//! Net worth over time (`src/domain/networth.ts`). Each account is worth its ledger balance on a
//! date, except investments, loans and other assets/liabilities, which use the latest recorded
//! value on or before that date when there is one. Liabilities count as amounts owed.

use std::collections::BTreeMap;

use crate::domain::dates::{add_months, end_of_month, start_of_month};
use crate::domain::ledger::{display_balance, is_liability};

/// Account types whose value is entered by hand rather than tracked transaction by transaction.
pub fn can_be_valued(account_type: &str) -> bool {
    matches!(account_type, "investment" | "loan" | "other_asset" | "other_liability")
}

pub struct NetWorthAccount {
    pub account_type: String,
    /// Stored (ledger-signed) opening balance; counts from the opening date.
    pub opening_minor: i64,
    pub opening_date: String,
    /// Net ledger change per day, any order.
    pub daily: Vec<(String, i64)>,
    /// Values as shown (amount owed for liabilities), any order.
    pub valuations: Vec<(String, i64)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Point {
    pub date: String,
    pub assets_minor: i64,
    pub liabilities_minor: i64,
    pub net_minor: i64,
}

struct Prepared<'a> {
    a: &'a NetWorthAccount,
    dates: Vec<String>,
    running: Vec<i64>,
    vals: Vec<(String, i64)>,
}

fn prepare(a: &NetWorthAccount) -> Prepared<'_> {
    let mut by_date: BTreeMap<String, i64> = BTreeMap::new();
    for (d, amt) in &a.daily {
        *by_date.entry(d.clone()).or_insert(0) += amt;
    }
    let mut t = 0;
    let (dates, running): (Vec<String>, Vec<i64>) = by_date
        .into_iter()
        .map(|(d, v)| {
            t += v;
            (d, t)
        })
        .unzip();
    let mut vals = a.valuations.clone();
    // Stable sort by date, like Array.prototype.sort with a comparator.
    vals.sort_by(|x, y| x.0.cmp(&y.0));
    Prepared { a, dates, running, vals }
}

/// Index of the last element ≤ date.
fn last_at_or_before<T>(sorted: &[T], key: impl Fn(&T) -> &str, date: &str) -> Option<usize> {
    let n = sorted.partition_point(|x| key(x) <= date);
    n.checked_sub(1)
}

fn value_of(p: &Prepared, date: &str) -> i64 {
    if can_be_valued(&p.a.account_type)
        && let Some(i) = last_at_or_before(&p.vals, |v| v.0.as_str(), date)
    {
        return p.vals[i].1;
    }
    let opening = if p.a.opening_date.as_str() <= date { p.a.opening_minor } else { 0 };
    let ledger = opening + last_at_or_before(&p.dates, |d| d.as_str(), date).map_or(0, |i| p.running[i]);
    display_balance(&p.a.account_type, ledger)
}

fn point_for(prepared: &[Prepared], date: &str) -> Point {
    let (mut assets, mut liabilities) = (0i64, 0i64);
    for p in prepared {
        let v = value_of(p, date);
        if is_liability(&p.a.account_type) {
            liabilities += v;
        } else {
            assets += v;
        }
    }
    Point {
        date: date.to_owned(),
        assets_minor: assets,
        liabilities_minor: liabilities,
        net_minor: assets - liabilities,
    }
}

/// Month-end dates from `from`'s month to `to`'s month; the last is `to` itself when mid-month.
pub fn month_ends(from: &str, to: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut m = start_of_month(from);
    while m.as_str() <= to {
        let e = end_of_month(&m).unwrap_or_else(|_| m.clone());
        out.push(if e.as_str() > to { to.to_owned() } else { e });
        m = match add_months(&m, 1, None) {
            Ok(next) => next,
            Err(_) => break,
        };
    }
    out
}

/// Net worth at each month end in [from, to].
pub fn net_worth_history(accounts: &[NetWorthAccount], from: &str, to: &str) -> Vec<Point> {
    let prepared: Vec<Prepared> = accounts.iter().map(prepare).collect();
    month_ends(from, to).iter().map(|d| point_for(&prepared, d)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valuations_override_ledger_for_valued_types() {
        let fund = NetWorthAccount {
            account_type: "investment".into(),
            opening_minor: 1000,
            opening_date: "2026-01-01".into(),
            daily: vec![("2026-02-10".into(), 500)],
            valuations: vec![("2026-03-01".into(), 9000)],
        };
        let card = NetWorthAccount {
            account_type: "credit_card".into(),
            opening_minor: -200,
            opening_date: "2026-01-01".into(),
            daily: vec![("2026-02-01".into(), -100), ("2026-02-01".into(), -50)],
            valuations: vec![],
        };
        let h = net_worth_history(&[fund, card], "2026-01-15", "2026-03-15");
        let nets: Vec<i64> = h.iter().map(|p| p.net_minor).collect();
        assert_eq!(h.iter().map(|p| p.date.as_str()).collect::<Vec<_>>(), ["2026-01-31", "2026-02-28", "2026-03-15"]);
        assert_eq!(nets, vec![800, 1150, 8650]);
    }
}
