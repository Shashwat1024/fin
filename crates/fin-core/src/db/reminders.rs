//! Reminders over the ledger (US11): gathers what is expected and hands it to
//! `domain/reminders.rs`; records what was shown in `notification_log` so nothing repeats.

use rusqlite::params;
use serde_json::{Map, Value, json};

use super::cards::cards_with_cycles;
use super::forecast::forecast;
use super::planning::list_occurrences;
use super::settings::get_settings;
use super::{Db, DbResult, now_iso};
use crate::domain::dates::{add_days, time_in, today_in};
use crate::domain::reminders::{
    CardBill, LowCash, OVERDUE_REMIND_DAYS, Payment, Reminder, ReminderInput, ReminderSettings, due_reminders,
};

fn st(v: &Value, k: &str) -> String {
    v.get(k).and_then(Value::as_str).unwrap_or_default().to_owned()
}

fn settings_of(s: &Map<String, Value>) -> ReminderSettings {
    let flag = |k: &str| s.get(k).and_then(Value::as_bool).unwrap_or(true);
    let text = |k: &str, d: &str| s.get(k).and_then(Value::as_str).unwrap_or(d).to_owned();
    ReminderSettings {
        recurring: flag("notifyRecurring"),
        card_due: flag("notifyCardDue"),
        low_cash: flag("notifyLowCash"),
        card_notice_days: s.get("cardDueNoticeDays").and_then(Value::as_i64).unwrap_or(3),
        quiet_start: text("quietHoursStart", "22:00"),
        quiet_end: text("quietHoursEnd", "08:00"),
        show_amounts: flag("notifyShowAmounts"),
    }
}

/// Every reminder due at `today`/`time`, whether or not it was shown before.
fn compute(db: &Db, today: &str, time: &str, settings: &ReminderSettings) -> DbResult<Vec<Reminder>> {
    let ad = |n: i64| add_days(today, n).unwrap_or_else(|_| today.to_owned());
    let payments: Vec<Payment> = if settings.recurring {
        list_occurrences(db, &ad(-OVERDUE_REMIND_DAYS), &ad(1), today)?
            .iter()
            .filter(|o| o["kind"] != "income" && (o["state"] == "expected" || o["state"] == "overdue"))
            .map(|o| Payment {
                item_id: st(o, "itemId"),
                name: st(o, "itemName"),
                due_date: st(o, "dueDate"),
                amount_minor: o["expectedMinor"].as_i64().unwrap_or(0),
                overdue: o["state"] == "overdue",
            })
            .collect()
    } else {
        Vec::new()
    };
    let cards: Vec<CardBill> = if settings.card_due {
        cards_with_cycles(db, today)?
            .into_iter()
            .filter_map(|c| {
                Some(CardBill {
                    statement_date: c.cycle.statement_date.clone()?,
                    due_date: c.cycle.due_date.clone()?,
                    remaining_minor: c.cycle.remaining_minor,
                    account_id: c.account_id,
                    name: c.account_name,
                })
            })
            .collect()
    } else {
        Vec::new()
    };
    let low = if settings.low_cash {
        let f = forecast(db, 30, today)?;
        let buffer = f["bufferMinor"].as_i64().unwrap_or(0);
        f["belowBuffer"].as_array().and_then(|r| r.first()).filter(|_| buffer > 0).map(|r| LowCash {
            from: st(r, "from"),
            lowest_minor: r["lowestMinor"].as_i64().unwrap_or(0),
            lowest_date: st(r, "lowestDate"),
            buffer_minor: buffer,
        })
    } else {
        None
    };
    Ok(due_reminders(&ReminderInput {
        today,
        time,
        settings,
        payments: &payments,
        cards: &cards,
        low_cash: low.as_ref(),
    }))
}

fn was_sent(db: &Db, key: &str) -> DbResult<bool> {
    Ok(db.query_row("SELECT 1 FROM notification_log WHERE key = ?", [key], |_| Ok(()))?.is_some())
}

fn to_dto(r: &Reminder, sent: bool) -> Value {
    json!({ "key": r.key, "kind": r.kind, "title": r.title, "body": r.body, "route": r.route, "sent": sent })
}

/// What would be reminded today, for Settings: quiet hours and the main switch aside, each marked
/// with whether it was already shown.
pub fn preview(db: &Db) -> DbResult<Vec<Value>> {
    let s = get_settings(db)?;
    let tz = s["timezone"].as_str().unwrap_or("Asia/Kolkata").to_owned();
    let mut rs = settings_of(&s);
    rs.quiet_start = "00:00".into();
    rs.quiet_end = "00:00".into();
    let mut out = Vec::new();
    for r in compute(db, &today_in(&tz), &time_in(&tz), &rs)? {
        out.push(to_dto(&r, was_sent(db, &r.key)?));
    }
    Ok(out)
}

/// The reminders to show now: due, outside quiet hours and never shown before. They are recorded as
/// shown before being returned, so a failure while showing can lose one but never repeat it.
pub fn take_due(db: &Db) -> DbResult<Vec<Value>> {
    let s = get_settings(db)?;
    if s["notifyEnabled"] != true {
        return Ok(Vec::new());
    }
    let tz = s["timezone"].as_str().unwrap_or("Asia/Kolkata").to_owned();
    let due = compute(db, &today_in(&tz), &time_in(&tz), &settings_of(&s))?;
    let mut out = Vec::new();
    db.transaction(|| {
        for r in &due {
            if !was_sent(db, &r.key)? {
                db.run("INSERT INTO notification_log (key, sent_at) VALUES (?, ?)", params![r.key, now_iso()])?;
                out.push(to_dto(r, false));
            }
        }
        Ok(())
    })?;
    Ok(out)
}

/// A sample for "Show a test notification".
pub fn test_reminder() -> Value {
    json!({
        "key": "test",
        "kind": "test",
        "title": "Fin reminders are on",
        "body": "This is how reminders will look. Windows shows them on this computer; nothing is sent anywhere.",
        "route": "/settings",
        "sent": false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::accounts::create_account;
    use crate::db::planning::create_recurring;
    use crate::db::settings::update_settings;
    use crate::db::test_db;

    fn at(instant: &str) {
        crate::clock::set_now(Some(instant.parse().unwrap()));
    }

    #[test]
    fn reminders_are_off_by_default_shown_once_and_held_in_quiet_hours() {
        let db = test_db();
        at("2026-11-10T04:00:00Z"); // 09:30 in Kolkata
        let bank =
            create_account(&db, &json!({ "name": "Bank", "type": "bank", "openingDate": "2026-10-01" })).unwrap();
        let bank = bank["account"]["id"].as_str().unwrap().to_owned();
        let rent = create_recurring(
            &db,
            &json!({ "name": "Rent", "kind": "bill", "accountId": bank, "amountMinor": 2_500_000,
                     "frequency": "monthly", "anchorDate": "2026-10-11" }),
            "2026-11-10",
        )
        .unwrap();
        let rent = rent["item"]["id"].as_str().unwrap().to_owned();
        create_recurring(
            &db,
            &json!({ "name": "Salary", "kind": "income", "accountId": bank, "amountMinor": 9_000_000,
                     "frequency": "monthly", "anchorDate": "2026-10-11" }),
            "2026-11-10",
        )
        .unwrap();

        // Off until turned on, but Settings can still show what would come.
        assert!(take_due(&db).unwrap().is_empty());
        let coming = preview(&db).unwrap();
        assert_eq!(coming.len(), 1, "income is not reminded");
        assert_eq!(coming[0]["body"], "Rent: ₹25,000 on 11 Nov");

        let mut on = Map::new();
        on.insert("notifyEnabled".into(), json!(true));
        update_settings(&db, &on).unwrap();
        let first = take_due(&db).unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0]["key"], format!("recurring:{rent}:2026-11-11:tomorrow"));
        assert!(take_due(&db).unwrap().is_empty(), "never repeated");
        assert_eq!(preview(&db).unwrap()[0]["sent"], true);

        at("2026-11-10T17:00:00Z"); // 22:30 in Kolkata
        db.exec("DELETE FROM notification_log").unwrap();
        assert!(take_due(&db).unwrap().is_empty(), "quiet hours");
        crate::clock::set_now(None);
    }
}
