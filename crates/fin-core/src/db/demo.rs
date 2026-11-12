//! Demo data (`src/db/seed/demo.ts`): a believable, fictional household over about three months
//! up to today. Statements run in exactly the original order with the same pseudo-random numbers,
//! so the demo looks the same in both versions.

use std::collections::HashMap;

use serde_json::{Value, json};

use super::accounts::create_account;
use super::categories::list_categories;
use super::categorization::create_rule;
use super::networth::upsert_valuation;
use super::planning::{assign_budget, contribute, create_goal, create_recurring};
use super::settings::update_settings;
use super::transactions::{create_transaction, create_transfer};
use super::{Db, DbResult};
use crate::db::dashboard::js_round;
use crate::domain::dates::{add_days, add_months, end_of_month, start_of_month, weekday};
use crate::error::AppError;

/// The original's generator: s = (s × 1664525 + 1013904223) mod 2³², returned as s / 2³².
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> f64 {
        self.0 = (self.0 * 1_664_525 + 1_013_904_223) & 0xffff_ffff;
        self.0 as f64 / 4_294_967_296.0
    }
    /// `Math.round((lo + rand() * (hi - lo)) / 100) * 100`
    fn between(&mut self, lo: i64, hi: i64) -> i64 {
        js_round((lo as f64 + self.next() * (hi - lo) as f64) / 100.0) * 100
    }
}

fn d(r: Result<String, crate::domain::dates::DateError>) -> DbResult<String> {
    r.map_err(|_| AppError::internal())
}

pub fn seed_demo_data(db: &Db, today: &str) -> DbResult<()> {
    let cats: HashMap<String, String> = list_categories(db)?
        .into_iter()
        .map(|c| (c["path"].as_str().unwrap_or_default().to_owned(), c["id"].as_str().unwrap_or_default().to_owned()))
        .collect();
    let c = |path: &str| -> DbResult<String> { cats.get(path).cloned().ok_or_else(AppError::internal) };
    let start = d(add_months(&start_of_month(today), -3, None))?;
    let acct = |name: &str, t: &str, opening: i64| -> DbResult<String> {
        let r = create_account(
            db,
            &json!({ "name": name, "type": t, "openingBalanceMinor": opening, "openingDate": start }),
        )?;
        Ok(r["account"]["id"].as_str().unwrap_or_default().to_owned())
    };
    let bank = acct("Demo Savings Bank", "bank", 18_500_000)?;
    let wallet = acct("Wallet", "cash", 300_000)?;
    let card = acct("Demo Credit Card", "credit_card", 1_250_000)?;
    // Statement on the 5th, due 20 days later: the 25th, when the recurring card bill is paid (US10).
    super::accounts::update_account(db, &card, &json!({ "statementDay": 5, "dueDaysAfter": 20 }))?;
    let funds = acct("Index Fund SIP", "investment", 42_000_000)?;

    let mut rand = Rng(20_261_109);
    let add = |account: &str, posted: &str, amount: i64, payee: &str, category: &str| -> DbResult<()> {
        if posted > today {
            return Ok(());
        }
        create_transaction(
            db,
            &json!({ "accountId": account, "postedDate": posted, "amountMinor": amount, "payee": payee, "categoryId": category }),
        )?;
        Ok(())
    };
    let transfer = |from: &str, to: &str, posted: &str, amount: i64| -> DbResult<()> {
        create_transfer(
            db,
            &json!({ "fromAccountId": from, "toAccountId": to, "postedDate": posted, "amountMinor": amount }),
        )?;
        Ok(())
    };

    for m in 0..=3 {
        let first = d(add_months(&start, m, None))?;
        let day = |n: i64| d(add_days(&first, n - 1));
        add(&bank, &day(1)?, 9_500_000, "ACME Technologies salary", &c("Income › Salary")?)?;
        add(&bank, &day(3)?, -2_200_000, "Rent — flat 402", &c("Housing › Rent")?)?;
        let v = rand.between(140_000, 260_000);
        add(&bank, &day(5)?, -v, "BESCOM electricity", &c("Housing › Electricity")?)?;
        add(&bank, &day(6)?, -99_900, "Airtel fibre", &c("Housing › Internet")?)?;
        add(&card, &day(7)?, -64_900, "Netflix", &c("Entertainment › Subscriptions")?)?;
        // Spotify's price went up in the third month (a behaviour insight, US8).
        add(&card, &day(12)?, if m >= 2 { -13_900 } else { -11_900 }, "Spotify", &c("Entertainment › Subscriptions")?)?;
        add(&bank, &day(10)?, -350_000, "Domestic help", &c("Bills › Domestic help")?)?;
        for w in 0..4 {
            let v = rand.between(180_000, 420_000);
            add(&card, &day(2 + w * 7)?, -v, "DMart", &c("Food › Groceries")?)?;
            let v = rand.between(25_000, 65_000);
            add(&bank, &day(4 + w * 7)?, -v, "UPI-SWIGGY", &c("Food › Food delivery")?)?;
            let v = rand.between(15_000, 45_000);
            add(&bank, &day(6 + w * 7)?, -v, "UPI-ZOMATO", &c("Food › Food delivery")?)?;
            let v = rand.between(4_000, 12_000);
            add(&wallet, &day(3 + w * 7)?, -v, "Auto rickshaw", &c("Transport › Cab & auto")?)?;
            let v = rand.between(30_000, 90_000);
            add(&card, &day(5 + w * 7)?, -v, "Uber", &c("Transport › Cab & auto")?)?;
        }
        let v = rand.between(100_000, 600_000);
        add(&card, &day(18)?, -v, "Amazon", &c("Shopping › Household")?)?;
        // Clothes: a little most months, a lot in the third (a category change, US8).
        let v = if m == 2 { 750_000 } else { rand.between(150_000, 230_000) };
        add(&card, &day(22)?, -v, "Myntra", &c("Shopping › Clothing")?)?;
        let v = rand.between(80_000, 250_000);
        add(&bank, &day(20)?, -v, "Apollo Pharmacy", &c("Health › Medicines")?)?;
        // Card bill paid from the bank: a transfer, so not counted as spending twice.
        let bill = day(25)?;
        if bill.as_str() <= today {
            let v = rand.between(1_200_000, 1_800_000);
            transfer(&bank, &card, &bill, v)?;
        }
        if day(16)?.as_str() <= today {
            transfer(&bank, &funds, &day(16)?, 1_000_000)?;
        }
        if day(9)?.as_str() <= today {
            transfer(&bank, &wallet, &day(9)?, 200_000)?;
        }
    }
    // Eating out on Saturdays, on the card (a weekend pattern, US8).
    let mut day = start.clone();
    while day.as_str() < today {
        if weekday(&day).unwrap_or(0) == 6 {
            let v = rand.between(120_000, 240_000);
            add(&card, &day, -v, "Toit Brewpub", &c("Food › Dining out")?)?;
        }
        day = d(add_days(&day, 1))?;
    }
    seed_planning(db, today, &start, (&bank, &card, &funds), &c)?;

    // Rules, and a few recent lines left uncategorised so suggestions can be tried (US6).
    create_rule(
        db,
        &json!({ "name": "Ride apps", "conditions": [{ "field": "description", "op": "contains", "value": "uber" }], "categoryId": c("Transport › Cab & auto")? }),
    )?;
    create_rule(
        db,
        &json!({ "name": "Pharmacy", "conditions": [{ "field": "description", "op": "regex", "value": "apollo|pharm|medplus" }], "categoryId": c("Health › Medicines")? }),
    )?;
    let recent = |days: i64, amount: i64, payee: &str, account: &str| -> DbResult<()> {
        let posted = d(add_days(today, -days))?;
        if posted.as_str() >= start.as_str() {
            create_transaction(
                db,
                &json!({ "accountId": account, "postedDate": posted, "amountMinor": amount, "payee": payee }),
            )?;
        }
        Ok(())
    };
    recent(1, -38_500, "UPI/428812349876/Swiggy/swiggy@icici/Payment", &bank)?;
    recent(2, -27_400, "UBER *TRIP HELP.UBER.COM", &card)?;
    recent(3, -64_000, "UPI-MEDPLUS PHARMACY-MEDPLUS@YBL-YESB0YBLUPI-428899991234-UPI", &bank)?;

    // The fund's value at each month end (US7): what was paid in, plus or minus market moves.
    for (m, growth) in [1.012f64, 0.994, 1.021].into_iter().enumerate() {
        let date = d(end_of_month(&d(add_months(&start, m as i32, None))?))?;
        if date.as_str() > today {
            continue;
        }
        let paid_in = 42_000_000 + (m as i64 + 1) * 1_000_000;
        let value = js_round((paid_in as f64 * growth) / 100.0) * 100;
        upsert_valuation(
            db,
            &json!({ "accountId": funds, "date": date, "valueMinor": value, "note": "Statement value" }),
            today,
        )?;
    }
    // A home loan with its terms (US16), a fixed deposit paid out to the bank (US17) and car
    // insurance set aside monthly (US18).
    let first_emi = d(add_months(&start, -24, None))?;
    create_account(
        db,
        &json!({ "name": "Home loan", "type": "loan", "openingBalanceMinor": 371_000_000, "openingDate": start,
                 "loanPrincipalMinor": 400_000_000, "rateBp": 850, "tenureMonths": 240, "firstEmiDate": first_emi }),
    )?;
    let fd_start = d(add_months(&start, -6, None))?;
    create_account(
        db,
        &json!({ "name": "SBI fixed deposit", "type": "investment", "openingBalanceMinor": 20_000_000, "openingDate": fd_start,
                 "depositKind": "fd", "rateBp": 710, "maturityDate": d(add_months(&fd_start, 12, None))?, "payoutAccountId": bank }),
    )?;
    create_recurring(
        db,
        &json!({ "name": "Car insurance", "kind": "bill", "accountId": bank, "categoryId": c("Bills › Insurance")?,
                 "amountMinor": 2_100_000, "frequency": "yearly", "anchorDate": d(add_months(&start, 7, None))?, "setAside": true }),
        today,
    )?;
    // Who owes whom (US21): Rahul's half of a dinner, and the user owing Priya for tickets.
    if let Some(dinner) = db.query_row(
        "SELECT id, -amount_minor FROM transactions WHERE payee = 'Toit Brewpub' AND deleted_at IS NULL ORDER BY posted_date DESC LIMIT 1",
        [],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
    )? {
        super::people::add_entry(db, &json!({ "transactionId": dinner.0, "personName": "Rahul", "amountMinor": dinner.1 / 2 }), today)?;
    }
    super::people::add_entry(
        db,
        &json!({ "personName": "Priya", "amountMinor": -60_000, "note": "Movie tickets" }),
        today,
    )?;
    // A saved view (US9) on the sidebar.
    super::views::create_view(db, &json!({ "name": "Food delivery", "query": "q=swiggy&range=last-90-days" }))?;
    let mut patch = serde_json::Map::new();
    patch.insert("onboarded".into(), json!(true));
    patch.insert("bufferMinor".into(), json!(5_000_000));
    update_settings(db, &patch)?;
    Ok(())
}

/// Recurring items, a budget for each month, and two goals (US5).
fn seed_planning(
    db: &Db,
    today: &str,
    start: &str,
    (bank, card, funds): (&str, &str, &str),
    c: &dyn Fn(&str) -> DbResult<String>,
) -> DbResult<()> {
    let day = |n: i64| d(add_days(start, n - 1));
    let recurring = |name: &str, kind: &str, account: &str, amount: i64, anchor: &str, extra: Value| -> DbResult<()> {
        let mut input = json!({ "name": name, "kind": kind, "accountId": account, "amountMinor": amount, "frequency": "monthly", "anchorDate": anchor });
        if let (Some(o), Some(e)) = (input.as_object_mut(), extra.as_object()) {
            o.extend(e.clone());
        }
        create_recurring(db, &input, today)?;
        Ok(())
    };
    recurring("Salary", "income", bank, 9_500_000, &day(1)?, json!({ "categoryId": c("Income › Salary")? }))?;
    recurring("Rent", "bill", bank, 2_200_000, &day(3)?, json!({ "categoryId": c("Housing › Rent")? }))?;
    recurring(
        "Electricity",
        "bill",
        bank,
        200_000,
        &day(5)?,
        json!({ "categoryId": c("Housing › Electricity")?, "toleranceBp": 4000 }),
    )?;
    recurring("Airtel fibre", "bill", bank, 99_900, &day(6)?, json!({ "categoryId": c("Housing › Internet")? }))?;
    recurring(
        "Netflix",
        "subscription",
        card,
        64_900,
        &day(7)?,
        json!({ "categoryId": c("Entertainment › Subscriptions")? }),
    )?;
    recurring(
        "Spotify",
        "subscription",
        card,
        13_900,
        &day(12)?,
        json!({ "categoryId": c("Entertainment › Subscriptions")?, "toleranceBp": 2500 }),
    )?;
    recurring("Index fund SIP", "savings", bank, 1_000_000, &day(16)?, json!({ "toAccountId": funds }))?;
    // The card bill varies, so it matches within ±50%; card purchases reach cash on this date.
    recurring(
        "Credit card bill",
        "transfer",
        bank,
        1_500_000,
        &day(25)?,
        json!({ "toAccountId": card, "toleranceBp": 5000 }),
    )?;

    let plan: [(&str, i64); 16] = [
        ("Housing › Rent", 2_200_000),
        ("Housing › Electricity", 250_000),
        ("Housing › Internet", 100_000),
        ("Bills › Domestic help", 350_000),
        ("Food › Groceries", 1_200_000),
        ("Food › Food delivery", 300_000),
        ("Transport › Cab & auto", 350_000),
        ("Entertainment › Subscriptions", 80_000),
        ("Shopping › Household", 300_000),
        ("Health › Medicines", 200_000),
        ("Food › Dining out", 1_000_000),
        ("Bills › Mobile", 70_000),
        ("Shopping › Clothing", 800_000),
        ("Entertainment › Movies & events", 150_000),
        ("Savings & investments › Mutual funds & SIP", 1_000_000),
        ("Savings & investments › Emergency fund", 950_000),
    ];
    for m in 0..=3 {
        let month = d(add_months(start, m, None))?[..7].to_owned();
        for (path, amount) in plan {
            assign_budget(db, &month, &c(path)?, amount)?;
        }
    }

    let goal = create_goal(
        db,
        &json!({ "name": "Emergency fund", "targetMinor": 30_000_000, "targetDate": d(add_months(today, 14, None))? }),
        today,
    )?;
    let emergency = goal["goal"]["id"].as_str().unwrap_or_default().to_owned();
    contribute(
        db,
        &json!({ "goalId": emergency, "date": day(1)?, "amountMinor": 6_000_000, "note": "Starting amount" }),
        today,
    )?;
    for m in 0..=3 {
        let date = d(add_days(&d(add_months(start, m, None))?, 1))?;
        if date.as_str() <= today {
            contribute(db, &json!({ "goalId": emergency, "date": date, "amountMinor": 1_500_000 }), today)?;
        }
    }
    create_goal(
        db,
        &json!({ "name": "Investments to ₹10 lakh", "targetMinor": 100_000_000, "linkedAccountId": funds }),
        today,
    )?;
    Ok(())
}
