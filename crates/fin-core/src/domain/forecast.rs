//! Cash-flow forecast (`src/domain/forecast.ts`, FR-027). A deterministic daily projection of
//! cash and bank balances: the starting balance, plus recurring items still expected, minus an
//! everyday-spending baseline (the median non-recurring spending for each weekday over the last
//! 90 days). Every input is reported back as an assumption.

use std::collections::HashMap;

use serde::Serialize;

use crate::db::dashboard::js_round;
use crate::db::transactions::locale_compare;
use crate::domain::dates::{add_days, diff_days, weekday};

/// How far back everyday spending is measured.
pub const BASELINE_DAYS: i64 = 90;
/// Below this much history the forecast is Low confidence.
pub const LOW_HISTORY_DAYS: i64 = 60;
/// High confidence needs this share of projected outflow to come from known recurring items.
pub const HIGH_RECURRING_SHARE: f64 = 0.8;
/// An unpaid item this many days overdue (or fewer) is assumed to go out today.
pub const OVERDUE_GRACE_DAYS: i64 = 7;
const MAX_CAUSES: usize = 5;

/// One expected recurring payment, as its effect on cash (negative = money leaves).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub item_id: String,
    pub name: String,
    pub due_date: String,
    /// Date it is counted on: the due date, or today for a recent overdue item.
    pub date: String,
    pub amount_minor: i64,
    pub overdue: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub date: String,
    pub balance_minor: i64,
    pub recurring_minor: i64,
    pub baseline_minor: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BufferRange {
    pub from: String,
    pub to: String,
    pub lowest_minor: i64,
    pub lowest_date: String,
    pub causes: Vec<Event>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Low {
    pub date: String,
    pub balance_minor: i64,
}

#[derive(Debug, Clone)]
pub struct ForecastInput {
    pub today: String,
    pub days: i64,
    pub start_minor: i64,
    pub buffer_minor: i64,
    /// Expected recurring items; paid or skipped ones are already left out.
    pub events: Vec<Event>,
    /// Non-recurring spending from cash and bank by day (positive amounts).
    pub daily_spending: HashMap<String, i64>,
    /// The first day with any cash or bank transaction.
    pub history_start: Option<String>,
}

/// Field order is the order the interface receives.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Forecast {
    pub today: String,
    pub days: i64,
    pub start_minor: i64,
    pub buffer_minor: i64,
    pub points: Vec<Point>,
    pub low: Low,
    pub end_minor: i64,
    pub below_buffer: Vec<BufferRange>,
    pub confidence: &'static str,
    pub confidence_reason: String,
    pub history_days: i64,
    pub baseline_days: i64,
    pub baseline_by_weekday: Vec<i64>,
    pub recurring_out_minor: i64,
    pub recurring_in_minor: i64,
    pub baseline_out_minor: i64,
    pub events: Vec<Event>,
}

fn ad(date: &str, days: i64) -> String {
    add_days(date, days).unwrap_or_else(|_| date.to_owned())
}

fn wd(date: &str) -> usize {
    weekday(date).unwrap_or(0) as usize
}

/// Median of integers, rounded to whole minor units (mean of the two middles for an even count).
pub fn median(values: &[i64]) -> i64 {
    if values.is_empty() {
        return 0;
    }
    let mut s = values.to_vec();
    s.sort();
    let mid = s.len() / 2;
    if s.len() % 2 == 1 { s[mid] } else { js_round((s[mid - 1] + s[mid]) as f64 / 2.0) }
}

/// Median spending for each weekday over the `BASELINE_DAYS` before today, counting days with no
/// spending as zero. Days before the history starts are not counted.
pub fn weekday_baseline(today: &str, daily: &HashMap<String, i64>, history_start: Option<&str>) -> (Vec<i64>, i64) {
    let Some(start) = history_start else { return (vec![0; 7], 0) };
    let mut buckets: Vec<Vec<i64>> = vec![Vec::new(); 7];
    let mut days = 0;
    for i in 1..=BASELINE_DAYS {
        let d = ad(today, -i);
        if d.as_str() < start {
            break;
        }
        buckets[wd(&d)].push(daily.get(&d).copied().unwrap_or(0));
        days += 1;
    }
    (buckets.iter().map(|b| median(b)).collect(), days)
}

pub fn confidence_for(history_days: i64, recurring_share: f64) -> (&'static str, String) {
    if history_days < LOW_HISTORY_DAYS {
        let reason = if history_days == 0 {
            "There is no spending history yet, so everyday spending is not included.".to_owned()
        } else {
            format!("Only {history_days} days of history; {LOW_HISTORY_DAYS} or more give a steadier estimate.")
        };
        return ("low", reason);
    }
    let pct = js_round(recurring_share * 100.0);
    if history_days >= BASELINE_DAYS && recurring_share >= HIGH_RECURRING_SHARE {
        return (
            "high",
            format!(
                "{pct}% of the money going out is from recurring items you set up, and there are at least {BASELINE_DAYS} days of history."
            ),
        );
    }
    let reason = if history_days < BASELINE_DAYS {
        format!(
            "{history_days} days of history; {BASELINE_DAYS} or more, with most spending set up as recurring items, gives High confidence."
        )
    } else {
        format!("{pct}% of the money going out is from recurring items; the rest is an estimate of everyday spending.")
    };
    ("medium", reason)
}

/// Run the projection. Points cover today and each of the next `days` days.
pub fn run_forecast(input: &ForecastInput) -> Forecast {
    let today = input.today.as_str();
    let end = ad(today, input.days);
    let mut events: Vec<Event> =
        input.events.iter().filter(|e| e.date.as_str() >= today && e.date <= end).cloned().collect();
    events.sort_by(|a, b| {
        a.date.cmp(&b.date).then(a.amount_minor.cmp(&b.amount_minor)).then_with(|| locale_compare(&a.name, &b.name))
    });
    let mut by_date: HashMap<&str, i64> = HashMap::new();
    for e in &events {
        *by_date.entry(e.date.as_str()).or_insert(0) += e.amount_minor;
    }

    let (by_weekday, baseline_days) = weekday_baseline(today, &input.daily_spending, input.history_start.as_deref());
    let mut points = Vec::with_capacity(input.days as usize + 1);
    let mut balance = input.start_minor;
    let mut baseline_out = 0;
    for i in 0..=input.days {
        let date = ad(today, i);
        let recurring = by_date.get(date.as_str()).copied().unwrap_or(0);
        // Today's spending is already in the balance, so the baseline starts tomorrow.
        let baseline = if i == 0 { 0 } else { by_weekday[wd(&date)] };
        balance += recurring - baseline;
        baseline_out += baseline;
        points.push(Point { date, balance_minor: balance, recurring_minor: recurring, baseline_minor: baseline });
    }

    let mut low = &points[0];
    for p in &points {
        if p.balance_minor < low.balance_minor {
            low = p;
        }
    }
    let recurring_out: i64 = events.iter().filter(|e| e.amount_minor < 0).map(|e| -e.amount_minor).sum();
    let recurring_in: i64 = events.iter().filter(|e| e.amount_minor > 0).map(|e| e.amount_minor).sum();
    let total_out = recurring_out + baseline_out;
    let share = if total_out == 0 { 1.0 } else { recurring_out as f64 / total_out as f64 };
    let history_days = input.history_start.as_deref().map_or(0, |s| diff_days(today, s).unwrap_or(0).max(0));
    let (confidence, confidence_reason) = confidence_for(history_days, share);

    Forecast {
        today: today.to_owned(),
        days: input.days,
        start_minor: input.start_minor,
        buffer_minor: input.buffer_minor,
        low: Low { date: low.date.clone(), balance_minor: low.balance_minor },
        end_minor: points.last().map_or(input.start_minor, |p| p.balance_minor),
        below_buffer: buffer_ranges(&points, input.buffer_minor, &events),
        points,
        confidence,
        confidence_reason,
        history_days,
        baseline_days,
        baseline_by_weekday: by_weekday,
        recurring_out_minor: recurring_out,
        recurring_in_minor: recurring_in,
        baseline_out_minor: baseline_out,
        events,
    }
}

/// Runs of days where the projected balance is below the buffer, with the payments that lead there.
pub fn buffer_ranges(points: &[Point], buffer_minor: i64, events: &[Event]) -> Vec<BufferRange> {
    let mut ranges: Vec<BufferRange> = Vec::new();
    let mut open = false;
    for p in points {
        if p.balance_minor < buffer_minor {
            if !open {
                ranges.push(BufferRange {
                    from: p.date.clone(),
                    to: p.date.clone(),
                    lowest_minor: p.balance_minor,
                    lowest_date: p.date.clone(),
                    causes: Vec::new(),
                });
                open = true;
            }
            let r = ranges.last_mut().expect("just pushed");
            r.to = p.date.clone();
            if p.balance_minor < r.lowest_minor {
                r.lowest_minor = p.balance_minor;
                r.lowest_date = p.date.clone();
            }
        } else {
            open = false;
        }
    }
    for r in &mut ranges {
        let mut causes: Vec<Event> =
            events.iter().filter(|e| e.amount_minor < 0 && e.date <= r.lowest_date).cloned().collect();
        causes.sort_by(|a, b| a.amount_minor.cmp(&b.amount_minor).then(a.date.cmp(&b.date)));
        causes.truncate(MAX_CAUSES);
        r.causes = causes;
    }
    ranges
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn medians_round_half_up() {
        assert_eq!(median(&[]), 0);
        assert_eq!(median(&[5, 1, 3]), 3);
        assert_eq!(median(&[1, 2]), 2);
        assert_eq!(median(&[4, 1, 2, 3]), 3);
    }

    #[test]
    fn projects_and_flags_the_buffer() {
        let ev = |date: &str, amount: i64, name: &str| Event {
            item_id: name.into(),
            name: name.into(),
            due_date: date.into(),
            date: date.into(),
            amount_minor: amount,
            overdue: false,
        };
        let input = ForecastInput {
            today: "2026-11-10".into(),
            days: 30,
            start_minor: 10_000,
            buffer_minor: 5_000,
            events: vec![
                ev("2026-11-12", -8_000, "Rent"),
                ev("2026-11-20", 20_000, "Salary"),
                ev("2027-01-01", -1, "Late"),
            ],
            daily_spending: HashMap::new(),
            history_start: None,
        };
        let f = run_forecast(&input);
        assert_eq!(f.points.len(), 31);
        assert_eq!((f.low.date.as_str(), f.low.balance_minor), ("2026-11-12", 2_000));
        assert_eq!(f.end_minor, 22_000);
        assert_eq!(f.below_buffer.len(), 1);
        assert_eq!((f.below_buffer[0].from.as_str(), f.below_buffer[0].to.as_str()), ("2026-11-12", "2026-11-19"));
        assert_eq!(f.below_buffer[0].causes[0].name, "Rent");
        assert_eq!(f.confidence, "low");
        assert_eq!(f.events.len(), 2);
    }
}
