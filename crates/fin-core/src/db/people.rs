//! Who owes whom over the ledger (US21): people, their entries (shares of expenses, money lent or
//! owed, repayments), balances and repayment suggestions. Rules are in `domain/ious.rs`. Spending is
//! not changed: an entry only records who owes what.

use rusqlite::params;
use serde_json::{Map, Value, json};

use super::audit::with_audit;
use super::{Db, DbResult, is_unique_violation, new_id, now_iso};
use crate::domain::dates::add_days;
use crate::domain::ious::{Candidate, LOOKBACK_DAYS, describe, rank_repayments};
use crate::error::AppError;
use crate::row;

fn s<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(Value::as_str)
}

fn person_row(db: &Db, id: &str) -> DbResult<Map<String, Value>> {
    db.get_json("SELECT * FROM people WHERE id = ?", [id])?.ok_or_else(|| AppError::not_found("Person"))
}

fn balance_of(db: &Db, id: &str) -> DbResult<i64> {
    Ok(db
        .query_row("SELECT COALESCE(SUM(amount_minor), 0) FROM shares WHERE person_id = ?", [id], |r| r.get(0))?
        .unwrap_or(0))
}

fn person_dto(db: &Db, p: &Map<String, Value>) -> DbResult<Value> {
    let id = p["id"].as_str().unwrap_or_default();
    let name = p["name"].as_str().unwrap_or_default();
    let balance = balance_of(db, id)?;
    let last: Option<String> =
        db.query_row("SELECT MAX(date) FROM shares WHERE person_id = ?", [id], |r| r.get(0))?.flatten();
    Ok(json!({
        "id": id,
        "name": name,
        "archived": !p["archived_at"].is_null(),
        "balanceMinor": balance,
        "text": describe(name, balance),
        "lastDate": last,
    }))
}

pub fn list_people(db: &Db) -> DbResult<Vec<Value>> {
    db.all_json("SELECT * FROM people WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE", [])?
        .iter()
        .map(|p| person_dto(db, p))
        .collect()
}

fn unique<T>(r: DbResult<T>) -> DbResult<T> {
    r.map_err(|e| {
        if is_unique_violation(&e, "people") {
            AppError::conflict("Someone with this name is already in your list")
        } else {
            e
        }
    })
}

fn insert_person(a: &mut super::audit::AuditWriter, name: &str) -> DbResult<String> {
    let id = new_id("per");
    let now = now_iso();
    a.insert("people", row! { "id" => id, "name" => name.trim(), "created_at" => now, "updated_at" => now })?;
    Ok(id)
}

pub fn create_person(db: &Db, input: &Value) -> DbResult<Value> {
    let name = s(input, "name").unwrap_or_default().trim().to_owned();
    let audited = unique(with_audit(db, &format!("Add {name}"), None, |a| insert_person(a, &name)))?;
    Ok(json!({ "person": person_dto(db, &person_row(db, &audited.result)?)?, "auditGroupId": audited.audit_group_id }))
}

pub fn update_person(db: &Db, input: &Value) -> DbResult<Value> {
    let id = s(input, "id").unwrap_or_default();
    let current = person_row(db, id)?;
    let mut patch = Map::new();
    if let Some(name) = s(input, "name") {
        patch.insert("name".into(), json!(name.trim()));
    }
    if let Some(archived) = input.get("archived").and_then(Value::as_bool) {
        if archived && balance_of(db, id)? != 0 {
            return Err(AppError::invariant("Settle up before removing someone from the list"));
        }
        patch.insert("archived_at".into(), if archived { json!(now_iso()) } else { Value::Null });
    }
    patch.insert("updated_at".into(), json!(now_iso()));
    let label = format!("Edit {}", current["name"].as_str().unwrap_or_default());
    let audited = unique(with_audit(db, &label, None, |a| {
        a.update("people", id, patch.clone())?;
        Ok(())
    }))?;
    Ok(json!({ "person": person_dto(db, &person_row(db, id)?)?, "auditGroupId": audited.audit_group_id }))
}

pub fn person_entries(db: &Db, id: &str) -> DbResult<Value> {
    let p = person_row(db, id)?;
    let entries = db.all_json(
        "SELECT s.id, s.date, s.amount_minor AS amountMinor, s.kind, s.note, s.transaction_id AS transactionId,
            t.payee, t.amount_minor AS transactionMinor
     FROM shares s LEFT JOIN transactions t ON t.id = s.transaction_id
     WHERE s.person_id = ? ORDER BY s.date DESC, s.created_at DESC",
        [id],
    )?;
    let mut dto = person_dto(db, &p)?;
    dto["entries"] = Value::Array(entries.into_iter().map(Value::Object).collect());
    Ok(dto)
}

/// The person an entry is for: an existing one, or a new one by name (added in the same change).
fn person_for(db: &Db, a: &mut super::audit::AuditWriter, input: &Value) -> DbResult<(String, String)> {
    if let Some(id) = s(input, "personId") {
        let p = person_row(db, id)?;
        return Ok((id.to_owned(), p["name"].as_str().unwrap_or_default().to_owned()));
    }
    let name = s(input, "personName").unwrap_or_default().trim().to_owned();
    if name.is_empty() {
        return Err(AppError::invariant("Choose someone, or type a name"));
    }
    let existing =
        db.query_row("SELECT id FROM people WHERE archived_at IS NULL AND name = ? COLLATE NOCASE", [&name], |r| {
            r.get::<_, String>(0)
        })?;
    Ok(match existing {
        Some(id) => (id, name),
        None => (insert_person(a, &name)?, name),
    })
}

/// A share of an expense (they owe the user), or a manual entry (signed: money lent or owed).
pub fn add_entry(db: &Db, input: &Value, today: &str) -> DbResult<Value> {
    let amount = input["amountMinor"].as_i64().unwrap_or(0);
    let txn = s(input, "transactionId");
    let (kind, date) = match txn {
        Some(t) => {
            let (date, total, kind): (String, i64, String) = db
                .query_row(
                    "SELECT posted_date, amount_minor, kind FROM transactions WHERE id = ? AND deleted_at IS NULL",
                    [t],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )?
                .ok_or_else(|| AppError::not_found("Transaction"))?;
            if kind != "standard" || total >= 0 {
                return Err(AppError::invariant("Only an expense can be shared"));
            }
            let shared: i64 = db
                .query_row(
                    "SELECT COALESCE(SUM(amount_minor), 0) FROM shares WHERE transaction_id = ? AND kind = 'share'",
                    [t],
                    |r| r.get(0),
                )?
                .unwrap_or(0);
            if amount <= 0 || shared + amount > -total {
                return Err(AppError::invariant("The shares add up to more than the expense"));
            }
            ("share", date)
        }
        None => ("manual", s(input, "date").unwrap_or(today).to_owned()),
    };
    let audited = unique(with_audit(db, "Record who owes what", None, |a| {
        let (person, name) = person_for(db, a, input)?;
        a.insert(
            "shares",
            row! {
                "id" => new_id("shr"), "person_id" => person, "date" => date, "amount_minor" => amount,
                "kind" => kind, "note" => s(input, "note"), "transaction_id" => txn, "created_at" => now_iso(),
            },
        )?;
        Ok((person, name))
    }))?;
    let (person, _) = audited.result;
    Ok(json!({ "person": person_dto(db, &person_row(db, &person)?)?, "auditGroupId": audited.audit_group_id }))
}

pub fn delete_entry(db: &Db, id: &str) -> DbResult<Value> {
    let name: String = db
        .query_row("SELECT p.name FROM shares s JOIN people p ON p.id = s.person_id WHERE s.id = ?", [id], |r| {
            r.get(0)
        })?
        .ok_or_else(|| AppError::not_found("Entry"))?;
    let audited = with_audit(db, &format!("Remove an entry for {name}"), None, |a| a.remove("shares", id))?;
    Ok(json!({ "auditGroupId": audited.audit_group_id }))
}

/// Who owes what of one transaction, for the transaction dialog.
pub fn shares_for_transaction(db: &Db, txn: &str) -> DbResult<Vec<Value>> {
    Ok(db
        .all_json(
            "SELECT s.id, s.person_id AS personId, p.name AS personName, s.amount_minor AS amountMinor, s.kind
       FROM shares s JOIN people p ON p.id = s.person_id WHERE s.transaction_id = ? ORDER BY s.created_at",
            [txn],
        )?
        .into_iter()
        .map(Value::Object)
        .collect())
}

/// Recent money in (when they owe the user) or out (when the user owes them) not yet linked.
pub fn repayment_candidates(db: &Db, id: &str, today: &str) -> DbResult<Vec<Value>> {
    let p = person_row(db, id)?;
    let balance = balance_of(db, id)?;
    if balance == 0 {
        return Ok(Vec::new());
    }
    let from = add_days(today, -LOOKBACK_DAYS).unwrap_or_else(|_| today.to_owned());
    let sign = if balance > 0 { "t.amount_minor > 0" } else { "t.amount_minor < 0" };
    let rows = db.query_map(
        &format!(
            "SELECT t.id, t.posted_date, t.payee, ABS(t.amount_minor) FROM transactions t
       WHERE t.deleted_at IS NULL AND t.kind = 'standard' AND {sign} AND t.posted_date BETWEEN ? AND ?
         AND NOT EXISTS (SELECT 1 FROM shares s WHERE s.transaction_id = t.id)"
        ),
        params![from, today],
        |r| Ok(Candidate { transaction_id: r.get(0)?, date: r.get(1)?, payee: r.get(2)?, amount_minor: r.get(3)? }),
    )?;
    Ok(rank_repayments(p["name"].as_str().unwrap_or_default(), balance, today, rows)
        .into_iter()
        .take(8)
        .map(|c| json!({ "transactionId": c.transaction_id, "date": c.date, "payee": c.payee, "amountMinor": c.amount_minor }))
        .collect())
}

/// A repayment, linked to a transaction or in cash. It moves the balance towards zero by its amount.
pub fn settle(db: &Db, input: &Value, today: &str) -> DbResult<Value> {
    let id = s(input, "personId").unwrap_or_default();
    let p = person_row(db, id)?;
    let balance = balance_of(db, id)?;
    let txn = s(input, "transactionId");
    let (date, amount) = match txn {
        Some(t) => db
            .query_row(
                "SELECT posted_date, ABS(amount_minor) FROM transactions WHERE id = ? AND deleted_at IS NULL",
                [t],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
            )?
            .ok_or_else(|| AppError::not_found("Transaction"))?,
        None => (s(input, "date").unwrap_or(today).to_owned(), input["amountMinor"].as_i64().unwrap_or(0)),
    };
    if amount <= 0 {
        return Err(AppError::invariant("Enter the amount repaid"));
    }
    let signed = if balance >= 0 { -amount } else { amount };
    let name = p["name"].as_str().unwrap_or_default();
    let audited = with_audit(db, &format!("Repayment with {name}"), None, |a| {
        a.insert(
            "shares",
            row! {
                "id" => new_id("shr"), "person_id" => id, "date" => date, "amount_minor" => signed,
                "kind" => "repayment", "note" => s(input, "note"), "transaction_id" => txn, "created_at" => now_iso(),
            },
        )?;
        Ok(())
    })?;
    Ok(json!({ "person": person_dto(db, &person_row(db, id)?)?, "auditGroupId": audited.audit_group_id }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::accounts::create_account;
    use crate::db::audit::undo_group;
    use crate::db::test_db;
    use crate::db::transactions::create_transaction;

    #[test]
    fn shares_balances_repayments_and_undo() {
        let db = test_db();
        let bank =
            create_account(&db, &json!({ "name": "Bank", "type": "bank", "openingDate": "2026-10-01" })).unwrap();
        let bank = bank["account"]["id"].as_str().unwrap().to_owned();
        let txn = |date: &str, amount: i64, payee: &str| -> String {
            create_transaction(
                &db,
                &json!({ "accountId": bank, "postedDate": date, "amountMinor": amount, "payee": payee }),
            )
            .unwrap()["txn"]["id"]
                .as_str()
                .unwrap()
                .to_owned()
        };
        let dinner = txn("2026-11-01", -240_000, "Toit");
        let first = add_entry(
            &db,
            &json!({ "transactionId": dinner, "personName": "Rahul", "amountMinor": 120_000 }),
            "2026-11-10",
        )
        .unwrap();
        assert_eq!(first["person"]["text"], "Rahul owes you ₹1,200");
        let rahul = first["person"]["id"].as_str().unwrap().to_owned();
        assert!(
            add_entry(
                &db,
                &json!({ "transactionId": dinner, "personId": rahul, "amountMinor": 130_000 }),
                "2026-11-10"
            )
            .is_err(),
            "shares cannot add up to more than the expense"
        );
        // Typing the same name again finds the same person.
        add_entry(&db, &json!({ "personName": "rahul", "amountMinor": 30_000, "note": "Cab" }), "2026-11-02").unwrap();
        assert_eq!(list_people(&db).unwrap().len(), 1);
        assert_eq!(list_people(&db).unwrap()[0]["balanceMinor"], 150_000);
        assert_eq!(shares_for_transaction(&db, &dinner).unwrap()[0]["personName"], "Rahul");

        // Money in naming Rahul is suggested first; linking it settles up.
        txn("2026-11-08", 500_000, "ACME salary");
        let back = txn("2026-11-07", 150_000, "UPI/RAHUL S/okaxis");
        let candidates = repayment_candidates(&db, &rahul, "2026-11-10").unwrap();
        assert_eq!(candidates[0]["transactionId"], back.as_str());
        let settled = settle(&db, &json!({ "personId": rahul, "transactionId": back }), "2026-11-10").unwrap();
        assert_eq!(settled["person"]["text"], "Settled up");
        assert!(repayment_candidates(&db, &rahul, "2026-11-10").unwrap().is_empty());
        let entries = person_entries(&db, &rahul).unwrap();
        assert_eq!(entries["entries"].as_array().unwrap().len(), 3);
        assert_eq!(
            entries["entries"].as_array().unwrap().iter().map(|e| e["amountMinor"].as_i64().unwrap()).sum::<i64>(),
            0
        );

        // Removing someone needs a zero balance; undo brings the debt back.
        undo_group(&db, settled["auditGroupId"].as_str().unwrap()).unwrap();
        assert!(update_person(&db, &json!({ "id": rahul, "archived": true })).is_err());
        // The user owing someone, then paying them back in cash.
        let priya = add_entry(&db, &json!({ "personName": "Priya", "amountMinor": -30_000 }), "2026-11-03").unwrap();
        assert_eq!(priya["person"]["text"], "You owe Priya ₹300");
        let pid = priya["person"]["id"].as_str().unwrap();
        let paid = settle(&db, &json!({ "personId": pid, "amountMinor": 30_000 }), "2026-11-10").unwrap();
        assert_eq!(paid["person"]["text"], "Settled up");
    }
}
