//! The health summary (US13): four plain measures from balances and monthly totals, each stated as a
//! fact with what it is computed from. No scores, grades or advice (PRD).

use crate::domain::money::rupees;

/// One complete month: money in and out (transfers excluded), and essential spending (categories in
/// the "needs" group), all as positive amounts.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Month {
    pub month: String,
    pub in_minor: i64,
    pub out_minor: i64,
    pub needs_minor: i64,
}

pub struct HealthInput<'a> {
    pub has_cash_accounts: bool,
    /// Cash and bank balances.
    pub cash_minor: i64,
    /// Up to the last six complete months, oldest first.
    pub months: &'a [Month],
    /// Active EMIs as a monthly amount, and how many there are.
    pub monthly_emi_minor: i64,
    pub emi_count: usize,
    /// Owed on credit cards, and how many cards there are.
    pub card_owed_minor: i64,
    pub card_count: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Measure {
    pub key: &'static str,
    pub label: &'static str,
    /// Months for emergency cover; percent for the others. None when it cannot be worked out.
    pub value: Option<f64>,
    /// The sentence shown, or why there is no value.
    pub text: String,
    pub available: bool,
}

const RECENT: usize = 3;

fn recent(months: &[Month]) -> &[Month] {
    &months[months.len().saturating_sub(RECENT)..]
}

/// "the last month" or "the last 3 months".
fn last(n: usize) -> String {
    if n == 1 { "the last month".to_owned() } else { format!("the last {n} months") }
}

fn average(values: impl Iterator<Item = i64>, n: usize) -> i64 {
    if n == 0 { 0 } else { (values.sum::<i64>() as f64 / n as f64).round() as i64 }
}

fn unavailable(key: &'static str, label: &'static str, text: impl Into<String>) -> Measure {
    Measure { key, label, value: None, text: text.into(), available: false }
}

const NO_MONTH: &str = "Not enough history yet: this needs one complete month of transactions.";

pub fn emergency_cover(input: &HealthInput) -> Measure {
    let (key, label) = ("emergency_cover", "Emergency cover");
    if !input.has_cash_accounts {
        return unavailable(key, label, "Add a cash or bank account to see how long your savings would last.");
    }
    let r = recent(input.months);
    if r.is_empty() {
        return unavailable(key, label, NO_MONTH);
    }
    let needs = average(r.iter().map(|m| m.needs_minor), r.len());
    if needs <= 0 {
        return unavailable(
            key,
            label,
            format!("No essential spending (categories in the “needs” group) in {}.", last(r.len())),
        );
    }
    let months = (input.cash_minor.max(0) as f64 / needs as f64 * 10.0).round() / 10.0;
    Measure {
        key,
        label,
        value: Some(months),
        text: format!(
            "Your cash and bank balances ({}) would cover about {months:.1} months of essential spending ({} a month on average over {}).",
            rupees(input.cash_minor.max(0)),
            rupees(needs),
            last(r.len())
        ),
        available: true,
    }
}

pub fn emi_share(input: &HealthInput) -> Measure {
    let (key, label) = ("emi_share", "EMIs and income");
    if input.emi_count == 0 {
        return unavailable(key, label, "No EMIs are set up as recurring payments.");
    }
    let r = recent(input.months);
    if r.is_empty() {
        return unavailable(key, label, NO_MONTH);
    }
    let income = average(r.iter().map(|m| m.in_minor), r.len());
    if income <= 0 {
        return unavailable(key, label, format!("No income recorded in {}.", last(r.len())));
    }
    let pct = (input.monthly_emi_minor as f64 / income as f64 * 100.0).round();
    Measure {
        key,
        label,
        value: Some(pct),
        text: format!(
            "Your EMIs ({} a month) are {pct:.0}% of your usual income ({} a month over {}).",
            rupees(input.monthly_emi_minor),
            rupees(income),
            last(r.len())
        ),
        available: true,
    }
}

/// Saved share of income over a run of months; None without income.
fn rate(months: &[Month]) -> Option<f64> {
    let income: i64 = months.iter().map(|m| m.in_minor).sum();
    let out: i64 = months.iter().map(|m| m.out_minor).sum();
    (income > 0).then(|| ((income - out) as f64 / income as f64 * 100.0).round())
}

fn describe_rate(r: f64) -> String {
    if r >= 0.0 { format!("saved {r:.0}% of your income") } else { format!("spent {:.0}% more than came in", -r) }
}

pub fn savings_trend(input: &HealthInput) -> Measure {
    let (key, label) = ("savings_rate", "Savings rate");
    let r = recent(input.months);
    if r.is_empty() {
        return unavailable(key, label, NO_MONTH);
    }
    let Some(now) = rate(r) else {
        return unavailable(key, label, format!("No income recorded in {}.", last(r.len())));
    };
    let before_end = input.months.len() - r.len();
    let before = &input.months[before_end.saturating_sub(RECENT)..before_end];
    let period = last(r.len());
    let text = match (before.len() == RECENT).then(|| rate(before)).flatten() {
        Some(then) => {
            let change = if (now - then).abs() <= 1.0 {
                "about the same as".to_owned()
            } else if now > then {
                format!("up from {then:.0}% in")
            } else {
                format!("down from {then:.0}% in")
            };
            format!("Over {period} you {}, {change} the 3 months before.", describe_rate(now))
        }
        None => format!("Over {period} you {}.", describe_rate(now)),
    };
    Measure { key, label, value: Some(now), text, available: true }
}

pub fn card_share(input: &HealthInput) -> Measure {
    let (key, label) = ("card_share", "Card dues and cash");
    if input.card_count == 0 {
        return unavailable(key, label, "No credit cards added.");
    }
    if !input.has_cash_accounts || input.cash_minor <= 0 {
        return unavailable(key, label, "No cash or bank balance to compare card dues with.");
    }
    let owed = input.card_owed_minor.max(0);
    let pct = (owed as f64 / input.cash_minor as f64 * 100.0).round();
    Measure {
        key,
        label,
        value: Some(pct),
        text: format!("You owe {} on credit cards, {pct:.0}% of your cash and bank balances.", rupees(owed)),
        available: true,
    }
}

pub fn health(input: &HealthInput) -> Vec<Measure> {
    vec![emergency_cover(input), emi_share(input), savings_trend(input), card_share(input)]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(month: &str, in_minor: i64, out_minor: i64, needs_minor: i64) -> Month {
        Month { month: month.into(), in_minor, out_minor, needs_minor }
    }
    fn input(months: &[Month]) -> HealthInput<'_> {
        HealthInput {
            has_cash_accounts: true,
            cash_minor: 42_000_000,
            months,
            monthly_emi_minor: 1_800_000,
            emi_count: 1,
            card_owed_minor: 3_780_000,
            card_count: 1,
        }
    }
    fn six() -> Vec<Month> {
        vec![
            m("2026-05", 10_000_000, 9_000_000, 4_000_000),
            m("2026-06", 10_000_000, 8_500_000, 4_000_000),
            m("2026-07", 10_000_000, 8_000_000, 4_000_000),
            m("2026-08", 10_000_000, 7_800_000, 9_000_000),
            m("2026-09", 10_000_000, 7_800_000, 10_000_000),
            m("2026-10", 10_000_000, 7_800_000, 11_000_000),
        ]
    }

    #[test]
    fn emergency_cover_uses_the_last_three_complete_months_of_needs() {
        let months = six();
        let c = emergency_cover(&input(&months));
        assert_eq!(c.value, Some(4.2));
        assert_eq!(
            c.text,
            "Your cash and bank balances (₹4,20,000) would cover about 4.2 months of essential spending (₹1,00,000 a month on average over the last 3 months)."
        );
        let none: Vec<Month> = vec![];
        assert_eq!(emergency_cover(&input(&none)).text, NO_MONTH);
        let no_needs = vec![m("2026-10", 1, 1, 0)];
        assert!(emergency_cover(&input(&no_needs)).text.starts_with("No essential spending"));
        assert!(!emergency_cover(&HealthInput { has_cash_accounts: false, ..input(&months) }).available);
    }

    #[test]
    fn emis_are_compared_with_usual_income() {
        let months = six();
        let e = emi_share(&input(&months));
        assert_eq!(e.value, Some(18.0));
        assert_eq!(
            e.text,
            "Your EMIs (₹18,000 a month) are 18% of your usual income (₹1,00,000 a month over the last 3 months)."
        );
        assert_eq!(
            emi_share(&HealthInput { emi_count: 0, ..input(&months) }).text,
            "No EMIs are set up as recurring payments."
        );
        let no_income = vec![m("2026-10", 0, 100, 0)];
        assert_eq!(emi_share(&input(&no_income)).text, "No income recorded in the last month.");
    }

    #[test]
    fn savings_rate_against_the_three_months_before() {
        let months = six();
        let s = savings_trend(&input(&months));
        assert_eq!(s.value, Some(22.0));
        assert_eq!(s.text, "Over the last 3 months you saved 22% of your income, up from 15% in the 3 months before.");
        let short = &months[3..];
        assert_eq!(savings_trend(&input(short)).text, "Over the last 3 months you saved 22% of your income.");
        let overspent = vec![m("2026-10", 1_000_000, 1_080_000, 0)];
        assert_eq!(savings_trend(&input(&overspent)).text, "Over the last month you spent 8% more than came in.");
    }

    #[test]
    fn card_dues_as_a_share_of_cash() {
        let months = six();
        let c = card_share(&input(&months));
        assert_eq!(
            (c.value, c.text.as_str()),
            (Some(9.0), "You owe ₹37,800 on credit cards, 9% of your cash and bank balances.")
        );
        assert!(!card_share(&HealthInput { card_count: 0, ..input(&months) }).available);
        assert!(!card_share(&HealthInput { cash_minor: 0, ..input(&months) }).available);
        assert_eq!(health(&input(&months)).len(), 4);
    }
}
