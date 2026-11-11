//! What-if scenarios (`src/domain/scenarios.ts`, FR-029). A scenario is a list of changes added on
//! top of the real forecast inputs and goal projections. Everything here is pure: inputs are
//! read, never changed, and nothing is stored.

use serde_json::{Value, json};

use crate::domain::dates::{add_days, add_months, start_of_month};
use crate::domain::forecast::{Event, ForecastInput, run_forecast};
use crate::domain::goals::{PACE_MONTHS, Projection, project_goal};
use crate::domain::recurrence::{Schedule, occurrences_between};

/// A goal as the projection needs it.
pub struct GoalBase {
    pub id: String,
    pub name: String,
    pub target_minor: i64,
    pub target_date: Option<String>,
    pub saved_minor: i64,
    /// Net amount added over the last PACE_MONTHS months.
    pub recent_minor: i64,
    /// Saved in a cash or bank account, so moving money to it does not leave cash and bank.
    pub liquid: bool,
}

pub struct LoanBase {
    pub id: String,
    pub name: String,
    pub owed_minor: i64,
    /// The loan's terms, when set (US16): a prepayment then shows interest and months saved.
    pub terms: Option<crate::domain::amortization::Terms>,
}

pub struct Base {
    pub forecast: ForecastInput,
    /// Recurring items that are income: a pay change is applied on their dates.
    pub income_item_ids: Vec<String>,
    pub goals: Vec<GoalBase>,
    pub loans: Vec<LoanBase>,
}

fn schedule(frequency: &str, anchor: &str) -> Schedule {
    Schedule {
        frequency: frequency.to_owned(),
        interval: 1,
        anchor_date: anchor.to_owned(),
        end_date: None,
        count: None,
    }
}

/// Monthly dates from `from` (same day each month) up to `to`.
fn monthly(from: &str, to: &str) -> Vec<String> {
    if from > to { Vec::new() } else { occurrences_between(&schedule("monthly", from), from, to) }
}

/// Never before today: a change dated in the past starts today.
fn not_before<'a>(d: &'a str, today: &'a str) -> &'a str {
    if d < today { today } else { d }
}

fn event(name: &str, date: &str, amount_minor: i64, n: usize) -> Event {
    Event {
        item_id: format!("what-if:{n}"),
        name: name.to_owned(),
        due_date: date.to_owned(),
        date: date.to_owned(),
        amount_minor,
        overdue: false,
    }
}

fn plural(n: usize) -> &'static str {
    if n == 1 { "" } else { "s" }
}

fn projection_json(p: &Projection) -> Value {
    json!({
        "savedMinor": p.saved_minor,
        "remainingMinor": p.remaining_minor,
        "percent": p.percent,
        "monthsLeft": p.months_left,
        "requiredMonthlyMinor": p.required_monthly_minor,
        "paceMonthlyMinor": p.pace_monthly_minor,
        "projectedDate": p.projected_date,
        "status": p.status,
    })
}

/// Run a scenario. `changes` are validated `ScenarioChange` values.
pub fn run_scenario(base: &Base, changes: &[Value]) -> Value {
    let input = &base.forecast;
    let today = input.today.as_str();
    let end = add_days(today, input.days).unwrap_or_else(|_| today.to_owned());
    let end = end.as_str();
    let mut added: Vec<Event> = Vec::new();
    let mut notes: Vec<String> = Vec::new();
    let mut extra_for_goal: Vec<(Option<String>, i64)> = Vec::new();
    // Per loan: total prepaid and the first prepayment date.
    let mut loan_paid: Vec<(String, i64, String)> = Vec::new();
    let text = |c: &Value, k: &str| c.get(k).and_then(Value::as_str).unwrap_or_default().to_owned();

    for (n, c) in changes.iter().enumerate() {
        let amount = c["amountMinor"].as_i64().unwrap_or(0);
        match c["kind"].as_str().unwrap_or_default() {
            "new_bill" => {
                let name = text(c, "name");
                let dates = occurrences_between(&schedule(&text(c, "frequency"), &text(c, "startDate")), today, end);
                for d in &dates {
                    added.push(event(&name, d, -amount, n));
                }
                notes.push(format!(
                    "{name}: {} payment{} in the next {} days.",
                    dates.len(),
                    plural(dates.len()),
                    input.days
                ));
            }
            "large_purchase" => {
                let name = text(c, "name");
                let date = text(c, "date");
                if date.as_str() <= end {
                    added.push(event(&name, not_before(&date, today), -amount, n));
                }
                notes.push(format!("{name}: one payment, paid from your cash and bank accounts."));
            }
            "loan_prepayment" => {
                let loan_id = text(c, "loanId");
                let loan = base.loans.iter().find(|l| l.id == loan_id);
                let name = format!("Prepay {}", loan.map_or("loan", |l| l.name.as_str()));
                let date = text(c, "date");
                if date.as_str() <= end {
                    added.push(event(&name, not_before(&date, today), -amount, n));
                }
                match loan_paid.iter_mut().find(|(id, ..)| *id == loan_id) {
                    Some(slot) => {
                        slot.1 += amount;
                        if date < slot.2 {
                            slot.2 = date.clone();
                        }
                    }
                    None => loan_paid.push((loan_id, amount, date.clone())),
                }
                notes.push(if loan.is_some_and(|l| l.terms.is_some()) {
                    format!("{name}: worked out from the loan’s terms; your cash forecast keeps the EMIs as they are.")
                } else {
                    format!(
                        "{name}: your EMIs stay as they are here, so the loan ends sooner rather than costing less each month. Add the loan’s terms on the Accounts page to see the interest saved."
                    )
                });
            }
            "income_change" => {
                let from_date = text(c, "fromDate");
                let from = not_before(&from_date, today);
                // On the first income payment of each month; on the 1st when no income is recurring.
                let mut income: Vec<&Event> = input
                    .events
                    .iter()
                    .filter(|e| {
                        base.income_item_ids.contains(&e.item_id) && e.date.as_str() >= from && e.date.as_str() <= end
                    })
                    .collect();
                income.sort_by(|a, b| a.date.cmp(&b.date));
                let mut months: Vec<&str> = Vec::new();
                let mut paydays: Vec<String> = Vec::new();
                for e in income {
                    let m = &e.date[..7];
                    if !months.contains(&m) {
                        months.push(m);
                        paydays.push(e.date.clone());
                    }
                }
                let from_payday = !paydays.is_empty();
                let dates = if from_payday {
                    paydays
                } else {
                    let first = start_of_month(from);
                    let start = if first == from {
                        from.to_owned()
                    } else {
                        add_months(&first, 1, None).unwrap_or_else(|_| from.to_owned())
                    };
                    monthly(&start, end)
                };
                for d in &dates {
                    added.push(event(if amount >= 0 { "Pay rise" } else { "Pay cut" }, d, amount, n));
                }
                notes.push(if from_payday {
                    format!(
                        "Pay change applied on each payday from your recurring income ({} in this period).",
                        dates.len()
                    )
                } else {
                    "No income is set up as recurring, so the pay change is applied on the 1st of each month."
                        .to_owned()
                });
            }
            "savings_change" => {
                let goal =
                    c.get("goalId").and_then(Value::as_str).and_then(|id| base.goals.iter().find(|g| g.id == id));
                let key = goal.map(|g| g.id.clone());
                match extra_for_goal.iter_mut().find(|(k, _)| *k == key) {
                    Some(slot) => slot.1 += amount,
                    None => extra_for_goal.push((key, amount)),
                }
                let name = goal.map_or_else(|| "Extra savings".to_owned(), |g| format!("Save for {}", g.name));
                if let Some(g) = goal.filter(|g| g.liquid) {
                    notes.push(format!(
                        "{name}: {} is saved in a cash or bank account, so your cash and bank total does not change.",
                        g.name
                    ));
                    continue;
                }
                let from_date = text(c, "fromDate");
                let dates = monthly(not_before(&from_date, today), end);
                for d in &dates {
                    added.push(event(&name, d, -amount, n));
                }
                notes.push(format!(
                    "{name}: moved out of cash and bank each month ({} time{} in this period).",
                    dates.len(),
                    plural(dates.len())
                ));
            }
            _ => {}
        }
    }

    added.sort_by(|a, b| a.date.cmp(&b.date).then(a.amount_minor.cmp(&b.amount_minor)));
    let before = run_forecast(input);
    let mut with_changes = input.clone();
    with_changes.events.extend(added.iter().cloned());
    let after = run_forecast(&with_changes);

    let goals: Vec<Value> = base
        .goals
        .iter()
        .map(|g| {
            let extra = extra_for_goal.iter().find(|(k, _)| k.as_deref() == Some(g.id.as_str())).map_or(0, |(_, v)| *v);
            let project =
                |recent: i64| project_goal(g.target_minor, g.target_date.as_deref(), g.saved_minor, recent, today);
            json!({
                "id": g.id,
                "name": g.name,
                "before": projection_json(&project(g.recent_minor)),
                "after": projection_json(&project(g.recent_minor + extra * PACE_MONTHS)),
                "extraMonthlyMinor": extra,
            })
        })
        .collect();
    let loans: Vec<Value> = base
        .loans
        .iter()
        .filter_map(|l| {
            let (_, paid, date) = loan_paid.iter().find(|(id, ..)| *id == l.id)?;
            let prepayment = l.terms.as_ref().map_or(Value::Null, |t| {
                let p = crate::domain::amortization::prepay(t, date, *paid);
                json!({
                    "currentEmiMinor": p.current_emi_minor,
                    "tenureMonthsSaved": p.tenure_months_saved,
                    "tenureInterestSavedMinor": p.tenure_interest_saved_minor,
                    "newEmiMinor": p.new_emi_minor,
                    "emiInterestSavedMinor": p.emi_interest_saved_minor,
                })
            });
            Some(json!({ "id": l.id, "name": l.name, "beforeMinor": l.owed_minor, "afterMinor": (l.owed_minor - paid).max(0), "prepayment": prepayment }))
        })
        .collect();

    json!({ "before": before, "after": after, "added": added, "goals": goals, "loans": loans, "notes": notes })
}
