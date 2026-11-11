//! The Overview (`src/db/repos/dashboard.ts`). Every figure is computed by the same query its
//! drill-down page uses, so the two always agree (SC-005).

use std::collections::HashMap;

use serde_json::{Value, json};

use super::accounts::list_accounts;
use super::networth::net_worth_now;
use super::transactions::query_transactions;
use super::{Db, DbResult};
use crate::domain::dates::{add_months, end_of_month, start_of_month};
use crate::error::AppError;

fn bad_date(_: crate::domain::dates::DateError) -> AppError {
    AppError::internal()
}

/// Same day last month, clamped to that month's length (31 Mar → 28/29 Feb).
pub fn same_point_last_month(today: &str) -> DbResult<(String, String)> {
    let from = add_months(&start_of_month(today), -1, None).map_err(bad_date)?;
    let shifted = add_months(today, -1, None).map_err(bad_date)?;
    let end = end_of_month(&from).map_err(bad_date)?;
    Ok((from, if shifted > end { end } else { shifted }))
}

/// Which accounts each balance metric covers; the Accounts page filters the same way.
fn in_group(group: &str, a: &Value) -> bool {
    let t = a["type"].as_str().unwrap_or_default();
    match group {
        "cash" => a["isLiquid"] == true,
        "cards" => t == "credit_card",
        "owed" => a["nature"] == "liability",
        _ => true,
    }
}

fn sources(db: &Db, accounts: &[Value], today: &str) -> DbResult<Vec<Value>> {
    let imports: HashMap<String, Value> = db
        .query_map(
            "SELECT account_id, imported_at AS at, file_name FROM import_batches b
       WHERE undone_at IS NULL AND imported_at = (
         SELECT MAX(imported_at) FROM import_batches x WHERE x.account_id = b.account_id AND x.undone_at IS NULL)",
            [],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    json!({ "at": r.get::<_, String>(1)?, "fileName": r.get::<_, String>(2)? }),
                ))
            },
        )?
        .into_iter()
        .collect();
    // A recorded value (investments, loans) is data too: it brings the account up to that date.
    let valued: HashMap<String, String> = db
        .query_map("SELECT account_id, MAX(date) AS d FROM valuations GROUP BY account_id", [], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?
        .into_iter()
        .collect();
    Ok(accounts
        .iter()
        .map(|a| {
            let id = a["id"].as_str().unwrap_or_default();
            let latest = [a["openingDate"].as_str(), a["lastTxnDate"].as_str(), valued.get(id).map(String::as_str)]
                .into_iter()
                .flatten()
                .filter(|d| !d.is_empty())
                .max()
                .unwrap_or_default();
            json!({
                "accountId": id,
                "accountName": a["name"],
                "lastDataDate": if latest > today { today } else { latest },
                "lastImport": imports.get(id).cloned().unwrap_or(Value::Null),
            })
        })
        .collect())
}

fn metric(value_minor: i64, src: Vec<Value>, drill: Value) -> serde_json::Map<String, Value> {
    let as_of = src.iter().filter_map(|s| s["lastDataDate"].as_str()).min().map_or(Value::Null, Value::from);
    let mut m = serde_json::Map::new();
    m.insert("valueMinor".into(), json!(value_minor));
    m.insert("asOf".into(), as_of);
    m.insert("sources".into(), Value::Array(src));
    m.insert("drill".into(), drill);
    m
}

/// Money in/out (transfers excluded) through the same query the Transactions page uses.
fn flow(db: &Db, from: &str, to: &str) -> DbResult<(i64, i64)> {
    let page = query_transactions(db, &json!({ "from": from, "to": to, "kind": "standard", "limit": 1 }))?;
    let totals = &page["totals"];
    Ok((totals["inMinor"].as_i64().unwrap_or(0), -totals["outMinor"].as_i64().unwrap_or(0)))
}

/// `Math.round`: halves round up (towards +∞).
pub fn js_round(x: f64) -> i64 {
    (x + 0.5).floor() as i64
}

pub fn dashboard_summary(db: &Db, today: &str) -> DbResult<Value> {
    let accounts = list_accounts(db, false)?;
    let all_sources = sources(db, &accounts, today)?;
    let sources_for = |group: &str| -> Vec<Value> {
        let ids: Vec<&Value> = accounts.iter().filter(|a| in_group(group, a)).map(|a| &a["id"]).collect();
        all_sources.iter().filter(|s| ids.contains(&&s["accountId"])).cloned().collect()
    };
    let sum_group = |group: &str| -> i64 {
        accounts.iter().filter(|a| in_group(group, a)).map(|a| a["balanceMinor"].as_i64().unwrap_or(0)).sum()
    };
    // Spending and income happen in cash, bank and card accounts.
    let spending_sources: Vec<Value> = all_sources
        .iter()
        .filter(|x| {
            accounts
                .iter()
                .find(|a| a["id"] == x["accountId"])
                .is_some_and(|a| a["isLiquid"] == true || a["type"] == "credit_card")
        })
        .cloned()
        .collect();

    let month_start = start_of_month(today);
    let (cur_in, cur_out) = flow(db, &month_start, today)?;
    let (prev_from, prev_to) = same_point_last_month(today)?;
    let (_, prev_out) = flow(db, &prev_from, &prev_to)?;
    let mtd = json!({ "page": "transactions", "from": month_start, "to": today, "kind": "standard" });
    let with = |extra: (&str, &str)| {
        let mut d = mtd.clone();
        d[extra.0] = json!(extra.1);
        d
    };

    let worth = net_worth_now(db, today, &accounts)?;
    let savings_rate =
        if cur_in > 0 { json!(js_round(((cur_in - cur_out) as f64 / cur_in as f64) * 100.0)) } else { Value::Null };

    let mut months = Vec::new();
    for i in (0..=5).rev() {
        let from = add_months(&month_start, -i, None).map_err(bad_date)?;
        let to = if i == 0 { today.to_owned() } else { end_of_month(&from).map_err(bad_date)? };
        let (inn, out) = flow(db, &from, &to)?;
        months.push(json!({ "month": &from[..7], "from": from, "to": to, "inMinor": inn, "outMinor": out }));
    }

    let mut spent = metric(cur_out, spending_sources.clone(), with(("direction", "out")));
    spent.insert("previousMinor".into(), json!(prev_out));
    spent.insert("previousFrom".into(), json!(prev_from));
    spent.insert("previousTo".into(), json!(prev_to));
    let mut card_dues =
        metric(sum_group("cards"), sources_for("cards"), json!({ "page": "accounts", "group": "cards" }));
    card_dues.insert("cardCount".into(), json!(accounts.iter().filter(|a| in_group("cards", a)).count()));
    let (next_due, all_paid) = super::cards::next_due(db, today, &accounts)?;
    card_dues.insert("nextDue".into(), next_due);
    card_dues.insert("allPaid".into(), json!(all_paid));
    let mut net_worth = metric(worth.net_minor, all_sources.clone(), json!({ "page": "networth" }));
    net_worth.insert("assetsMinor".into(), json!(worth.assets_minor));
    net_worth.insert("owedMinor".into(), json!(worth.liabilities_minor));

    Ok(json!({
        "today": today,
        "cash": metric(sum_group("cash"), sources_for("cash"), json!({ "page": "accounts", "group": "cash" })),
        "spent": spent,
        "income": metric(cur_in, spending_sources, with(("direction", "in"))),
        "savingsRate": { "percent": savings_rate, "drill": mtd },
        "cardDues": card_dues,
        "netWorth": net_worth,
        "months": months,
    }))
}
