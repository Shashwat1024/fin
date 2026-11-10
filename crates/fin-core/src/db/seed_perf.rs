//! A large synthetic ledger for performance checks (NFR: 50,000 transactions), ported from
//! `src/db/seed/perf.ts` with the same generator and order. Bulk rows are written with direct
//! inserts in one transaction, since replaying 50k audited creates would only measure the seed.
//! Everything is fictional and deterministic.

use rusqlite::params;
use serde_json::{Value, json};

use super::accounts::create_account;
use super::categories::{backfill_merchants, list_categories};
use super::categorization::create_rule;
use super::planning::{assign_budget, create_goal, create_recurring};
use super::settings::update_settings;
use super::transactions::create_transfer;
use super::{Db, DbResult, new_id, now_iso};
use crate::db::dashboard::js_round;
use crate::domain::dates::{add_days, add_months, diff_days, start_of_month};
use crate::error::AppError;

fn d(r: Result<String, crate::domain::dates::DateError>) -> DbResult<String> {
    r.map_err(|_| AppError::internal())
}

/// Returns the number of live transactions written.
pub fn seed_perf_data(db: &Db, today: &str, count: usize) -> DbResult<i64> {
    let mut s: u64 = 424_242;
    let mut rand = move || {
        s = (s * 1_664_525 + 1_013_904_223) & 0xffff_ffff;
        s as f64 / 4_294_967_296.0
    };
    let start = d(add_months(&start_of_month(today), -36, None))?;
    let acct = |name: &str, t: &str, opening: i64| -> DbResult<String> {
        let r = create_account(
            db,
            &json!({ "name": name, "type": t, "openingBalanceMinor": opening, "openingDate": start }),
        )?;
        Ok(r["account"]["id"].as_str().unwrap_or_default().to_owned())
    };
    let bank = acct("Perf Bank", "bank", 50_000_000)?;
    let salary = acct("Perf Salary Account", "bank", 10_000_000)?;
    let wallet = acct("Perf Wallet", "cash", 500_000)?;
    let card = acct("Perf Card", "credit_card", 0)?;
    let fund = acct("Perf Fund", "investment", 100_000_000)?;

    let categories = list_categories(db)?;
    let leaves: Vec<String> = categories
        .iter()
        .filter(|c| !c["parentId"].is_null() && c["group"] != "income" && c["group"] != "transfer")
        .map(|c| c["id"].as_str().unwrap_or_default().to_owned())
        .collect();
    let salary_cat = categories
        .iter()
        .find(|c| c["path"] == "Income › Salary")
        .and_then(|c| c["id"].as_str())
        .ok_or_else(AppError::internal)?
        .to_owned();
    let payees = [
        "UPI/4288{n}/Swiggy/swiggy@icici/Payment",
        "UPI-ZOMATO-ZOMATO@HDFC-HDFC0000001-4288{n}-ORDER",
        "POS 4321XXXX DMART MUMBAI",
        "UBER *TRIP HELP.UBER.COM",
        "NEFT/N{n}/ACME TRADERS",
        "IMPS/P2A/{n}/RAVI KUMAR",
        "AMAZON PAY INDIA",
        "BESCOM ELECTRICITY",
        "APOLLO PHARMACY",
        "Chai Point",
        "Shell petrol pump",
        "Big Basket",
    ];

    let days = diff_days(today, &start).map_err(|_| AppError::internal())? + 1;
    db.transaction(|| {
        let now = now_iso();
        let sql = "INSERT INTO transactions (id, account_id, posted_date, amount_minor, payee, category_id, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
        let mut inserted = 0usize;
        for m in 0..36 {
            let date = d(add_months(&start, m, None))?;
            db.run(sql, params![new_id("txn"), salary, date, 15_000_000, "ACME Technologies salary", salary_cat, Option::<String>::None, now, now])?;
            inserted += 1;
        }
        let accounts = [&bank, &bank, &card, &card, &wallet];
        while inserted < count {
            // Draws in the original's order: date, payee, reference, account, amount, category, note.
            let date = d(add_days(&start, (rand() * days as f64).floor() as i64))?;
            let payee_template = payees[(rand() * payees.len() as f64).floor() as usize];
            let reference = 10_000_000 + (rand() * 89_999_999.0).floor() as i64;
            let payee = payee_template.replacen("{n}", &reference.to_string(), 1);
            let account = accounts[(rand() * accounts.len() as f64).floor() as usize];
            let (a, b) = (rand(), rand());
            let amount = -js_round(1_000.0 + a * b * 500_000.0);
            let category = if rand() < 0.85 { Some(leaves[(rand() * leaves.len() as f64).floor() as usize].clone()) } else { None };
            let note = if rand() < 0.05 { Some("perf note") } else { None };
            db.run(sql, params![new_id("txn"), account, date, amount, payee, category, note, now, now])?;
            inserted += 1;
        }
        Ok(())
    })?;
    // Monthly card bills and salary sweeps as real transfers.
    for m in 0..36 {
        let day = d(add_days(&d(add_months(&start, m, None))?, 24))?;
        if day.as_str() > today {
            break;
        }
        create_transfer(
            db,
            &json!({ "fromAccountId": bank, "toAccountId": card, "postedDate": day, "amountMinor": 3_000_000 }),
        )?;
        let sweep = d(add_days(&day, -20))?;
        create_transfer(
            db,
            &json!({ "fromAccountId": salary, "toAccountId": bank, "postedDate": sweep, "amountMinor": 10_000_000 }),
        )?;
    }
    backfill_merchants(db)?;

    let monthly = |name: &str, kind: &str, account: &str, amount: i64, day: i64, extra: Value| -> DbResult<()> {
        let mut input = json!({ "name": name, "kind": kind, "accountId": account, "amountMinor": amount, "frequency": "monthly", "anchorDate": d(add_days(&start, day - 1))? });
        if let (Some(o), Some(e)) = (input.as_object_mut(), extra.as_object()) {
            o.extend(e.clone());
        }
        create_recurring(db, &input, today)?;
        Ok(())
    };
    monthly("Salary", "income", &salary, 15_000_000, 1, json!({}))?;
    monthly("Rent", "bill", &bank, 3_000_000, 3, json!({}))?;
    monthly("Card bill", "transfer", &bank, 3_000_000, 25, json!({ "toAccountId": card, "toleranceBp": 5000 }))?;
    monthly("Sweep", "transfer", &salary, 10_000_000, 5, json!({ "toAccountId": bank }))?;
    monthly("SIP", "savings", &bank, 2_000_000, 10, json!({ "toAccountId": fund }))?;
    create_rule(
        db,
        &json!({ "name": "Swiggy", "conditions": [{ "field": "description", "op": "contains", "value": "swiggy" }], "categoryId": leaves[0] }),
    )?;
    create_rule(
        db,
        &json!({ "name": "Uber", "conditions": [{ "field": "merchant", "op": "contains", "value": "uber" }], "categoryId": leaves[1] }),
    )?;
    for m in 0..36 {
        let month = d(add_months(&start, m, None))?[..7].to_owned();
        assign_budget(db, &month, &leaves[m as usize % leaves.len()], 1_000_000)?;
    }
    create_goal(db, &json!({ "name": "Perf goal", "targetMinor": 100_000_000, "linkedAccountId": fund }), today)?;
    let mut patch = serde_json::Map::new();
    patch.insert("onboarded".into(), json!(true));
    patch.insert("bufferMinor".into(), json!(2_000_000));
    update_settings(db, &patch)?;
    Ok(db.query_row("SELECT COUNT(*) FROM transactions WHERE deleted_at IS NULL", [], |r| r.get(0))?.unwrap_or(0))
}
