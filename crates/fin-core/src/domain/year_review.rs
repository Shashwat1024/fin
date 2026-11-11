//! The year in review (US15): which dates a year covers, and ranking what stood out. Pure.

use std::collections::HashMap;

use crate::domain::dates::{end_of_month, make_date, parts};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Basis {
    /// A financial year starting in the user's FY start month (India: April).
    Financial,
    Calendar,
}

impl Basis {
    pub fn parse(s: &str) -> Basis {
        if s == "calendar" { Basis::Calendar } else { Basis::Financial }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Basis::Financial => "fy",
            Basis::Calendar => "calendar",
        }
    }
}

/// The year a date falls in: the calendar year, or the year a financial year starts in.
pub fn year_of(basis: Basis, date: &str, fy_start_month: u32) -> i32 {
    let Ok(p) = parts(date) else { return 0 };
    match basis {
        Basis::Calendar => p.year,
        Basis::Financial if p.month >= fy_start_month => p.year,
        Basis::Financial => p.year - 1,
    }
}

/// First and last day of a year, and how it is written ("2026", "FY 2026-27").
pub fn period(basis: Basis, year: i32, fy_start_month: u32) -> (String, String, String) {
    match basis {
        Basis::Calendar => (format!("{year:04}-01-01"), format!("{year:04}-12-31"), year.to_string()),
        Basis::Financial if fy_start_month == 1 => {
            (format!("{year:04}-01-01"), format!("{year:04}-12-31"), format!("FY {year}"))
        }
        Basis::Financial => {
            let from = make_date(year, fy_start_month, 1).unwrap_or_default();
            let last_month_start = make_date(year + 1, fy_start_month - 1, 1).unwrap_or_default();
            let to = end_of_month(&last_month_start).unwrap_or_default();
            (from, to, format!("FY {year}-{:02}", (year + 1) % 100))
        }
    }
}

/// The largest `n` amounts, ties by name (so the order never depends on storage).
pub fn top<K: Clone>(items: &HashMap<K, (String, i64)>, n: usize) -> Vec<(K, String, i64)> {
    let mut v: Vec<(K, String, i64)> =
        items.iter().filter(|(_, (_, a))| *a > 0).map(|(k, (name, a))| (k.clone(), name.clone(), *a)).collect();
    v.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| a.1.cmp(&b.1)));
    v.truncate(n);
    v
}

/// The categories whose spending changed most against the year before (either way).
pub fn biggest_changes(
    this: &HashMap<String, (String, i64)>,
    last: &HashMap<String, (String, i64)>,
    n: usize,
) -> Vec<(String, String, i64, i64)> {
    let mut keys: Vec<&String> = this.keys().chain(last.keys()).collect();
    keys.sort();
    keys.dedup();
    let mut v: Vec<(String, String, i64, i64)> = keys
        .into_iter()
        .map(|k| {
            let (name, now) = this.get(k).cloned().unwrap_or_else(|| (last[k].0.clone(), 0));
            let before = last.get(k).map_or(0, |x| x.1);
            (k.clone(), name, now, before)
        })
        .filter(|(_, _, now, before)| now != before)
        .collect();
    v.sort_by(|a, b| (b.2 - b.3).abs().cmp(&(a.2 - a.3).abs()).then_with(|| a.1.cmp(&b.1)));
    v.truncate(n);
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn financial_and_calendar_years() {
        assert_eq!(period(Basis::Financial, 2025, 4), ("2025-04-01".into(), "2026-03-31".into(), "FY 2025-26".into()));
        assert_eq!(period(Basis::Financial, 2027, 3), ("2027-03-01".into(), "2028-02-29".into(), "FY 2027-28".into()));
        assert_eq!(period(Basis::Financial, 2026, 1), ("2026-01-01".into(), "2026-12-31".into(), "FY 2026".into()));
        assert_eq!(period(Basis::Calendar, 2026, 4).2, "2026");
        assert_eq!(year_of(Basis::Financial, "2026-03-31", 4), 2025);
        assert_eq!(year_of(Basis::Financial, "2026-04-01", 4), 2026);
        assert_eq!(year_of(Basis::Calendar, "2026-03-31", 4), 2026);
    }

    #[test]
    fn ranking_and_changes_are_stable() {
        let m = |xs: &[(&str, i64)]| -> HashMap<String, (String, i64)> {
            xs.iter().map(|(k, a)| (k.to_string(), (k.to_uppercase(), *a))).collect()
        };
        let this = m(&[("rent", 300), ("food", 200), ("fun", 200), ("refund", -5)]);
        let names: Vec<String> = top(&this, 2).into_iter().map(|x| x.1).collect();
        assert_eq!(names, ["RENT", "FOOD"], "ties by name; refunds-only are left out");
        let last = m(&[("rent", 300), ("food", 50), ("travel", 400)]);
        let changes = biggest_changes(&this, &last, 5);
        assert_eq!(
            changes,
            vec![
                ("travel".into(), "TRAVEL".into(), 0, 400),
                ("fun".into(), "FUN".into(), 200, 0),
                ("food".into(), "FOOD".into(), 200, 50),
                ("refund".into(), "REFUND".into(), -5, 0),
            ]
        );
    }
}
