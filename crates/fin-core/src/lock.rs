//! The app lock (Fin 2.7): a PIN, optionally Windows Hello, an idle time. While locked, `dispatch`
//! answers nothing but `lock.status` and `lock.unlock`, so the interface can't skip the lock.
//!
//! The lock is a gate against someone at an unlocked computer; the data itself is protected by the
//! encryption key, which Windows keeps for this account. The PIN is stored only as an scrypt hash,
//! in a settings row the interface never receives and exports leave out.

use chrono::{DateTime, Duration, Utc};
use rusqlite::params;
use serde_json::{Value, json};

use crate::app::App;
use crate::db::{Db, DbResult};
use crate::error::{AppError, ErrorCode};

const SETTING: &str = "lock";
/// Wrong PINs in a row before Fin makes the next try wait.
const TRIES: u32 = 5;
const WAIT_SECONDS: i64 = 30;
/// scrypt cost for PINs: about 16 MB and a few tens of milliseconds.
const PIN_LOG_N: u8 = 14;

#[derive(Debug, Default)]
pub struct LockState {
    pub locked: bool,
    failures: u32,
    wait_until: Option<DateTime<Utc>>,
}

impl LockState {
    /// Fin opens locked when the lock is on.
    pub fn on_open(db: &Db) -> LockState {
        LockState { locked: config(db).is_ok_and(|c| c.enabled()), ..LockState::default() }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LockConfig {
    /// `salt:hash` in hex, or empty when the lock is off.
    pin: String,
    pub hello: bool,
    /// Idle minutes before locking; 0 means never.
    pub after_minutes: i64,
}

impl LockConfig {
    pub fn enabled(&self) -> bool {
        !self.pin.is_empty()
    }
}

fn config(db: &Db) -> DbResult<LockConfig> {
    let stored: Option<String> =
        db.query_row("SELECT value FROM settings WHERE key = ?", [SETTING], |r| r.get(0)).ok().flatten();
    let v: Value = stored.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
    Ok(LockConfig {
        pin: v["pin"].as_str().unwrap_or_default().to_owned(),
        hello: v["hello"] == true,
        after_minutes: v["afterMinutes"].as_i64().unwrap_or(15),
    })
}

fn save(db: &Db, c: &LockConfig) -> DbResult<()> {
    let value = json!({ "pin": c.pin, "hello": c.hello, "afterMinutes": c.after_minutes }).to_string();
    db.run(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        params![SETTING, value],
    )?;
    Ok(())
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn pin_hash(pin: &str, salt: &[u8]) -> Vec<u8> {
    let params = scrypt::Params::new(PIN_LOG_N, 8, 1).expect("valid scrypt parameters");
    let mut out = [0u8; 32];
    scrypt::scrypt(pin.as_bytes(), salt, &params, &mut out).expect("scrypt output length is valid");
    out.to_vec()
}

fn hash_new_pin(pin: &str) -> String {
    let mut salt = [0u8; 16];
    getrandom::fill(&mut salt).expect("the operating system provides random numbers");
    format!("{}:{}", hex(&salt), hex(&pin_hash(pin, &salt)))
}

fn pin_matches(stored: &str, pin: &str) -> bool {
    let Some((salt, hash)) = stored.split_once(':') else { return false };
    let Ok(salt) =
        (0..salt.len() / 2).map(|i| u8::from_str_radix(&salt[i * 2..i * 2 + 2], 16)).collect::<Result<Vec<u8>, _>>()
    else {
        return false;
    };
    // Compare every byte, so the time taken says nothing about how much matched.
    let got = hex(&pin_hash(pin, &salt));
    got.len() == hash.len() && got.bytes().zip(hash.bytes()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
}

pub fn valid_pin(pin: &str) -> bool {
    (4..=8).contains(&pin.len()) && pin.bytes().all(|b| b.is_ascii_digit())
}

/// What the lock screen and Settings › Privacy show. The shell adds whether Windows Hello is
/// available on this computer.
pub fn status(app: &App) -> DbResult<Value> {
    let c = config(app.db())?;
    let wait = app.lock.wait_until.map_or(0, |t| (t - crate::clock::now()).num_seconds().max(0));
    Ok(json!({
        "locked": app.lock.locked,
        "enabled": c.enabled(),
        "hello": c.hello,
        "helloAvailable": false,
        "afterMinutes": c.after_minutes,
        "waitSeconds": wait,
        "encrypted": app.is_encrypted(),
        "demo": app.is_demo(),
    }))
}

/// Turn the lock on (a new PIN), change its PIN, Windows Hello or idle time, or turn it off
/// (`pin: null`). Only possible while unlocked, which the gate guarantees.
pub fn configure(app: &mut App, input: &Value) -> DbResult<Value> {
    let mut c = config(app.db())?;
    match input.get("pin") {
        Some(Value::Null) => {
            c.pin.clear();
            c.hello = false;
        }
        Some(Value::String(pin)) => {
            if !valid_pin(pin) {
                return Err(AppError::new(ErrorCode::Validation, "A PIN is 4 to 8 digits."));
            }
            c.pin = hash_new_pin(pin);
        }
        _ => {}
    }
    if let Some(h) = input.get("hello").and_then(Value::as_bool) {
        c.hello = h && c.enabled();
    }
    if let Some(m) = input.get("afterMinutes").and_then(Value::as_i64) {
        c.after_minutes = m;
    }
    save(app.db(), &c)?;
    crate::log::info("lock.configured", &[("on", crate::log::Ctx::Text(if c.enabled() { "yes" } else { "no" }))]);
    status(app)
}

/// Unlock with the PIN. After five wrong PINs in a row each try waits 30 seconds.
pub fn unlock_with_pin(app: &mut App, pin: &str) -> DbResult<Value> {
    let c = config(app.db())?;
    if !app.lock.locked || !c.enabled() {
        app.lock.locked = false;
        return status(app);
    }
    let now = crate::clock::now();
    if let Some(until) = app.lock.wait_until
        && until > now
    {
        let secs = (until - now).num_seconds().max(1);
        return Err(AppError::new(ErrorCode::Validation, format!("Too many tries. Wait {secs} seconds.")));
    }
    if pin_matches(&c.pin, pin) {
        unlock(app);
        return status(app);
    }
    app.lock.failures += 1;
    if app.lock.failures >= TRIES {
        app.lock.wait_until = Some(now + Duration::seconds(WAIT_SECONDS));
    }
    crate::log::info("lock.wrong_pin", &[]);
    Err(AppError::new(ErrorCode::Validation, "That PIN is not right."))
}

/// Unlock after Windows has checked the user (Windows Hello, in the shell).
pub fn unlock(app: &mut App) {
    app.lock = LockState::default();
    crate::log::info("lock.unlocked", &[]);
}

/// Lock now (Ctrl+L, idle time, the tray). Nothing happens when the lock is off.
pub fn lock_now(app: &mut App) -> DbResult<Value> {
    if config(app.db())?.enabled() {
        app.lock.locked = true;
        crate::log::info("lock.locked", &[]);
    }
    status(app)
}

/// Whether reminders must leave out amounts and names: always while the lock is on.
pub fn private_notifications(app: &App) -> bool {
    config(app.db()).is_ok_and(|c| c.enabled())
}

/// Requests answered while locked.
pub fn allowed_while_locked(channel: &str) -> bool {
    matches!(channel, "lock.status" | "lock.unlock")
}

pub fn locked_error() -> AppError {
    AppError::new(ErrorCode::Locked, "Fin is locked.")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pins_are_hashed_and_checked() {
        let stored = hash_new_pin("4821");
        assert!(!stored.contains("4821"));
        assert!(pin_matches(&stored, "4821"));
        assert!(!pin_matches(&stored, "4822"));
        assert!(!pin_matches("nonsense", "4821"));
        assert_ne!(hash_new_pin("4821"), stored, "each PIN gets its own salt");
        assert!(valid_pin("1234") && valid_pin("12345678"));
        assert!(!valid_pin("123") && !valid_pin("123456789") && !valid_pin("12a4"));
    }
}
