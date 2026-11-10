//! The current time. Tests and the parity harness fix it with `FIN_FAKE_NOW` (an RFC 3339
//! instant) or `set_now`, so both backends compute the same "today" and timestamps.

use std::sync::Mutex;

use chrono::{DateTime, Utc};

static OVERRIDE: Mutex<Option<DateTime<Utc>>> = Mutex::new(None);

pub fn now() -> DateTime<Utc> {
    if let Some(t) = *OVERRIDE.lock().unwrap_or_else(|p| p.into_inner()) {
        return t;
    }
    std::env::var("FIN_FAKE_NOW")
        .ok()
        .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
        .map_or_else(Utc::now, |d| d.with_timezone(&Utc))
}

/// Move the clock (test tooling only: `fin-cli` exposes it to the parity harness).
pub fn set_now(at: Option<DateTime<Utc>>) {
    *OVERRIDE.lock().unwrap_or_else(|p| p.into_inner()) = at;
}
