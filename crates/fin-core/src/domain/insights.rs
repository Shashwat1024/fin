//! Behaviour insights (`src/domain/insights.ts`, FR-029). Pure detectors over spending lines: each
//! insight states what changed, the period it compares against, and the transactions behind it.
//! Wording is descriptive, never judgemental. Arithmetic follows the TypeScript original step by
//! step (including where it rounds), so both backends report the same insights and figures.
//!
//! Statements give a posting date but no time of day, so late-night patterns are not attempted.

use std::collections::{HashMap, HashSet};

use serde_json::{Value, json};

use crate::db::dashboard::js_round;
use crate::domain::dates::{
    add_days, add_months, day_month, diff_days, end_of_month, month_key, month_long, month_short, parts,
    start_of_month, weekday,
};
use crate::domain::forecast::median;
use crate::domain::money::rupees;

/// One piece of spending: a transaction, or one split of it.
#[derive(Debug, Clone)]
pub struct SpendLine {
    pub txn_id: String,
    pub date: String,
    /// Positive = money spent; negative = a refund.
    pub amount_minor: i64,
    pub category_id: Option<String>,
    pub category_name: Option<String>,
    pub merchant_key: Option<String>,
    /// Merchant display name, or the payee.
    pub merchant_name: String,
    /// Matched to a recurring item: left out of "everyday" patterns.
    pub recurring: bool,
}

#[derive(Debug, Clone)]
pub struct SubscriptionItem {
    pub item_id: String,
    pub name: String,
    /// Expected amount per payment (positive).
    pub amount_minor: i64,
    pub frequency: String,
    pub interval: i64,
    /// First payment.
    pub start_date: String,
    pub end_date: Option<String>,
    pub active: bool,
}

/// A real payment matched to a subscription item.
#[derive(Debug, Clone)]
pub struct SubscriptionPayment {
    pub item_id: String,
    pub txn_id: String,
    pub date: String,
    pub amount_minor: i64,
}

pub const MAX_SOURCES: usize = 5;
/// Months averaged as "usual" for category and merchant changes (at least MIN_COMPARE_MONTHS).
pub const COMPARE_MONTHS: i32 = 3;
pub const MIN_COMPARE_MONTHS: i32 = 2;
/// A change must be at least this share of the usual amount…
pub const CHANGE_SHARE: f64 = 0.25;
/// …and at least this much money (₹1,000).
pub const CHANGE_MIN_MINOR: f64 = 100_000.0;
pub const WEEKEND_DAYS: i64 = 90;
pub const WEEKEND_RATIO: f64 = 1.5;
/// Weekend days need to differ by at least ₹300 a day.
pub const WEEKEND_MIN_MINOR: i64 = 30_000;
pub const UNUSUAL_RECENT_DAYS: i64 = 30;
pub const UNUSUAL_RATIO: i64 = 3;
pub const UNUSUAL_MIN_MINOR: i64 = 200_000;
pub const UNUSUAL_MIN_HISTORY: usize = 5;
/// A subscription price rise is reported from 5% (and at least ₹10).
pub const PRICE_RISE_SHARE: f64 = 0.05;
pub const CREEP_MONTHS: i32 = 6;

fn ad(d: &str, n: i64) -> String {
    add_days(d, n).unwrap_or_else(|_| d.to_owned())
}
fn am(d: &str, n: i32) -> String {
    add_months(d, n, None).unwrap_or_else(|_| d.to_owned())
}
fn month_name(d: &str) -> &'static str {
    parts(d).map_or("", |p| month_long(p.month))
}
fn short_month(d: &str) -> &'static str {
    parts(d).map_or("", |p| month_short(p.month))
}
fn dm(d: &str) -> String {
    day_month(d).unwrap_or_default()
}
fn wd(d: &str) -> u32 {
    weekday(d).unwrap_or(0)
}
fn pct(share: f64) -> String {
    format!("{}%", js_round(share.abs() * 100.0))
}
fn in_range(d: &str, from: &str, to: &str) -> bool {
    d >= from && d <= to
}
fn plural(n: usize) -> &'static str {
    if n == 1 { "" } else { "s" }
}

/// `Number.prototype.toFixed(1)` for a positive number: an exact tie (x.x5, only possible for
/// x.25 and x.75 in binary) rounds up, where Rust's formatter would round to even.
pub fn to_fixed_1(x: f64) -> String {
    let quarters = x * 4.0;
    if quarters.fract() == 0.0 && (quarters as i64) % 2 != 0 {
        let tenths = (x * 10.0).floor() as i64 + 1;
        return format!("{}.{}", tenths / 10, tenths % 10);
    }
    format!("{x:.1}")
}

#[derive(Debug, Clone)]
pub struct Period {
    pub label: String,
    pub from: String,
    pub to: String,
}

impl Period {
    fn json(&self) -> Value {
        json!({ "label": self.label, "from": self.from, "to": self.to })
    }
}

fn default_label(l: &SpendLine) -> String {
    if l.merchant_name.is_empty() { "Unnamed".to_owned() } else { l.merchant_name.clone() }
}

/// The largest supporting transactions, newest first on a tie.
fn top_sources(lines: &[&SpendLine], label: fn(&SpendLine) -> String) -> Vec<Value> {
    let mut sorted: Vec<&SpendLine> = lines.to_vec();
    sorted.sort_by(|a, b| b.amount_minor.cmp(&a.amount_minor).then_with(|| b.date.cmp(&a.date)));
    sorted
        .into_iter()
        .take(MAX_SOURCES)
        .map(|l| json!({ "txnId": l.txn_id, "date": l.date, "label": label(l), "amountMinor": l.amount_minor }))
        .collect()
}

/// The last complete month, and the months before it to average as "usual": three when the
/// history covers them, otherwise two. `None` with less history than that.
pub fn comparison_months(today: &str, history_start: Option<&str>) -> Option<(Period, Period, i32)> {
    let start = history_start?;
    let recent_from = am(&start_of_month(today), -1);
    let mut months = COMPARE_MONTHS;
    while months >= MIN_COMPARE_MONTHS && start > am(&recent_from, -months).as_str() {
        months -= 1;
    }
    if months < MIN_COMPARE_MONTHS {
        return None;
    }
    let usual_from = am(&recent_from, -months);
    let usual_to = ad(&recent_from, -1);
    Some((
        Period {
            label: month_name(&recent_from).to_owned(),
            to: end_of_month(&recent_from).unwrap_or_else(|_| recent_from.clone()),
            from: recent_from,
        },
        Period {
            label: format!("{}–{} average", short_month(&usual_from), short_month(&usual_to)),
            from: usual_from,
            to: usual_to,
        },
        months,
    ))
}

struct Group<'a> {
    id: String,
    name: String,
    recent: Vec<&'a SpendLine>,
    usual_total: i64,
    recent_total: i64,
}

/// Category or merchant spending last month against the average of the months before.
fn period_changes(lines: &[SpendLine], today: &str, history_start: Option<&str>, by_category: bool) -> Vec<Value> {
    let Some((recent, usual, months)) = comparison_months(today, history_start) else { return Vec::new() };
    let mut groups: Vec<Group> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    for l in lines {
        let id = if by_category { l.category_id.as_deref() } else { l.merchant_key.as_deref() };
        let Some(id) = id.filter(|i| !i.is_empty()) else { continue };
        let is_recent = in_range(&l.date, &recent.from, &recent.to);
        if !is_recent && !in_range(&l.date, &usual.from, &usual.to) {
            continue;
        }
        let at = *index.entry(id.to_owned()).or_insert_with(|| {
            let name = if by_category {
                l.category_name.clone().unwrap_or_else(|| "Unnamed".to_owned())
            } else {
                l.merchant_name.clone()
            };
            groups.push(Group { id: id.to_owned(), name, recent: Vec::new(), usual_total: 0, recent_total: 0 });
            groups.len() - 1
        });
        let g = &mut groups[at];
        if is_recent {
            g.recent_total += l.amount_minor;
            if l.amount_minor > 0 {
                g.recent.push(l);
            }
        } else {
            g.usual_total += l.amount_minor;
        }
    }
    // Merchants are noisier than categories, so they need a bigger change to be worth mentioning.
    let min_share = if by_category { CHANGE_SHARE } else { CHANGE_SHARE * 2.0 };
    let min_minor = if by_category { CHANGE_MIN_MINOR } else { CHANGE_MIN_MINOR * 1.5 };
    let mut out: Vec<(i64, Value)> = Vec::new();
    for g in &groups {
        let avg = js_round(g.usual_total as f64 / months as f64);
        let now = g.recent_total.max(0);
        let diff = now - avg.max(0);
        if avg <= 0 || (diff.abs() as f64) < min_minor || (diff.abs() as f64) / (avg as f64) < min_share {
            continue;
        }
        let up = diff > 0;
        let place = if by_category { format!("in {}", g.name) } else { format!("at {}", g.name) };
        let subject = if by_category { g.name.clone() } else { format!("Spending at {}", g.name) };
        let payments = if g.recent.is_empty() {
            format!("No spending {place} last month.")
        } else {
            format!("{} payment{} {place} last month.", g.recent.len(), plural(g.recent.len()))
        };
        let label: fn(&SpendLine) -> String = if by_category {
            default_label
        } else {
            |l| l.category_name.clone().unwrap_or_else(|| l.merchant_name.clone())
        };
        let filter = if by_category {
            json!({ "from": recent.from, "to": recent.to, "categoryId": g.id })
        } else {
            json!({ "from": recent.from, "to": recent.to, "text": g.name })
        };
        out.push((
            diff.abs(),
            json!({
                "key": format!("{}:{}:{}", if by_category { "category" } else { "merchant" }, g.id, month_key(&recent.from)),
                "kind": if by_category { "category_change" } else { "merchant_change" },
                "title": format!("{subject} {} {} in {}", if up { "up" } else { "down" }, pct(diff as f64 / avg as f64), recent.label),
                "detail": format!(
                    "{} in {}, {} your usual {} a month ({}). {payments}",
                    rupees(now),
                    recent.label,
                    if up { "compared with" } else { "down from" },
                    rupees(avg),
                    usual.label
                ),
                "direction": if up { "up" } else { "down" },
                "period": recent.json(),
                "comparison": usual.json(),
                "currentMinor": now,
                "comparisonMinor": avg,
                "sources": top_sources(&g.recent, label),
                "sourceCount": g.recent.len(),
                "filter": filter,
                "weightMinor": diff.abs(),
            }),
        ));
    }
    out.sort_by_key(|o| std::cmp::Reverse(o.0));
    out.into_iter().take(if by_category { 4 } else { 3 }).map(|(_, v)| v).collect()
}

pub fn category_changes(lines: &[SpendLine], today: &str, history_start: Option<&str>) -> Vec<Value> {
    period_changes(lines, today, history_start, true)
}
pub fn merchant_changes(lines: &[SpendLine], today: &str, history_start: Option<&str>) -> Vec<Value> {
    period_changes(lines, today, history_start, false)
}

/// Everyday spending per weekend day against per weekday, over the last 90 days.
pub fn weekend_spending(lines: &[SpendLine], today: &str, history_start: Option<&str>) -> Vec<Value> {
    let Some(start) = history_start else { return Vec::new() };
    let to = ad(today, -1);
    let window_from = ad(today, -WEEKEND_DAYS);
    let from = if start > window_from.as_str() { start.to_owned() } else { window_from };
    let (mut weekend_days, mut weekdays) = (0i64, 0i64);
    let mut d = from.clone();
    while d <= to {
        if matches!(wd(&d), 0 | 6) {
            weekend_days += 1;
        } else {
            weekdays += 1;
        }
        d = ad(&d, 1);
    }
    if weekend_days < 8 || weekdays < 20 {
        return Vec::new();
    }
    let (mut weekend_total, mut weekday_total) = (0i64, 0i64);
    let mut weekend_lines: Vec<&SpendLine> = Vec::new();
    for l in lines {
        if l.recurring || !in_range(&l.date, &from, &to) {
            continue;
        }
        if matches!(wd(&l.date), 0 | 6) {
            weekend_total += l.amount_minor;
            if l.amount_minor > 0 {
                weekend_lines.push(l);
            }
        } else {
            weekday_total += l.amount_minor;
        }
    }
    let per_weekend = js_round(weekend_total as f64 / weekend_days as f64);
    let per_weekday = js_round(weekday_total as f64 / weekdays as f64);
    // A habit, not one big Saturday: several weekend days, and some weekday spending to compare with.
    let distinct_days: HashSet<&str> = weekend_lines.iter().map(|l| l.date.as_str()).collect();
    if per_weekday <= 0 || distinct_days.len() < 4 {
        return Vec::new();
    }
    if per_weekend - per_weekday < WEEKEND_MIN_MINOR || (per_weekend as f64) < per_weekday as f64 * WEEKEND_RATIO {
        return Vec::new();
    }
    let mut by_category: Vec<(String, i64)> = Vec::new();
    for l in &weekend_lines {
        let name = l.category_name.clone().unwrap_or_else(|| "Uncategorised".to_owned());
        match by_category.iter_mut().find(|(n, _)| *n == name) {
            Some(slot) => slot.1 += l.amount_minor,
            None => by_category.push((name, l.amount_minor)),
        }
    }
    by_category.sort_by_key(|c| std::cmp::Reverse(c.1));
    let top: Vec<String> = by_category.iter().take(2).map(|(name, v)| format!("{name} ({})", rupees(*v))).collect();
    let days = diff_days(&ad(&to, 1), &from).unwrap_or(0);
    vec![json!({
        "key": format!("weekend:{}", month_key(today)),
        "kind": "weekend_spending",
        "title": format!("Weekends cost about {}× a weekday", to_fixed_1(per_weekend as f64 / per_weekday.max(1) as f64)),
        "detail": format!(
            "About {} a day on Saturdays and Sundays, compared with {} on weekdays, over the last {days} days (recurring payments not counted). Most weekend spending went to {}.",
            rupees(per_weekend),
            rupees(per_weekday),
            top.join(" and ")
        ),
        "direction": "up",
        "period": { "label": format!("A weekend day, last {days} days"), "from": from, "to": to },
        "comparison": { "label": "A weekday, same period", "from": from, "to": to },
        "currentMinor": per_weekend,
        "comparisonMinor": per_weekday,
        "sources": top_sources(&weekend_lines, default_label),
        "sourceCount": weekend_lines.len(),
        "filter": { "from": from, "to": to },
        "weightMinor": (per_weekend - per_weekday) * weekend_days,
    })]
}

/// A recent purchase several times the usual size for its category over the past year.
pub fn unusual_purchases(lines: &[SpendLine], today: &str) -> Vec<Value> {
    let recent_from = ad(today, -UNUSUAL_RECENT_DAYS);
    let mut order: Vec<&str> = Vec::new();
    let mut by_category: HashMap<&str, Vec<&SpendLine>> = HashMap::new();
    for l in lines {
        let Some(c) = l.category_id.as_deref().filter(|c| !c.is_empty()) else { continue };
        if l.recurring || l.amount_minor <= 0 {
            continue;
        }
        by_category
            .entry(c)
            .or_insert_with(|| {
                order.push(c);
                Vec::new()
            })
            .push(l);
    }
    let mut out: Vec<(i64, Value)> = Vec::new();
    for c in order {
        let list = &by_category[c];
        for (i, l) in list.iter().enumerate() {
            if !in_range(&l.date, &recent_from, today) || l.amount_minor < UNUSUAL_MIN_MINOR {
                continue;
            }
            let year_from = ad(&l.date, -365);
            let before: Vec<i64> = list
                .iter()
                .enumerate()
                .filter(|(j, p)| *j != i && p.date < l.date && p.date >= year_from)
                .map(|(_, p)| p.amount_minor)
                .collect();
            if before.len() < UNUSUAL_MIN_HISTORY {
                continue;
            }
            let usual = median(&before);
            if l.amount_minor < usual * UNUSUAL_RATIO {
                continue;
            }
            let category_name = l.category_name.as_deref().unwrap_or("null");
            let payee = if l.merchant_name.is_empty() { "an unnamed payee" } else { l.merchant_name.as_str() };
            out.push((
                l.amount_minor - usual,
                json!({
                    "key": format!("unusual:{}:{c}", l.txn_id),
                    "kind": "unusual_purchase",
                    "title": format!("{} at {payee} on {}", rupees(l.amount_minor), dm(&l.date)),
                    "detail": format!(
                        "About {}× your typical {category_name} payment of {} (the middle of {} payments in the year before).",
                        js_round(l.amount_minor as f64 / usual.max(1) as f64),
                        rupees(usual),
                        before.len()
                    ),
                    "direction": "up",
                    "period": { "label": dm(&l.date), "from": l.date, "to": l.date },
                    "comparison": { "label": format!("{category_name}, previous 12 months"), "from": year_from, "to": ad(&l.date, -1) },
                    "currentMinor": l.amount_minor,
                    "comparisonMinor": usual,
                    "sources": top_sources(&[l], default_label),
                    "sourceCount": 1,
                    "filter": { "from": l.date, "to": l.date, "categoryId": c },
                    "weightMinor": l.amount_minor - usual,
                }),
            ));
        }
    }
    out.sort_by_key(|o| std::cmp::Reverse(o.0));
    out.into_iter().take(3).map(|(_, v)| v).collect()
}

/// What one payment of a schedule costs per month on average.
pub fn monthly_equivalent(amount_minor: i64, frequency: &str, interval: i64) -> i64 {
    let per_year = match frequency {
        "weekly" => 52.0 / interval as f64,
        "monthly" => 12.0 / interval as f64,
        _ => 1.0 / interval as f64,
    };
    js_round((amount_minor as f64 * per_year) / 12.0)
}

fn active_on(s: &SubscriptionItem, date: &str) -> bool {
    s.start_date.as_str() <= date && s.end_date.as_deref().is_none_or(|e| e.is_empty() || e >= date)
}

/// Subscription prices that went up, and more (or pricier) subscriptions than six months ago. The
/// second needs six months of history, so items set up recently are not mistaken for new ones.
pub fn subscription_changes(
    items: &[SubscriptionItem],
    payments: &[SubscriptionPayment],
    today: &str,
    history_start: Option<&str>,
) -> Vec<Value> {
    let mut out = Vec::new();
    let year_ago = ad(today, -365);
    for s in items {
        if !s.active {
            continue;
        }
        let mut paid: Vec<&SubscriptionPayment> =
            payments.iter().filter(|p| p.item_id == s.item_id && in_range(&p.date, &year_ago, today)).collect();
        paid.sort_by(|a, b| a.date.cmp(&b.date));
        if paid.len() < 2 {
            continue;
        }
        let first = paid[0];
        let last = paid[paid.len() - 1];
        let rise = last.amount_minor - first.amount_minor;
        if rise < 1000 || (rise as f64) < first.amount_minor as f64 * PRICE_RISE_SHARE {
            continue;
        }
        let yearly = monthly_equivalent(rise, &s.frequency, s.interval) * 12;
        out.push(json!({
            "key": format!("sub_price:{}:{}", s.item_id, last.txn_id),
            "kind": "subscription_price",
            "title": format!("{} now costs {}", s.name, rupees(last.amount_minor)),
            "detail": format!(
                "Up {} from {} in {} — about {} more a year.",
                pct(rise as f64 / first.amount_minor as f64),
                rupees(first.amount_minor),
                month_name(&first.date),
                rupees(yearly)
            ),
            "direction": "up",
            "period": { "label": dm(&last.date), "from": last.date, "to": last.date },
            "comparison": { "label": dm(&first.date), "from": first.date, "to": first.date },
            "currentMinor": last.amount_minor,
            "comparisonMinor": first.amount_minor,
            "sources": paid.iter().rev().take(MAX_SOURCES).map(|p| json!({ "txnId": p.txn_id, "date": p.date, "label": s.name, "amountMinor": p.amount_minor })).collect::<Vec<_>>(),
            "sourceCount": paid.len(),
            "filter": { "from": first.date, "to": last.date, "text": s.name },
            "weightMinor": yearly,
        }));
    }

    let then = am(today, -CREEP_MONTHS);
    let now_items: Vec<usize> = (0..items.len()).filter(|i| items[*i].active && active_on(&items[*i], today)).collect();
    let then_items: Vec<usize> = (0..items.len()).filter(|i| active_on(&items[*i], &then)).collect();
    let total = |list: &[usize]| -> i64 {
        list.iter().map(|i| monthly_equivalent(items[*i].amount_minor, &items[*i].frequency, items[*i].interval)).sum()
    };
    let now_total = total(&now_items);
    let then_total = total(&then_items);
    let added: Vec<usize> = now_items.iter().copied().filter(|i| !then_items.contains(i)).collect();
    let enough_history = history_start.is_some_and(|h| h <= then.as_str());
    if enough_history && !added.is_empty() && (now_total - then_total) as f64 >= (then_total as f64 * 0.1).max(10_000.0)
    {
        let added_ids: HashSet<&str> = added.iter().map(|i| items[*i].item_id.as_str()).collect();
        // Later items with the same id win, like a Map built from entries.
        let names: HashMap<&str, &str> = items.iter().map(|s| (s.item_id.as_str(), s.name.as_str())).collect();
        let mut recent_paid: Vec<&SubscriptionPayment> =
            payments.iter().filter(|p| added_ids.contains(p.item_id.as_str())).collect();
        recent_paid.sort_by(|a, b| b.date.cmp(&a.date));
        let yearly = (now_total - then_total) * 12;
        out.push(json!({
            "key": format!("subs:{}", month_key(today)),
            "kind": "subscription_creep",
            "title": format!("Subscriptions: {} a month, up from {}", rupees(now_total), rupees(then_total)),
            "detail": format!(
                "{} subscription{} now, against {} in {}. New since then: {}. That is about {} more a year.",
                now_items.len(),
                plural(now_items.len()),
                then_items.len(),
                month_name(&then),
                added.iter().map(|i| items[*i].name.as_str()).collect::<Vec<_>>().join(", "),
                rupees(yearly)
            ),
            "direction": "up",
            "period": { "label": "Now", "from": then, "to": today },
            "comparison": { "label": month_name(&then), "from": then, "to": then },
            "currentMinor": now_total,
            "comparisonMinor": then_total,
            "sources": recent_paid.iter().take(MAX_SOURCES).map(|p| json!({
                "txnId": p.txn_id,
                "date": p.date,
                "label": names.get(p.item_id.as_str()).copied().unwrap_or(""),
                "amountMinor": p.amount_minor,
            })).collect::<Vec<_>>(),
            "sourceCount": recent_paid.len(),
            "filter": { "from": then, "to": today },
            "weightMinor": yearly,
        }));
    }
    out
}

/// Every detector, in feed order: subscriptions, changes, one-offs, habits. A merchant change is
/// left out when its category change already tells the same story.
pub fn detect_insights(
    today: &str,
    history_start: Option<&str>,
    lines: &[SpendLine],
    subscriptions: &[SubscriptionItem],
    payments: &[SubscriptionPayment],
) -> Vec<Value> {
    let categories = category_changes(lines, today, history_start);
    let reported: HashSet<&str> = categories.iter().filter_map(|c| c["filter"]["categoryId"].as_str()).collect();
    let merchants: Vec<Value> = merchant_changes(lines, today, history_start)
        .into_iter()
        .filter(|m| {
            let name = m["filter"]["text"].as_str().unwrap_or_default();
            let (from, to) =
                (m["period"]["from"].as_str().unwrap_or_default(), m["period"]["to"].as_str().unwrap_or_default());
            let recent: Vec<&SpendLine> = lines
                .iter()
                .filter(|l| l.merchant_name == name && in_range(&l.date, from, to) && l.amount_minor > 0)
                .collect();
            let total: i64 = recent.iter().map(|l| l.amount_minor).sum();
            let covered: i64 = recent
                .iter()
                .filter(|l| l.category_id.as_deref().is_some_and(|c| !c.is_empty() && reported.contains(c)))
                .map(|l| l.amount_minor)
                .sum();
            total == 0 || covered * 2 < total
        })
        .collect();
    let mut out = subscription_changes(subscriptions, payments, today, history_start);
    out.extend(categories.iter().cloned());
    out.extend(merchants);
    out.extend(unusual_purchases(lines, today));
    out.extend(weekend_spending(lines, today, history_start));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_fixed_matches_javascript() {
        assert_eq!(to_fixed_1(2.25), "2.3");
        assert_eq!(to_fixed_1(0.75), "0.8");
        assert_eq!(to_fixed_1(0.35), "0.3");
        assert_eq!(to_fixed_1(1.45), "1.4");
        assert_eq!(to_fixed_1(3.0), "3.0");
        assert_eq!(to_fixed_1(12.96), "13.0");
    }

    #[test]
    fn monthly_equivalents() {
        assert_eq!(monthly_equivalent(64_900, "monthly", 1), 64_900);
        assert_eq!(monthly_equivalent(120_000, "yearly", 1), 10_000);
        assert_eq!(monthly_equivalent(10_000, "weekly", 2), 21_667);
    }

    #[test]
    fn comparison_needs_two_full_months() {
        assert!(comparison_months("2026-11-10", Some("2026-09-15")).is_none());
        let (recent, usual, months) = comparison_months("2026-11-10", Some("2026-08-01")).unwrap();
        assert_eq!(
            (recent.label.as_str(), recent.from.as_str(), recent.to.as_str()),
            ("October", "2026-10-01", "2026-10-31")
        );
        assert_eq!((usual.label.as_str(), months), ("Aug–Sept average", 2));
    }
}
