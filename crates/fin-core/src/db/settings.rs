//! Settings, stored as JSON values under string keys (`src/db/repos/settings.ts`).

use rusqlite::params;
use serde_json::{Map, Value, json};

use super::{Db, DbResult};

/// Defaults, in the order the interface receives them.
pub fn defaults() -> Map<String, Value> {
    let mut m = Map::new();
    for (k, v) in [
        ("currency", json!("INR")),
        ("timezone", json!("Asia/Kolkata")),
        ("fyStartMonth", json!(4)),
        ("weekStart", json!(1)),
        ("locale", json!("en-IN")),
        ("theme", json!("system")),
        ("bufferMinor", json!(0)),
        ("onboarded", json!(false)),
        ("backupDir", Value::Null),
        ("notifyEnabled", json!(false)),
        ("notifyRecurring", json!(true)),
        ("notifyCardDue", json!(true)),
        ("notifyLowCash", json!(true)),
        ("cardDueNoticeDays", json!(3)),
        ("quietHoursStart", json!("22:00")),
        ("quietHoursEnd", json!("08:00")),
        ("notifyShowAmounts", json!(true)),
        ("keepInTray", json!(false)),
        ("startAtLogin", json!(false)),
    ] {
        m.insert(k.to_owned(), v);
    }
    m
}

pub fn get_settings(db: &Db) -> DbResult<Map<String, Value>> {
    let mut out = defaults();
    for (key, value) in
        db.query_map("SELECT key, value FROM settings", [], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
    {
        if out.contains_key(&key)
            && let Ok(v) = serde_json::from_str::<Value>(&value)
        {
            // A corrupt value keeps the default.
            out.insert(key, v);
        }
    }
    Ok(out)
}

pub fn update_settings(db: &Db, patch: &Map<String, Value>) -> DbResult<Map<String, Value>> {
    let known = defaults();
    db.transaction(|| {
        for (key, value) in patch {
            if !known.contains_key(key) {
                continue;
            }
            db.run(
                "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                params![key, serde_json::to_string(value).unwrap_or_default()],
            )?;
        }
        Ok(())
    })?;
    get_settings(db)
}

/// Today in the user's time zone.
pub fn today(db: &Db) -> DbResult<String> {
    let s = get_settings(db)?;
    Ok(crate::domain::dates::today_in(s["timezone"].as_str().unwrap_or("Asia/Kolkata")))
}
