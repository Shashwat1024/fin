//! Credit-card billing cycles (US10). Pure: the cycle settings, the card's opening balance and its
//! transactions in, the latest statement and what is still due out. Amounts owed are in display
//! terms (positive = owed); transaction amounts are as stored (spending negative, payments and
//! refunds positive).

use crate::domain::dates::{add_days, days_in_month, diff_days, make_date, parts};

/// The statement date in `year`/`month`: `day`, or the month's last day when it is shorter.
fn statement_in(year: i32, month: u32, day: u32) -> String {
    make_date(year, month, day.min(days_in_month(year, month))).unwrap_or_default()
}

fn shift_month(year: i32, month: u32, by: i32) -> (i32, u32) {
    let m = year * 12 + month as i32 - 1 + by;
    (m.div_euclid(12), (m.rem_euclid(12) + 1) as u32)
}

/// The latest statement date on or before `date`.
pub fn statement_on_or_before(day: u32, date: &str) -> String {
    let Ok(p) = parts(date) else { return date.to_owned() };
    let this = statement_in(p.year, p.month, day);
    if this.as_str() <= date {
        return this;
    }
    let (y, m) = shift_month(p.year, p.month, -1);
    statement_in(y, m, day)
}

/// The first statement date after `date`.
pub fn statement_after(day: u32, date: &str) -> String {
    let Ok(p) = parts(date) else { return date.to_owned() };
    let this = statement_in(p.year, p.month, day);
    if this.as_str() > date {
        return this;
    }
    let (y, m) = shift_month(p.year, p.month, 1);
    statement_in(y, m, day)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// No statement since the card's start date in Fin.
    NoStatement,
    /// The statement showed nothing owed (zero or in credit).
    NothingDue,
    Paid,
    Due,
    Overdue,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NoStatement => "no_statement",
            Self::NothingDue => "nothing_due",
            Self::Paid => "paid",
            Self::Due => "due",
            Self::Overdue => "overdue",
        }
    }
}

pub struct CycleInput<'a> {
    pub statement_day: u32,
    pub due_days_after: i64,
    pub opening_date: &'a str,
    /// Owed on the opening date, as the user entered it.
    pub opening_owed_minor: i64,
    /// `(posted_date, stored amount)` of every live transaction on the card.
    pub entries: &'a [(String, i64)],
    pub today: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CardCycle {
    pub statement_date: Option<String>,
    /// Owed at the end of the statement day; 0 when the card was in credit.
    pub statement_minor: i64,
    pub due_date: Option<String>,
    /// Payments and refunds after the statement.
    pub credits_since_minor: i64,
    /// What is still to pay of the statement.
    pub remaining_minor: i64,
    /// Spending after the statement (billed with the next one).
    pub spent_since_minor: i64,
    /// Owed now (every transaction, as on the Accounts page).
    pub owed_now_minor: i64,
    pub next_statement_date: String,
    pub next_due_date: String,
    pub status: Status,
    /// Days from today to the due date (negative when overdue).
    pub days_until_due: Option<i64>,
}

impl CardCycle {
    /// Owed beyond the unpaid statement: what the next statement is expected to bill so far.
    pub fn next_bill_so_far_minor(&self) -> i64 {
        (self.owed_now_minor - self.remaining_minor).max(0)
    }
}

pub fn card_cycle(input: &CycleInput) -> CardCycle {
    let day = input.statement_day.clamp(1, 31);
    let owed_at = |date: &str| -> i64 {
        input.opening_owed_minor - input.entries.iter().filter(|(d, _)| d.as_str() <= date).map(|(_, a)| a).sum::<i64>()
    };
    let owed_now = input.opening_owed_minor - input.entries.iter().map(|(_, a)| a).sum::<i64>();
    let latest = statement_on_or_before(day, input.today);
    let statement = (latest.as_str() >= input.opening_date).then_some(latest);
    // Spending and credits are counted after the statement, or from the start without one.
    let after = |date: &str| match &statement {
        Some(s) => date > s.as_str(),
        None => date >= input.opening_date,
    };
    let credits_since: i64 = input.entries.iter().filter(|(d, a)| *a > 0 && after(d)).map(|(_, a)| a).sum();
    let spent_since: i64 = -input.entries.iter().filter(|(d, a)| *a < 0 && after(d)).map(|(_, a)| a).sum::<i64>();
    let next_statement = statement_after(day, input.today);
    let due_after = |d: &str| add_days(d, input.due_days_after).unwrap_or_else(|_| d.to_owned());
    let next_due = due_after(&next_statement);

    let Some(statement_date) = statement else {
        return CardCycle {
            statement_date: None,
            statement_minor: 0,
            due_date: None,
            credits_since_minor: credits_since,
            remaining_minor: 0,
            spent_since_minor: spent_since,
            owed_now_minor: owed_now,
            next_statement_date: next_statement,
            next_due_date: next_due,
            status: Status::NoStatement,
            days_until_due: None,
        };
    };
    let statement_minor = owed_at(&statement_date).max(0);
    let remaining = (statement_minor - credits_since).max(0);
    let due = due_after(&statement_date);
    let days_until_due = diff_days(&due, input.today).ok();
    let status = if statement_minor == 0 {
        Status::NothingDue
    } else if remaining == 0 {
        Status::Paid
    } else if input.today > due.as_str() {
        Status::Overdue
    } else {
        Status::Due
    };
    CardCycle {
        statement_date: Some(statement_date),
        statement_minor,
        due_date: Some(due),
        credits_since_minor: credits_since,
        remaining_minor: remaining,
        spent_since_minor: spent_since,
        owed_now_minor: owed_now,
        next_statement_date: next_statement,
        next_due_date: next_due,
        status,
        days_until_due,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(list: &[(&str, i64)]) -> Vec<(String, i64)> {
        list.iter().map(|(d, a)| (d.to_string(), *a)).collect()
    }
    fn run(day: u32, entries: &[(String, i64)], today: &str) -> CardCycle {
        card_cycle(&CycleInput {
            statement_day: day,
            due_days_after: 20,
            opening_date: "2026-09-01",
            opening_owed_minor: 0,
            entries,
            today,
        })
    }

    #[test]
    fn statement_days_past_the_month_end_fall_on_its_last_day() {
        assert_eq!(statement_on_or_before(31, "2026-11-30"), "2026-11-30");
        assert_eq!(statement_on_or_before(31, "2026-11-29"), "2026-10-31");
        assert_eq!(statement_on_or_before(30, "2027-03-01"), "2027-02-28");
        assert_eq!(statement_on_or_before(30, "2028-03-01"), "2028-02-29");
        assert_eq!(statement_on_or_before(5, "2026-01-04"), "2025-12-05");
        assert_eq!(statement_after(31, "2027-01-31"), "2027-02-28");
        assert_eq!(statement_after(12, "2026-12-12"), "2027-01-12");
        assert_eq!(statement_after(12, "2026-12-11"), "2026-12-12");
    }

    #[test]
    fn a_statement_bills_what_was_owed_and_new_spending_waits_for_the_next() {
        let entries = e(&[("2026-09-10", -100_000), ("2026-09-25", -5_000), ("2026-10-05", -200_000)]);
        let c = run(25, &entries, "2026-10-08");
        assert_eq!(c.statement_date.as_deref(), Some("2026-09-25"));
        // Spending on the statement day is on that statement.
        assert_eq!(c.statement_minor, 105_000);
        assert_eq!(c.due_date.as_deref(), Some("2026-10-15"));
        assert_eq!((c.remaining_minor, c.spent_since_minor, c.credits_since_minor), (105_000, 200_000, 0));
        assert_eq!(c.owed_now_minor, 305_000);
        assert_eq!(c.next_bill_so_far_minor(), 200_000);
        assert_eq!((c.status, c.days_until_due), (Status::Due, Some(7)));
        assert_eq!((c.next_statement_date.as_str(), c.next_due_date.as_str()), ("2026-10-25", "2026-11-14"));
    }

    #[test]
    fn payments_and_refunds_after_the_statement_reduce_what_is_due() {
        let base = [("2026-09-10", -100_000), ("2026-10-05", -50_000)];
        let partial = e(&[base[0], base[1], ("2026-10-07", 60_000)]);
        let c = run(25, &partial, "2026-10-08");
        assert_eq!((c.remaining_minor, c.status), (40_000, Status::Due));

        let with_refund = e(&[base[0], base[1], ("2026-10-07", 60_000), ("2026-10-08", 40_000)]);
        assert_eq!(run(25, &with_refund, "2026-10-08").status, Status::Paid);

        let overpaid = e(&[base[0], base[1], ("2026-10-07", 150_000)]);
        let c = run(25, &overpaid, "2026-10-08");
        assert_eq!((c.remaining_minor, c.status), (0, Status::Paid));
        // Paying more than the statement also covers the new spending.
        assert_eq!((c.owed_now_minor, c.next_bill_so_far_minor()), (0, 0));
    }

    #[test]
    fn an_unpaid_statement_becomes_overdue_after_its_due_date() {
        let entries = e(&[("2026-09-10", -100_000)]);
        let c = run(25, &entries, "2026-10-20");
        assert_eq!((c.status, c.days_until_due), (Status::Overdue, Some(-5)));
        assert_eq!(run(25, &entries, "2026-10-15").status, Status::Due);
    }

    #[test]
    fn a_card_in_credit_or_without_a_statement_has_nothing_due() {
        let credit = e(&[("2026-09-10", 5_000)]);
        let c = run(25, &credit, "2026-10-08");
        assert_eq!((c.statement_minor, c.status), (0, Status::NothingDue));

        // Added to Fin on 28 Sep with ₹2,000 owed, after the 25 Sep statement: no statement yet,
        // and everything owed is billed next time.
        let late = card_cycle(&CycleInput {
            statement_day: 25,
            due_days_after: 20,
            opening_date: "2026-09-28",
            opening_owed_minor: 200_000,
            entries: &e(&[("2026-10-01", -30_000)]),
            today: "2026-10-08",
        });
        assert_eq!((late.status, late.statement_date.clone(), late.days_until_due), (Status::NoStatement, None, None));
        assert_eq!(
            (late.spent_since_minor, late.owed_now_minor, late.next_bill_so_far_minor()),
            (30_000, 230_000, 230_000)
        );
        assert_eq!(late.next_statement_date, "2026-10-25");
    }

    #[test]
    fn the_opening_balance_counts_towards_the_first_statement() {
        let c = card_cycle(&CycleInput {
            statement_day: 12,
            due_days_after: 18,
            opening_date: "2026-08-01",
            opening_owed_minor: 1_250_000,
            entries: &e(&[("2026-08-20", -50_000), ("2026-08-30", 1_250_000)]),
            today: "2026-09-13",
        });
        assert_eq!(c.statement_date.as_deref(), Some("2026-09-12"));
        assert_eq!(c.statement_minor, 50_000);
        assert_eq!((c.due_date.as_deref(), c.status), (Some("2026-09-30"), Status::Due));
    }
}
