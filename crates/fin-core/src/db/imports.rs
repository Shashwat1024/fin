//! Statement import: duplicate classification, preview, commit as an undoable batch, history and
//! presets (`src/db/repos/imports.ts`). The interface parses the file; lines arrive here parsed.

use std::collections::{HashMap, HashSet};

use rusqlite::params;
use serde_json::{Map, Value, json};

use super::accounts::{assert_account_usable, get_account};
use super::audit::{AuditWriter, with_audit};
use super::categories::{assert_category_usable, resolve_merchant_id};
use super::categorization::suggest_for_lines;
use super::{Db, DbResult, new_id, now_iso};
use crate::domain::dates::add_days;
use crate::domain::import::fingerprint::{fingerprint_key, is_possible_duplicate, occurrence_indexes};
use crate::error::AppError;
use crate::row;

/// Built-in layouts for common Indian bank CSV exports, in the order the interface lists them.
const BUILTIN_PRESETS: &str = r#"[
  {"id":"builtin:hdfc","name":"HDFC Bank — savings/current","builtin":true,"mapping":{"dateOrder":"dmy","amountMode":"debit_credit","columns":{"date":"Date","description":"Narration","debit":"Withdrawal Amt.","credit":"Deposit Amt.","balance":"Closing Balance","reference":"Chq./Ref.No."}}},
  {"id":"builtin:icici","name":"ICICI Bank — savings/current","builtin":true,"mapping":{"dateOrder":"dmy","amountMode":"debit_credit","columns":{"date":"Transaction Date","description":"Transaction Remarks","debit":"Withdrawal Amount (INR )","credit":"Deposit Amount (INR )","balance":"Balance (INR )","reference":"Cheque Number"}}},
  {"id":"builtin:sbi","name":"State Bank of India — savings","builtin":true,"mapping":{"dateOrder":"dmy","amountMode":"debit_credit","columns":{"date":"Txn Date","description":"Description","debit":"Debit","credit":"Credit","balance":"Balance","reference":"Ref No./Cheque No."}}},
  {"id":"builtin:axis","name":"Axis Bank — savings","builtin":true,"mapping":{"dateOrder":"dmy","amountMode":"debit_credit","columns":{"date":"Tran Date","description":"PARTICULARS","debit":"DR","credit":"CR","balance":"BAL","reference":"CHQNO"}}},
  {"id":"builtin:kotak","name":"Kotak Mahindra Bank — savings","builtin":true,"mapping":{"dateOrder":"dmy","amountMode":"indicator","columns":{"date":"Date","description":"Description","amount":"Amount","indicator":"Dr / Cr","balance":"Balance","reference":"Chq / Ref number"}}},
  {"id":"builtin:card","name":"Credit card — purchases positive","builtin":true,"mapping":{"dateOrder":"dmy","amountMode":"single","signInverted":true,"columns":{"date":"Date","description":"Description","amount":"Amount"}}}
]"#;

struct Line {
    row_number: i64,
    date: String,
    amount_minor: i64,
    description: String,
}

fn lines_of(v: &Value) -> Vec<Line> {
    v.as_array()
        .map(|a| {
            a.iter()
                .map(|l| Line {
                    row_number: l["rowNumber"].as_i64().unwrap_or(0),
                    date: l["date"].as_str().unwrap_or_default().to_owned(),
                    amount_minor: l["amountMinor"].as_i64().unwrap_or(0),
                    description: l["description"].as_str().unwrap_or_default().to_owned(),
                })
                .collect()
        })
        .unwrap_or_default()
}

struct Classified {
    row_number: i64,
    status: &'static str,
    matched: Option<Value>,
    fingerprint: String,
    occurrence: i64,
}

struct Existing {
    id: String,
    posted_date: String,
    amount_minor: i64,
    payee: String,
    fingerprint: Option<String>,
    occurrence_index: i64,
}

impl Existing {
    fn as_match(&self) -> Value {
        json!({ "id": self.id, "postedDate": self.posted_date, "amountMinor": self.amount_minor, "payee": self.payee })
    }
}

/// Compare statement lines with the ledger. Exact: same account, fingerprint and occurrence.
/// Possible: same amount within ±2 days of a transaction no other line matched exactly.
fn classify_lines(db: &Db, account_id: &str, lines: &[Line]) -> DbResult<Vec<Classified>> {
    if lines.is_empty() {
        return Ok(Vec::new());
    }
    let keys: Vec<String> = lines.iter().map(|l| fingerprint_key(&l.date, l.amount_minor, &l.description)).collect();
    let occ = occurrence_indexes(&keys);
    let mut dates: Vec<&str> = lines.iter().map(|l| l.date.as_str()).collect();
    dates.sort();
    let from = add_days(dates[0], -2).map_err(|_| AppError::internal())?;
    let to = add_days(dates[dates.len() - 1], 2).map_err(|_| AppError::internal())?;
    let existing = db.query_map(
        "SELECT id, posted_date, amount_minor, payee, fingerprint, occurrence_index FROM transactions
     WHERE account_id = ? AND deleted_at IS NULL AND posted_date BETWEEN ? AND ?",
        params![account_id, from, to],
        |r| {
            Ok(Existing {
                id: r.get(0)?,
                posted_date: r.get(1)?,
                amount_minor: r.get(2)?,
                payee: r.get(3)?,
                fingerprint: r.get(4)?,
                occurrence_index: r.get(5)?,
            })
        },
    )?;
    // Later rows with the same key win, as in a JavaScript Map built from entries.
    let mut exact: HashMap<String, &Existing> = HashMap::new();
    for e in &existing {
        if let Some(f) = &e.fingerprint
            && !f.is_empty()
        {
            exact.insert(format!("{f}#{}", e.occurrence_index), e);
        }
    }
    let mut result: Vec<Classified> = lines
        .iter()
        .enumerate()
        .map(|(i, l)| {
            let hit = exact.get(&format!("{}#{}", keys[i], occ[i]));
            Classified {
                row_number: l.row_number,
                status: if hit.is_some() { "duplicate" } else { "new" },
                matched: hit.map(|h| h.as_match()),
                fingerprint: keys[i].clone(),
                occurrence: occ[i],
            }
        })
        .collect();
    let claimed: HashSet<String> =
        result.iter().filter_map(|r| r.matched.as_ref().and_then(|m| m["id"].as_str().map(str::to_owned))).collect();
    let mut by_amount: HashMap<i64, Vec<&Existing>> = HashMap::new();
    for e in &existing {
        if !claimed.contains(&e.id) {
            by_amount.entry(e.amount_minor).or_default().push(e);
        }
    }
    for (i, l) in lines.iter().enumerate() {
        if result[i].status != "new" {
            continue;
        }
        let near = by_amount.get(&l.amount_minor).and_then(|list| {
            list.iter().find(|e| is_possible_duplicate(&l.date, l.amount_minor, &e.posted_date, e.amount_minor))
        });
        if let Some(e) = near {
            result[i].status = "possible_duplicate";
            result[i].matched = Some(e.as_match());
        }
    }
    Ok(result)
}

fn batch_by_same_file(db: &Db, account_id: &str, file_hash: Option<&str>) -> DbResult<Value> {
    let Some(hash) = file_hash.filter(|h| !h.is_empty()) else { return Ok(Value::Null) };
    let b = db.query_row(
        "SELECT id, imported_at, undone_at FROM import_batches WHERE account_id = ? AND file_sha256 = ? ORDER BY imported_at DESC LIMIT 1",
        params![account_id, hash],
        |r| Ok(json!({ "batchId": r.get::<_, String>(0)?, "importedAt": r.get::<_, String>(1)?, "undone": r.get::<_, Option<String>>(2)?.is_some() })),
    )?;
    Ok(b.unwrap_or(Value::Null))
}

pub fn preview_import(db: &Db, input: &Value) -> DbResult<Value> {
    let account_id = input["accountId"].as_str().unwrap_or_default();
    let account = get_account(db, account_id)?;
    let lines = lines_of(&input["rows"]);
    let pairs: Vec<(String, i64)> = lines.iter().map(|l| (l.description.clone(), l.amount_minor)).collect();
    let suggestions = suggest_for_lines(db, account_id, &pairs)?;
    let rows: Vec<Value> = classify_lines(db, account_id, &lines)?
        .into_iter()
        .zip(suggestions)
        .map(|(c, (merchant, suggestion))| {
            json!({
                "rowNumber": c.row_number,
                "status": c.status,
                "match": c.matched,
                "merchant": merchant,
                // Only lines that will become new transactions need a category.
                "suggestion": if c.status == "duplicate" { Value::Null } else { suggestion.unwrap_or(Value::Null) },
            })
        })
        .collect();
    Ok(json!({
        "rows": rows,
        "sameFile": batch_by_same_file(db, account_id, input.get("fileHash").and_then(Value::as_str))?,
        "account": {
            "ledgerBalanceMinor": account["ledgerBalanceMinor"],
            "balanceMinor": account["balanceMinor"],
            "lastTxnDate": account["lastTxnDate"],
        },
    }))
}

/// `String.prototype.slice(0, n)` (UTF-16 units).
fn js_slice(s: &str, n: usize) -> String {
    let units: Vec<u16> = s.encode_utf16().take(n).collect();
    String::from_utf16_lossy(&units)
}

/// Save one statement as an import batch: new lines (and possible duplicates the user chose)
/// become transactions; every source line is stored with its outcome. One undoable change.
pub fn commit_import(db: &Db, input: &Value) -> DbResult<Value> {
    let rows = input["rows"].as_array().cloned().unwrap_or_default();
    let rejected = input["rejected"].as_array().cloned().unwrap_or_default();
    let mut seen = HashSet::new();
    if !rows.iter().chain(rejected.iter()).all(|r| seen.insert(r["rowNumber"].as_i64().unwrap_or(0))) {
        return Err(AppError::invariant("Each source line can appear only once"));
    }
    if rows.is_empty() {
        return Err(AppError::invariant("There is nothing to import from this file"));
    }
    let account_id = input["accountId"].as_str().unwrap_or_default();
    let file_name = input["fileName"].as_str().unwrap_or_default();
    let audited = with_audit(db, &format!("Import {file_name}"), None, |a| {
        assert_account_usable(db, account_id)?;
        // Re-classify here: the interface's preview may be stale.
        let lines = lines_of(&input["rows"]);
        let classified = classify_lines(db, account_id, &lines)?;
        let chosen: HashSet<i64> = input["importPossibleDuplicates"]
            .as_array()
            .map(|a| a.iter().filter_map(Value::as_i64).collect())
            .unwrap_or_default();
        let mut accepted: HashMap<i64, String> = HashMap::new();
        let mut accepted_order: Vec<String> = Vec::new();
        for c in input.get("categories").and_then(Value::as_array).cloned().unwrap_or_default() {
            let cat = c["categoryId"].as_str().unwrap_or_default().to_owned();
            if !accepted_order.contains(&cat) {
                accepted_order.push(cat.clone());
            }
            accepted.insert(c["rowNumber"].as_i64().unwrap_or(0), cat);
        }
        for cat in &accepted_order {
            assert_category_usable(db, cat)?;
        }
        let batch_id = new_id("imp");
        let now = now_iso();
        let failed = rejected.iter().filter(|r| r["status"] == "error").count() as i64;
        let ignored = rejected.iter().filter(|r| r["status"] == "ignored").count() as i64;
        let total = (rows.len() + rejected.len()) as i64;
        let closing = input.get("statementClosing").filter(|c| !c.is_null());
        a.insert(
            "import_batches",
            row! {
                "id" => batch_id,
                "account_id" => account_id,
                "file_name" => file_name,
                "file_sha256" => input.get("fileHash").cloned().unwrap_or(Value::Null),
                "mapping" => serde_json::to_string(&input["mapping"]).unwrap_or_default(),
                "imported_at" => now,
                "rows_total" => total,
                "rows_imported" => 0,
                "rows_duplicate" => 0,
                "rows_skipped" => 0,
                "rows_failed" => failed,
                "rows_ignored" => ignored,
                "statement_closing_minor" => closing.map_or(Value::Null, |c| c["balanceMinor"].clone()),
                "statement_closing_date" => closing.map_or(Value::Null, |c| c["date"].clone()),
            },
        )?;
        let write_row =
            |a: &mut AuditWriter, row_number: i64, raw: &Value, outcome: &str, message: Value, txn: Option<String>| {
                a.insert(
                    "import_rows",
                    row! {
                        "id" => new_id("imr"),
                        "batch_id" => batch_id,
                        "row_number" => row_number,
                        "raw" => serde_json::to_string(raw).unwrap_or_default(),
                        "outcome" => outcome,
                        "message" => message,
                        "transaction_id" => txn,
                    },
                )
                .map(|_| ())
            };
        let (mut imported, mut duplicate, mut skipped) = (0i64, 0i64, 0i64);
        for (i, line) in rows.iter().enumerate() {
            let c = &classified[i];
            let row_number = line["rowNumber"].as_i64().unwrap_or(0);
            let mut txn_id = None;
            let outcome = if c.status == "duplicate" {
                duplicate += 1;
                "duplicate"
            } else if c.status == "possible_duplicate" && !chosen.contains(&row_number) {
                skipped += 1;
                "possible_duplicate_skipped"
            } else {
                let description = line["description"].as_str().unwrap_or_default();
                let id = new_id("txn");
                let merchant_id = resolve_merchant_id(db, a, description)?;
                a.insert(
                    "transactions",
                    row! {
                        "id" => id,
                        "account_id" => account_id,
                        "posted_date" => line["date"],
                        "amount_minor" => line["amountMinor"],
                        "payee" => description,
                        "merchant_id" => merchant_id,
                        "category_id" => accepted.get(&row_number),
                        "import_batch_id" => batch_id,
                        "fingerprint" => c.fingerprint,
                        "occurrence_index" => c.occurrence,
                        "created_at" => now,
                        "updated_at" => now,
                    },
                )?;
                txn_id = Some(id);
                imported += 1;
                if c.status == "possible_duplicate" { "possible_duplicate_imported" } else { "imported" }
            };
            let message = c.matched.as_ref().map_or(Value::Null, |m| {
                json!(js_slice(
                    &format!(
                        "Matches {} {}",
                        m["postedDate"].as_str().unwrap_or_default(),
                        m["payee"].as_str().unwrap_or_default()
                    ),
                    500
                ))
            });
            write_row(a, row_number, &line["raw"], outcome, message, txn_id)?;
        }
        for r in &rejected {
            let outcome = if r["status"] == "error" { "failed" } else { "ignored" };
            write_row(a, r["rowNumber"].as_i64().unwrap_or(0), &r["raw"], outcome, r["message"].clone(), None)?;
        }
        a.update(
            "import_batches",
            &batch_id,
            row! { "rows_imported" => imported, "rows_duplicate" => duplicate, "rows_skipped" => skipped },
        )?;
        if let Some(name) = input.get("savePresetAs").and_then(Value::as_str) {
            save_preset_with(db, a, name, &input["mapping"])?;
        }
        Ok(json!({
            "batchId": batch_id,
            "counts": { "total": total, "imported": imported, "duplicate": duplicate, "skipped": skipped, "failed": failed, "ignored": ignored },
        }))
    })?;
    let mut out = audited.result;
    out["auditGroupId"] = json!(audited.audit_group_id);
    Ok(out)
}

pub fn list_batches(db: &Db, limit: i64) -> DbResult<Vec<Value>> {
    let rows = db.all_json(
        "SELECT b.*, a.name AS account_name,
            (SELECT COUNT(*) FROM transactions t WHERE t.import_batch_id = b.id AND t.deleted_at IS NULL) AS live_count,
            (SELECT COUNT(*) FROM transactions t WHERE t.import_batch_id = b.id AND t.deleted_at IS NULL AND t.updated_at > t.created_at) AS edited_count
     FROM import_batches b JOIN accounts a ON a.id = b.account_id
     ORDER BY b.imported_at DESC LIMIT ?",
        [limit],
    )?;
    Ok(rows
        .iter()
        .map(|b| {
            let closing = match (&b["statement_closing_minor"], b["statement_closing_date"].as_str()) {
                (m, Some(d)) if !m.is_null() && !d.is_empty() => json!({ "date": d, "balanceMinor": m }),
                _ => Value::Null,
            };
            json!({
                "id": b["id"],
                "accountId": b["account_id"],
                "accountName": b["account_name"],
                "fileName": b["file_name"],
                "importedAt": b["imported_at"],
                "counts": {
                    "total": b["rows_total"],
                    "imported": b["rows_imported"],
                    "duplicate": b["rows_duplicate"],
                    "skipped": b["rows_skipped"],
                    "failed": b["rows_failed"],
                    "ignored": b["rows_ignored"],
                },
                "statementClosing": closing,
                "undone": !b["undone_at"].is_null(),
                "liveCount": b["live_count"],
                "editedCount": b["edited_count"],
            })
        })
        .collect())
}

pub fn batch_rows(db: &Db, batch_id: &str) -> DbResult<Vec<Value>> {
    db.query_map(
        "SELECT row_number, raw, outcome, message, transaction_id FROM import_rows WHERE batch_id = ? ORDER BY row_number",
        [batch_id],
        |r| {
            let raw: String = r.get(1)?;
            Ok(json!({
                "rowNumber": r.get::<_, i64>(0)?,
                "raw": serde_json::from_str::<Value>(&raw).unwrap_or(Value::Array(vec![])),
                "outcome": r.get::<_, String>(2)?,
                "message": r.get::<_, Option<String>>(3)?,
                "transactionId": r.get::<_, Option<String>>(4)?,
            }))
        },
    )
}

/// Remove the transactions an import created. Ones edited after import are kept unless
/// `include_edited`; nothing outside the batch is touched.
pub fn undo_import(db: &Db, batch_id: &str, include_edited: bool) -> DbResult<Value> {
    let batch = db.query_row("SELECT file_name, undone_at FROM import_batches WHERE id = ?", [batch_id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
    })?;
    let Some((file_name, undone_at)) = batch else { return Err(AppError::not_found("Import")) };
    if undone_at.is_some() {
        return Err(AppError::conflict("This import was already undone"));
    }
    let audited = with_audit(db, &format!("Undo import {file_name}"), None, |a| {
        let txns = db.query_map(
            "SELECT id, updated_at > created_at AS edited FROM transactions WHERE import_batch_id = ? AND deleted_at IS NULL",
            [batch_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? != 0)),
        )?;
        let now = now_iso();
        let (mut removed, mut kept) = (0i64, 0i64);
        for (id, edited) in txns {
            if edited && !include_edited {
                kept += 1;
                continue;
            }
            a.update("transactions", &id, row! { "deleted_at" => now, "updated_at" => now })?;
            removed += 1;
        }
        a.update("import_batches", batch_id, row! { "undone_at" => now })?;
        Ok((removed, kept))
    })?;
    Ok(json!({ "removed": audited.result.0, "kept": audited.result.1, "auditGroupId": audited.audit_group_id }))
}

// ---- Presets ----------------------------------------------------------------------------------

pub fn list_presets(db: &Db) -> DbResult<Vec<Value>> {
    let mut out =
        db.query_map("SELECT id, name, mapping FROM mapping_presets ORDER BY name COLLATE NOCASE", [], |r| {
            let mapping: String = r.get(2)?;
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "name": r.get::<_, String>(1)?,
                "builtin": false,
                "mapping": serde_json::from_str::<Value>(&mapping).unwrap_or(Value::Null),
            }))
        })?;
    out.extend(serde_json::from_str::<Vec<Value>>(BUILTIN_PRESETS).expect("built-in presets are valid JSON"));
    Ok(out)
}

fn save_preset_with(db: &Db, a: &mut AuditWriter, name: &str, mapping: &Value) -> DbResult<Value> {
    let mut rest: Map<String, Value> = mapping.as_object().cloned().unwrap_or_default();
    rest.shift_remove("headerRow");
    let text = serde_json::to_string(&rest).unwrap_or_default();
    let now = now_iso();
    if let Some(id) =
        db.query_row("SELECT id FROM mapping_presets WHERE name = ? COLLATE NOCASE", [name], |r| r.get::<_, String>(0))?
    {
        a.update("mapping_presets", &id, row! { "mapping" => text, "updated_at" => now })?;
        return Ok(json!({ "id": id, "name": name, "builtin": false, "mapping": rest }));
    }
    let id = new_id("map");
    a.insert(
        "mapping_presets",
        row! { "id" => id, "name" => name, "mapping" => text, "created_at" => now, "updated_at" => now },
    )?;
    Ok(json!({ "id": id, "name": name, "builtin": false, "mapping": rest }))
}

pub fn save_preset(db: &Db, name: &str, mapping: &Value) -> DbResult<Value> {
    let audited =
        with_audit(db, &format!("Save import preset {name}"), None, |a| save_preset_with(db, a, name, mapping))?;
    Ok(json!({ "preset": audited.result, "auditGroupId": audited.audit_group_id }))
}
