//! Behaviour insights and "looks recurring" suggestions (`src/db/repos/patterns.ts`). Both are
//! computed from the ledger every time; only the keys of dismissed ones are stored.

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use regex::Regex;
use rusqlite::params;
use serde_json::{Value, json};

use super::accounts::list_accounts;
use super::audit::with_audit;
use super::categories::list_categories;
use super::planning::{list_occurrences, list_recurring};
use super::{Db, DbResult, new_id, now_iso};
use crate::domain::dates::add_days;
use crate::domain::insights::{SpendLine, SubscriptionItem, SubscriptionPayment, detect_insights};
use crate::domain::money::js_trim;
use crate::domain::recurrence::{PastPayment, detect_recurring};
use crate::error::AppError;
use crate::row;

/// A year of history is enough for every detector.
const LOOKBACK_DAYS: i64 = 400;

pub(crate) struct LineRow {
    pub id: String,
    pub account_id: String,
    pub posted_date: String,
    pub payee: String,
    pub mkey: Option<String>,
    pub mname: Option<String>,
    pub category_id: Option<String>,
    pub amount_minor: i64,
}

fn line_row(r: &rusqlite::Row) -> rusqlite::Result<LineRow> {
    Ok(LineRow {
        id: r.get(0)?,
        account_id: r.get(1)?,
        posted_date: r.get(2)?,
        payee: r.get(3)?,
        mkey: r.get(4)?,
        mname: r.get(5)?,
        category_id: r.get(6)?,
        amount_minor: r.get(7)?,
    })
}

/// Standard (non-transfer) transactions with splits expanded: one row per category.
pub(crate) fn ledger_lines(db: &Db, from: &str, to: &str) -> DbResult<Vec<LineRow>> {
    db.query_map(
        "SELECT t.id, t.account_id, t.posted_date, t.payee, m.normalized_key AS mkey, m.display_name AS mname,
            COALESCE(s.category_id, t.category_id) AS category_id, COALESCE(s.amount_minor, t.amount_minor) AS amount_minor
     FROM transactions t
     LEFT JOIN splits s ON s.transaction_id = t.id
     LEFT JOIN merchants m ON m.id = t.merchant_id
     WHERE t.deleted_at IS NULL AND t.kind = 'standard' AND t.posted_date >= ? AND t.posted_date <= ?",
        params![from, to],
        line_row,
    )
}

// JavaScript's `\s`, spelled out (Rust's differs on U+0085 and U+FEFF).
const JS_SPACE: &str =
    r"\t\n\x0B\x0C\r \u{a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}";
static DIGITS: LazyLock<Regex> = LazyLock::new(|| Regex::new("[0-9]+").unwrap());
static NOT_LETTERS: LazyLock<Regex> = LazyLock::new(|| Regex::new(&format!(r"[^\p{{L}}{JS_SPACE}&]")).unwrap());
static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(&format!("[{JS_SPACE}]+")).unwrap());
static REFERENCE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(&format!("[^{JS_SPACE}]*[0-9]{{4,}}[^{JS_SPACE}]*")).unwrap());

/// Payees without a recognised merchant: lower case, digits (reference numbers) removed.
pub fn payee_key(payee: &str) -> String {
    let lower = payee.to_lowercase();
    let no_digits = DIGITS.replace_all(&lower, " ");
    let letters = NOT_LETTERS.replace_all(&no_digits, " ");
    js_trim(&SPACES.replace_all(&letters, " ")).to_owned()
}

/// A name fit to show: reference numbers (four or more digits) removed.
pub fn clean_name(name: &str) -> String {
    let stripped = REFERENCE.replace_all(name, " ");
    let cleaned = js_trim(&SPACES.replace_all(&stripped, " ")).to_owned();
    if cleaned.is_empty() { js_trim(name).to_owned() } else { cleaned }
}

/// Occurrences in [from, to] and the transactions matched to them (automatically or by hand).
fn recurring_matches(db: &Db, from: &str, to: &str, today: &str) -> DbResult<(Vec<Value>, HashSet<String>)> {
    let occurrences = list_occurrences(db, from, to, today)?;
    let ids = occurrences.iter().filter_map(|o| o["matchedTxn"]["id"].as_str().map(str::to_owned)).collect();
    Ok((occurrences, ids))
}

fn dismissed_keys(db: &Db) -> DbResult<HashSet<String>> {
    Ok(db.query_map("SELECT key FROM dismissed_insights", [], |r| r.get::<_, String>(0))?.into_iter().collect())
}

fn st<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(Value::as_str).unwrap_or_default()
}

// ---- Insights feed ----------------------------------------------------------------------------

pub fn list_insights(db: &Db, today: &str, include_dismissed: bool) -> DbResult<Value> {
    let from = add_days(today, -LOOKBACK_DAYS).map_err(|_| AppError::internal())?;
    let categories: HashMap<String, Value> =
        list_categories(db)?.into_iter().map(|c| (st(&c, "id").to_owned(), c)).collect();
    let (occurrences, recurring_txns) = recurring_matches(db, &from, today, today)?;

    // Spending: money out (and refunds back) in spending categories, on any account including cards.
    let rows = ledger_lines(db, &from, today)?;
    let mut lines: Vec<SpendLine> = Vec::new();
    for r in &rows {
        let c = r.category_id.as_deref().and_then(|id| categories.get(id));
        if c.is_some_and(|c| c["group"] == "income" || c["group"] == "transfer") {
            continue;
        }
        // Uncategorised money in is not a refund we can place.
        if c.is_none() && r.amount_minor > 0 {
            continue;
        }
        lines.push(SpendLine {
            txn_id: r.id.clone(),
            date: r.posted_date.clone(),
            amount_minor: -r.amount_minor,
            category_id: c.map(|c| st(c, "id").to_owned()),
            category_name: c.map(|c| st(c, "path").to_owned()),
            merchant_key: r.mkey.clone(),
            merchant_name: r.mname.clone().unwrap_or_else(|| r.payee.clone()),
            recurring: recurring_txns.contains(&r.id),
        });
    }
    let history_start = db
        .query_row(
            "SELECT MIN(posted_date) FROM transactions WHERE deleted_at IS NULL AND kind = 'standard'",
            [],
            |r| r.get::<_, Option<String>>(0),
        )?
        .flatten();
    let as_of = db
        .query_row(
            "SELECT MAX(posted_date) FROM transactions WHERE deleted_at IS NULL AND posted_date <= ?",
            [today],
            |r| r.get::<_, Option<String>>(0),
        )?
        .flatten();

    // Subscriptions: what each one charged, from its matched payments and any other payments to
    // the same merchant from the same account (a price rise can fall outside the tolerance).
    let items: Vec<Value> = list_recurring(db, today)?.into_iter().filter(|i| i["kind"] == "subscription").collect();
    let mut subscriptions: Vec<SubscriptionItem> = Vec::new();
    let mut payments: Vec<SubscriptionPayment> = Vec::new();
    if !items.is_empty() {
        // Later lines of the same transaction (splits) win, like a Map built from entries.
        let by_id: HashMap<&str, &SpendLine> = lines.iter().map(|l| (l.txn_id.as_str(), l)).collect();
        for item in &items {
            let item_id = st(item, "id");
            let matched: Vec<&Value> = occurrences
                .iter()
                .filter(|o| st(o, "itemId") == item_id && o["matchedTxn"].is_object())
                .map(|o| &o["matchedTxn"])
                .collect();
            let merchants: HashSet<&str> =
                matched.iter().filter_map(|m| by_id.get(st(m, "id")).and_then(|l| l.merchant_key.as_deref())).collect();
            let payees: HashSet<String> = matched.iter().map(|m| payee_key(st(m, "payee"))).collect();
            let mut seen: HashSet<String> = HashSet::new();
            let mut add = |txn_id: &str, date: &str, amount: i64, payments: &mut Vec<SubscriptionPayment>| {
                if amount <= 0 || !seen.insert(txn_id.to_owned()) {
                    return;
                }
                payments.push(SubscriptionPayment {
                    item_id: item_id.to_owned(),
                    txn_id: txn_id.to_owned(),
                    date: date.to_owned(),
                    amount_minor: amount,
                });
            };
            for m in &matched {
                add(st(m, "id"), st(m, "postedDate"), -m["amountMinor"].as_i64().unwrap_or(0), &mut payments);
            }
            for r in &rows {
                if r.account_id != st(item, "accountId") || r.amount_minor >= 0 {
                    continue;
                }
                let same_merchant = r.mkey.as_deref().is_some_and(|k| !k.is_empty() && merchants.contains(k));
                if same_merchant || payees.contains(&payee_key(&r.payee)) {
                    add(&r.id, &r.posted_date, -r.amount_minor, &mut payments);
                }
            }
            let first = payments
                .iter()
                .filter(|p| p.item_id == item_id)
                .map(|p| p.date.as_str())
                .fold(st(item, "anchorDate"), |m, d| if d < m { d } else { m })
                .to_owned();
            subscriptions.push(SubscriptionItem {
                item_id: item_id.to_owned(),
                name: st(item, "name").to_owned(),
                amount_minor: item["amountMinor"].as_i64().unwrap_or(0),
                frequency: st(item, "frequency").to_owned(),
                interval: item["interval"].as_i64().unwrap_or(1),
                start_date: first,
                end_date: item["endDate"].as_str().map(str::to_owned),
                active: item["active"] == true,
            });
        }
    }

    let dismissed = dismissed_keys(db)?;
    let all: Vec<Value> = detect_insights(today, history_start.as_deref(), &lines, &subscriptions, &payments)
        .into_iter()
        .map(|mut i| {
            let is_dismissed = dismissed.contains(st(&i, "key"));
            i["dismissed"] = json!(is_dismissed);
            i
        })
        .collect();
    let dismissed_count = all.iter().filter(|i| i["dismissed"] == true).count();
    let insights: Vec<Value> =
        if include_dismissed { all } else { all.into_iter().filter(|i| i["dismissed"] != true).collect() };
    Ok(json!({
        "today": today,
        "asOf": as_of,
        "historyStart": history_start,
        "insights": insights,
        "dismissedCount": dismissed_count,
    }))
}

pub fn dismiss_insight(db: &Db, key: &str) -> DbResult<Value> {
    if db.query_row("SELECT 1 FROM dismissed_insights WHERE key = ?", [key], |_| Ok(()))?.is_some() {
        return Err(AppError::invariant("This is already dismissed"));
    }
    let audited = with_audit(db, "Dismiss insight", None, |a| {
        a.insert("dismissed_insights", row! { "id" => new_id("dis"), "key" => key, "dismissed_at" => now_iso() })?;
        Ok(())
    })?;
    Ok(json!({ "auditGroupId": audited.audit_group_id }))
}

pub fn restore_insight(db: &Db, key: &str) -> DbResult<Value> {
    let id = db.query_row("SELECT id FROM dismissed_insights WHERE key = ?", [key], |r| r.get::<_, String>(0))?;
    let Some(id) = id else { return Err(AppError::not_found("Dismissed insight")) };
    let audited = with_audit(db, "Show insight again", None, |a| a.remove("dismissed_insights", &id))?;
    Ok(json!({ "auditGroupId": audited.audit_group_id }))
}

// ---- Likely recurring payments ----------------------------------------------------------------

pub fn suggestion_dismiss_key(key: &str) -> String {
    format!("recurring:{key}")
}

fn guess_kind(direction: &str, category_path: Option<&str>, category_group: Option<&str>) -> &'static str {
    if direction == "in" {
        return "income";
    }
    let path = category_path.unwrap_or_default().to_lowercase();
    if path.contains("subscri") {
        "subscription"
    } else if path.contains("loan") || path.contains("emi") {
        "emi"
    } else if category_group == Some("goals") {
        "savings"
    } else {
        "bill"
    }
}

/// Series of payments that look like a bill, subscription or income not yet set up as recurring.
/// Payments already matched to a recurring item, and series the user dismissed, are left out.
pub fn recurring_suggestions(db: &Db, today: &str) -> DbResult<Vec<Value>> {
    let from = add_days(today, -LOOKBACK_DAYS).map_err(|_| AppError::internal())?;
    let (_, matched) = recurring_matches(db, &from, today, today)?;
    let existing_key = |account: &str, name: &str| format!("{account}:{}", js_trim(name).to_lowercase());
    let existing: HashSet<String> =
        list_recurring(db, today)?.iter().map(|i| existing_key(st(i, "accountId"), st(i, "name"))).collect();
    let accounts: HashMap<String, Value> =
        list_accounts(db, false)?.into_iter().map(|a| (st(&a, "id").to_owned(), a)).collect();
    let categories: HashMap<String, Value> =
        list_categories(db)?.into_iter().map(|c| (st(&c, "id").to_owned(), c)).collect();
    // Splits are one payment: take each transaction once, with its own category (null when split).
    let rows = db.query_map(
        "SELECT t.id, t.account_id, t.posted_date, t.payee, m.normalized_key AS mkey, m.display_name AS mname, t.category_id, t.amount_minor
     FROM transactions t LEFT JOIN merchants m ON m.id = t.merchant_id
     WHERE t.deleted_at IS NULL AND t.kind = 'standard' AND t.posted_date >= ? AND t.posted_date <= ?",
        params![from, today],
        line_row,
    )?;
    let mut past: Vec<PastPayment> = Vec::new();
    for r in rows {
        if matched.contains(&r.id) || !accounts.contains_key(&r.account_id) {
            continue;
        }
        past.push(PastPayment {
            group_key: r.mkey.clone().unwrap_or_else(|| payee_key(&r.payee)),
            name: clean_name(r.mname.as_deref().unwrap_or(&r.payee)),
            txn_id: r.id,
            date: r.posted_date,
            amount_minor: r.amount_minor,
            account_id: r.account_id,
            category_id: r.category_id,
        });
    }
    let dismissed = dismissed_keys(db)?;
    Ok(detect_recurring(&past, today)
        .into_iter()
        .filter(|s| !dismissed.contains(&suggestion_dismiss_key(&s.key)) && !existing.contains(&existing_key(&s.account_id, &s.name)))
        .map(|s| {
            let c = s.category_id.as_deref().and_then(|id| categories.get(id));
            let path = c.map(|c| st(c, "path"));
            json!({
                "key": s.key,
                "name": s.name,
                "accountId": s.account_id,
                "categoryId": s.category_id,
                "direction": s.direction,
                "amountMinor": s.amount_minor,
                "frequency": s.frequency,
                "lastDate": s.last_date,
                "nextDate": s.next_date,
                "toleranceBp": s.tolerance_bp,
                "payments": s.payments.iter().map(|(id, date, amount)| json!({ "txnId": id, "date": date, "amountMinor": amount })).collect::<Vec<_>>(),
                "dismissKey": suggestion_dismiss_key(&s.key),
                "accountName": accounts.get(&s.account_id).map_or(Value::Null, |a| a["name"].clone()),
                "categoryPath": path,
                "suggestedKind": guess_kind(s.direction, path, c.map(|c| st(c, "group"))),
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payee_keys_and_clean_names() {
        assert_eq!(payee_key("UPI/428812349876/Swiggy & Co."), "upi swiggy & co");
        assert_eq!(payee_key("  Rent — flat 402 "), "rent flat");
        assert_eq!(clean_name("Domestic help REF428812349876 paid"), "Domestic help paid");
        assert_eq!(clean_name("428812349876"), "428812349876");
        assert_eq!(clean_name("Flat 402 rent"), "Flat 402 rent");
    }
}
