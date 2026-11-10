//! Net worth now and by month, and recorded values (`src/db/repos/insights.ts`, FR-028).

use std::collections::HashMap;

use rusqlite::params;
use serde_json::{Value, json};

use super::accounts::list_accounts;
use super::audit::with_audit;
use super::{Db, DbResult, new_id, now_iso};
use crate::domain::dates::{add_months, start_of_month};
use crate::domain::ledger::is_liquid;
use crate::domain::networth::{NetWorthAccount, can_be_valued, net_worth_history};
use crate::error::AppError;
use crate::row;

fn s(v: &Value, k: &str) -> String {
    v[k].as_str().unwrap_or_default().to_owned()
}

fn net_worth_accounts(db: &Db, accounts: &[Value]) -> DbResult<Vec<NetWorthAccount>> {
    let mut daily: HashMap<String, Vec<(String, i64)>> = HashMap::new();
    for (acc, d, total) in db.query_map(
        "SELECT account_id, posted_date AS d, SUM(amount_minor) AS total FROM transactions
     WHERE deleted_at IS NULL GROUP BY account_id, posted_date",
        [],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)),
    )? {
        daily.entry(acc).or_default().push((d, total));
    }
    let mut vals: HashMap<String, Vec<(String, i64)>> = HashMap::new();
    for (acc, d, v) in db.query_map("SELECT account_id, date, value_minor FROM valuations", [], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
    })? {
        vals.entry(acc).or_default().push((d, v));
    }
    let stored: HashMap<String, i64> = db
        .query_map("SELECT id, opening_balance_minor FROM accounts", [], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })?
        .into_iter()
        .collect();
    Ok(accounts
        .iter()
        .map(|a| {
            let id = s(a, "id");
            NetWorthAccount {
                account_type: s(a, "type"),
                opening_minor: stored.get(&id).copied().unwrap_or(0),
                opening_date: s(a, "openingDate"),
                daily: daily.remove(&id).unwrap_or_default(),
                valuations: vals.remove(&id).unwrap_or_default(),
            }
        })
        .collect())
}

pub struct NetWorthNow {
    pub date: String,
    pub assets_minor: i64,
    pub liabilities_minor: i64,
    pub net_minor: i64,
    /// (account, value, source, valuation date)
    pub values: Vec<(Value, i64, &'static str, Option<String>)>,
}

impl NetWorthNow {
    pub fn point(&self) -> Value {
        json!({ "date": self.date, "assetsMinor": self.assets_minor, "liabilitiesMinor": self.liabilities_minor, "netMinor": self.net_minor })
    }
}

/// Net worth now, from account balances and the latest value of each valued account. The
/// Overview card and the Net worth page both use it, so they always agree.
pub fn net_worth_now(db: &Db, today: &str, accounts: &[Value]) -> DbResult<NetWorthNow> {
    let latest: HashMap<String, (String, i64)> = db
        .query_map(
            "SELECT v.account_id, v.date, v.value_minor FROM valuations v
       WHERE v.date = (SELECT MAX(date) FROM valuations x WHERE x.account_id = v.account_id)",
            [],
            |r| Ok((r.get::<_, String>(0)?, (r.get::<_, String>(1)?, r.get::<_, i64>(2)?))),
        )?
        .into_iter()
        .collect();
    let (mut assets, mut liabilities) = (0i64, 0i64);
    let values = accounts
        .iter()
        .map(|a| {
            let v = if can_be_valued(&s(a, "type")) { latest.get(&s(a, "id")) } else { None };
            let (value, source, date) = match v {
                Some((d, m)) => (*m, "valuation", Some(d.clone())),
                None => (a["balanceMinor"].as_i64().unwrap_or(0), "ledger", None),
            };
            if a["nature"] == "asset" {
                assets += value;
            } else {
                liabilities += value;
            }
            (a.clone(), value, source, date)
        })
        .collect();
    Ok(NetWorthNow {
        date: today.to_owned(),
        assets_minor: assets,
        liabilities_minor: liabilities,
        net_minor: assets - liabilities,
        values,
    })
}

/// Month-end net worth from `from` (default: 11 months ago, or the first opening) to today.
pub fn net_worth_history_for(db: &Db, today: &str, from: Option<&str>, to: Option<&str>) -> DbResult<Value> {
    let accounts = list_accounts(db, false)?;
    let nw = net_worth_accounts(db, &accounts)?;
    let earliest = accounts.iter().map(|a| s(a, "openingDate")).min().unwrap_or_else(|| today.to_owned());
    let default_from = add_months(&start_of_month(today), -11, None).map_err(|_| AppError::internal())?;
    let mut start = from
        .map(str::to_owned)
        .unwrap_or_else(|| if earliest > default_from { earliest.clone() } else { default_from });
    if start < earliest {
        start = earliest;
    }
    let end = match to {
        Some(t) if t < today => t.to_owned(),
        _ => today.to_owned(),
    };
    if start > end {
        start = end.clone();
    }
    let now = net_worth_now(db, today, &accounts)?;
    let mut points: Vec<Value> = net_worth_history(&nw, &start, &end)
        .into_iter()
        .map(|p| json!({ "date": p.date, "assetsMinor": p.assets_minor, "liabilitiesMinor": p.liabilities_minor, "netMinor": p.net_minor }))
        .collect();
    if end == today
        && let Some(last) = points.last_mut()
    {
        *last = now.point();
    }
    Ok(json!({
        "today": today,
        "current": now.point(),
        "points": points,
        "accounts": now.values.iter().map(|(a, value, source, date)| json!({
            "id": a["id"],
            "name": a["name"],
            "type": a["type"],
            "nature": a["nature"],
            "valueMinor": value,
            "source": source,
            "valuationDate": date,
            "ledgerMinor": a["balanceMinor"],
            "canValue": can_be_valued(&s(a, "type")),
        })).collect::<Vec<_>>(),
    }))
}

fn valuation_dto(r: &serde_json::Map<String, Value>) -> Value {
    json!({ "id": r["id"], "accountId": r["account_id"], "date": r["date"], "valueMinor": r["value_minor"], "note": r["note"] })
}

pub fn list_valuations(db: &Db, account_id: &str) -> DbResult<Vec<Value>> {
    Ok(db
        .all_json("SELECT * FROM valuations WHERE account_id = ? ORDER BY date DESC", [account_id])?
        .iter()
        .map(valuation_dto)
        .collect())
}

/// Record what an investment, loan or other asset/liability is worth on a date (one per day).
pub fn upsert_valuation(db: &Db, input: &Value, today: &str) -> DbResult<Value> {
    let account_id = s(input, "accountId");
    let date = s(input, "date");
    let account = db.query_row("SELECT name, type, archived_at FROM accounts WHERE id = ?", [&account_id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?))
    })?;
    let Some((name, t, archived)) = account else { return Err(AppError::not_found("Account")) };
    if !can_be_valued(&t) {
        return Err(AppError::invariant(if is_liquid(&t) || t == "credit_card" {
            "This account’s balance comes from its transactions"
        } else {
            "This account cannot be valued"
        }));
    }
    if archived.is_some() {
        return Err(AppError::invariant("This account is archived. Restore it before recording a value."));
    }
    if date.as_str() > today {
        return Err(AppError::invariant("A value can only be recorded for today or earlier"));
    }
    let existing =
        db.query_row("SELECT id FROM valuations WHERE account_id = ? AND date = ?", params![account_id, date], |r| {
            r.get::<_, String>(0)
        })?;
    let audited = with_audit(db, &format!("Record value of {name}"), None, |a| {
        let fields = row! {
            "value_minor" => input["valueMinor"],
            "note" => input.get("note").cloned().unwrap_or(Value::Null),
            "updated_at" => now_iso(),
        };
        if let Some(id) = &existing {
            a.update("valuations", id, fields)?;
            return Ok(id.clone());
        }
        let id = new_id("val");
        let mut row = row! { "id" => id, "account_id" => account_id, "date" => date };
        row.extend(fields);
        row.insert("created_at".into(), json!(now_iso()));
        a.insert("valuations", row)?;
        Ok(id)
    })?;
    let v = db
        .get_json("SELECT * FROM valuations WHERE id = ?", [&audited.result])?
        .ok_or_else(|| AppError::not_found("Valuation"))?;
    Ok(json!({ "valuation": valuation_dto(&v), "auditGroupId": audited.audit_group_id }))
}

pub fn delete_valuation(db: &Db, id: &str) -> DbResult<Value> {
    let name = db.query_row(
        "SELECT a.name FROM valuations v JOIN accounts a ON a.id = v.account_id WHERE v.id = ?",
        [id],
        |r| r.get::<_, String>(0),
    )?;
    let Some(name) = name else { return Err(AppError::not_found("Valuation")) };
    let audited = with_audit(db, &format!("Delete value of {name}"), None, |a| a.remove("valuations", id))?;
    Ok(json!({ "auditGroupId": audited.audit_group_id }))
}
