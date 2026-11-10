//! Recurring schedules and payment matching (`src/domain/recurrence.ts`, research R12). An
//! occurrence is computed from the anchor (anchor + n × interval), never from the previous one,
//! so a schedule on the 31st lands on 30 Apr and 28/29 Feb, then returns to the 31st.

use crate::domain::dates::{add_days, add_months, diff_days, month_long, parts, weekday, weekday_long};

#[derive(Debug, Clone)]
pub struct Schedule {
    pub frequency: String,
    pub interval: i64,
    pub anchor_date: String,
    pub end_date: Option<String>,
    pub count: Option<i64>,
}

/// The n-th occurrence (0-based), with month-end clamping.
pub fn nth_occurrence(s: &Schedule, n: i64) -> String {
    let r = match s.frequency.as_str() {
        "weekly" => add_days(&s.anchor_date, 7 * s.interval * n),
        "monthly" => add_months(&s.anchor_date, (s.interval * n) as i32, None),
        _ => add_months(&s.anchor_date, (12 * s.interval * n) as i32, None),
    };
    r.unwrap_or_else(|_| "9999-12-31".into())
}

/// Index of the first occurrence on or after `date` (a lower bound; may be a little early).
fn first_index_from(s: &Schedule, date: &str) -> i64 {
    if date <= s.anchor_date.as_str() {
        return 0;
    }
    let (Ok(a), Ok(d)) = (parts(&s.anchor_date), parts(date)) else { return 0 };
    let months = (d.year - a.year) as i64 * 12 + (d.month as i64 - a.month as i64);
    let raw = match s.frequency.as_str() {
        "weekly" => (diff_days(date, &s.anchor_date).unwrap_or(0) as f64 / (7 * s.interval) as f64).floor() as i64,
        "yearly" => (months as f64 / (12 * s.interval) as f64).floor() as i64,
        _ => (months as f64 / s.interval as f64).floor() as i64,
    };
    (raw - 1).max(0)
}

/// Occurrence dates within [from, to], in order.
pub fn occurrences_between(s: &Schedule, from: &str, to: &str) -> Vec<String> {
    let mut out = Vec::new();
    if s.interval < 1 {
        return out;
    }
    let last = match &s.end_date {
        Some(e) if e.as_str() < to => e.as_str(),
        _ => to,
    };
    let mut n = first_index_from(s, from);
    loop {
        if s.count.is_some_and(|c| n >= c) {
            break;
        }
        let date = nth_occurrence(s, n);
        if date.as_str() > last {
            break;
        }
        if date.as_str() >= from {
            out.push(date);
        }
        n += 1;
    }
    out
}

/// The first occurrence on or after `date`, or `None` when the schedule has ended.
pub fn next_occurrence(s: &Schedule, date: &str) -> Option<String> {
    let horizon = match s.frequency.as_str() {
        "yearly" => 366 * s.interval + 1,
        "monthly" => 31 * s.interval + 1,
        _ => 7 * s.interval,
    };
    let to = add_days(date, horizon).ok()?;
    occurrences_between(s, date, &to).into_iter().next()
}

fn ordinal(n: u32) -> String {
    let rem100 = n % 100;
    if (11..=13).contains(&rem100) {
        return format!("{n}th");
    }
    let suffix = match n % 10 {
        1 => "st",
        2 => "nd",
        3 => "rd",
        _ => "th",
    };
    format!("{n}{suffix}")
}

/// "Every month on the 1st", "Every 2 weeks on Monday", "Every year on 5 March".
pub fn describe_schedule(s: &Schedule) -> String {
    let Ok(p) = parts(&s.anchor_date) else { return String::new() };
    let every =
        |unit: &str| if s.interval == 1 { format!("Every {unit}") } else { format!("Every {} {unit}s", s.interval) };
    let day_text = if p.day >= 29 { format!("{} (or the last day)", ordinal(p.day)) } else { ordinal(p.day) };
    match s.frequency.as_str() {
        "weekly" => format!("{} on {}", every("week"), weekday_long(weekday(&s.anchor_date).unwrap_or(0))),
        "monthly" => format!("{} on the {day_text}", every("month")),
        _ => format!("{} on {} {}", every("year"), p.day, month_long(p.month)),
    }
}

// ---- Matching ---------------------------------------------------------------------------------

pub const MATCH_WINDOW_DAYS: i64 = 3;

/// Same direction, and |actual − expected| ≤ tolerance × |expected| (integer maths).
pub fn within_tolerance(expected: i64, actual: i64, tolerance_bp: i64) -> bool {
    if expected == 0 || expected.signum() != actual.signum() {
        return false;
    }
    ((actual - expected).abs() as i128) * 10_000 <= (expected.abs() as i128) * tolerance_bp as i128
}

#[derive(Debug, Clone)]
pub struct Candidate {
    pub id: String,
    pub posted_date: String,
    pub amount_minor: i64,
}

/// The best transaction for an occurrence: within the date window and tolerance, nearest date,
/// then nearest amount, then earliest id. Ids in `used` are skipped.
pub fn best_match<'a>(
    due: &str,
    expected: i64,
    tolerance_bp: i64,
    candidates: impl IntoIterator<Item = &'a Candidate>,
    used: &std::collections::HashSet<String>,
) -> Option<&'a Candidate> {
    let mut best: Option<(&Candidate, i64, i64)> = None;
    for c in candidates {
        if used.contains(&c.id) {
            continue;
        }
        let days = diff_days(&c.posted_date, due).unwrap_or(i64::MAX).abs();
        if days > MATCH_WINDOW_DAYS || !within_tolerance(expected, c.amount_minor, tolerance_bp) {
            continue;
        }
        let diff = (c.amount_minor - expected).abs();
        let better = match best {
            None => true,
            Some((b, bd, bdiff)) => days < bd || (days == bd && (diff < bdiff || (diff == bdiff && c.id < b.id))),
        };
        if better {
            best = Some((c, days, diff));
        }
    }
    best.map(|b| b.0)
}

/// expected → paid (matched) · expected → overdue (due date passed) · any → skipped (user).
pub fn occurrence_state(due: &str, today: &str, matched: bool, skipped: bool) -> &'static str {
    if skipped {
        "skipped"
    } else if matched {
        "paid"
    } else if due < today {
        "overdue"
    } else {
        "expected"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monthly(anchor: &str) -> Schedule {
        Schedule { frequency: "monthly".into(), interval: 1, anchor_date: anchor.into(), end_date: None, count: None }
    }

    #[test]
    fn month_end_schedules_return_to_the_31st() {
        let s = monthly("2026-01-31");
        assert_eq!(
            occurrences_between(&s, "2026-01-01", "2026-05-31"),
            ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]
        );
        assert_eq!(describe_schedule(&s), "Every month on the 31st (or the last day)");
        let w = Schedule {
            frequency: "weekly".into(),
            interval: 2,
            anchor_date: "2026-11-09".into(),
            end_date: None,
            count: Some(3),
        };
        assert_eq!(occurrences_between(&w, "2026-11-01", "2027-01-31"), ["2026-11-09", "2026-11-23", "2026-12-07"]);
        assert_eq!(describe_schedule(&w), "Every 2 weeks on Monday");
        assert_eq!(next_occurrence(&monthly("2026-01-15"), "2026-11-16").as_deref(), Some("2026-12-15"));
    }

    #[test]
    fn matching_prefers_nearest_date_then_amount() {
        let c = |id: &str, d: &str, a: i64| Candidate { id: id.into(), posted_date: d.into(), amount_minor: a };
        let pool = [c("b", "2026-11-03", -1000), c("a", "2026-11-02", -1100), c("z", "2026-11-01", -990)];
        let used = Default::default();
        assert_eq!(best_match("2026-11-01", -1000, 1000, &pool, &used).map(|x| x.id.as_str()), Some("z"));
        assert!(!within_tolerance(-1000, 1000, 1000));
        assert!(within_tolerance(-1000, -1100, 1000));
        assert!(!within_tolerance(-1000, -1101, 1000));
    }
}
