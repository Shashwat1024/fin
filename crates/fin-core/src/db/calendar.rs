//! Spending calendar (US12): money out per day for one month, by the same rule as the Overview's
//! "Spent" (`dashboard.rs`: standard transactions with a negative amount, transfers excluded, every
//! account), so a full month's total equals that figure.

use std::collections::HashMap;

use rusqlite::params;
use serde_json::{Value, json};

use super::settings::get_settings;
use super::{Db, DbResult};
use crate::domain::dates::{add_days, end_of_month};
use crate::error::AppError;

pub fn spending_calendar(db: &Db, month: &str, today: &str) -> DbResult<Value> {
    let from = format!("{month}-01");
    let to = end_of_month(&from).map_err(|_| AppError::invariant("Invalid month"))?;
    let by_day: HashMap<String, (i64, i64)> = db
        .query_map(
            "SELECT posted_date, -SUM(amount_minor), COUNT(*) FROM transactions
       WHERE deleted_at IS NULL AND kind = 'standard' AND amount_minor < 0 AND posted_date BETWEEN ? AND ?
       GROUP BY posted_date",
            params![from, to],
            |r| Ok((r.get::<_, String>(0)?, (r.get::<_, i64>(1)?, r.get::<_, i64>(2)?))),
        )?
        .into_iter()
        .collect();

    let mut days = Vec::new();
    let mut day = from.clone();
    while day <= to {
        let (spent, count) = by_day.get(&day).copied().unwrap_or((0, 0));
        days.push((day.clone(), spent, count));
        day = add_days(&day, 1).map_err(|_| AppError::internal())?;
    }
    let total: i64 = days.iter().map(|d| d.1).sum();
    // No-spend days only count days that have happened.
    let elapsed: Vec<&(String, i64, i64)> = days.iter().filter(|d| d.0.as_str() <= today).collect();
    let no_spend = elapsed.iter().filter(|d| d.1 == 0).count();
    // The highest day; the earliest wins a tie.
    let highest = days.iter().filter(|d| d.1 > 0).fold(None::<&(String, i64, i64)>, |best, d| match best {
        Some(b) if b.1 >= d.1 => Some(b),
        _ => Some(d),
    });
    let dto = |d: &(String, i64, i64)| json!({ "date": d.0, "spentMinor": d.1, "count": d.2 });
    Ok(json!({
        "month": month,
        "from": from,
        "to": to,
        "days": days.iter().map(dto).collect::<Vec<_>>(),
        "totalMinor": total,
        "noSpendDays": no_spend,
        "elapsedDays": elapsed.len(),
        "highest": highest.map_or(Value::Null, dto),
        "weekStart": get_settings(db)?["weekStart"],
        "today": today,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::accounts::create_account;
    use crate::db::dashboard::dashboard_summary;
    use crate::db::test_db;
    use crate::db::transactions::{create_transaction, create_transfer};

    fn account(db: &Db, name: &str, t: &str) -> String {
        let r = create_account(db, &json!({ "name": name, "type": t, "openingDate": "2026-01-01" })).unwrap();
        r["account"]["id"].as_str().unwrap().to_owned()
    }
    fn spend(db: &Db, acc: &str, date: &str, amount: i64) {
        create_transaction(db, &json!({ "accountId": acc, "postedDate": date, "amountMinor": amount, "payee": "x" }))
            .unwrap();
    }

    #[test]
    fn month_total_matches_the_overview_and_transfers_are_left_out() {
        let db = test_db();
        let bank = account(&db, "Bank", "bank");
        let card = account(&db, "Card", "credit_card");
        spend(&db, &bank, "2026-10-03", -50_000);
        spend(&db, &bank, "2026-10-03", -25_000);
        spend(&db, &card, "2026-10-17", -120_000);
        spend(&db, &bank, "2026-10-20", 900_000); // income is not spending
        spend(&db, &bank, "2026-09-30", -1_000); // other month
        create_transfer(
            &db,
            &json!({ "fromAccountId": bank, "toAccountId": card, "postedDate": "2026-10-25", "amountMinor": 120_000 }),
        )
        .unwrap();

        let cal = spending_calendar(&db, "2026-10", "2026-11-05").unwrap();
        assert_eq!(cal["days"].as_array().unwrap().len(), 31);
        assert_eq!(cal["days"][2], json!({ "date": "2026-10-03", "spentMinor": 75_000, "count": 2 }));
        assert_eq!(cal["totalMinor"], 195_000);
        assert_eq!(cal["noSpendDays"], 29);
        assert_eq!(cal["highest"]["date"], "2026-10-17");

        // The Overview's "Spent" for the whole of October (as of its last day) is the same figure.
        let overview = dashboard_summary(&db, "2026-10-31").unwrap();
        assert_eq!(overview["spent"]["valueMinor"], cal["totalMinor"]);
    }

    #[test]
    fn days_after_today_are_not_no_spend_days() {
        let db = test_db();
        let cal = spending_calendar(&db, "2028-02", "2028-02-10").unwrap();
        assert_eq!(cal["days"].as_array().unwrap().len(), 29);
        assert_eq!(cal["elapsedDays"], 10);
        assert_eq!(cal["noSpendDays"], 10);
        assert_eq!(cal["highest"], Value::Null);
    }
}
