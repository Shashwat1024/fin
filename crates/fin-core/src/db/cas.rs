//! Mutual-fund statement (CAS) import (US20): what the statement says each folio is worth, then
//! the chosen accounts' values recorded on the statement date in one undoable change. The text is
//! neither stored nor logged.

use rusqlite::params;
use serde_json::{Value, json};

use super::accounts::list_accounts;
use super::audit::with_audit;
use super::{Db, DbResult, is_unique_violation, new_id, now_iso};
use crate::domain::cas::{CasError, parse_cas};
use crate::error::AppError;
use crate::row;

fn key(amc: &str, folio: &str) -> String {
    format!("{amc}|{folio}")
}

pub fn preview(db: &Db, text: &str) -> DbResult<Value> {
    let statement = parse_cas(text).map_err(|e| match e {
        CasError::NothingFound => AppError::invariant(
            "Fin could not find any funds with a closing value in this file. Is it a CAMS or KFintech consolidated account statement?",
        ),
    })?;
    let investments: Vec<Value> = list_accounts(db, false)?.into_iter().filter(|a| a["type"] == "investment").collect();
    let folios: Vec<Value> = statement
        .folios
        .iter()
        .map(|f| {
            // An existing investment account named with this folio number is the likely match.
            let digits: String = f.folio.split('/').next().unwrap_or_default().to_owned();
            let matched = investments
                .iter()
                .find(|a| !digits.is_empty() && a["name"].as_str().is_some_and(|n| n.contains(&digits)));
            let short = f.amc.trim_end_matches("Mutual Fund").trim();
            json!({
                "key": key(&f.amc, &f.folio),
                "amc": f.amc,
                "folio": f.folio,
                "valueMinor": f.value_minor(),
                "schemes": f.schemes.iter().map(|s| json!({
                    "name": s.name,
                    "units": s.units,
                    "nav": s.nav,
                    "navDate": s.nav_date,
                    "costMinor": s.cost_minor,
                    "valueMinor": s.value_minor,
                })).collect::<Vec<_>>(),
                "suggestedAccountId": matched.map_or(Value::Null, |a| a["id"].clone()),
                "suggestedName": format!("{} MF {}", if short.is_empty() { "Mutual fund" } else { short }, f.folio),
            })
        })
        .collect();
    Ok(json!({
        "statementDate": statement.date,
        "totalMinor": statement.folios.iter().map(|f| f.value_minor()).sum::<i64>(),
        "folios": folios,
    }))
}

/// Record each chosen folio's value on the statement date, creating investment accounts asked for.
pub fn commit(db: &Db, input: &Value, today: &str) -> DbResult<Value> {
    let date = input["statementDate"].as_str().unwrap_or_default().to_owned();
    if date.as_str() > today {
        return Err(AppError::invariant("The statement date is in the future"));
    }
    let chosen: Vec<&Value> = input["folios"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|f| {
            f.get("accountId").and_then(Value::as_str).is_some() || f.get("newName").and_then(Value::as_str).is_some()
        })
        .collect();
    if chosen.is_empty() {
        return Err(AppError::invariant("Choose an account for at least one folio"));
    }
    let investments: Vec<String> = list_accounts(db, false)?
        .into_iter()
        .filter(|a| a["type"] == "investment")
        .filter_map(|a| a["id"].as_str().map(str::to_owned))
        .collect();
    let (mut created, mut valued) = (0, 0);
    let audited = with_audit(db, &format!("Import mutual fund values for {date}"), None, |a| {
        let mut order: i64 =
            db.query_row("SELECT MAX(sort_order) FROM accounts", [], |r| r.get::<_, Option<i64>>(0))?.flatten().unwrap_or(-1);
        for f in &chosen {
            let account_id = match (f.get("accountId").and_then(Value::as_str), f.get("newName").and_then(Value::as_str)) {
                (Some(id), _) => {
                    if !investments.iter().any(|i| i == id) {
                        return Err(AppError::invariant("Values can only be recorded on active investment accounts"));
                    }
                    id.to_owned()
                }
                (None, Some(name)) => {
                    order += 1;
                    let id = new_id("acc");
                    let now = now_iso();
                    a.insert(
                        "accounts",
                        row! {
                            "id" => id, "name" => name.trim(), "type" => "investment", "currency" => "INR",
                            "opening_balance_minor" => 0, "opening_date" => date, "notes" => "Created from a mutual fund statement",
                            "sort_order" => order, "created_at" => now, "updated_at" => now,
                        },
                    )?;
                    created += 1;
                    id
                }
                _ => continue,
            };
            let existing = db.query_row(
                "SELECT id FROM valuations WHERE account_id = ? AND date = ?",
                params![account_id, date],
                |r| r.get::<_, String>(0),
            )?;
            let fields = row! { "value_minor" => f["valueMinor"], "note" => "From a mutual fund statement", "updated_at" => now_iso() };
            match existing {
                Some(id) => {
                    a.update("valuations", &id, fields)?;
                }
                None => {
                    let mut row = row! { "id" => new_id("val"), "account_id" => account_id, "date" => date, "created_at" => now_iso() };
                    row.extend(fields);
                    a.insert("valuations", row)?;
                }
            }
            valued += 1;
        }
        Ok(())
    })
    .map_err(|e| if is_unique_violation(&e, "accounts") { AppError::conflict("An active account already has that name") } else { e })?;
    Ok(json!({ "created": created, "valued": valued, "auditGroupId": audited.audit_group_id }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::accounts::create_account;
    use crate::db::audit::undo_group;
    use crate::db::networth::list_valuations;
    use crate::db::test_db;

    const TEXT: &str = "Period: 01-Apr-2026 to 31-Oct-2026
HDFC Mutual Fund
Folio No: 1234567 / 89
HDFC Flexi Cap Fund - Direct Plan - Growth
Closing Unit Balance: 10.000 NAV on 31-Oct-2026: INR 2,000.00 Market Value on 31-Oct-2026: INR 20,000.00
Axis Mutual Fund
Folio No: 555
Axis ELSS Tax Saver Fund - Direct Growth
Closing Unit Balance: 100.000 NAV on 31-Oct-2026: INR 90.00 Market Value on 31-Oct-2026: INR 9,000.00";

    #[test]
    fn a_statement_values_new_and_existing_accounts_in_one_undoable_change() {
        let db = test_db();
        let existing = create_account(
            &db,
            &json!({ "name": "HDFC MF 1234567", "type": "investment", "openingDate": "2026-01-01", "openingBalanceMinor": 1_500_000 }),
        )
        .unwrap();
        let existing = existing["account"]["id"].as_str().unwrap().to_owned();
        let p = preview(&db, TEXT).unwrap();
        assert_eq!((p["statementDate"].clone(), p["totalMinor"].clone()), (json!("2026-10-31"), json!(2_900_000)));
        assert_eq!(p["folios"][0]["suggestedAccountId"], existing.as_str());
        assert_eq!(p["folios"][1]["suggestedName"], "Axis MF 555");
        assert!(preview(&db, "nothing here").is_err());

        let done = commit(
            &db,
            &json!({ "statementDate": "2026-10-31", "folios": [
                { "key": p["folios"][0]["key"], "accountId": existing, "valueMinor": 2_000_000 },
                { "key": p["folios"][1]["key"], "newName": "Axis MF 555", "valueMinor": 900_000 },
            ] }),
            "2026-11-05",
        )
        .unwrap();
        assert_eq!((done["created"].clone(), done["valued"].clone()), (json!(1), json!(2)));
        assert_eq!(list_valuations(&db, &existing).unwrap()[0]["valueMinor"], 2_000_000);
        assert!(list_accounts(&db, false).unwrap().iter().any(|a| a["name"] == "Axis MF 555"));

        undo_group(&db, done["auditGroupId"].as_str().unwrap()).unwrap();
        assert!(list_valuations(&db, &existing).unwrap().is_empty());
        assert!(!list_accounts(&db, false).unwrap().iter().any(|a| a["name"] == "Axis MF 555"));
    }
}
