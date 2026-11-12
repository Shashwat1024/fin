//! Who owes whom (US21). Pure: a balance is the sum of a person's entries (positive: they owe the
//! user), and repayment suggestions rank incoming money by whether it names the person, whether it is
//! exactly what is owed, and how recent it is. Nothing is applied without the user's choice.

use crate::domain::dates::diff_days;
use crate::domain::money::rupees_exact;

pub fn balance(amounts: &[i64]) -> i64 {
    amounts.iter().sum()
}

/// "Rahul owes you ₹1,200", "You owe Priya ₹300" or "Settled up".
pub fn describe(name: &str, balance_minor: i64) -> String {
    match balance_minor {
        0 => "Settled up".to_owned(),
        b if b > 0 => format!("{name} owes you {}", rupees_exact(b)),
        b => format!("You owe {name} {}", rupees_exact(-b)),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub transaction_id: String,
    pub date: String,
    pub payee: String,
    /// Positive, the size of the payment.
    pub amount_minor: i64,
}

/// How far back repayments are looked for.
pub const LOOKBACK_DAYS: i64 = 90;

/// Words of a name worth looking for in a bank description (three letters or more).
fn name_words(name: &str) -> Vec<String> {
    name.split_whitespace().map(str::to_lowercase).filter(|w| w.chars().count() >= 3).collect()
}

/// The likely repayments first: naming the person, then exactly the amount owed, then the newest.
pub fn rank_repayments(name: &str, owed_minor: i64, today: &str, mut candidates: Vec<Candidate>) -> Vec<Candidate> {
    let words = name_words(name);
    candidates.retain(|c| diff_days(today, &c.date).is_ok_and(|d| (0..=LOOKBACK_DAYS).contains(&d)));
    let score = |c: &Candidate| {
        let payee = c.payee.to_lowercase();
        let named = words.iter().any(|w| payee.contains(w.as_str()));
        (i32::from(named) * 2 + i32::from(c.amount_minor == owed_minor.abs())) as i64
    };
    candidates.sort_by(|a, b| {
        score(b).cmp(&score(a)).then_with(|| b.date.cmp(&a.date)).then_with(|| a.transaction_id.cmp(&b.transaction_id))
    });
    candidates
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(id: &str, date: &str, payee: &str, amount: i64) -> Candidate {
        Candidate { transaction_id: id.into(), date: date.into(), payee: payee.into(), amount_minor: amount }
    }

    #[test]
    fn balances_in_plain_words() {
        assert_eq!(balance(&[60_000, 60_000, -50_000]), 70_000);
        assert_eq!(describe("Rahul", 120_000), "Rahul owes you ₹1,200");
        assert_eq!(describe("Priya", -30_050), "You owe Priya ₹300.50");
        assert_eq!(describe("Ana", 0), "Settled up");
    }

    #[test]
    fn repayments_naming_the_person_come_first_then_the_exact_amount() {
        let ranked = rank_repayments(
            "Rahul Sharma",
            120_000,
            "2026-11-10",
            vec![
                c("a", "2026-11-09", "ACME salary", 120_000),
                c("b", "2026-11-01", "UPI/RAHUL SHARMA/okaxis", 100_000),
                c("c", "2026-11-08", "IMPS from Priya", 5_000),
                c("d", "2026-06-01", "UPI/RAHUL/old", 120_000),
                c("e", "2026-11-05", "upi rahul s", 120_000),
            ],
        );
        let ids: Vec<&str> = ranked.iter().map(|x| x.transaction_id.as_str()).collect();
        assert_eq!(ids, ["e", "b", "a", "c"], "named and exact, named, exact, then the rest; too old is left out");
    }
}
