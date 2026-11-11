//! Fixed and recurring deposits (US17), compounded quarterly as most Indian banks do: interest is
//! added every three months from the deposit date, in exact paise (rounded half up), and a part
//! quarter earns simple interest for its days (365-day year). Pure.

use crate::domain::dates::{add_months, diff_days, parts};

fn div_round(x: i128, y: i128) -> i128 {
    if x >= 0 { (2 * x + y) / (2 * y) } else { -((2 * -x + y) / (2 * y)) }
}

fn months_from(start: &str, n: i32) -> String {
    let day = parts(start).map(|p| p.day).ok();
    add_months(start, n, day).unwrap_or_else(|_| start.to_owned())
}

/// What `amount` deposited on `from` is worth on `at` (no later than `until`).
pub fn grown(amount_minor: i64, rate_bp: i64, from: &str, at: &str) -> i64 {
    if at <= from || rate_bp <= 0 {
        return amount_minor;
    }
    let mut balance = amount_minor as i128;
    let mut q = 1;
    let mut last = from.to_owned();
    loop {
        let next = months_from(from, 3 * q);
        if next.as_str() > at {
            break;
        }
        balance += div_round(balance * rate_bp as i128, 40_000);
        last = next;
        q += 1;
    }
    let days = diff_days(at, &last).unwrap_or(0).max(0) as i128;
    balance += div_round(balance * rate_bp as i128 * days, 10_000 * 365);
    balance as i64
}

/// A fixed deposit's value on `at` (its maturity value from the maturity date on).
pub fn fd_value(principal_minor: i64, rate_bp: i64, start: &str, maturity: &str, at: &str) -> i64 {
    grown(principal_minor, rate_bp, start, if at > maturity { maturity } else { at })
}

/// Recurring-deposit instalment dates: monthly from the start, before the maturity date.
pub fn rd_dates(start: &str, maturity: &str) -> Vec<String> {
    (0..1200).map(|n| months_from(start, n)).take_while(|d| d.as_str() < maturity).collect()
}

/// A recurring deposit's value on `at`: each instalment paid by then, grown from its own date.
pub fn rd_value(instalment_minor: i64, rate_bp: i64, start: &str, maturity: &str, at: &str) -> i64 {
    let until = if at > maturity { maturity } else { at };
    rd_dates(start, maturity)
        .iter()
        .filter(|d| d.as_str() <= until)
        .map(|d| grown(instalment_minor, rate_bp, d, until))
        .sum()
}

/// Money put in by `at` (principal, or the instalments paid).
pub fn rd_deposited(instalment_minor: i64, start: &str, maturity: &str, at: &str) -> i64 {
    rd_dates(start, maturity).iter().filter(|d| d.as_str() <= at).count() as i64 * instalment_minor
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_deposits_match_bank_calculators() {
        // ₹1,00,000 at 7% for 1 year: ₹1,07,186 (quarterly compounding); for 5 years: ₹1,41,478.
        assert_eq!(fd_value(10_000_000, 700, "2026-01-01", "2027-01-01", "2027-01-01"), 10_718_591);
        assert_eq!((fd_value(10_000_000, 700, "2026-01-01", "2031-01-01", "2031-01-01") + 50) / 100, 141_478);
        // Half way through a quarter: one quarter compounded, then 45 days' simple interest.
        let q1 = 10_000_000 + 175_000;
        assert_eq!(
            fd_value(10_000_000, 700, "2026-01-01", "2027-01-01", "2026-05-16"),
            q1 + (q1 as f64 * 0.07 * 45.0 / 365.0).round() as i64
        );
        // Not more after maturity, and nothing before the start.
        assert_eq!(fd_value(10_000_000, 700, "2026-01-01", "2027-01-01", "2029-06-01"), 10_718_591);
        assert_eq!(fd_value(10_000_000, 700, "2026-01-01", "2027-01-01", "2025-06-01"), 10_000_000);
    }

    #[test]
    fn recurring_deposits_grow_each_instalment_from_its_date() {
        let dates = rd_dates("2026-01-10", "2027-01-10");
        assert_eq!((dates.len(), dates[11].as_str()), (12, "2026-12-10"));
        let maturity = rd_value(1_000_000, 680, "2026-01-10", "2027-01-10", "2027-01-10");
        // The banks' formula, Σ R(1 + r/4)^(k/3) for k = 1..12 months: about ₹1,24,513.
        let formula: f64 = (1..=12).map(|k| 10_000.0 * (1.0 + 0.068 / 4.0_f64).powf(k as f64 / 3.0)).sum();
        assert!(((maturity as f64 / 100.0) - formula).abs() < 60.0, "{maturity} vs {formula}");
        assert_eq!(rd_deposited(1_000_000, "2026-01-10", "2027-01-10", "2026-03-10"), 3_000_000);
        assert!(rd_value(1_000_000, 680, "2026-01-10", "2027-01-10", "2026-03-10") > 3_000_000);
    }
}
