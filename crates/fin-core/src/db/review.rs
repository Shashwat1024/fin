//! The monthly review (US14): what each step has to look at for a month, whether the month was
//! reviewed, the Overview's prompt, and copying a month's budget into the next.

use rusqlite::params;
use serde_json::{Value, json};

use super::accounts::list_accounts;
use super::audit::with_audit;
use super::planning::budget_month;
use super::transactions::query_transactions;
use super::{Db, DbResult, new_id, now_iso};
use crate::domain::dates::{add_months, end_of_month};
use crate::domain::ledger::display_balance;
use crate::error::AppError;
use crate::row;

fn month_range(month: &str) -> DbResult<(String, String)> {
    let from = format!("{month}-01");
    let to = end_of_month(&from).map_err(|_| AppError::invariant("Invalid month"))?;
    Ok((from, to))
}

fn shift(month: &str, by: i32) -> DbResult<String> {
    Ok(add_months(&format!("{month}-01"), by, None).map_err(|_| AppError::invariant("Invalid month"))?[..7].to_owned())
}

fn state_of(db: &Db, month: &str) -> DbResult<Value> {
    Ok(db
        .get_json("SELECT month, state, at FROM month_reviews WHERE month = ?", [month])?
        .map_or(Value::Null, Value::Object))
}

pub fn review_month(db: &Db, month: &str) -> DbResult<Value> {
    let (from, to) = month_range(month)?;
    let next = shift(month, 1)?;
    let count = |filter: Value| -> DbResult<i64> {
        let mut f = filter;
        f["from"] = json!(from);
        f["to"] = json!(to);
        f["limit"] = json!(1);
        Ok(query_transactions(db, &f)?["totals"]["count"].as_i64().unwrap_or(0))
    };

    // Accounts with statements to check: cash, bank and cards, as they stood at the month's end.
    let mut accounts = Vec::new();
    for a in list_accounts(db, false)? {
        let t = a["type"].as_str().unwrap_or_default().to_owned();
        if a["isLiquid"] != true && t != "credit_card" {
            continue;
        }
        let id = a["id"].as_str().unwrap_or_default().to_owned();
        let (to_end, in_month): (i64, i64) = db
            .query_row(
                "SELECT COALESCE(SUM(CASE WHEN posted_date <= ?2 THEN amount_minor END), 0),
                COALESCE(SUM(CASE WHEN posted_date BETWEEN ?3 AND ?2 THEN 1 ELSE 0 END), 0)
         FROM transactions WHERE account_id = ?1 AND deleted_at IS NULL",
                params![id, to, from],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?
            .unwrap_or((0, 0));
        let opening: i64 =
            db.query_row("SELECT opening_balance_minor FROM accounts WHERE id = ?", [&id], |r| r.get(0))?.unwrap_or(0);
        accounts.push(json!({
            "accountId": id,
            "name": a["name"],
            "type": t,
            "monthEndBalanceMinor": display_balance(&t, opening + to_end),
            "txnCount": in_month,
        }));
    }

    let budget = budget_month(db, month)?;
    let mut overspent = Vec::new();
    for g in budget["groups"].as_array().into_iter().flatten() {
        for r in g["rows"].as_array().into_iter().flatten() {
            let available = r["availableMinor"].as_i64().unwrap_or(0);
            if available < 0 {
                overspent.push(json!({
                    "categoryId": r["categoryId"],
                    "path": format!("{} › {}", g["name"].as_str().unwrap_or_default(), r["name"].as_str().unwrap_or_default()),
                    "overMinor": -available,
                }));
            }
        }
    }
    let next_assigned: i64 = db
        .query_row("SELECT COALESCE(SUM(assigned_minor), 0) FROM monthly_budgets WHERE month = ?", [&next], |r| {
            r.get(0)
        })?
        .unwrap_or(0);
    let copyable: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM monthly_budgets b WHERE b.month = ? AND b.assigned_minor > 0
       AND NOT EXISTS (SELECT 1 FROM monthly_budgets n WHERE n.month = ? AND n.category_id = b.category_id AND n.assigned_minor > 0)",
            params![month, next],
            |r| r.get(0),
        )?
        .unwrap_or(0);

    Ok(json!({
        "month": month,
        "from": from,
        "to": to,
        "nextMonth": next,
        "state": state_of(db, month)?,
        "transactionCount": count(json!({}))?,
        "uncategorizedCount": count(json!({ "categoryIds": ["uncategorized"] }))?,
        "accounts": accounts,
        "budget": {
            "assignedMinor": budget["assignedMinor"],
            "spentMinor": budget["spentMinor"],
            "overspent": overspent,
        },
        "next": { "assignedMinor": next_assigned, "copyableCount": copyable },
    }))
}

/// Mark a month reviewed or dismissed (or clear it). Audited, so it can be undone.
pub fn set_review_state(db: &Db, month: &str, state: Option<&str>) -> DbResult<Value> {
    let existing = db.query_row("SELECT id FROM month_reviews WHERE month = ?", [month], |r| r.get::<_, String>(0))?;
    let label = match state {
        Some("reviewed") => format!("Mark {month} reviewed"),
        Some(_) => format!("Skip the review of {month}"),
        None => format!("Reopen the review of {month}"),
    };
    let audited = with_audit(db, &label, None, |a| {
        match (&existing, state) {
            (Some(id), None) => a.remove("month_reviews", id)?,
            (None, None) => {}
            (Some(id), Some(s)) => {
                a.update("month_reviews", id, row! { "state" => s, "at" => now_iso() })?;
            }
            (None, Some(s)) => {
                a.insert(
                    "month_reviews",
                    row! { "id" => new_id("rev"), "month" => month, "state" => s, "at" => now_iso() },
                )?;
            }
        }
        Ok(())
    })?;
    Ok(json!({ "review": state_of(db, month)?, "auditGroupId": audited.audit_group_id }))
}

/// From the 1st to the 7th, last month, if it had transactions and was neither reviewed nor skipped.
pub fn review_prompt(db: &Db, today: &str) -> DbResult<Value> {
    if today[8..10].parse::<u32>().unwrap_or(31) > 7 {
        return Ok(Value::Null);
    }
    let last = shift(&today[..7], -1)?;
    let (from, to) = month_range(&last)?;
    let had_any = db
        .query_row(
            "SELECT 1 FROM transactions WHERE deleted_at IS NULL AND posted_date BETWEEN ? AND ? LIMIT 1",
            params![from, to],
            |_| Ok(()),
        )?
        .is_some();
    if !had_any || !state_of(db, &last)?.is_null() {
        return Ok(Value::Null);
    }
    Ok(json!({ "month": last }))
}

/// Copy `from`'s assigned amounts into `to`, only for categories with nothing assigned there. One
/// undoable change.
pub fn copy_budget(db: &Db, from: &str, to: &str) -> DbResult<Value> {
    if from == to {
        return Err(AppError::invariant("Choose two different months"));
    }
    let rows = db.query_map(
        "SELECT b.category_id, b.assigned_minor, n.id FROM monthly_budgets b
     LEFT JOIN monthly_budgets n ON n.month = ?2 AND n.category_id = b.category_id
     WHERE b.month = ?1 AND b.assigned_minor > 0 AND COALESCE(n.assigned_minor, 0) = 0",
        params![from, to],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, Option<String>>(2)?)),
    )?;
    let copied = rows.len();
    let audited = with_audit(db, &format!("Copy the {from} budget to {to}"), None, |a| {
        for (category, amount, existing) in &rows {
            match existing {
                Some(id) => {
                    a.update("monthly_budgets", id, row! { "assigned_minor" => amount, "updated_at" => now_iso() })?;
                }
                None => {
                    a.insert(
                        "monthly_budgets",
                        row! { "id" => new_id("bud"), "month" => to, "category_id" => category, "assigned_minor" => amount, "updated_at" => now_iso() },
                    )?;
                }
            }
        }
        Ok(())
    })?;
    Ok(json!({ "copied": copied, "auditGroupId": audited.audit_group_id }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::accounts::create_account;
    use crate::db::audit::undo_group;
    use crate::db::categories::list_categories;
    use crate::db::planning::assign_budget;
    use crate::db::test_db;
    use crate::db::transactions::create_transaction;

    #[test]
    fn a_month_is_reviewed_prompted_and_its_budget_copied() {
        let db = test_db();
        let bank = create_account(
            &db,
            &json!({ "name": "Bank", "type": "bank", "openingDate": "2026-09-01", "openingBalanceMinor": 1_000_000 }),
        )
        .unwrap();
        let bank = bank["account"]["id"].as_str().unwrap().to_owned();
        let cats = list_categories(&db).unwrap();
        let id = |path: &str| cats.iter().find(|c| c["path"] == path).unwrap()["id"].as_str().unwrap().to_owned();
        let (rent, groceries) = (id("Housing › Rent"), id("Food › Groceries"));
        create_transaction(
            &db,
            &json!({ "accountId": bank, "postedDate": "2026-10-03", "amountMinor": -50_000, "payee": "Shop" }),
        )
        .unwrap();
        create_transaction(
            &db,
            &json!({ "accountId": bank, "postedDate": "2026-10-04", "amountMinor": -300_000, "payee": "DMart", "categoryId": groceries }),
        )
        .unwrap();
        assign_budget(&db, "2026-10", &rent, 2_500_000).unwrap();
        assign_budget(&db, "2026-10", &groceries, 200_000).unwrap();
        assign_budget(&db, "2026-11", &groceries, 900_000).unwrap();

        let r = review_month(&db, "2026-10").unwrap();
        assert_eq!((r["transactionCount"].clone(), r["uncategorizedCount"].clone()), (json!(2), json!(1)));
        assert_eq!(r["accounts"][0]["monthEndBalanceMinor"], 650_000);
        assert_eq!(r["budget"]["overspent"][0]["path"], "Food › Groceries");
        assert_eq!(r["budget"]["overspent"][0]["overMinor"], 100_000);
        assert_eq!(r["next"]["copyableCount"], 1, "groceries already has an amount in November");

        // The Overview asks about October in the first week of November, until it is reviewed.
        assert_eq!(review_prompt(&db, "2026-11-03").unwrap(), json!({ "month": "2026-10" }));
        assert_eq!(review_prompt(&db, "2026-11-08").unwrap(), Value::Null);
        let done = set_review_state(&db, "2026-10", Some("reviewed")).unwrap();
        assert_eq!(done["review"]["state"], "reviewed");
        assert_eq!(review_prompt(&db, "2026-11-03").unwrap(), Value::Null);
        undo_group(&db, done["auditGroupId"].as_str().unwrap()).unwrap();
        assert_eq!(review_prompt(&db, "2026-11-03").unwrap(), json!({ "month": "2026-10" }));

        // Copying fills only empty categories, and undoes in one step.
        let copied = copy_budget(&db, "2026-10", "2026-11").unwrap();
        assert_eq!(copied["copied"], 1);
        let nov = budget_month(&db, "2026-11").unwrap();
        assert_eq!(nov["assignedMinor"], 3_400_000);
        undo_group(&db, copied["auditGroupId"].as_str().unwrap()).unwrap();
        assert_eq!(budget_month(&db, "2026-11").unwrap()["assignedMinor"], 900_000);
    }
}
