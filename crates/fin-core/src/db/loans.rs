//! Loans with terms (US16): the schedule from the amount borrowed, rate, tenure and first EMI date,
//! and where it stands today. The rules are in `domain/amortization.rs`.

use serde_json::{Value, json};

use super::accounts::{get_account, list_accounts};
use super::{Db, DbResult};
use crate::domain::amortization::{Row, Terms, emi, position, schedule};
use crate::error::AppError;

/// The terms of a loan account, when all four are set.
pub fn terms_of(account: &Value) -> Option<Terms> {
    if account["type"] != "loan" {
        return None;
    }
    Some(Terms {
        principal_minor: account["loanPrincipalMinor"].as_i64()?,
        rate_bp: account["rateBp"].as_i64()?,
        months: account["tenureMonths"].as_i64()?,
        first_date: account["firstEmiDate"].as_str()?.to_owned(),
    })
}

fn row_dto(r: &Row) -> Value {
    json!({
        "n": r.n,
        "date": r.date,
        "emiMinor": r.emi_minor,
        "interestMinor": r.interest_minor,
        "principalMinor": r.principal_minor,
        "balanceMinor": r.balance_minor,
    })
}

fn summary(account: &Value, t: &Terms, rows: &[Row], today: &str) -> Value {
    let p = position(t.principal_minor, rows, today);
    json!({
        "accountId": account["id"],
        "accountName": account["name"],
        "principalMinor": t.principal_minor,
        "rateBp": t.rate_bp,
        "months": rows.len(),
        "firstDate": t.first_date,
        "emiMinor": emi(t.principal_minor, t.rate_bp, t.months),
        "totalInterestMinor": rows.iter().map(|r| r.interest_minor).sum::<i64>(),
        "paidCount": p.paid_count,
        "interestPaidMinor": p.interest_paid_minor,
        "principalPaidMinor": p.principal_paid_minor,
        "outstandingMinor": p.outstanding_minor,
        "interestRemainingMinor": p.interest_remaining_minor,
        "next": p.next.as_ref().map_or(Value::Null, row_dto),
        "endDate": p.end_date,
        // What the ledger says is owed (payments and valuations), to compare with the schedule.
        "ledgerOwedMinor": account["balanceMinor"],
    })
}

/// Every active loan with terms, for the Accounts page.
pub fn loans_summary(db: &Db, today: &str) -> DbResult<Vec<Value>> {
    Ok(list_accounts(db, false)?
        .iter()
        .filter_map(|a| terms_of(a).map(|t| summary(a, &t, &schedule(&t), today)))
        .collect())
}

/// One loan's whole schedule.
pub fn loan_schedule(db: &Db, id: &str, today: &str) -> DbResult<Value> {
    let account = get_account(db, id)?;
    let t = terms_of(&account).ok_or_else(|| AppError::invariant("Add the loan’s terms to see its schedule"))?;
    let rows = schedule(&t);
    let mut out = summary(&account, &t, &rows, today);
    out["rows"] = Value::Array(rows.iter().map(row_dto).collect());
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::accounts::create_account;
    use crate::db::test_db;

    #[test]
    fn loan_terms_round_trip_and_give_a_schedule() {
        let db = test_db();
        let loan = create_account(
            &db,
            &json!({ "name": "Car loan", "type": "loan", "openingDate": "2026-01-01", "openingBalanceMinor": 100_000_000,
                     "loanPrincipalMinor": 100_000_000, "rateBp": 900, "tenureMonths": 60, "firstEmiDate": "2026-02-05",
                     "depositKind": "fd" }),
        )
        .unwrap();
        let a = &loan["account"];
        assert_eq!((a["rateBp"].clone(), a["tenureMonths"].clone()), (json!(900), json!(60)));
        assert_eq!(a["depositKind"], Value::Null, "deposit fields are not kept on a loan");
        let id = a["id"].as_str().unwrap();

        let s = loans_summary(&db, "2026-04-10").unwrap();
        assert_eq!(s[0]["emiMinor"], 2_075_800);
        assert_eq!(s[0]["paidCount"], 3);
        assert_eq!(s[0]["next"]["date"], "2026-05-05");
        let full = loan_schedule(&db, id, "2026-04-10").unwrap();
        assert_eq!(full["rows"].as_array().unwrap().len(), 60);
        assert_eq!(full["endDate"], "2031-01-05");
    }
}
