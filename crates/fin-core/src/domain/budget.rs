//! Zero-based monthly budget (`src/domain/budget.ts`, research R14):
//!   available[c,m] = carry[c,m] + assigned[c,m] − spent[c,m],   carry = max(available[c,m−1], 0)
//!   toAssign[m]    = income[m] + toAssign[m−1] − Σ assigned[c,m] − last month's overspending
//! Unspent money stays in its category; overspending comes out of next month's To assign.

use std::collections::HashMap;

use crate::domain::dates::add_months;

#[derive(Debug, Clone, Default)]
pub struct MonthInput {
    pub month: String,
    pub income_minor: i64,
    /// (category, amount) in insertion order.
    pub assigned: Vec<(String, i64)>,
    pub spent: Vec<(String, i64)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Line {
    pub category_id: String,
    pub carry_minor: i64,
    pub assigned_minor: i64,
    pub spent_minor: i64,
    pub available_minor: i64,
}

#[derive(Debug, Clone)]
pub struct MonthResult {
    pub month: String,
    pub income_minor: i64,
    pub leftover_minor: i64,
    pub overspent_minor: i64,
    pub assigned_minor: i64,
    pub to_assign_minor: i64,
    pub lines: Vec<Line>,
}

fn shift(month: &str, by: i32) -> String {
    add_months(&format!("{month}-01"), by, None).map(|d| d[..7].to_owned()).unwrap_or_else(|_| month.to_owned())
}

/// Consecutive month keys from `first` to `last` inclusive.
pub fn month_span(first: &str, last: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut m = first.to_owned();
    while m.as_str() <= last {
        out.push(m.clone());
        let next = shift(&m, 1);
        if next == m {
            break;
        }
        m = next;
    }
    out
}

fn lookup(list: &[(String, i64)], id: &str) -> i64 {
    list.iter().rev().find(|(k, _)| k == id).map_or(0, |(_, v)| *v)
}

/// Run the budget forward over consecutive months (oldest first). `category_ids` lists categories
/// to report even with no activity.
pub fn run_budget(months: &[MonthInput], category_ids: &[String]) -> Vec<MonthResult> {
    let mut ids: Vec<String> = Vec::new();
    let add = |id: &String, ids: &mut Vec<String>| {
        if !ids.contains(id) {
            ids.push(id.clone());
        }
    };
    for id in category_ids {
        add(id, &mut ids);
    }
    for m in months {
        for (id, _) in &m.assigned {
            add(id, &mut ids);
        }
        for (id, _) in &m.spent {
            add(id, &mut ids);
        }
    }
    let mut prev_available: HashMap<String, i64> = HashMap::new();
    let mut prev_order: Vec<String> = Vec::new();
    let mut to_assign = 0i64;
    let mut results = Vec::new();
    for m in months {
        let lines: Vec<Line> = ids
            .iter()
            .map(|id| {
                let carry = prev_available.get(id).copied().unwrap_or(0).max(0);
                let assigned = lookup(&m.assigned, id);
                let spent = lookup(&m.spent, id);
                Line {
                    category_id: id.clone(),
                    carry_minor: carry,
                    assigned_minor: assigned,
                    spent_minor: spent,
                    available_minor: carry + assigned - spent,
                }
            })
            .collect();
        let overspent: i64 = prev_order.iter().map(|id| prev_available[id]).filter(|v| *v < 0).map(|v| -v).sum();
        let assigned: i64 = lines.iter().map(|l| l.assigned_minor).sum();
        let leftover = to_assign;
        to_assign = m.income_minor + leftover - assigned - overspent;
        prev_available = lines.iter().map(|l| (l.category_id.clone(), l.available_minor)).collect();
        prev_order = lines.iter().map(|l| l.category_id.clone()).collect();
        results.push(MonthResult {
            month: m.month.clone(),
            income_minor: m.income_minor,
            leftover_minor: leftover,
            overspent_minor: overspent,
            assigned_minor: assigned,
            to_assign_minor: to_assign,
            lines,
        });
    }
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn carry_forward_and_overspending() {
        let m = |month: &str, income, assigned: Vec<(&str, i64)>, spent: Vec<(&str, i64)>| MonthInput {
            month: month.into(),
            income_minor: income,
            assigned: assigned.into_iter().map(|(k, v)| (k.into(), v)).collect(),
            spent: spent.into_iter().map(|(k, v)| (k.into(), v)).collect(),
        };
        let r = run_budget(
            &[
                m("2026-10", 1000, vec![("food", 600), ("fun", 300)], vec![("food", 400), ("fun", 450)]),
                m("2026-11", 0, vec![], vec![]),
            ],
            &[],
        );
        assert_eq!(r[0].to_assign_minor, 100);
        assert_eq!(r[1].lines[0].carry_minor, 200);
        assert_eq!(r[1].lines[1].carry_minor, 0);
        assert_eq!(r[1].overspent_minor, 150);
        assert_eq!(r[1].to_assign_minor, -50);
        assert_eq!(month_span("2026-11", "2027-02"), ["2026-11", "2026-12", "2027-01", "2027-02"]);
    }
}
