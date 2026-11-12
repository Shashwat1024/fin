//! NFR performance with 50,000 transactions (plan.md): list filtering < 150 ms, the Overview
//! < 300 ms, the heavier pages < 300–500 ms. Timings only mean something on an optimised build,
//! so this runs with `npm run test:perf` (`cargo test --release -- --ignored`). Each figure is
//! the median of several runs after one warm-up.

use std::time::Instant;

use fin_core::app::{App, AppPaths, PresetDialogs};
use fin_core::dispatch::dispatch;
use serde_json::{Value, json};

const TODAY: &str = "2026-11-09";

fn median_ms(app: &mut App, channel: &str, input: Value, runs: usize) -> u128 {
    let reply = dispatch(app, channel, Some(input.clone()));
    assert_eq!(reply["ok"], true, "{channel}: {reply}");
    let mut t: Vec<u128> = (0..runs)
        .map(|_| {
            let s = Instant::now();
            dispatch(app, channel, Some(input.clone()));
            s.elapsed().as_millis()
        })
        .collect();
    t.sort();
    t[runs / 2]
}

#[test]
#[ignore = "timing: run with npm run test:perf (release build)"]
fn fifty_thousand_transactions_stay_fast() {
    // SAFETY: set before anything reads the clock; this test runs alone in its own process.
    unsafe { std::env::set_var("FIN_FAKE_NOW", format!("{TODAY}T06:30:00Z")) };
    let dir = tempfile::tempdir().unwrap();
    let mut app = App::open(AppPaths::in_dir(dir.path()), Box::new(PresetDialogs::default())).unwrap();
    let n = fin_core::db::seed_perf::seed_perf_data(app.db(), TODAY, 50_000).unwrap();
    assert!(n >= 50_000);
    app.db().exec("PRAGMA optimize").unwrap();
    let cats = dispatch(&mut app, "categories.list", None);
    let food = cats["data"].as_array().unwrap().iter().find(|c| c["path"] == "Food").unwrap()["id"].clone();
    let accounts = dispatch(&mut app, "accounts.list", None);
    let bank = accounts["data"].as_array().unwrap().iter().find(|a| a["name"] == "Perf Bank").unwrap()["id"].clone();

    let mut report = Vec::new();
    let mut check = |app: &mut App, name: &str, channel: &str, input: Value, budget: u128| {
        let ms = median_ms(app, channel, input, 5);
        report.push(format!("{name}: {ms} ms (budget {budget})"));
        println!("{}", report.last().unwrap());
        assert!(ms < budget, "{name} took {ms} ms (budget {budget} ms)");
    };
    check(&mut app, "txns: first page", "txns.query", json!({ "limit": 100 }), 150);
    check(&mut app, "txns: text search", "txns.query", json!({ "text": "swiggy", "limit": 100 }), 150);
    check(
        &mut app,
        "txns: category + year",
        "txns.query",
        json!({ "categoryIds": [food], "from": "2025-11-01", "to": TODAY, "limit": 100 }),
        150,
    );
    check(
        &mut app,
        "txns: amount + account",
        "txns.query",
        json!({ "accountIds": [bank], "minAmountMinor": 100_000, "direction": "out", "limit": 100 }),
        150,
    );
    check(
        &mut app,
        "txns: uncategorised",
        "txns.query",
        json!({ "categoryIds": ["uncategorized"], "limit": 100 }),
        150,
    );
    check(&mut app, "dashboard.summary", "dashboard.summary", json!({}), 300);
    check(&mut app, "forecast 30", "forecast.run", json!({ "days": 30 }), 300);
    check(&mut app, "forecast 90", "forecast.run", json!({ "days": 90 }), 300);
    check(&mut app, "budget month", "budget.month", json!({ "month": "2026-11" }), 300);
    check(&mut app, "net worth (all)", "networth.history", json!({ "from": "1900-01-01" }), 300);
    check(&mut app, "insights", "insights.list", json!({}), 500);
    // Daily use (specs/003-daily-use SC-012).
    check(&mut app, "card cycles", "cards.cycles", json!({}), 100);
    check(&mut app, "spending calendar", "insights.calendar", json!({ "month": &TODAY[..7] }), 100);
    check(&mut app, "reminder check", "reminders.preview", json!({}), 300);
    // Making sense of it (specs/004-understanding SC-015).
    check(&mut app, "health summary", "health.summary", json!({}), 300);
    check(&mut app, "month review", "review.month", json!({ "month": "2026-10" }), 300);
    check(&mut app, "year in review", "review.year", json!({ "basis": "fy" }), 500);
    // Loans and deposits (specs/005-loans-deposits SC-019).
    check(&mut app, "loans", "loans.summary", json!({}), 100);
    check(&mut app, "deposits", "deposits.summary", json!({}), 100);
    // Tax and investments (specs/006-tax-investments SC-021).
    // A busy category (Food and everything under it) counted under a section, so the totals do work.
    dispatch(&mut app, "tax.map", Some(json!({ "sectionId": "tax_80c", "categoryId": food })));
    check(&mut app, "tax year", "tax.year", json!({ "year": 2026 }), 300);
    // Shared life (specs/007-shared-life SC-023).
    check(&mut app, "people", "people.list", json!({}), 100);
    check(&mut app, "looks recurring", "recurring.detectCandidates", json!({}), 500);
    check(
        &mut app,
        "what-if 90",
        "scenarios.run",
        json!({ "days": 90, "changes": [{ "kind": "large_purchase", "name": "Laptop", "amountMinor": 15_000_000, "date": TODAY }] }),
        300,
    );

    // Everything the Overview loads at once.
    let overview = |app: &mut App| {
        for (channel, input) in [
            ("dashboard.summary", json!({})),
            ("forecast.run", json!({ "days": 30 })),
            ("recurring.list", json!({})),
            ("recurring.occurrences", json!({ "from": "2026-09-10", "to": "2027-01-07" })),
            ("budget.month", json!({ "month": "2026-11" })),
            ("goals.list", json!({})),
            ("accounts.list", json!({})),
            ("txns.query", json!({ "limit": 10 })),
            ("health.summary", json!({})),
            ("review.prompt", json!({})),
        ] {
            dispatch(app, channel, Some(input));
        }
    };
    overview(&mut app);
    let mut t: Vec<u128> = (0..5)
        .map(|_| {
            let s = Instant::now();
            overview(&mut app);
            s.elapsed().as_millis()
        })
        .collect();
    t.sort();
    report.push(format!("overview (all queries): {} ms (budget 300)", t[2]));
    println!("{}", report.last().unwrap());
    assert!(t[2] < 300, "the Overview took {} ms", t[2]);
}
