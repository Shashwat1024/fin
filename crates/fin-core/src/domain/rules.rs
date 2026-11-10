//! Categorisation rules (`src/domain/rules.ts`): all conditions must hold; rules are tried in
//! priority order and the first match wins. Rules only ever suggest.

use std::cmp::Ordering;
use std::collections::HashMap;
use std::sync::Mutex;

use fancy_regex::{Regex, RegexBuilder};
use serde_json::Value;

use crate::domain::money::js_trim;

#[derive(Debug, Clone)]
pub struct Rule {
    pub id: String,
    pub name: String,
    pub priority: i64,
    pub enabled: bool,
    /// Conditions as stored (JSON), in the shape of `RuleCondition`.
    pub conditions: Vec<Value>,
    pub category_id: String,
}

/// What a rule looks at.
pub struct Subject<'a> {
    pub description: &'a str,
    pub merchant: Option<&'a str>,
    pub amount_minor: i64,
    pub account_id: &'a str,
}

/// `s.toLowerCase().replace(/\s+/g, ' ').trim()`
fn fold(s: &str) -> String {
    let lower = s.to_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut space = false;
    for c in lower.chars() {
        if c.is_whitespace() {
            space = true;
        } else {
            if space {
                out.push(' ');
                space = false;
            }
            out.push(c);
        }
    }
    if space {
        out.push(' ');
    }
    js_trim(&out).to_owned()
}

static REGEX_CACHE: Mutex<Option<HashMap<String, Option<Regex>>>> = Mutex::new(None);

/// A user pattern, case-insensitive like JavaScript's `new RegExp(p, 'i')`. Invalid patterns
/// never match (and are rejected when a rule is saved). `fancy-regex` supports the lookaround and
/// backreferences JavaScript users may write.
pub fn compile_regex(pattern: &str) -> Option<Regex> {
    let mut cache = REGEX_CACHE.lock().unwrap_or_else(|p| p.into_inner());
    cache
        .get_or_insert_with(HashMap::new)
        .entry(pattern.to_owned())
        .or_insert_with(|| RegexBuilder::new(pattern).case_insensitive(true).build().ok())
        .clone()
}

fn s<'a>(c: &'a Value, k: &str) -> &'a str {
    c.get(k).and_then(Value::as_str).unwrap_or_default()
}

pub fn condition_matches(c: &Value, subject: &Subject) -> bool {
    match s(c, "field") {
        "description" => {
            if s(c, "op") == "regex" {
                return compile_regex(s(c, "value"))
                    .is_some_and(|re| re.is_match(subject.description).unwrap_or(false));
            }
            let text = fold(subject.description);
            let v = fold(s(c, "value"));
            if v.is_empty() {
                return false;
            }
            match s(c, "op") {
                "equals" => text == v,
                "startsWith" => text.starts_with(&v),
                _ => text.contains(&v),
            }
        }
        "merchant" => {
            let Some(merchant) = subject.merchant else { return false };
            let m = fold(merchant);
            let v = fold(s(c, "value"));
            !v.is_empty() && if s(c, "op") == "equals" { m == v } else { m.contains(&v) }
        }
        "amount" => {
            let abs = subject.amount_minor.abs();
            let min = c.get("min").and_then(Value::as_i64);
            let max = c.get("max").and_then(Value::as_i64);
            min.is_none_or(|m| abs >= m) && max.is_none_or(|m| abs <= m)
        }
        "direction" => {
            if s(c, "value") == "in" {
                subject.amount_minor > 0
            } else {
                subject.amount_minor < 0
            }
        }
        "account" => subject.account_id == s(c, "value"),
        _ => false,
    }
}

pub fn rule_matches(rule: &Rule, subject: &Subject) -> bool {
    rule.enabled && !rule.conditions.is_empty() && rule.conditions.iter().all(|c| condition_matches(c, subject))
}

/// Rules in the order they are tried: priority, then name, then id.
pub fn order_rules(rules: &mut [Rule]) {
    use crate::db::transactions::locale_compare;
    rules.sort_by(|a, b| {
        a.priority
            .cmp(&b.priority)
            .then_with(|| locale_compare(&a.name, &b.name))
            .then_with(|| locale_compare(&a.id, &b.id))
    });
}

/// Problems with a rule definition, or an empty list.
pub fn validate_rule(conditions: &[Value]) -> Vec<String> {
    let mut problems = Vec::new();
    if conditions.is_empty() {
        problems.push("Add at least one condition".to_owned());
    }
    for c in conditions {
        let field = s(c, "field");
        if (field == "description" || field == "merchant") && js_trim(s(c, "value")).is_empty() {
            problems.push("A text condition is empty".to_owned());
        }
        if field == "description" && s(c, "op") == "regex" && compile_regex(s(c, "value")).is_none() {
            problems.push(format!("\"{}\" is not a valid pattern", s(c, "value")));
        }
        if field == "amount" {
            let min = c.get("min").and_then(Value::as_i64);
            let max = c.get("max").and_then(Value::as_i64);
            if min.is_none() && max.is_none() {
                problems.push("An amount condition needs a minimum or maximum".to_owned());
            }
            if let (Some(a), Some(b)) = (min, max)
                && a.cmp(&b) == Ordering::Greater
            {
                problems.push("The minimum amount is above the maximum".to_owned());
            }
        }
    }
    problems
}
