//! The year in review over the ledger (US15). Money in and out per month come from the Overview's
//! own query, so the year equals the sum of its months (SC-016); categories and merchants come from
//! the same spending lines as Insights.

use std::collections::HashMap;

use rusqlite::params;
use serde_json::{Value, json};

use super::categories::list_categories;
use super::networth::net_worth_history_for;
use super::patterns::{clean_name, ledger_lines, payee_key};
use super::settings::get_settings;
use super::transactions::query_transactions;
use super::{Db, DbResult};
use crate::domain::dates::{add_days, add_months, end_of_month};
use crate::domain::year_review::{Basis, biggest_changes, period, top, year_of};
use crate::error::AppError;

type Totals = HashMap<String, (String, i64)>;

fn flow(db: &Db, from: &str, to: &str) -> DbResult<(i64, i64)> {
    let page = query_transactions(db, &json!({ "from": from, "to": to, "kind": "standard", "limit": 1 }))?;
    Ok((page["totals"]["inMinor"].as_i64().unwrap_or(0), -page["totals"]["outMinor"].as_i64().unwrap_or(0)))
}

/// Spending by top-level category and by merchant (positive = spent), as Insights counts it:
/// income and transfer categories are left out, and uncategorised money in is not a refund.
fn spending(db: &Db, from: &str, to: &str) -> DbResult<(Totals, Totals)> {
    let categories = list_categories(db)?;
    let by_id: HashMap<&str, &Value> = categories.iter().filter_map(|c| Some((c["id"].as_str()?, c))).collect();
    let mut cats: Totals = HashMap::new();
    let mut merchants: Totals = HashMap::new();
    for l in ledger_lines(db, from, to)? {
        let c = l.category_id.as_deref().and_then(|id| by_id.get(id));
        if c.is_some_and(|c| c["group"] == "income" || c["group"] == "transfer") || (c.is_none() && l.amount_minor > 0)
        {
            continue;
        }
        let spent = -l.amount_minor;
        let (key, name) = match c {
            Some(c) => {
                let top = c["parentId"].as_str().and_then(|p| by_id.get(p)).unwrap_or(c);
                (top["id"].as_str().unwrap_or_default().to_owned(), top["name"].as_str().unwrap_or_default().to_owned())
            }
            None => (String::new(), "Uncategorised".to_owned()),
        };
        let e = cats.entry(key).or_insert((name, 0));
        e.1 += spent;
        let mkey = l.mkey.clone().unwrap_or_else(|| payee_key(&l.payee));
        let mname = l.mname.clone().unwrap_or_else(|| clean_name(&l.payee));
        let e = merchants.entry(mkey).or_insert((mname, 0));
        e.1 += spent;
    }
    Ok((cats, merchants))
}

pub fn year_review(db: &Db, basis: &str, year: Option<i64>, today: &str) -> DbResult<Value> {
    let fy = get_settings(db)?["fyStartMonth"].as_i64().unwrap_or(4) as u32;
    let basis = Basis::parse(basis);
    let first: Option<String> =
        db.query_row("SELECT MIN(posted_date) FROM transactions WHERE deleted_at IS NULL", [], |r| r.get(0))?.flatten();
    let current = year_of(basis, today, fy);
    let oldest = first.as_deref().map_or(current, |d| year_of(basis, d, fy));
    // Default: the last complete year with any data, otherwise this one so far.
    let year = year.map(|y| y as i32).unwrap_or(if oldest < current { current - 1 } else { current });
    let (from, end, label) = period(basis, year, fy);
    let partial = end.as_str() > today;
    let to = if partial { today.to_owned() } else { end.clone() };
    if from.as_str() > today {
        return Err(AppError::invariant("That year has not started yet"));
    }

    let mut months = Vec::new();
    let (mut total_in, mut total_out) = (0, 0);
    let mut m = from.clone();
    while m <= to {
        let m_end = end_of_month(&m).map_err(|_| AppError::internal())?;
        let m_to = if m_end > to { to.clone() } else { m_end };
        let (inn, out) = flow(db, &m, &m_to)?;
        total_in += inn;
        total_out += out;
        months.push(json!({ "month": &m[..7], "from": m, "to": m_to, "inMinor": inn, "outMinor": out }));
        m = add_months(&m, 1, None).map_err(|_| AppError::internal())?;
    }

    let (cats, merchants) = spending(db, &from, &to)?;
    let top_categories: Vec<Value> = top(&cats, 5)
        .into_iter()
        .map(|(k, name, amount)| json!({ "categoryId": if k.is_empty() { Value::Null } else { json!(k) }, "name": name, "amountMinor": amount }))
        .collect();
    let top_merchants: Vec<Value> = top(&merchants, 5)
        .into_iter()
        .map(|(_, name, amount)| json!({ "name": name, "amountMinor": amount }))
        .collect();

    // Against the same stretch of the year before (to the same day, for a year still going).
    let (prev_from, _, _) = period(basis, year - 1, fy);
    let prev_to = add_days(&add_months(&to, -12, None).map_err(|_| AppError::internal())?, 0).unwrap_or_default();
    let had_previous = first.as_deref().is_some_and(|f| f <= prev_to.as_str());
    let changes = if had_previous {
        let (before, _) = spending(db, &prev_from, &prev_to)?;
        let named = |t: &Totals| -> Totals {
            t.iter().filter(|(k, _)| !k.is_empty()).map(|(k, v)| (k.clone(), v.clone())).collect()
        };
        json!(biggest_changes(&named(&cats), &named(&before), 5)
            .into_iter()
            .map(|(id, name, now, then)| json!({ "categoryId": id, "name": name, "thisMinor": now, "lastMinor": then }))
            .collect::<Vec<_>>())
    } else {
        Value::Null
    };

    // Goals saved by contributions: the day the total first reached the target.
    let mut goals_reached = Vec::new();
    for (id, name, target) in db.query_map(
        "SELECT id, name, target_minor FROM goals WHERE archived_at IS NULL AND linked_account_id IS NULL ORDER BY sort_order, created_at",
        [],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)),
    )? {
        let mut sum = 0;
        for (date, amount) in db.query_map(
            "SELECT date, amount_minor FROM goal_contributions WHERE goal_id = ? ORDER BY date, id",
            params![id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
        )? {
            sum += amount;
            if sum >= target {
                if date >= from && date <= to {
                    goals_reached.push(json!({ "id": id, "name": name, "targetMinor": target, "reachedOn": date }));
                }
                break;
            }
        }
    }

    let worth = net_worth_history_for(db, today, Some(&from), Some(&to))?;
    let points = worth["points"].as_array().cloned().unwrap_or_default();
    let net = |p: Option<&Value>| p.and_then(|p| p["netMinor"].as_i64()).unwrap_or(0);

    let saved = total_in - total_out;
    Ok(json!({
        "basis": basis.as_str(),
        "year": year,
        "label": label,
        "from": from,
        "to": to,
        "partial": partial,
        "dataFrom": first.filter(|f| f.as_str() > from.as_str()),
        "inMinor": total_in,
        "outMinor": total_out,
        "savedMinor": saved,
        "savingsRate": if total_in > 0 { json!((saved as f64 / total_in as f64 * 100.0).round()) } else { Value::Null },
        "months": months,
        "topCategories": top_categories,
        "topMerchants": top_merchants,
        "changes": changes,
        "goalsReached": goals_reached,
        "netWorth": { "startMinor": net(points.first()), "endMinor": net(points.last()) },
        "years": (oldest..=current).rev().collect::<Vec<_>>(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::accounts::create_account;
    use crate::db::dashboard::dashboard_summary;
    use crate::db::test_db;
    use crate::db::transactions::create_transaction;

    #[test]
    fn a_year_is_the_sum_of_its_months_and_ranks_what_stood_out() {
        let db = test_db();
        let bank = create_account(
            &db,
            &json!({ "name": "Bank", "type": "bank", "openingDate": "2024-04-01", "openingBalanceMinor": 10_000_000 }),
        )
        .unwrap();
        let bank = bank["account"]["id"].as_str().unwrap().to_owned();
        let cats = list_categories(&db).unwrap();
        let id = |path: &str| cats.iter().find(|c| c["path"] == path).unwrap()["id"].clone();
        let add = |date: &str, amount: i64, payee: &str, cat: Value| {
            create_transaction(&db, &json!({ "accountId": bank, "postedDate": date, "amountMinor": amount, "payee": payee, "categoryId": cat }))
                .unwrap();
        };
        add("2024-06-10", -400_000, "Goa trip", id("Travel › Flights & trains"));
        add("2025-04-05", 5_000_000, "ACME", id("Income › Salary"));
        add("2025-05-03", -300_000, "DMart", id("Food › Groceries"));
        add("2025-05-20", -200_000, "Toit", id("Food › Dining out"));
        add("2026-02-14", -1_000_000, "Landlord", id("Housing › Rent"));
        add("2026-04-02", -50_000, "Next year", id("Housing › Rent"));

        let y = year_review(&db, "fy", None, "2026-05-01").unwrap();
        assert_eq!(
            (y["year"].clone(), y["label"].clone(), y["partial"].clone()),
            (json!(2025), json!("FY 2025-26"), json!(false))
        );
        assert_eq!(
            (y["inMinor"].clone(), y["outMinor"].clone(), y["savedMinor"].clone()),
            (json!(5_000_000), json!(1_500_000), json!(3_500_000))
        );
        assert_eq!(y["savingsRate"], 70.0);
        assert_eq!(y["months"].as_array().unwrap().len(), 12);
        // Each month's money out is the Overview's "Spent" for that month.
        let feb = &y["months"][10];
        assert_eq!(feb["month"], "2026-02");
        assert_eq!(dashboard_summary(&db, "2026-02-28").unwrap()["spent"]["valueMinor"], feb["outMinor"]);
        let names: Vec<&str> =
            y["topCategories"].as_array().unwrap().iter().map(|c| c["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["Housing", "Food"]);
        assert_eq!(y["topCategories"][1]["amountMinor"], 500_000);
        let changes = y["changes"].as_array().unwrap();
        assert_eq!(changes[0]["name"], "Housing");
        assert!(changes.iter().any(|c| c["name"] == "Travel" && c["thisMinor"] == 0 && c["lastMinor"] == 400_000));
        assert_eq!(y["years"], json!([2026, 2025, 2024]));

        let current = year_review(&db, "calendar", Some(2026), "2026-05-01").unwrap();
        assert_eq!((current["to"].clone(), current["partial"].clone()), (json!("2026-05-01"), json!(true)));
    }
}
