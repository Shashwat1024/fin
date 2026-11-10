//! Category management, rules and suggestions (`src/db/repos/categorization.ts`).

use std::collections::{HashMap, HashSet};

use rusqlite::params;
use serde_json::{Value, json};

use super::audit::with_audit;
use super::categories::list_categories;
use super::{Db, DbResult, new_id, now_iso};
use crate::domain::import::narration::{merchant_key, merchant_name};
use crate::domain::rules::{Rule, Subject, order_rules, rule_matches, validate_rule};
use crate::error::{AppError, ErrorCode};
use crate::row;

fn s<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(Value::as_str)
}

fn category(db: &Db, id: &str) -> DbResult<Value> {
    list_categories(db)?.into_iter().find(|c| c["id"] == id).ok_or_else(|| AppError::not_found("Category"))
}

fn unique_name<T>(r: DbResult<T>) -> DbResult<T> {
    r.map_err(|e| {
        let d = e.detail.as_deref().unwrap_or_default();
        if e.code == ErrorCode::Internal
            && (d.contains("UNIQUE constraint failed: categories")
                || d.contains("UNIQUE constraint failed: index 'categories_"))
        {
            AppError::conflict("A category with this name already exists here")
        } else {
            e
        }
    })
}

fn assert_parent(db: &Db, parent_id: &str, self_id: Option<&str>) -> DbResult<Value> {
    let parent = category(db, parent_id)?;
    if Some(parent["id"].as_str().unwrap_or_default()) == self_id {
        return Err(AppError::invariant("A category cannot be inside itself"));
    }
    if !parent["parentId"].is_null() {
        return Err(AppError::invariant("Categories go two levels deep: choose a top-level category as the parent"));
    }
    if parent["archived"] == true {
        return Err(AppError::invariant("That category is archived"));
    }
    Ok(parent)
}

pub fn create_category(db: &Db, input: &Value) -> DbResult<Value> {
    let parent_id = s(input, "parentId").filter(|p| !p.is_empty());
    let parent = match parent_id {
        Some(p) => Some(assert_parent(db, p, None)?),
        None => None,
    };
    let group = s(input, "group")
        .map(str::to_owned)
        .or_else(|| parent.as_ref().and_then(|p| p["group"].as_str().map(str::to_owned)))
        .unwrap_or_else(|| "wants".into());
    let name = s(input, "name").unwrap_or_default();
    let audited = unique_name(with_audit(db, &format!("Add category {name}"), None, |a| {
        let id = new_id("cat");
        let now = now_iso();
        let order: i64 = db
            .query_row("SELECT MAX(sort_order) FROM categories WHERE parent_id IS ?", [parent_id], |r| {
                r.get::<_, Option<i64>>(0)
            })?
            .flatten()
            .unwrap_or(-1);
        a.insert(
            "categories",
            row! {
                "id" => id, "name" => name, "parent_id" => parent_id, "grp" => group,
                "sort_order" => order + 1, "created_at" => now, "updated_at" => now,
            },
        )?;
        Ok(id)
    }))?;
    Ok(json!({ "category": category(db, &audited.result)?, "auditGroupId": audited.audit_group_id }))
}

/// Rename, move (two levels at most) or regroup. Moving a parent's group moves its children too.
pub fn update_category(db: &Db, input: &Value) -> DbResult<Value> {
    let id = s(input, "id").unwrap_or_default();
    let cur = category(db, id)?;
    let cur_parent = cur["parentId"].as_str().map(str::to_owned);
    let children: Vec<Value> = list_categories(db)?.into_iter().filter(|c| c["parentId"] == cur["id"]).collect();
    let parent_id: Option<String> =
        if input.get("parentId").is_some() { s(input, "parentId").map(str::to_owned) } else { cur_parent.clone() };
    if let Some(p) = parent_id.as_deref().filter(|p| !p.is_empty())
        && Some(p) != cur_parent.as_deref()
    {
        assert_parent(db, p, Some(id))?;
        if !children.is_empty() {
            return Err(AppError::invariant("This category has subcategories, so it has to stay at the top level"));
        }
    }
    let name = s(input, "name").or(s(&cur, "name")).unwrap_or_default().to_owned();
    let cur_group = s(&cur, "group").unwrap_or_default().to_owned();
    let group = s(input, "group").map(str::to_owned).unwrap_or_else(|| cur_group.clone());
    let audited = unique_name(with_audit(db, &format!("Edit category {name}"), None, |a| {
        a.update(
            "categories",
            id,
            row! { "name" => name, "parent_id" => parent_id, "grp" => group, "updated_at" => now_iso() },
        )?;
        if let Some(new_group) = s(input, "group").filter(|g| *g != cur_group) {
            for c in &children {
                if c["group"] == cur_group.as_str() {
                    a.update(
                        "categories",
                        c["id"].as_str().unwrap_or_default(),
                        row! { "grp" => new_group, "updated_at" => now_iso() },
                    )?;
                }
            }
        }
        Ok(())
    }))?;
    Ok(json!({ "category": category(db, id)?, "auditGroupId": audited.audit_group_id }))
}

fn count(db: &Db, sql: &str, id: &str) -> DbResult<i64> {
    Ok(db.query_row(sql, [id], |r| r.get::<_, i64>(0))?.unwrap_or(0))
}

pub fn category_usage(db: &Db, id: &str) -> DbResult<Value> {
    Ok(json!({
        "transactions": count(db, "SELECT COUNT(*) FROM transactions WHERE category_id = ? AND deleted_at IS NULL", id)?,
        "splits": count(db, "SELECT COUNT(*) FROM splits s JOIN transactions t ON t.id = s.transaction_id WHERE s.category_id = ? AND t.deleted_at IS NULL", id)?,
        "budgets": count(db, "SELECT COUNT(*) FROM monthly_budgets WHERE category_id = ?", id)?,
        "recurring": count(db, "SELECT COUNT(*) FROM recurring_items WHERE category_id = ?", id)?,
        "rules": count(db, "SELECT COUNT(*) FROM rules WHERE category_id = ?", id)?,
        "children": count(db, "SELECT COUNT(*) FROM categories WHERE parent_id = ?", id)?,
    }))
}

fn ids(db: &Db, sql: &str, id: &str) -> DbResult<Vec<String>> {
    db.query_map(sql, [id], |r| r.get::<_, String>(0))
}

/// Delete a category. If anything uses it (including deleted transactions kept for undo), a
/// replacement is required and everything moves there first: this is also how categories merge.
pub fn delete_category(db: &Db, id: &str, replacement_id: Option<&str>) -> DbResult<Value> {
    let cur = category(db, id)?;
    let usage = category_usage(db, id)?;
    if usage["children"].as_i64().unwrap_or(0) > 0 {
        return Err(AppError::invariant("Move or delete its subcategories first"));
    }
    let refs = count(
        db,
        "SELECT (SELECT COUNT(*) FROM transactions WHERE category_id = ?1) + (SELECT COUNT(*) FROM splits WHERE category_id = ?1)
            + (SELECT COUNT(*) FROM monthly_budgets WHERE category_id = ?1) + (SELECT COUNT(*) FROM recurring_items WHERE category_id = ?1)
            + (SELECT COUNT(*) FROM rules WHERE category_id = ?1) + (SELECT COUNT(*) FROM merchants WHERE default_category_id = ?1) AS n",
        id,
    )?;
    let mut target: Option<Value> = None;
    if refs > 0 {
        let Some(rep) = replacement_id.filter(|r| !r.is_empty()) else {
            return Err(AppError::invariant("This category is in use. Choose a category to move its transactions to."));
        };
        if rep == id {
            return Err(AppError::invariant("Choose a different category"));
        }
        let t = category(db, rep)?;
        if t["archived"] == true {
            return Err(AppError::invariant("That category is archived"));
        }
        target = Some(t);
    }
    let path = s(&cur, "path").unwrap_or_default();
    let label = match &target {
        Some(t) => format!("Merge {path} into {}", s(t, "path").unwrap_or_default()),
        None => format!("Delete category {path}"),
    };
    let audited = with_audit(db, &label, None, |a| {
        let mut moved = 0i64;
        if let Some(t) = &target {
            let tid = s(t, "id").unwrap_or_default();
            let now = now_iso();
            for x in ids(db, "SELECT id FROM transactions WHERE category_id = ?", id)? {
                a.update("transactions", &x, row! { "category_id" => tid, "updated_at" => now })?;
                moved += 1;
            }
            for x in ids(db, "SELECT id FROM splits WHERE category_id = ?", id)? {
                a.update("splits", &x, row! { "category_id" => tid })?;
                moved += 1;
            }
            let budgets = db.query_map(
                "SELECT id, month, assigned_minor FROM monthly_budgets WHERE category_id = ?",
                [id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)),
            )?;
            for (bid, month, assigned) in budgets {
                let other = db.query_row(
                    "SELECT id, assigned_minor FROM monthly_budgets WHERE category_id = ? AND month = ?",
                    params![tid, month],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
                )?;
                match other {
                    Some((oid, oa)) => {
                        a.update(
                            "monthly_budgets",
                            &oid,
                            row! { "assigned_minor" => oa + assigned, "updated_at" => now },
                        )?;
                        a.remove("monthly_budgets", &bid)?;
                    }
                    None => {
                        a.update("monthly_budgets", &bid, row! { "category_id" => tid, "updated_at" => now })?;
                    }
                }
            }
            for x in ids(db, "SELECT id FROM recurring_items WHERE category_id = ?", id)? {
                a.update("recurring_items", &x, row! { "category_id" => tid, "updated_at" => now })?;
            }
            for x in ids(db, "SELECT id FROM rules WHERE category_id = ?", id)? {
                a.update("rules", &x, row! { "category_id" => tid, "updated_at" => now })?;
            }
            for x in ids(db, "SELECT id FROM merchants WHERE default_category_id = ?", id)? {
                a.update("merchants", &x, row! { "default_category_id" => tid, "updated_at" => now })?;
            }
        }
        a.remove("categories", id)?;
        Ok(moved)
    })?;
    Ok(json!({ "moved": audited.result, "auditGroupId": audited.audit_group_id }))
}

// ---- Rules ------------------------------------------------------------------------------------

pub fn load_rules(db: &Db) -> DbResult<Vec<Rule>> {
    let mut rules =
        db.query_map("SELECT id, name, priority, enabled, conditions, category_id FROM rules", [], |r| {
            Ok(Rule {
                id: r.get(0)?,
                name: r.get(1)?,
                priority: r.get(2)?,
                enabled: r.get::<_, i64>(3)? == 1,
                conditions: serde_json::from_str::<Vec<Value>>(&r.get::<_, String>(4)?).unwrap_or_default(),
                category_id: r.get(5)?,
            })
        })?;
    order_rules(&mut rules);
    Ok(rules)
}

fn rule_dto(r: &Rule, paths: &HashMap<String, String>) -> Value {
    json!({
        "id": r.id,
        "name": r.name,
        "priority": r.priority,
        "enabled": r.enabled,
        "conditions": r.conditions,
        "categoryId": r.category_id,
        "categoryPath": paths.get(&r.category_id).cloned().unwrap_or_else(|| "Deleted category".into()),
    })
}

fn category_paths(db: &Db) -> DbResult<HashMap<String, String>> {
    Ok(list_categories(db)?
        .into_iter()
        .map(|c| (c["id"].as_str().unwrap_or_default().to_owned(), c["path"].as_str().unwrap_or_default().to_owned()))
        .collect())
}

pub fn list_rules(db: &Db) -> DbResult<Vec<Value>> {
    let paths = category_paths(db)?;
    Ok(load_rules(db)?.iter().map(|r| rule_dto(r, &paths)).collect())
}

fn find_rule_dto(db: &Db, id: &str) -> DbResult<Value> {
    list_rules(db)?.into_iter().find(|r| r["id"] == id).ok_or_else(|| AppError::not_found("Rule"))
}

fn rule_fields(db: &Db, input: &Value) -> DbResult<serde_json::Map<String, Value>> {
    let conditions = input["conditions"].as_array().cloned().unwrap_or_default();
    if let Some(p) = validate_rule(&conditions).into_iter().next() {
        return Err(AppError::invariant(p));
    }
    let category_id = s(input, "categoryId").unwrap_or_default();
    if category(db, category_id)?["archived"] == true {
        return Err(AppError::invariant("That category is archived"));
    }
    for c in &conditions {
        if s(c, "field") == Some("account")
            && db
                .query_row("SELECT 1 FROM accounts WHERE id = ?", [s(c, "value").unwrap_or_default()], |_| Ok(()))?
                .is_none()
        {
            return Err(AppError::not_found("Account"));
        }
    }
    Ok(row! {
        "name" => s(input, "name"),
        "priority" => input.get("priority").and_then(Value::as_i64).unwrap_or(100),
        "enabled" => if input.get("enabled") == Some(&Value::Bool(false)) { 0 } else { 1 },
        "conditions" => serde_json::to_string(&conditions).unwrap_or_default(),
        "category_id" => category_id,
    })
}

pub fn create_rule(db: &Db, input: &Value) -> DbResult<Value> {
    let fields = rule_fields(db, input)?;
    let audited = with_audit(db, &format!("Add rule {}", s(input, "name").unwrap_or_default()), None, |a| {
        let id = new_id("rule");
        let now = now_iso();
        let mut row = row! { "id" => id };
        row.extend(fields.clone());
        row.insert("created_at".into(), json!(now));
        row.insert("updated_at".into(), json!(now));
        a.insert("rules", row)?;
        Ok(id)
    })?;
    Ok(json!({ "rule": find_rule_dto(db, &audited.result)?, "auditGroupId": audited.audit_group_id }))
}

pub fn update_rule(db: &Db, id: &str, input: &Value) -> DbResult<Value> {
    find_rule_dto(db, id)?;
    let mut fields = rule_fields(db, input)?;
    let audited = with_audit(db, &format!("Edit rule {}", s(input, "name").unwrap_or_default()), None, |a| {
        fields.insert("updated_at".into(), json!(now_iso()));
        a.update("rules", id, fields.clone())?;
        Ok(())
    })?;
    Ok(json!({ "rule": find_rule_dto(db, id)?, "auditGroupId": audited.audit_group_id }))
}

pub fn delete_rule(db: &Db, id: &str) -> DbResult<Value> {
    let r = find_rule_dto(db, id)?;
    let audited =
        with_audit(db, &format!("Delete rule {}", s(&r, "name").unwrap_or_default()), None, |a| a.remove("rules", id))?;
    Ok(json!({ "auditGroupId": audited.audit_group_id }))
}

/// Standard, unsplit, live transactions: the only ones a rule may recategorise.
const HISTORY: &str = "
  SELECT t.id, t.posted_date, t.amount_minor, t.payee, t.account_id, a.name AS account_name, t.category_id,
         CASE WHEN p.name IS NULL THEN c.name ELSE p.name || ' › ' || c.name END AS category_path, m.display_name AS merchant_name, t.merchant_id
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN categories p ON p.id = c.parent_id
  LEFT JOIN merchants m ON m.id = t.merchant_id
  WHERE t.deleted_at IS NULL AND t.kind = 'standard' AND NOT EXISTS (SELECT 1 FROM splits s WHERE s.transaction_id = t.id)";

struct History {
    id: String,
    posted_date: String,
    amount_minor: i64,
    payee: String,
    account_id: String,
    account_name: String,
    category_id: Option<String>,
    category_path: Option<String>,
    merchant_name: Option<String>,
    merchant_id: Option<String>,
}

fn history(db: &Db, sql: &str, param: Option<String>) -> DbResult<Vec<History>> {
    let map = |r: &rusqlite::Row| {
        Ok(History {
            id: r.get(0)?,
            posted_date: r.get(1)?,
            amount_minor: r.get(2)?,
            payee: r.get(3)?,
            account_id: r.get(4)?,
            account_name: r.get(5)?,
            category_id: r.get(6)?,
            category_path: r.get(7)?,
            merchant_name: r.get(8)?,
            merchant_id: r.get(9)?,
        })
    };
    match param {
        Some(p) => db.query_map(sql, [p], map),
        None => db.query_map(sql, [], map),
    }
}

impl History {
    fn subject(&self) -> Subject<'_> {
        Subject {
            description: &self.payee,
            merchant: self.merchant_name.as_deref(),
            amount_minor: self.amount_minor,
            account_id: &self.account_id,
        }
    }
}

const PREVIEW_LIMIT: usize = 500;

/// What applying a rule to past transactions would change; nothing is changed here.
pub fn preview_rule(db: &Db, rule: &Rule, only_uncategorized: bool) -> DbResult<Value> {
    let mut r = rule.clone();
    r.enabled = true;
    let rows: Vec<History> = history(db, &format!("{HISTORY} ORDER BY t.posted_date DESC, t.id DESC"), None)?
        .into_iter()
        .filter(|t| {
            t.category_id.as_deref() != Some(r.category_id.as_str())
                && (!only_uncategorized || t.category_id.is_none())
                && rule_matches(&r, &t.subject())
        })
        .collect();
    Ok(json!({
        "count": rows.len(),
        "matches": rows.iter().take(PREVIEW_LIMIT).map(|t| json!({
            "id": t.id,
            "postedDate": t.posted_date,
            "amountMinor": t.amount_minor,
            "payee": t.payee,
            "accountName": t.account_name,
            "categoryPath": t.category_path,
        })).collect::<Vec<_>>(),
    }))
}

pub fn preview_saved_rule(db: &Db, rule_id: &str, only_uncategorized: bool) -> DbResult<Value> {
    let r = load_rules(db)?.into_iter().find(|x| x.id == rule_id).ok_or_else(|| AppError::not_found("Rule"))?;
    preview_rule(db, &r, only_uncategorized)
}

pub fn draft_rule(input: &Value) -> Rule {
    Rule {
        id: "draft".into(),
        name: s(input, "name").unwrap_or_default().to_owned(),
        priority: input.get("priority").and_then(Value::as_i64).unwrap_or(100),
        enabled: true,
        conditions: input["conditions"].as_array().cloned().unwrap_or_default(),
        category_id: s(input, "categoryId").unwrap_or_default().to_owned(),
    }
}

/// Apply a rule to the transactions the user confirmed. Each is re-checked; one undoable change.
pub fn apply_rule(db: &Db, rule_id: &str, txn_ids: &[String]) -> DbResult<Value> {
    let rule = load_rules(db)?.into_iter().find(|x| x.id == rule_id).ok_or_else(|| AppError::not_found("Rule"))?;
    if category(db, &rule.category_id)?["archived"] == true {
        return Err(AppError::invariant("The rule’s category is archived"));
    }
    let mut wanted: Vec<String> = Vec::new();
    for id in txn_ids {
        if !wanted.contains(id) {
            wanted.push(id.clone());
        }
    }
    let label = format!("Apply rule {} to {} transactions", rule.name, txn_ids.len());
    let audited = with_audit(db, &label, None, |a| {
        let mut count = 0i64;
        let now = now_iso();
        let mut enabled = rule.clone();
        enabled.enabled = true;
        let rows = history(
            db,
            &format!("{HISTORY} AND t.id IN (SELECT value FROM json_each(?))"),
            Some(serde_json::to_string(&wanted).unwrap_or_default()),
        )?;
        for t in rows {
            if t.category_id.as_deref() == Some(rule.category_id.as_str()) || !rule_matches(&enabled, &t.subject()) {
                continue;
            }
            a.update("transactions", &t.id, row! { "category_id" => rule.category_id, "updated_at" => now })?;
            count += 1;
        }
        Ok((count, wanted.len() as i64 - count))
    })?;
    Ok(json!({ "count": audited.result.0, "skipped": audited.result.1, "auditGroupId": audited.audit_group_id }))
}

// ---- Suggestions ------------------------------------------------------------------------------

/// The category chosen most often for each merchant, per direction, from unsplit transactions.
/// Ties go to the most recent choice. Keyed `merchantId:dir`.
fn learned_categories(db: &Db, merchant_ids: &[String]) -> DbResult<HashMap<String, (String, i64)>> {
    if merchant_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let mut unique: Vec<&String> = Vec::new();
    for m in merchant_ids {
        if !unique.contains(&m) {
            unique.push(m);
        }
    }
    let rows = db.query_map(
        "SELECT t.merchant_id, t.amount_minor > 0 AS dir, t.category_id, COUNT(*) AS n, MAX(t.posted_date || t.id) AS last
         FROM transactions t JOIN categories c ON c.id = t.category_id AND c.archived_at IS NULL
         WHERE t.deleted_at IS NULL AND t.kind = 'standard' AND t.merchant_id IN (SELECT value FROM json_each(?))
         GROUP BY t.merchant_id, dir, t.category_id
         ORDER BY n DESC, last DESC",
        [serde_json::to_string(&unique).unwrap_or_default()],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?)),
    )?;
    let mut out = HashMap::new();
    for (m, dir, cat, n) in rows {
        out.entry(format!("{m}:{dir}")).or_insert((cat, n));
    }
    Ok(out)
}

pub struct LineSubject {
    pub description: String,
    pub merchant: Option<String>,
    pub amount_minor: i64,
    pub account_id: String,
    pub merchant_id: Option<String>,
}

/// Rules first (in priority order), then what the user chose before for the same merchant.
fn suggest_all(db: &Db, subjects: &[LineSubject]) -> DbResult<Vec<Option<Value>>> {
    let rules: Vec<Rule> = load_rules(db)?.into_iter().filter(|r| r.enabled).collect();
    let categories: HashMap<String, Value> =
        list_categories(db)?.into_iter().map(|c| (c["id"].as_str().unwrap_or_default().to_owned(), c)).collect();
    let merchant_ids: Vec<String> = subjects.iter().filter_map(|s| s.merchant_id.clone()).collect();
    let learned = learned_categories(db, &merchant_ids)?;
    Ok(subjects
        .iter()
        .map(|sub| {
            let subject = Subject {
                description: &sub.description,
                merchant: sub.merchant.as_deref(),
                amount_minor: sub.amount_minor,
                account_id: &sub.account_id,
            };
            let rule = rules.iter().find(|r| {
                rule_matches(r, &subject) && categories.get(&r.category_id).is_none_or(|c| c["archived"] != true)
            });
            if let Some(r) = rule {
                return Some(json!({
                    "categoryId": r.category_id,
                    "categoryPath": categories.get(&r.category_id).map(|c| c["path"].clone()).unwrap_or(Value::Null),
                    "source": "rule",
                    "reason": format!("Rule: {}", r.name),
                    "ruleId": r.id,
                }));
            }
            let dir = if sub.amount_minor > 0 { 1 } else { 0 };
            let l = sub.merchant_id.as_ref().and_then(|m| learned.get(&format!("{m}:{dir}")));
            match (l, sub.merchant.as_deref()) {
                (Some((cat, n)), Some(merchant)) => {
                    let times = if *n == 1 { "once".to_owned() } else { format!("{n} times") };
                    Some(json!({
                        "categoryId": cat,
                        "categoryPath": categories.get(cat).map(|c| c["path"].clone()).unwrap_or(Value::Null),
                        "source": "merchant",
                        "reason": format!("You chose this for {merchant} {times}"),
                        "ruleId": Value::Null,
                    }))
                }
                _ => None,
            }
        })
        .collect())
}

/// Suggestions for uncategorised transactions (split, transfer and categorised ones are skipped).
pub fn suggest_for_txns(db: &Db, txn_ids: &[String]) -> DbResult<Vec<Value>> {
    if txn_ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows = history(
        db,
        &format!("{HISTORY}\n     AND t.category_id IS NULL AND t.id IN (SELECT value FROM json_each(?))"),
        Some(serde_json::to_string(txn_ids).unwrap_or_default()),
    )?;
    let subjects: Vec<LineSubject> = rows
        .iter()
        .map(|r| LineSubject {
            description: r.payee.clone(),
            merchant: r.merchant_name.clone(),
            amount_minor: r.amount_minor,
            account_id: r.account_id.clone(),
            merchant_id: r.merchant_id.clone(),
        })
        .collect();
    let suggestions = suggest_all(db, &subjects)?;
    Ok(rows
        .iter()
        .zip(suggestions)
        .filter_map(|(r, sug)| {
            sug.map(|mut v| {
                v["txnId"] = json!(r.id);
                v
            })
        })
        .collect())
}

/// Suggestions for statement lines not in the ledger yet (import preview).
pub fn suggest_for_lines(
    db: &Db,
    account_id: &str,
    lines: &[(String, i64)],
) -> DbResult<Vec<(Option<String>, Option<Value>)>> {
    let by_key: HashMap<String, String> = db
        .query_map("SELECT id, normalized_key FROM merchants", [], |r| {
            Ok((r.get::<_, String>(1)?, r.get::<_, String>(0)?))
        })?
        .into_iter()
        .collect();
    let subjects: Vec<LineSubject> = lines
        .iter()
        .map(|(description, amount)| {
            let merchant = merchant_name(description);
            let merchant_id = merchant.as_ref().and_then(|m| by_key.get(&merchant_key(m)).cloned());
            LineSubject {
                description: description.clone(),
                merchant,
                amount_minor: *amount,
                account_id: account_id.to_owned(),
                merchant_id,
            }
        })
        .collect();
    let suggestions = suggest_all(db, &subjects)?;
    Ok(subjects.into_iter().zip(suggestions).map(|(s, sug)| (s.merchant, sug)).collect())
}

/// Ids appear once each, keeping their first position.
pub fn dedupe(ids: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    ids.iter().filter(|i| seen.insert((*i).clone())).cloned().collect()
}
