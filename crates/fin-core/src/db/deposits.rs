//! Fixed and recurring deposits over the ledger (US17). A deposit is an investment account with
//! deposit terms; the amount deposited is its start balance (FD) or its instalments (RD). The rules
//! are in `domain/deposits.rs`.

use std::collections::HashMap;

use serde_json::{Value, json};

use super::accounts::list_accounts;
use super::{Db, DbResult};
use crate::domain::dates::{add_months, end_of_month, start_of_month};
use crate::domain::deposits::{fd_value, rd_deposited, rd_value};

pub struct Deposit {
    pub kind: String,
    pub rate_bp: i64,
    pub start: String,
    pub maturity: String,
    pub principal_minor: i64,
    pub installment_minor: i64,
}

impl Deposit {
    pub fn value_at(&self, at: &str) -> i64 {
        if self.kind == "rd" {
            rd_value(self.installment_minor, self.rate_bp, &self.start, &self.maturity, at)
        } else {
            fd_value(self.principal_minor, self.rate_bp, &self.start, &self.maturity, at)
        }
    }
    pub fn deposited_at(&self, at: &str) -> i64 {
        if self.kind == "rd" {
            rd_deposited(self.installment_minor, &self.start, &self.maturity, at)
        } else {
            self.principal_minor
        }
    }
}

/// The deposit terms of an account (from `list_accounts`), when complete.
pub fn deposit_of(account: &Value) -> Option<Deposit> {
    if account["type"] != "investment" {
        return None;
    }
    let kind = account["depositKind"].as_str()?.to_owned();
    Some(Deposit {
        installment_minor: if kind == "rd" { account["installmentMinor"].as_i64()? } else { 0 },
        kind,
        rate_bp: account["rateBp"].as_i64()?,
        start: account["openingDate"].as_str()?.to_owned(),
        maturity: account["maturityDate"].as_str()?.to_owned(),
        principal_minor: account["openingBalanceMinor"].as_i64().unwrap_or(0),
    })
}

/// Computed values for net worth history: each month end from the start to today, and today.
pub fn computed_values(d: &Deposit, today: &str) -> Vec<(String, i64)> {
    let mut out = Vec::new();
    let mut m = start_of_month(&d.start);
    while m.as_str() <= today {
        let end = end_of_month(&m).unwrap_or_else(|_| m.clone());
        if end.as_str() >= d.start.as_str() && end.as_str() < today {
            out.push((end.clone(), d.value_at(&end)));
        }
        m = match add_months(&m, 1, None) {
            Ok(next) => next,
            Err(_) => break,
        };
    }
    out.push((today.to_owned(), d.value_at(today)));
    out
}

pub fn deposits_summary(db: &Db, today: &str) -> DbResult<Vec<Value>> {
    let accounts = list_accounts(db, false)?;
    let names: HashMap<&str, &str> =
        accounts.iter().filter_map(|a| Some((a["id"].as_str()?, a["name"].as_str()?))).collect();
    let valued: Vec<String> = db.query_map("SELECT DISTINCT account_id FROM valuations", [], |r| r.get(0))?;
    Ok(accounts
        .iter()
        .filter_map(|a| {
            let d = deposit_of(a)?;
            let id = a["id"].as_str()?;
            let payout = a["payoutAccountId"].as_str();
            Some(json!({
                "accountId": id,
                "accountName": a["name"],
                "kind": d.kind,
                "rateBp": d.rate_bp,
                "startDate": d.start,
                "maturityDate": d.maturity,
                "depositedMinor": d.deposited_at(today),
                "valueTodayMinor": d.value_at(today),
                "maturityMinor": d.value_at(&d.maturity),
                "matured": today >= d.maturity.as_str(),
                "payoutAccountId": payout,
                "payoutAccountName": payout.and_then(|p| names.get(p).copied()),
                "hasRecordedValue": valued.iter().any(|v| v == id),
            }))
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::accounts::create_account;
    use crate::db::forecast::forecast;
    use crate::db::networth::{net_worth_history_for, net_worth_now, upsert_valuation};
    use crate::db::test_db;

    #[test]
    fn deposits_are_valued_for_net_worth_and_mature_into_the_forecast() {
        let db = test_db();
        let bank =
            create_account(&db, &json!({ "name": "Bank", "type": "bank", "openingDate": "2026-01-01" })).unwrap();
        let bank = bank["account"]["id"].as_str().unwrap().to_owned();
        let fd = create_account(
            &db,
            &json!({ "name": "SBI FD", "type": "investment", "openingDate": "2026-01-01", "openingBalanceMinor": 10_000_000,
                     "depositKind": "fd", "rateBp": 700, "maturityDate": "2027-01-01", "payoutAccountId": bank,
                     "tenureMonths": 12 }),
        )
        .unwrap();
        assert_eq!(fd["account"]["tenureMonths"], Value::Null, "loan fields are not kept on a deposit");
        let fd_id = fd["account"]["id"].as_str().unwrap().to_owned();

        let s = deposits_summary(&db, "2026-12-15").unwrap();
        assert_eq!(s[0]["maturityMinor"], 10_718_591);
        assert_eq!(s[0]["payoutAccountName"], "Bank");
        let today_value = s[0]["valueTodayMinor"].as_i64().unwrap();
        assert!(today_value > 10_600_000 && today_value < 10_718_591);

        // Net worth uses the computed value, now and month by month.
        let accounts = list_accounts(&db, false).unwrap();
        let now = net_worth_now(&db, "2026-12-15", &accounts).unwrap();
        assert_eq!(now.assets_minor, today_value);
        assert!(now.values.iter().any(|(_, _, source, _)| *source == "deposit"));
        let history = net_worth_history_for(&db, "2026-12-15", Some("2026-01-01"), None).unwrap();
        let june = history["points"].as_array().unwrap().iter().find(|p| p["date"] == "2026-06-30").unwrap();
        assert!(june["netMinor"].as_i64().unwrap() > 10_000_000);

        // The maturity is money into the bank account on its date.
        let f = forecast(&db, 30, "2026-12-15").unwrap();
        let row = f["assumptions"].as_array().unwrap().iter().find(|a| a["kind"] == "deposit").cloned().unwrap();
        assert_eq!((row["label"].clone(), row["amountMinor"].clone()), (json!("SBI FD matures"), json!(10_718_591)));

        // A recorded value takes priority.
        upsert_valuation(
            &db,
            &json!({ "accountId": fd_id, "date": "2026-12-01", "valueMinor": 10_500_000 }),
            "2026-12-15",
        )
        .unwrap();
        let now = net_worth_now(&db, "2026-12-15", &list_accounts(&db, false).unwrap()).unwrap();
        assert_eq!(now.assets_minor, 10_500_000);
    }
}
