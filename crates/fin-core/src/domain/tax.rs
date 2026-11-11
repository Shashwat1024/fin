//! The tax-year view (US19): Indian financial years (April to March, whatever the user's own
//! financial-year setting), what counts within a section's limit, and a loan's interest and
//! principal in a year. Pure; no tax is computed.

use crate::domain::amortization::Row;
use crate::domain::dates::parts;

/// The financial year a date falls in, by the year it starts (2026-27 → 2026).
pub fn tax_year_of(date: &str) -> i32 {
    parts(date).map_or(0, |p| if p.month >= 4 { p.year } else { p.year - 1 })
}

pub fn tax_year_range(year: i32) -> (String, String) {
    (format!("{year:04}-04-01"), format!("{:04}-03-31", year + 1))
}

/// "FY 2026-27 · AY 2027-28": the year the money moved, and the assessment year it is filed in.
pub fn tax_year_label(year: i32) -> String {
    format!("FY {year}-{:02} · AY {}-{:02}", (year + 1) % 100, year + 1, (year + 2) % 100)
}

/// What counts towards a section: the total, up to its limit (none for sections without one).
pub fn counted(total_minor: i64, limit_minor: Option<i64>) -> i64 {
    let total = total_minor.max(0);
    limit_minor.map_or(total, |l| total.min(l))
}

/// Interest and principal of the instalments dated within a year, from a loan's schedule.
pub fn loan_parts_in(rows: &[Row], from: &str, to: &str) -> (i64, i64) {
    rows.iter()
        .filter(|r| r.date.as_str() >= from && r.date.as_str() <= to)
        .fold((0, 0), |(i, p), r| (i + r.interest_minor, p + r.principal_minor))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::amortization::{Terms, schedule};

    #[test]
    fn indian_financial_years_run_april_to_march() {
        assert_eq!(tax_year_of("2026-03-31"), 2025);
        assert_eq!(tax_year_of("2026-04-01"), 2026);
        assert_eq!(tax_year_range(2026), ("2026-04-01".into(), "2027-03-31".into()));
        assert_eq!(tax_year_label(2026), "FY 2026-27 · AY 2027-28");
        assert_eq!(tax_year_label(2099), "FY 2099-00 · AY 2100-01");
    }

    #[test]
    fn limits_and_loan_parts() {
        assert_eq!(counted(18_000_000, Some(15_000_000)), 15_000_000);
        assert_eq!(counted(9_000_000, Some(15_000_000)), 9_000_000);
        assert_eq!(counted(7_000_000, None), 7_000_000);
        assert_eq!(counted(-500, Some(100)), 0, "refunds larger than spending count as nothing");

        let rows = schedule(&Terms {
            principal_minor: 100_000_000,
            rate_bp: 900,
            months: 60,
            first_date: "2026-01-05".into(),
        });
        let (interest, principal) = loan_parts_in(&rows, "2026-04-01", "2027-03-31");
        assert_eq!(
            rows.iter().filter(|r| r.date.as_str() >= "2026-04-01" && r.date.as_str() <= "2027-03-31").count(),
            12
        );
        assert_eq!(interest + principal, rows[3..15].iter().map(|r| r.emi_minor).sum::<i64>());
        assert!(interest > 0 && principal > interest);
    }
}
