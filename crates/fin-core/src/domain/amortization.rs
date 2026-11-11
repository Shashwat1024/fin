//! Loan schedules (US16): reducing-balance EMIs as Indian banks compute them. Interest is worked out
//! each month on the outstanding balance in exact paise (rounded half up); the EMI is rounded to the
//! nearest rupee and the last instalment clears the balance exactly. Pure.

use crate::domain::dates::{add_months, parts};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Terms {
    pub principal_minor: i64,
    /// Annual rate in basis points (8.75% = 875).
    pub rate_bp: i64,
    pub months: i64,
    pub first_date: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Row {
    pub n: i64,
    pub date: String,
    pub emi_minor: i64,
    pub interest_minor: i64,
    pub principal_minor: i64,
    /// Outstanding after this instalment.
    pub balance_minor: i64,
}

/// `x / y` rounded half up, for non-negative x and positive y.
fn div_round(x: i128, y: i128) -> i128 {
    (2 * x + y) / (2 * y)
}

/// One month's interest on a balance.
pub fn monthly_interest(balance_minor: i64, rate_bp: i64) -> i64 {
    div_round(balance_minor.max(0) as i128 * rate_bp as i128, 120_000) as i64
}

/// The EMI, to the nearest rupee: P·r·(1+r)ⁿ / ((1+r)ⁿ − 1), or P ÷ n without interest.
pub fn emi(principal_minor: i64, rate_bp: i64, months: i64) -> i64 {
    if principal_minor <= 0 || months <= 0 {
        return 0;
    }
    let rupees = if rate_bp <= 0 {
        principal_minor as f64 / 100.0 / months as f64
    } else {
        let r = rate_bp as f64 / 120_000.0;
        let f = (1.0 + r).powi(months as i32);
        principal_minor as f64 / 100.0 * r * f / (f - 1.0)
    };
    (rupees.round() as i64) * 100
}

/// Instalments from a balance with a fixed EMI until it is cleared (at most `limit`).
fn run(balance_minor: i64, rate_bp: i64, emi_minor: i64, limit: i64, mut on_row: impl FnMut(i64, i64, i64, i64)) {
    let mut balance = balance_minor;
    let mut n = 0;
    while balance > 0 && n < limit {
        n += 1;
        let interest = monthly_interest(balance, rate_bp);
        let mut principal = emi_minor - interest;
        if principal >= balance || n == limit {
            principal = balance;
        }
        if principal <= 0 {
            // The EMI does not cover the interest: the loan would never be repaid.
            break;
        }
        balance -= principal;
        on_row(n, interest + principal, interest, principal);
    }
}

fn instalment_date(first: &str, n: i64) -> String {
    let day = parts(first).map(|p| p.day).ok();
    add_months(first, (n - 1) as i32, day).unwrap_or_else(|_| first.to_owned())
}

pub fn schedule(t: &Terms) -> Vec<Row> {
    let e = emi(t.principal_minor, t.rate_bp, t.months);
    let mut rows = Vec::new();
    let mut balance = t.principal_minor;
    run(t.principal_minor, t.rate_bp, e, t.months, |n, paid, interest, principal| {
        balance -= principal;
        rows.push(Row {
            n,
            date: instalment_date(&t.first_date, n),
            emi_minor: paid,
            interest_minor: interest,
            principal_minor: principal,
            balance_minor: balance,
        });
    });
    rows
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Position {
    pub paid_count: i64,
    pub interest_paid_minor: i64,
    pub principal_paid_minor: i64,
    pub outstanding_minor: i64,
    pub interest_remaining_minor: i64,
    /// The next instalment on or after `today`.
    pub next: Option<Row>,
    pub end_date: Option<String>,
}

/// Where a loan stands on a day: instalments dated on or before it count as paid.
pub fn position(principal_minor: i64, rows: &[Row], today: &str) -> Position {
    let paid: Vec<&Row> = rows.iter().filter(|r| r.date.as_str() < today).collect();
    let rest: Vec<&Row> = rows.iter().filter(|r| r.date.as_str() >= today).collect();
    Position {
        paid_count: paid.len() as i64,
        interest_paid_minor: paid.iter().map(|r| r.interest_minor).sum(),
        principal_paid_minor: paid.iter().map(|r| r.principal_minor).sum(),
        outstanding_minor: paid.last().map_or(principal_minor, |r| r.balance_minor),
        interest_remaining_minor: rest.iter().map(|r| r.interest_minor).sum(),
        next: rest.first().map(|r| (*r).clone()),
        end_date: rows.last().map(|r| r.date.clone()),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Prepayment {
    /// Keep the EMI, finish sooner.
    pub tenure_interest_saved_minor: i64,
    pub tenure_months_saved: i64,
    /// Keep the end date, pay a smaller EMI.
    pub emi_interest_saved_minor: i64,
    pub new_emi_minor: i64,
    pub current_emi_minor: i64,
}

/// A lump sum paid on `date`, before the instalments due on or after it.
pub fn prepay(t: &Terms, date: &str, amount_minor: i64) -> Prepayment {
    let rows = schedule(t);
    let e = emi(t.principal_minor, t.rate_bp, t.months);
    let pos = position(t.principal_minor, &rows, date);
    let remaining_months = rows.len() as i64 - pos.paid_count;
    let balance = (pos.outstanding_minor - amount_minor).max(0);

    let mut tenure_months = 0;
    let mut tenure_interest = 0;
    run(balance, t.rate_bp, e, remaining_months.max(1), |n, _, interest, _| {
        tenure_months = n;
        tenure_interest += interest;
    });
    let new_emi = emi(balance, t.rate_bp, remaining_months);
    let mut emi_interest = 0;
    run(balance, t.rate_bp, new_emi, remaining_months.max(1), |_, _, interest, _| emi_interest += interest);

    Prepayment {
        tenure_interest_saved_minor: pos.interest_remaining_minor - tenure_interest,
        tenure_months_saved: remaining_months - tenure_months,
        emi_interest_saved_minor: pos.interest_remaining_minor - emi_interest,
        new_emi_minor: new_emi,
        current_emi_minor: e,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn terms(principal: i64, rate_bp: i64, months: i64) -> Terms {
        Terms { principal_minor: principal, rate_bp, months, first_date: "2026-01-05".into() }
    }

    #[test]
    fn emis_match_standard_calculators() {
        // ₹10,00,000 at 9% for 5 years; ₹50,00,000 at 8.5% for 20 years; ₹5,00,000 at 10.5% for 3 years.
        assert_eq!(emi(100_000_000, 900, 60), 2_075_800);
        assert_eq!(emi(500_000_000, 850, 240), 4_339_100);
        assert_eq!(emi(50_000_000, 1050, 36), 1_625_100);
        assert_eq!(emi(1_200_000, 0, 12), 100_000);
    }

    #[test]
    fn the_schedule_clears_the_balance_exactly() {
        let t = terms(100_000_000, 900, 60);
        let rows = schedule(&t);
        assert_eq!(rows.len(), 60);
        // First month: interest on ₹10,00,000 at 0.75% = ₹7,500.
        assert_eq!((rows[0].interest_minor, rows[0].principal_minor), (750_000, 1_325_800));
        assert_eq!(rows.last().unwrap().balance_minor, 0);
        assert_eq!(rows.iter().map(|r| r.principal_minor).sum::<i64>(), 100_000_000);
        // The EMI is rounded down from ₹20,758.35, so the last one is ₹26.79 more.
        assert_eq!(rows[59].emi_minor, 2_078_479);
        assert_eq!(rows[1].date, "2026-02-05");
        let zero = schedule(&terms(1_200_000, 0, 12));
        assert!(zero.iter().all(|r| r.interest_minor == 0 && r.emi_minor == 100_000));
    }

    #[test]
    fn position_on_a_day() {
        let t = terms(100_000_000, 900, 60);
        let rows = schedule(&t);
        let p = position(t.principal_minor, &rows, "2026-03-20");
        assert_eq!(p.paid_count, 3);
        assert_eq!(p.outstanding_minor, rows[2].balance_minor);
        assert_eq!(p.next.as_ref().unwrap().date, "2026-04-05");
        assert_eq!(
            p.interest_paid_minor + p.interest_remaining_minor,
            rows.iter().map(|r| r.interest_minor).sum::<i64>()
        );
        assert_eq!(p.end_date.as_deref(), Some("2030-12-05"));
        assert_eq!(position(t.principal_minor, &rows, "2025-12-01").outstanding_minor, 100_000_000);
    }

    #[test]
    fn prepaying_saves_interest_either_way() {
        let t = terms(100_000_000, 900, 60);
        let p = prepay(&t, "2027-01-10", 20_000_000);
        assert_eq!(p.current_emi_minor, 2_075_800);
        assert!(p.tenure_months_saved >= 12, "₹2 lakh off ₹8.3 lakh shortens it by about a year: {p:?}");
        assert!(p.tenure_interest_saved_minor > p.emi_interest_saved_minor, "a shorter tenure saves more");
        assert!(p.emi_interest_saved_minor > 0);
        assert!(p.new_emi_minor < p.current_emi_minor);
        // Paying it all off saves all remaining interest.
        let all = prepay(&t, "2027-01-10", 1_000_000_000);
        assert_eq!(all.new_emi_minor, 0);
        assert_eq!(
            all.tenure_interest_saved_minor,
            position(t.principal_minor, &schedule(&t), "2027-01-10").interest_remaining_minor
        );
    }
}
