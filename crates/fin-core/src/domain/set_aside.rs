//! Setting money aside each month for a bill that comes once a year or a quarter (US18). Pure.

use crate::domain::dates::parts;

/// Months from `month` (YYYY-MM) to the month of `due`, counting both: due next month = 2.
pub fn months_left(month: &str, due: &str) -> i64 {
    let (Ok(a), Ok(b)) = (parts(&format!("{month}-01")), parts(due)) else { return 1 };
    ((b.year - a.year) as i64 * 12 + b.month as i64 - a.month as i64 + 1).max(1)
}

/// What still has to be set aside (the bill less what is already available in its category),
/// spread over the months left and rounded up to the rupee.
pub fn monthly_set_aside(amount_minor: i64, available_minor: i64, months: i64) -> i64 {
    let needed = (amount_minor - available_minor.max(0)).max(0);
    let per_month = (needed + months.max(1) - 1) / months.max(1);
    (per_month + 99) / 100 * 100
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spread_over_the_months_left() {
        assert_eq!(months_left("2026-11", "2027-03-15"), 5);
        assert_eq!(months_left("2026-11", "2026-11-28"), 1);
        assert_eq!(months_left("2026-11", "2026-10-01"), 1, "never less than one");
        // ₹21,000 due in March, nothing set aside yet: ₹4,200 a month from November.
        assert_eq!(monthly_set_aside(2_100_000, 0, 5), 420_000);
        // ₹8,400 already set aside: the rest over the months left.
        assert_eq!(monthly_set_aside(2_100_000, 840_000, 3), 420_000);
        assert_eq!(monthly_set_aside(1_000_000, 0, 3), 333_400, "rounded up to the rupee");
        assert_eq!(monthly_set_aside(1_000_000, 1_200_000, 2), 0, "already covered");
    }
}
