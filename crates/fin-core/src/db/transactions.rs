//! Transactions, splits, tags, transfers and search (`src/db/repos/transactions.ts`).
//! Statement order matters: it decides the order of audit entries, which undo replays.

use std::cmp::Ordering;
use std::collections::HashSet;

use rusqlite::params_from_iter;
use rusqlite::types::Value as Sql;
use serde_json::{Map, Value, json};

use super::accounts::assert_account_usable;
use super::audit::{AuditWriter, with_audit};
use super::categories::{
    UNCATEGORIZED, assert_category_usable, expand_category_ids, resolve_merchant_id, resolve_tag_ids,
};
use super::{Db, DbResult, new_id, now_iso, placeholders};
use crate::domain::ledger::validate_splits;
use crate::domain::money::{ParseResult, js_trim, parse_amount};
use crate::error::AppError;
use crate::row;

const TAG_SEP: char = '\u{1f}';

const ROW_SELECT: &str = "
  SELECT t.id, t.account_id, a.name AS account_name, a.type AS account_type, a.currency,
         t.posted_date, t.amount_minor, t.payee, m.display_name AS merchant_name, t.notes, t.category_id,
         CASE WHEN pc.name IS NOT NULL THEN pc.name || ' › ' || c.name ELSE c.name END AS category_path,
         (SELECT COUNT(*) FROM splits s WHERE s.transaction_id = t.id) AS split_count,
         (SELECT group_concat(g.name, char(31)) FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id
            WHERE tt.transaction_id = t.id) AS tag_names,
         t.kind, t.transfer_id, o.account_id AS counter_account_id, oa.name AS counter_account_name,
         t.status, t.import_batch_id, t.created_at, t.updated_at
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN categories pc ON pc.id = c.parent_id
  LEFT JOIN merchants m ON m.id = t.merchant_id
  LEFT JOIN transactions o ON o.transfer_id = t.transfer_id AND o.id <> t.id
  LEFT JOIN accounts oa ON oa.id = o.account_id";

type Row = Map<String, Value>;

/// Approximates `String.prototype.localeCompare` (ICU root collation) for tag names: letters
/// compare case- and accent-insensitively first, punctuation sorts before digits before
/// letters, and on a tie lowercase comes before uppercase.
pub fn locale_compare(a: &str, b: &str) -> Ordering {
    fn class(c: char) -> u8 {
        if c.is_alphabetic() {
            2
        } else if c.is_numeric() {
            1
        } else {
            0
        }
    }
    let primary =
        |s: &str| -> Vec<(u8, String)> { s.chars().map(|c| (class(c), c.to_lowercase().collect())).collect() };
    primary(a).cmp(&primary(b)).then_with(|| {
        let tertiary = |s: &str| -> Vec<bool> { s.chars().map(char::is_uppercase).collect() };
        tertiary(a).cmp(&tertiary(b))
    })
}

fn map_row(r: &Row) -> Value {
    let mut tags: Vec<String> =
        r["tag_names"].as_str().map(|s| s.split(TAG_SEP).map(str::to_owned).collect()).unwrap_or_default();
    tags.sort_by(|x, y| locale_compare(x, y));
    json!({
        "id": r["id"],
        "accountId": r["account_id"],
        "accountName": r["account_name"],
        "accountType": r["account_type"],
        "currency": r["currency"],
        "postedDate": r["posted_date"],
        "amountMinor": r["amount_minor"],
        "payee": r["payee"],
        "merchantName": r["merchant_name"],
        "notes": r["notes"],
        "categoryId": r["category_id"],
        "categoryPath": r["category_path"],
        "splitCount": r["split_count"],
        "tags": tags,
        "kind": r["kind"],
        "transferId": r["transfer_id"],
        "counterAccountId": r["counter_account_id"],
        "counterAccountName": r["counter_account_name"],
        "status": r["status"],
        "importBatchId": r["import_batch_id"],
    })
}

fn load_live(db: &Db, id: &str) -> DbResult<Row> {
    db.get_json("SELECT * FROM transactions WHERE id = ? AND deleted_at IS NULL", [id])?
        .ok_or_else(|| AppError::not_found("Transaction"))
}

pub fn get_transaction(db: &Db, id: &str) -> DbResult<Value> {
    let r = db
        .get_json(&format!("{ROW_SELECT} WHERE t.id = ? AND t.deleted_at IS NULL"), [id])?
        .ok_or_else(|| AppError::not_found("Transaction"))?;
    let splits = db.query_map(
        "SELECT s.id, s.category_id, s.amount_minor, s.memo,
                CASE WHEN p.name IS NOT NULL THEN p.name || ' › ' || c.name ELSE c.name END AS category_path
         FROM splits s JOIN categories c ON c.id = s.category_id LEFT JOIN categories p ON p.id = c.parent_id
         WHERE s.transaction_id = ? ORDER BY s.sort_order",
        [id],
        |s| {
            Ok(json!({
                "id": s.get::<_, String>(0)?,
                "categoryId": s.get::<_, String>(1)?,
                "categoryPath": s.get::<_, String>(4)?,
                "amountMinor": s.get::<_, i64>(2)?,
                "memo": s.get::<_, Option<String>>(3)?,
            }))
        },
    )?;
    let tag_ids =
        db.query_map("SELECT tag_id FROM transaction_tags WHERE transaction_id = ?", [id], |t| t.get::<_, String>(0))?;
    let mut out = map_row(&r);
    let o = out.as_object_mut().expect("object");
    o.insert("splits".into(), Value::Array(splits));
    o.insert("tagIds".into(), json!(tag_ids));
    o.insert("createdAt".into(), r["created_at"].clone());
    o.insert("updatedAt".into(), r["updated_at"].clone());
    Ok(out)
}

#[derive(Clone)]
struct SplitInput {
    category_id: String,
    amount_minor: i64,
    memo: Value,
}

fn splits_from(v: &Value) -> Vec<SplitInput> {
    v.as_array()
        .map(|a| {
            a.iter()
                .map(|s| SplitInput {
                    category_id: s["categoryId"].as_str().unwrap_or_default().to_owned(),
                    amount_minor: s["amountMinor"].as_i64().unwrap_or(0),
                    memo: s.get("memo").cloned().unwrap_or(Value::Null),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn check_splits(db: &Db, amount_minor: i64, splits: &[SplitInput]) -> DbResult<()> {
    let parts: Vec<i64> = splits.iter().map(|s| s.amount_minor).collect();
    if let Err((problem, remaining)) = validate_splits(amount_minor, &parts) {
        return Err(AppError::invariant(problem.message())
            .with_issues(json!({ "reason": problem.code(), "remainingMinor": remaining })));
    }
    for s in splits {
        assert_category_usable(db, &s.category_id)?;
    }
    Ok(())
}

fn write_splits(db: &Db, a: &mut AuditWriter, txn_id: &str, splits: &[SplitInput]) -> DbResult<()> {
    for id in db.query_map("SELECT id FROM splits WHERE transaction_id = ?", [txn_id], |r| r.get::<_, String>(0))? {
        a.remove("splits", &id)?;
    }
    for (i, s) in splits.iter().enumerate() {
        a.insert(
            "splits",
            row! {
                "id" => new_id("spl"),
                "transaction_id" => txn_id,
                "category_id" => s.category_id,
                "amount_minor" => s.amount_minor,
                "memo" => s.memo,
                "sort_order" => i as i64,
            },
        )?;
    }
    Ok(())
}

fn strings(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_owned)).collect())
        .unwrap_or_default()
}

fn set_tags(db: &Db, a: &mut AuditWriter, txn_id: &str, names: &[String]) -> DbResult<()> {
    let mut wanted: Vec<String> = Vec::new();
    for id in resolve_tag_ids(db, a, names)? {
        if !wanted.contains(&id) {
            wanted.push(id);
        }
    }
    let existing = db.query_map("SELECT id, tag_id FROM transaction_tags WHERE transaction_id = ?", [txn_id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })?;
    for (link_id, tag_id) in existing {
        if let Some(pos) = wanted.iter().position(|w| *w == tag_id) {
            wanted.remove(pos);
        } else {
            a.remove("transaction_tags", &link_id)?;
        }
    }
    for tag_id in wanted {
        a.insert("transaction_tags", row! { "id" => new_id("ttg"), "transaction_id" => txn_id, "tag_id" => tag_id })?;
    }
    Ok(())
}

fn str_or<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(Value::as_str)
}

pub fn create_transaction(db: &Db, input: &Value) -> DbResult<Value> {
    let audited = with_audit(db, "Add transaction", None, |a| {
        let account_id = str_or(input, "accountId").unwrap_or_default();
        assert_account_usable(db, account_id)?;
        let amount = input["amountMinor"].as_i64().unwrap_or(0);
        let splits = splits_from(input.get("splits").unwrap_or(&Value::Null));
        let category = str_or(input, "categoryId").filter(|c| !c.is_empty());
        if !splits.is_empty() {
            check_splits(db, amount, &splits)?;
        } else if let Some(c) = category {
            assert_category_usable(db, c)?;
        }
        let id = new_id("txn");
        let now = now_iso();
        let payee = str_or(input, "payee").unwrap_or("");
        let merchant_id = resolve_merchant_id(db, a, payee)?;
        a.insert(
            "transactions",
            row! {
                "id" => id,
                "account_id" => account_id,
                "posted_date" => str_or(input, "postedDate"),
                "amount_minor" => amount,
                "payee" => payee,
                "merchant_id" => merchant_id,
                "category_id" => if splits.is_empty() { input.get("categoryId").cloned().unwrap_or(Value::Null) } else { Value::Null },
                "notes" => input.get("notes").cloned().unwrap_or(Value::Null),
                "status" => str_or(input, "status").unwrap_or("cleared"),
                "created_at" => now,
                "updated_at" => now,
            },
        )?;
        if !splits.is_empty() {
            write_splits(db, a, &id, &splits)?;
        }
        let tags = strings(input.get("tags"));
        if !tags.is_empty() {
            set_tags(db, a, &id, &tags)?;
        }
        Ok(id)
    })?;
    Ok(json!({ "txn": get_transaction(db, &audited.result)?, "auditGroupId": audited.audit_group_id }))
}

const TRANSFER_LOCKED: [&str; 5] = ["accountId", "amountMinor", "postedDate", "categoryId", "splits"];

pub fn update_transaction(db: &Db, id: &str, patch: &Value) -> DbResult<Value> {
    let has = |k: &str| patch.get(k).is_some();
    let audited = with_audit(db, "Edit transaction", None, |a| {
        let cur = load_live(db, id)?;
        let cur_str = |k: &str| cur[k].as_str().unwrap_or_default().to_owned();
        if cur_str("kind") == "transfer" && TRANSFER_LOCKED.iter().any(|k| has(k)) {
            return Err(AppError::invariant(
                "Change the amount, date or accounts of a transfer from the transfer form",
            ));
        }
        if let Some(acc) = str_or(patch, "accountId")
            && acc != cur_str("account_id")
        {
            assert_account_usable(db, acc)?;
        }
        let amount =
            patch.get("amountMinor").and_then(Value::as_i64).unwrap_or(cur["amount_minor"].as_i64().unwrap_or(0));
        let existing: Vec<SplitInput> = db.query_map(
            "SELECT category_id, amount_minor, memo FROM splits WHERE transaction_id = ? ORDER BY sort_order",
            [id],
            |r| {
                Ok(SplitInput {
                    category_id: r.get(0)?,
                    amount_minor: r.get(1)?,
                    memo: r.get::<_, Option<String>>(2)?.map_or(Value::Null, Value::String),
                })
            },
        )?;
        // Choosing a single category replaces any existing split.
        let category_given = str_or(patch, "categoryId").is_some_and(|c| !c.is_empty());
        let splits = if has("splits") {
            splits_from(&patch["splits"])
        } else if category_given {
            Vec::new()
        } else {
            existing.clone()
        };
        let splits_changed = has("splits") || splits.len() != existing.len();
        if !splits.is_empty() {
            check_splits(db, amount, &splits)?;
        }
        let category_id: Value = if !splits.is_empty() {
            Value::Null
        } else if has("categoryId") {
            patch["categoryId"].clone()
        } else {
            cur["category_id"].clone()
        };
        if let Some(c) = category_id.as_str()
            && !c.is_empty()
            && category_id != cur["category_id"]
        {
            assert_category_usable(db, c)?;
        }
        let pick = |k: &str, col: &str| -> Value {
            match patch.get(k) {
                Some(Value::Null) | None => cur[col].clone(),
                Some(v) => v.clone(),
            }
        };
        let next = row! {
            "account_id" => pick("accountId", "account_id"),
            "posted_date" => pick("postedDate", "posted_date"),
            "amount_minor" => amount,
            "payee" => pick("payee", "payee"),
            "category_id" => category_id,
            "notes" => if has("notes") { patch["notes"].clone() } else { cur["notes"].clone() },
            "status" => pick("status", "status"),
        };
        let changed = next.iter().any(|(k, v)| cur.get(k) != Some(v));
        let mut update = next.clone();
        if next["payee"] != cur["payee"] && cur_str("kind") == "standard" {
            let merchant = resolve_merchant_id(db, a, next["payee"].as_str().unwrap_or_default())?;
            update.insert("merchant_id".into(), json!(merchant));
        }
        if changed {
            update.insert("updated_at".into(), json!(now_iso()));
            a.update("transactions", id, update)?;
        }
        if splits_changed {
            write_splits(db, a, id, &splits)?;
        }
        if has("tags") {
            set_tags(db, a, id, &strings(patch.get("tags")))?;
        }
        Ok(())
    })?;
    Ok(json!({ "txn": get_transaction(db, id)?, "auditGroupId": audited.audit_group_id }))
}

/// Soft-delete transactions; deleting one leg of a transfer deletes both legs.
pub fn delete_transactions(db: &Db, ids: &[String]) -> DbResult<Value> {
    let label =
        if ids.len() == 1 { "Delete transaction".to_owned() } else { format!("Delete {} transactions", ids.len()) };
    let audited = with_audit(db, &label, None, |a| {
        let mut targets: Vec<String> = Vec::new();
        let add = |id: String, targets: &mut Vec<String>| {
            if !targets.contains(&id) {
                targets.push(id);
            }
        };
        for id in ids {
            let Some(t) = db.get_json("SELECT * FROM transactions WHERE id = ? AND deleted_at IS NULL", [id])? else {
                continue;
            };
            add(t["id"].as_str().unwrap_or_default().to_owned(), &mut targets);
            if let Some(transfer_id) = t["transfer_id"].as_str() {
                for leg in db.query_map(
                    "SELECT id FROM transactions WHERE transfer_id = ? AND deleted_at IS NULL",
                    [transfer_id],
                    |r| r.get::<_, String>(0),
                )? {
                    add(leg, &mut targets);
                }
            }
        }
        if targets.is_empty() {
            return Err(AppError::not_found("Transaction"));
        }
        let now = now_iso();
        for id in &targets {
            a.update("transactions", id, row! { "deleted_at" => now, "updated_at" => now })?;
        }
        Ok(targets.len() as i64)
    })?;
    Ok(json!({ "count": audited.result, "auditGroupId": audited.audit_group_id }))
}

/// Apply a category and/or tag changes to many transactions as a single undoable change.
pub fn bulk_update(db: &Db, input: &Value) -> DbResult<Value> {
    let ids = strings(input.get("ids"));
    let audited = with_audit(db, &format!("Edit {} transactions", ids.len()), None, |a| {
        let category = input.get("categoryId");
        if let Some(c) = category.and_then(Value::as_str).filter(|c| !c.is_empty()) {
            assert_category_usable(db, c)?;
        }
        let add_tags = strings(input.get("addTags"));
        let add_tag_ids = if add_tags.is_empty() { Vec::new() } else { resolve_tag_ids(db, a, &add_tags)? };
        let remove: HashSet<String> = strings(input.get("removeTagIds")).into_iter().collect();
        let (mut count, mut skipped) = (0i64, 0i64);
        let now = now_iso();
        for id in &ids {
            let t = db.get_json(
                "SELECT t.*, (SELECT COUNT(*) FROM splits s WHERE s.transaction_id = t.id) AS splits
                 FROM transactions t WHERE t.id = ? AND t.deleted_at IS NULL",
                [id],
            )?;
            let Some(t) = t else {
                skipped += 1;
                continue;
            };
            let mut touched = false;
            if let Some(c) = category {
                // Transfers carry no category, and split transactions keep their split parts.
                if t["kind"] == "transfer" || t["splits"].as_i64().unwrap_or(0) > 0 {
                    skipped += 1;
                    continue;
                }
                if t["category_id"] != *c {
                    a.update("transactions", id, row! { "category_id" => c, "updated_at" => now })?;
                    touched = true;
                }
            }
            let current =
                db.query_map("SELECT id, tag_id FROM transaction_tags WHERE transaction_id = ?", [id], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })?;
            for (link_id, tag_id) in &current {
                if remove.contains(tag_id) {
                    a.remove("transaction_tags", link_id)?;
                    touched = true;
                }
            }
            let has: HashSet<&String> = current.iter().map(|(_, t)| t).collect();
            for tag_id in &add_tag_ids {
                if !has.contains(tag_id) {
                    a.insert(
                        "transaction_tags",
                        row! { "id" => new_id("ttg"), "transaction_id" => id, "tag_id" => tag_id },
                    )?;
                    touched = true;
                }
            }
            if touched {
                count += 1;
            }
        }
        Ok((count, skipped))
    })?;
    Ok(json!({ "count": audited.result.0, "skipped": audited.result.1, "auditGroupId": audited.audit_group_id }))
}

fn account_name(db: &Db, id: &str) -> DbResult<String> {
    db.query_row("SELECT name FROM accounts WHERE id = ?", [id], |r| r.get(0))?
        .ok_or_else(|| AppError::not_found("Account"))
}

/// A transfer is two linked legs that are exact negatives of each other.
pub fn create_transfer(db: &Db, input: &Value) -> DbResult<Value> {
    let from = str_or(input, "fromAccountId").unwrap_or_default();
    let to = str_or(input, "toAccountId").unwrap_or_default();
    if from == to {
        return Err(AppError::invariant("Choose two different accounts for a transfer"));
    }
    let audited = with_audit(db, "Add transfer", None, |a| {
        assert_account_usable(db, from)?;
        assert_account_usable(db, to)?;
        let amount = input["amountMinor"].as_i64().unwrap_or(0);
        let transfer_id = new_id("trf");
        let from_id = new_id("txn");
        let to_id = new_id("txn");
        let now = now_iso();
        a.insert(
            "transfers",
            row! { "id" => transfer_id, "from_txn_id" => from_id, "to_txn_id" => to_id, "created_at" => now },
        )?;
        let notes = input.get("notes").cloned().unwrap_or(Value::Null);
        let leg = |id: &str, account: &str, amount: i64, payee: String| {
            row! {
                "posted_date" => str_or(input, "postedDate"),
                "kind" => "transfer",
                "transfer_id" => transfer_id,
                "notes" => notes,
                "id" => id,
                "account_id" => account,
                "amount_minor" => amount,
                "payee" => payee,
                "created_at" => now,
                "updated_at" => now,
            }
        };
        let to_name = account_name(db, to)?;
        a.insert("transactions", leg(&from_id, from, -amount, format!("Transfer to {to_name}")))?;
        let from_name = account_name(db, from)?;
        a.insert("transactions", leg(&to_id, to, amount, format!("Transfer from {from_name}")))?;
        Ok((transfer_id, vec![from_id, to_id]))
    })?;
    Ok(json!({ "transferId": audited.result.0, "txnIds": audited.result.1, "auditGroupId": audited.audit_group_id }))
}

pub fn update_transfer(db: &Db, transfer_id: &str, patch: &Value) -> DbResult<Value> {
    let legs = db.query_row("SELECT from_txn_id, to_txn_id FROM transfers WHERE id = ?", [transfer_id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })?;
    let Some((from_txn, to_txn)) = legs else { return Err(AppError::not_found("Transfer")) };
    let from = load_live(db, &from_txn)?;
    let to = load_live(db, &to_txn)?;
    let from_account = str_or(patch, "fromAccountId").or(from["account_id"].as_str()).unwrap_or_default().to_owned();
    let to_account = str_or(patch, "toAccountId").or(to["account_id"].as_str()).unwrap_or_default().to_owned();
    if from_account == to_account {
        return Err(AppError::invariant("Choose two different accounts for a transfer"));
    }
    let audited = with_audit(db, "Edit transfer", None, |a| {
        if Some(from_account.as_str()) != from["account_id"].as_str() {
            assert_account_usable(db, &from_account)?;
        }
        if Some(to_account.as_str()) != to["account_id"].as_str() {
            assert_account_usable(db, &to_account)?;
        }
        let amount = patch.get("amountMinor").and_then(Value::as_i64).or(to["amount_minor"].as_i64()).unwrap_or(0);
        if amount <= 0 {
            return Err(AppError::internal());
        }
        let now = now_iso();
        let posted = str_or(patch, "postedDate").map_or_else(|| to["posted_date"].clone(), Value::from);
        let notes = if patch.get("notes").is_some() { patch["notes"].clone() } else { to["notes"].clone() };
        let to_name = account_name(db, &to_account)?;
        a.update(
            "transactions",
            from["id"].as_str().unwrap_or_default(),
            row! {
                "posted_date" => posted, "notes" => notes, "updated_at" => now,
                "account_id" => from_account, "amount_minor" => -amount, "payee" => format!("Transfer to {to_name}"),
            },
        )?;
        let from_name = account_name(db, &from_account)?;
        a.update(
            "transactions",
            to["id"].as_str().unwrap_or_default(),
            row! {
                "posted_date" => posted, "notes" => notes, "updated_at" => now,
                "account_id" => to_account, "amount_minor" => amount, "payee" => format!("Transfer from {from_name}"),
            },
        )?;
        Ok(())
    })?;
    Ok(json!({ "transferId": transfer_id, "txnIds": [from["id"], to["id"]], "auditGroupId": audited.audit_group_id }))
}

/// Free text as a safe FTS5 prefix query: each word must appear (as a prefix).
pub fn fts_query(text: &str) -> Option<String> {
    let tokens: Vec<String> = text
        .split(char::is_whitespace)
        .map(|t| t.chars().filter(|c| !"\"*^():{}[]\\+-".contains(*c)).collect::<String>())
        .map(|t| js_trim(&t).to_owned())
        .filter(|t| !t.is_empty())
        .collect();
    (!tokens.is_empty()).then(|| tokens.iter().map(|t| format!("\"{t}\"*")).collect::<Vec<_>>().join(" "))
}

fn decode_cursor(cursor: &str) -> DbResult<(String, String)> {
    let mut parts = cursor.split('|');
    let (date, id) = (parts.next().unwrap_or_default(), parts.next().unwrap_or_default());
    let date_shape = date.len() == 10
        && date.bytes().enumerate().all(|(i, b)| if i == 4 || i == 7 { b == b'-' } else { b.is_ascii_digit() });
    if date.is_empty() || id.is_empty() || !date_shape {
        return Err(AppError::invariant("Invalid cursor"));
    }
    Ok((date.to_owned(), id.to_owned()))
}

pub fn query_transactions(db: &Db, f: &Value) -> DbResult<Value> {
    let mut wh: Vec<String> = vec!["t.deleted_at IS NULL".into()];
    let mut params: Vec<Sql> = Vec::new();
    let text = str_or(f, "text").unwrap_or_default();
    if !js_trim(text).is_empty() {
        let mut clauses = Vec::new();
        if let Some(q) = fts_query(text) {
            clauses.push("t.rowid IN (SELECT rowid FROM txn_fts WHERE txn_fts MATCH ?)".to_owned());
            params.push(Sql::Text(q));
        }
        if let ParseResult::Ok(minor) = parse_amount(js_trim(text), "INR")
            && minor != 0
        {
            clauses.push("ABS(t.amount_minor) = ?".into());
            params.push(Sql::Integer(minor.abs()));
        }
        if !clauses.is_empty() {
            wh.push(format!("({})", clauses.join(" OR ")));
        }
    }
    if let Some(from) = str_or(f, "from") {
        wh.push("t.posted_date >= ?".into());
        params.push(Sql::Text(from.into()));
    }
    if let Some(to) = str_or(f, "to") {
        wh.push("t.posted_date <= ?".into());
        params.push(Sql::Text(to.into()));
    }
    let account_ids = strings(f.get("accountIds"));
    if !account_ids.is_empty() {
        wh.push(format!("t.account_id IN ({})", placeholders(account_ids.len())));
        params.extend(account_ids.into_iter().map(Sql::Text));
    }
    let requested = strings(f.get("categoryIds"));
    let mut category_ids: Vec<String> = Vec::new();
    if !requested.is_empty() {
        category_ids = expand_category_ids(db, &requested)?;
        let mut parts = Vec::new();
        if !category_ids.is_empty() {
            let ph = placeholders(category_ids.len());
            parts.push(format!("t.category_id IN ({ph})"));
            parts.push(format!(
                "EXISTS (SELECT 1 FROM splits s WHERE s.transaction_id = t.id AND s.category_id IN ({ph}))"
            ));
            params.extend(category_ids.iter().cloned().map(Sql::Text));
            params.extend(category_ids.iter().cloned().map(Sql::Text));
        }
        if requested.iter().any(|c| c == UNCATEGORIZED) {
            parts.push(
                "(t.category_id IS NULL AND t.kind = 'standard' AND NOT EXISTS (SELECT 1 FROM splits s WHERE s.transaction_id = t.id))"
                    .into(),
            );
        }
        wh.push(format!("({})", parts.join(" OR ")));
    }
    let tag_ids = strings(f.get("tagIds"));
    if !tag_ids.is_empty() {
        wh.push(format!(
            "EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = t.id AND tt.tag_id IN ({}))",
            placeholders(tag_ids.len())
        ));
        params.extend(tag_ids.into_iter().map(Sql::Text));
    }
    if let Some(min) = f.get("minAmountMinor").and_then(Value::as_i64) {
        wh.push("ABS(t.amount_minor) >= ?".into());
        params.push(Sql::Integer(min));
    }
    if let Some(max) = f.get("maxAmountMinor").and_then(Value::as_i64) {
        wh.push("ABS(t.amount_minor) <= ?".into());
        params.push(Sql::Integer(max));
    }
    match str_or(f, "direction") {
        Some("in") => wh.push("t.amount_minor > 0".into()),
        Some(_) => wh.push("t.amount_minor < 0".into()),
        None => {}
    }
    if let Some(kind) = str_or(f, "kind") {
        wh.push("t.kind = ?".into());
        params.push(Sql::Text(kind.into()));
    }
    if let Some(batch) = str_or(f, "importBatchId") {
        wh.push("t.import_batch_id = ?".into());
        params.push(Sql::Text(batch.into()));
    }
    let where_sql = wh.join(" AND ");

    // With a category filter, a split transaction contributes only its matching parts.
    let mut contribution = "t.amount_minor".to_owned();
    let mut totals_params: Vec<Sql> = Vec::new();
    if !category_ids.is_empty() {
        let ph = placeholders(category_ids.len());
        contribution = format!(
            "CASE WHEN EXISTS (SELECT 1 FROM splits s WHERE s.transaction_id = t.id)
      THEN (SELECT COALESCE(SUM(s.amount_minor), 0) FROM splits s WHERE s.transaction_id = t.id AND s.category_id IN ({ph}))
      ELSE t.amount_minor END"
        );
        totals_params.extend(category_ids.iter().cloned().map(Sql::Text));
    }
    totals_params.extend(params.iter().cloned());
    let (n, inflow, outflow) = db
        .query_row(
            &format!(
                "SELECT COUNT(*) AS n,
            SUM(CASE WHEN c > 0 THEN c ELSE 0 END) AS inflow,
            SUM(CASE WHEN c < 0 THEN c ELSE 0 END) AS outflow
     FROM (SELECT {contribution} AS c FROM transactions t WHERE {where_sql})"
            ),
            params_from_iter(totals_params),
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<i64>>(1)?, r.get::<_, Option<i64>>(2)?)),
        )?
        .unwrap_or((0, None, None));

    let mut page_where = vec![where_sql];
    let mut page_params = params;
    if let Some(cursor) = str_or(f, "cursor") {
        let (date, id) = decode_cursor(cursor)?;
        page_where.push("(t.posted_date < ? OR (t.posted_date = ? AND t.id < ?))".into());
        page_params.extend([Sql::Text(date.clone()), Sql::Text(date), Sql::Text(id)]);
    }
    let limit = f.get("limit").and_then(Value::as_i64).unwrap_or(200);
    page_params.push(Sql::Integer(limit + 1));
    let rows = db.all_json(
        &format!("{ROW_SELECT} WHERE {} ORDER BY t.posted_date DESC, t.id DESC LIMIT ?", page_where.join(" AND ")),
        params_from_iter(page_params),
    )?;
    let has_more = rows.len() as i64 > limit;
    let page: Vec<Value> = rows.iter().take(limit as usize).map(map_row).collect();
    let next_cursor = match (has_more, page.last()) {
        (true, Some(last)) => json!(format!(
            "{}|{}",
            last["postedDate"].as_str().unwrap_or_default(),
            last["id"].as_str().unwrap_or_default()
        )),
        _ => Value::Null,
    };
    let (in_minor, out_minor) = (inflow.unwrap_or(0), outflow.unwrap_or(0));
    Ok(json!({
        "rows": page,
        "nextCursor": next_cursor,
        "totals": { "count": n, "inMinor": in_minor, "outMinor": out_minor, "netMinor": in_minor + out_minor },
    }))
}

/// Recent payees matching a prefix, with the category and account most often used.
pub fn suggest_payees(db: &Db, prefix: &str, limit: usize) -> DbResult<Vec<Value>> {
    let escaped: String =
        js_trim(prefix).chars().flat_map(|c| if "\\%_".contains(c) { vec!['\\', c] } else { vec![c] }).collect();
    let rows = db.query_map(
        "SELECT payee, category_id, account_id, COUNT(*) AS n, MAX(posted_date) AS last_date
         FROM transactions
         WHERE deleted_at IS NULL AND kind = 'standard' AND payee <> '' AND payee LIKE ? ESCAPE '\\'
         GROUP BY payee COLLATE NOCASE, category_id, account_id
         ORDER BY n DESC, last_date DESC
         LIMIT 200",
        [format!("{escaped}%")],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?)),
    )?;
    let mut best: Vec<(String, Value)> = Vec::new();
    for (payee, category, account, n) in rows {
        let key = payee.to_lowercase();
        match best.iter_mut().find(|(k, _)| *k == key) {
            Some((_, cur)) => cur["count"] = json!(cur["count"].as_i64().unwrap_or(0) + n),
            None => {
                best.push((key, json!({ "payee": payee, "categoryId": category, "accountId": account, "count": n })))
            }
        }
    }
    let mut out: Vec<Value> = best.into_iter().map(|(_, v)| v).collect();
    out.sort_by(|a, b| b["count"].as_i64().cmp(&a["count"].as_i64()));
    out.truncate(limit);
    Ok(out)
}
