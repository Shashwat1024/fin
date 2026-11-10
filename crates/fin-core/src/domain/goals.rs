//! Savings goal projection (`src/domain/goals.ts`, FR-024). Arithmetic follows the TypeScript
//! original step by step (including its floating-point floor/ceil), so both give the same paise.

use crate::domain::dates::{add_months, parts};

/// Contributions over this many months set the pace used for the projected date.
pub const PACE_MONTHS: i64 = 3;
/// Beyond this the pace is too slow for a projected date to mean anything.
pub const MAX_PROJECTION_MONTHS: f64 = 600.0;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Projection {
    pub saved_minor: i64,
    pub remaining_minor: i64,
    pub percent: i64,
    pub months_left: Option<i64>,
    pub required_monthly_minor: Option<i64>,
    pub pace_monthly_minor: i64,
    pub projected_date: Option<String>,
    pub status: &'static str,
}

/// Calendar months from `from`'s month to `to`'s month (Nov → next Nov = 12).
pub fn months_between(from: &str, to: &str) -> i64 {
    match (parts(from), parts(to)) {
        (Ok(a), Ok(b)) => (b.year - a.year) as i64 * 12 + (b.month as i64 - a.month as i64),
        _ => 0,
    }
}

pub fn project_goal(
    target_minor: i64,
    target_date: Option<&str>,
    saved_minor: i64,
    recent_minor: i64,
    today: &str,
) -> Projection {
    let remaining = (target_minor - saved_minor).max(0);
    let percent = if target_minor <= 0 {
        100
    } else {
        (((saved_minor as f64 * 100.0) / target_minor as f64).floor() as i64).clamp(0, 100)
    };
    let past = target_date.is_some_and(|d| d < today);
    let months_left = match target_date {
        Some(d) if !past => Some(months_between(today, d).max(1)),
        _ => None,
    };
    let required = months_left.map(|m| (remaining as f64 / m as f64).ceil() as i64);
    let pace = ((recent_minor as f64 / PACE_MONTHS as f64).floor() as i64).max(0);
    let months_at_pace = if recent_minor > 0 {
        ((remaining as f64 * PACE_MONTHS as f64) / recent_minor as f64).ceil()
    } else {
        f64::INFINITY
    };
    let projected = if remaining == 0 {
        Some(today.to_owned())
    } else if months_at_pace <= MAX_PROJECTION_MONTHS {
        add_months(today, months_at_pace as i32, None).ok()
    } else {
        None
    };
    let status = if remaining == 0 {
        "achieved"
    } else if past {
        "past_target"
    } else if projected.is_none() {
        "no_pace"
    } else if target_date.is_none_or(|t| projected.as_deref().is_some_and(|p| p <= t)) {
        "on_track"
    } else {
        "off_track"
    };
    Projection {
        saved_minor,
        remaining_minor: remaining,
        percent,
        months_left,
        required_monthly_minor: required,
        pace_monthly_minor: pace,
        projected_date: projected,
        status,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projections() {
        let p = project_goal(30_000_000, Some("2027-12-10"), 12_000_000, 4_500_000, "2026-11-10");
        assert_eq!((p.percent, p.months_left, p.required_monthly_minor), (40, Some(13), Some(1_384_616)));
        assert_eq!(
            (p.pace_monthly_minor, p.projected_date.as_deref(), p.status),
            (1_500_000, Some("2027-11-10"), "on_track")
        );
        assert_eq!(project_goal(100, None, 100, 0, "2026-11-10").status, "achieved");
        assert_eq!(project_goal(100, Some("2026-01-01"), 10, 0, "2026-11-10").status, "past_target");
        assert_eq!(project_goal(100, None, 10, 0, "2026-11-10").status, "no_pace");
    }
}
