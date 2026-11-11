//! The health summary over the ledger (US13). Monthly figures come from the same transaction query
//! as the Overview and the Transactions page, so each measure matches the records it links to.

use std::collections::HashMap;

use rusqlite::params;
use serde_json::{Value, json};

use super::accounts::list_accounts;
use super::planning::list_recurring;

use super::{Db, DbResult};
use crate::domain::dates::{add_months, end_of_month, start_of_month};
use crate::domain::health::{HealthInput, Month, health};
use crate::domain::insights::monthly_equivalent;
use crate::error::AppError;

const MONTHS: i32 = 6;

/// The transaction query's totals, which the grouped figures must equal (tests).
#[cfg(test)]
fn totals(db: &Db, filter: Value) -> DbResult<(i64, i64)> {
    let mut f = filter;
    f["kind"] = json!("standard");
    f["limit"] = json!(1);
    let page = super::transactions::query_transactions(db, &f)?;
    Ok((page["totals"]["inMinor"].as_i64().unwrap_or(0), -page["totals"]["outMinor"].as_i64().unwrap_or(0)))
}

/// Money in, money out and essential spending per month, in two grouped queries. Same rules as
/// the transaction query the links open (`kind = 'standard'`, split parts by category, exactly the
/// "needs" categories); a test checks they agree.
fn monthly(db: &Db, months: &[(String, String)]) -> DbResult<Vec<Month>> {
    let (Some(first), Some(last)) = (months.first(), months.last()) else { return Ok(Vec::new()) };
    let flows: HashMap<String, (i64, i64)> = db
        .query_map(
            "SELECT substr(posted_date, 1, 7),
              COALESCE(SUM(CASE WHEN amount_minor > 0 THEN amount_minor END), 0),
              COALESCE(-SUM(CASE WHEN amount_minor < 0 THEN amount_minor END), 0)
       FROM transactions WHERE deleted_at IS NULL AND kind = 'standard' AND posted_date BETWEEN ? AND ?
       GROUP BY 1",
            params![first.0, last.1],
            |r| Ok((r.get::<_, String>(0)?, (r.get::<_, i64>(1)?, r.get::<_, i64>(2)?))),
        )?
        .into_iter()
        .collect();
    let needs: HashMap<String, i64> = db
        .query_map(
            "SELECT substr(t.posted_date, 1, 7), COALESCE(-SUM(
           CASE WHEN EXISTS (SELECT 1 FROM splits s WHERE s.transaction_id = t.id)
             THEN (SELECT COALESCE(SUM(s.amount_minor), 0) FROM splits s JOIN categories c ON c.id = s.category_id
                   WHERE s.transaction_id = t.id AND c.grp = 'needs')
             ELSE CASE WHEN c.grp = 'needs' THEN t.amount_minor ELSE 0 END END), 0)
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.deleted_at IS NULL AND t.kind = 'standard' AND t.amount_minor < 0 AND t.posted_date BETWEEN ? AND ?
       GROUP BY 1",
            params![first.0, last.1],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
        )?
        .into_iter()
        .collect();
    Ok(months
        .iter()
        .map(|(from, _)| {
            let key = from[..7].to_owned();
            let (in_minor, out_minor) = flows.get(&key).copied().unwrap_or((0, 0));
            Month { needs_minor: needs.get(&key).copied().unwrap_or(0), month: key, in_minor, out_minor }
        })
        .collect())
}

/// Complete months before this one, oldest first, from the month of the first transaction.
fn complete_months(db: &Db, today: &str) -> DbResult<Vec<(String, String)>> {
    let first: Option<String> =
        db.query_row("SELECT MIN(posted_date) FROM transactions WHERE deleted_at IS NULL", [], |r| r.get(0))?.flatten();
    let Some(first) = first else { return Ok(Vec::new()) };
    let first_month = start_of_month(&first);
    let this_month = start_of_month(today);
    let mut out = Vec::new();
    for i in (1..=MONTHS).rev() {
        let from = add_months(&this_month, -i, None).map_err(|_| AppError::internal())?;
        if from < first_month {
            continue;
        }
        let to = end_of_month(&from).map_err(|_| AppError::internal())?;
        out.push((from, to));
    }
    Ok(out)
}

pub fn health_summary(db: &Db, today: &str) -> DbResult<Value> {
    let accounts = list_accounts(db, false)?;
    let liquid: Vec<&Value> = accounts.iter().filter(|a| a["isLiquid"] == true).collect();
    let cards: Vec<&Value> = accounts.iter().filter(|a| a["type"] == "credit_card").collect();
    let balance = |list: &[&Value]| list.iter().map(|a| a["balanceMinor"].as_i64().unwrap_or(0)).sum::<i64>();

    let months = monthly(db, &complete_months(db, today)?)?;

    let emis: Vec<Value> =
        list_recurring(db, today)?.into_iter().filter(|i| i["kind"] == "emi" && i["active"] == true).collect();
    let monthly_emi_minor = emis
        .iter()
        .map(|i| {
            monthly_equivalent(
                i["amountMinor"].as_i64().unwrap_or(0).abs(),
                i["frequency"].as_str().unwrap_or("monthly"),
                i["interval"].as_i64().unwrap_or(1),
            )
        })
        .sum();

    let measures = health(&HealthInput {
        has_cash_accounts: !liquid.is_empty(),
        cash_minor: balance(&liquid),
        months: &months,
        monthly_emi_minor,
        emi_count: emis.len(),
        card_owed_minor: balance(&cards),
        card_count: cards.len(),
    });
    // The months the "recent" figures cover, for the links to their transactions.
    let recent = &months[months.len().saturating_sub(3)..];
    let range = match (recent.first(), recent.last()) {
        (Some(a), Some(b)) => {
            json!({ "from": format!("{}-01", a.month), "to": end_of_month(&format!("{}-01", b.month)).unwrap_or_default() })
        }
        _ => Value::Null,
    };
    Ok(json!({
        "today": today,
        "recent": range,
        "measures": measures.iter().map(|m| json!({
            "key": m.key,
            "label": m.label,
            "value": m.value,
            "text": m.text,
            "available": m.available,
        })).collect::<Vec<_>>(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::accounts::create_account;
    use crate::db::categories::list_categories;
    use crate::db::test_db;
    use crate::db::transactions::create_transaction;

    #[test]
    fn health_reads_complete_months_and_needs_categories() {
        let db = test_db();
        let bank = create_account(
            &db,
            &json!({ "name": "Bank", "type": "bank", "openingDate": "2026-08-01", "openingBalanceMinor": 30_000_000 }),
        )
        .unwrap();
        let bank = bank["account"]["id"].as_str().unwrap().to_owned();
        let cats = list_categories(&db).unwrap();
        let id = |path: &str| cats.iter().find(|c| c["path"] == path).unwrap()["id"].clone();
        let (rent, dining, salary) = (id("Housing › Rent"), id("Food › Dining out"), id("Income › Salary"));
        assert_eq!(cats.iter().find(|c| c["path"] == "Housing › Rent").unwrap()["group"], "needs");
        for month in ["2026-08", "2026-09", "2026-10"] {
            let add = |amount: i64, cat: &Value| {
                create_transaction(
                    &db,
                    &json!({ "accountId": bank, "postedDate": format!("{month}-05"), "amountMinor": amount, "payee": "x", "categoryId": cat }),
                )
                .unwrap();
            };
            add(10_000_000, &salary);
            add(-2_500_000, &rent);
            add(-1_500_000, &dining);
        }
        // This month is not complete, so it is left out.
        create_transaction(&db, &json!({ "accountId": bank, "postedDate": "2026-11-02", "amountMinor": -9_000_000, "payee": "x", "categoryId": rent }))
            .unwrap();

        let h = health_summary(&db, "2026-11-10").unwrap();
        let m = |key: &str| h["measures"].as_array().unwrap().iter().find(|x| x["key"] == key).unwrap().clone();
        // Cash: 3,00,000 + 3 × (1,00,000 − 40,000) − 90,000 = 3,90,000. Needs: rent only, 25,000 a
        // month (dining out is "wants" even though Food is "needs").
        assert_eq!(m("emergency_cover")["value"], 15.6);
        assert_eq!(m("savings_rate")["value"], 60.0);
        assert_eq!(m("emi_share")["available"], false);
        assert_eq!(m("card_share")["text"], "No credit cards added.");
        assert_eq!(h["recent"], json!({ "from": "2026-08-01", "to": "2026-10-31" }));

        // The grouped figures equal what the linked transaction lists add up to.
        for m in monthly(&db, &complete_months(&db, "2026-11-10").unwrap()).unwrap() {
            let (from, to) = (format!("{}-01", m.month), end_of_month(&format!("{}-01", m.month)).unwrap());
            assert_eq!((m.in_minor, m.out_minor), totals(&db, json!({ "from": from, "to": to })).unwrap());
            let needs = totals(&db, json!({ "from": from, "to": to, "direction": "out", "categoryGroup": "needs" }));
            assert_eq!(m.needs_minor, needs.unwrap().1);
        }
    }
}
