//! The current time. Tests and the parity harness fix it with `FIN_FAKE_NOW` (an RFC 3339
//! instant), so both backends compute the same "today" and timestamps.

use chrono::{DateTime, Utc};

pub fn now() -> DateTime<Utc> {
    std::env::var("FIN_FAKE_NOW")
        .ok()
        .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
        .map_or_else(Utc::now, |d| d.with_timezone(&Utc))
}
