//! JSON and CSV export (contracts/export-json.md). Fields that existed in Fin 1.x are written exactly
//! as 1.x wrote them; 2.1 adds card cycle fields on accounts and `savedViews` (additive, format v1).

use std::collections::HashMap;

use serde_json::{Map, Value, json};

use super::migrate::current_schema_version;
use super::settings::get_settings;
use super::{Db, DbResult, now_iso};
use crate::domain::money::to_major_string;

fn group_by(rows: Vec<Map<String, Value>>, key: &str) -> HashMap<String, Vec<Map<String, Value>>> {
    let mut m: HashMap<String, Vec<Map<String, Value>>> = HashMap::new();
    for r in rows {
        m.entry(r[key].as_str().unwrap_or_default().to_owned()).or_default().push(r);
    }
    m
}

/// Full export, format v1. Soft-deleted records, the audit log and raw import lines are left out.
pub fn export_json(db: &Db) -> DbResult<Value> {
    let mut settings = get_settings(db)?;
    settings.shift_remove("backupDir");
    settings.shift_remove("onboarded");
    let splits = group_by(
        db.all_json(
            "SELECT transaction_id, category_id, amount_minor, memo FROM splits ORDER BY transaction_id, sort_order",
            [],
        )?,
        "transaction_id",
    );
    let tags = group_by(db.all_json("SELECT transaction_id, tag_id FROM transaction_tags", [])?, "transaction_id");
    let all =
        |sql: &str| -> DbResult<Vec<Value>> { Ok(db.all_json(sql, [])?.into_iter().map(Value::Object).collect()) };

    let transactions: Vec<Value> = db
        .all_json(
            "SELECT id, account_id AS accountId, posted_date AS postedDate, amount_minor AS amountMinor, payee AS payeeRaw,
              merchant_id AS merchantId, category_id AS categoryId, notes, kind, transfer_id AS transferId,
              status, import_batch_id AS importBatchId
       FROM transactions WHERE deleted_at IS NULL ORDER BY posted_date, id",
            [],
        )?
        .into_iter()
        .map(|mut t| {
            let id = t["id"].as_str().unwrap_or_default().to_owned();
            let parts: Vec<Value> = splits
                .get(&id)
                .map(|ss| {
                    ss.iter()
                        .map(|s| json!({ "categoryId": s["category_id"], "amountMinor": s["amount_minor"], "memo": s["memo"] }))
                        .collect()
                })
                .unwrap_or_default();
            let tag_ids: Vec<Value> = tags.get(&id).map(|ts| ts.iter().map(|x| x["tag_id"].clone()).collect()).unwrap_or_default();
            t.insert("splits".into(), Value::Array(parts));
            t.insert("tagIds".into(), Value::Array(tag_ids));
            Value::Object(t)
        })
        .collect();

    let recurring: Vec<Value> = db
        .all_json(
            "SELECT id, name, kind, account_id AS accountId, to_account_id AS toAccountId, category_id AS categoryId,
              amount_minor AS amountMinor, tolerance_bp AS toleranceBp, frequency, interval_count AS \"interval\",
              anchor_date AS anchorDate, end_date AS endDate, occurrences AS count, notes, active,
              set_aside AS setAside
       FROM recurring_items ORDER BY sort_order, name",
            [],
        )?
        .into_iter()
        .map(|mut r| {
            let active = r["active"] == 1;
            r.insert("active".into(), json!(active));
            let set_aside = r["setAside"] == 1;
            r.insert("setAside".into(), json!(set_aside));
            Value::Object(r)
        })
        .collect();

    let saved_views: Vec<Value> = db
        .all_json("SELECT id, name, query, pinned FROM saved_views ORDER BY sort_order, created_at", [])?
        .into_iter()
        .map(|mut v| {
            let pinned = v["pinned"] == 1;
            v.insert("pinned".into(), json!(pinned));
            Value::Object(v)
        })
        .collect();

    Ok(json!({
        "format": "fin-export",
        "version": 1,
        "exportedAt": now_iso(),
        "appSchemaVersion": current_schema_version(db)?,
        "settings": settings,
        "accounts": all("SELECT id, name, type, currency, opening_balance_minor AS openingBalanceMinor, opening_date AS openingDate,
              notes, archived_at AS archivedAt, statement_day AS statementDay, due_days_after AS dueDaysAfter,
              rate_bp AS rateBp, loan_principal_minor AS loanPrincipalMinor, tenure_months AS tenureMonths,
              first_emi_date AS firstEmiDate, deposit_kind AS depositKind, maturity_date AS maturityDate,
              installment_minor AS installmentMinor, payout_account_id AS payoutAccountId
       FROM accounts ORDER BY sort_order, name")?,
        "categories": all("SELECT id, name, parent_id AS parentId, grp AS \"group\", archived_at AS archivedAt FROM categories ORDER BY sort_order, name")?,
        "tags": all("SELECT id, name FROM tags ORDER BY name")?,
        "merchants": all("SELECT id, display_name AS name, default_category_id AS defaultCategoryId FROM merchants ORDER BY display_name")?,
        "rules": [],
        "transactions": transactions,
        "transfers": all("SELECT tr.id, tr.from_txn_id AS fromTxnId, tr.to_txn_id AS toTxnId FROM transfers tr
       WHERE EXISTS (SELECT 1 FROM transactions t WHERE t.id = tr.from_txn_id AND t.deleted_at IS NULL)")?,
        "recurringItems": recurring,
        "recurringDecisions": all("SELECT item_id AS itemId, due_date AS dueDate, state, matched_txn_id AS matchedTxnId
       FROM recurring_occurrences ORDER BY item_id, due_date")?,
        "budgets": all("SELECT month, category_id AS categoryId, assigned_minor AS assignedMinor FROM monthly_budgets ORDER BY month, category_id")?,
        "goals": all("SELECT id, name, target_minor AS targetMinor, target_date AS targetDate, linked_account_id AS linkedAccountId, notes
       FROM goals WHERE archived_at IS NULL ORDER BY sort_order, created_at")?,
        "goalContributions": all("SELECT c.id, c.goal_id AS goalId, c.date, c.amount_minor AS amountMinor, c.note
       FROM goal_contributions c JOIN goals g ON g.id = c.goal_id WHERE g.archived_at IS NULL ORDER BY c.date, c.id")?,
        "valuations": all("SELECT id, account_id AS accountId, date, value_minor AS valueMinor, note FROM valuations ORDER BY account_id, date")?,
        "dismissedInsights": all("SELECT key, dismissed_at AS dismissedAt FROM dismissed_insights ORDER BY dismissed_at, key")?,
        "savedViews": saved_views,
        "monthReviews": all("SELECT month, state, at FROM month_reviews ORDER BY month")?,
        "taxSections": all("SELECT id, code, label, limit_minor AS limitMinor, direction, note FROM tax_sections ORDER BY sort_order")?,
        "people": all("SELECT id, name, archived_at AS archivedAt FROM people ORDER BY name")?,
        "shares": all("SELECT id, person_id AS personId, date, amount_minor AS amountMinor, kind, note,
              transaction_id AS transactionId FROM shares ORDER BY date, id")?,
        "taxMappings": all("SELECT id, section_id AS sectionId, category_id AS categoryId, loan_account_id AS loanAccountId,
              loan_part AS loanPart FROM tax_mappings ORDER BY created_at, id")?,
        "importBatches": all("SELECT id, account_id AS accountId, file_name AS fileName, imported_at AS importedAt, rows_total AS rowsTotal,
              rows_imported AS rowsImported, rows_duplicate AS rowsDuplicate, rows_failed AS rowsFailed
       FROM import_batches WHERE undone_at IS NULL ORDER BY imported_at")?,
    }))
}

/// `JSON.stringify(value, null, 2)`: two-space indentation, `[]`/`{}` for empty containers.
pub fn to_js_pretty(v: &Value) -> String {
    let mut out = String::new();
    write_pretty(v, 0, &mut out);
    out
}

fn write_pretty(v: &Value, depth: usize, out: &mut String) {
    let pad = |d: usize| "  ".repeat(d);
    match v {
        Value::Array(a) if a.is_empty() => out.push_str("[]"),
        Value::Object(o) if o.is_empty() => out.push_str("{}"),
        Value::Array(a) => {
            out.push_str("[\n");
            for (i, x) in a.iter().enumerate() {
                out.push_str(&pad(depth + 1));
                write_pretty(x, depth + 1, out);
                out.push_str(if i + 1 < a.len() { ",\n" } else { "\n" });
            }
            out.push_str(&pad(depth));
            out.push(']');
        }
        Value::Object(o) => {
            out.push_str("{\n");
            for (i, (k, x)) in o.iter().enumerate() {
                out.push_str(&pad(depth + 1));
                out.push_str(&serde_json::to_string(k).unwrap_or_default());
                out.push_str(": ");
                write_pretty(x, depth + 1, out);
                out.push_str(if i + 1 < o.len() { ",\n" } else { "\n" });
            }
            out.push_str(&pad(depth));
            out.push('}');
        }
        other => out.push_str(&serde_json::to_string(other).unwrap_or_default()),
    }
}

pub const CSV_COLUMNS: [&str; 12] = [
    "date",
    "account",
    "amount",
    "currency",
    "payee",
    "merchant",
    "category",
    "subcategory",
    "tags",
    "notes",
    "kind",
    "import_batch",
];

/// Quote when needed, and stop spreadsheets running text as a formula (`= + - @` gets an apostrophe).
pub fn csv_text(value: Option<&str>) -> String {
    let mut v = value.unwrap_or_default().to_owned();
    if v.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        v.insert(0, '\'');
    }
    if v.contains(['"', ',', '\r', '\n']) { format!("\"{}\"", v.replace('"', "\"\"")) } else { v }
}

/// Transactions as CSV, amounts in rupees. A split is one line per part, so category totals add up.
pub fn export_transactions_csv(db: &Db) -> DbResult<String> {
    let cats: HashMap<String, (String, String)> = db
        .query_map(
            "SELECT c.id, c.name, p.name AS parent FROM categories c LEFT JOIN categories p ON p.id = c.parent_id",
            [],
            |r| {
                let name: String = r.get(1)?;
                Ok((
                    r.get::<_, String>(0)?,
                    match r.get::<_, Option<String>>(2)? {
                        Some(parent) => (parent, name),
                        None => (name, String::new()),
                    },
                ))
            },
        )?
        .into_iter()
        .collect();
    let splits = group_by(
        db.all_json(
            "SELECT transaction_id, category_id, amount_minor FROM splits ORDER BY transaction_id, sort_order",
            [],
        )?,
        "transaction_id",
    );
    let tags = group_by(
        db.all_json(
            "SELECT tt.transaction_id, t.name FROM transaction_tags tt JOIN tags t ON t.id = tt.tag_id ORDER BY t.name",
            [],
        )?,
        "transaction_id",
    );
    let rows = db.all_json(
        "SELECT t.id, t.posted_date, a.name AS account, t.amount_minor, a.currency, t.payee, m.display_name AS merchant,
            t.category_id, t.notes, t.kind, t.import_batch_id
     FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN merchants m ON m.id = t.merchant_id
     WHERE t.deleted_at IS NULL ORDER BY t.posted_date, t.id",
        [],
    )?;
    let mut lines = vec![CSV_COLUMNS.join(",")];
    for r in &rows {
        let id = r["id"].as_str().unwrap_or_default();
        let own = vec![(r["category_id"].as_str().map(str::to_owned), r["amount_minor"].as_i64().unwrap_or(0))];
        let parts: Vec<(Option<String>, i64)> = splits
            .get(id)
            .map(|ss| {
                ss.iter()
                    .map(|s| (s["category_id"].as_str().map(str::to_owned), s["amount_minor"].as_i64().unwrap_or(0)))
                    .collect()
            })
            .unwrap_or(own);
        let currency = r["currency"].as_str().unwrap_or("INR");
        let tag_text = tags
            .get(id)
            .map(|ts| ts.iter().map(|t| t["name"].as_str().unwrap_or_default()).collect::<Vec<_>>().join("; "))
            .unwrap_or_default();
        for (category, amount) in parts {
            let cat = category.as_ref().and_then(|c| cats.get(c));
            lines.push(
                [
                    r["posted_date"].as_str().unwrap_or_default().to_owned(),
                    csv_text(r["account"].as_str()),
                    to_major_string(amount, currency).unwrap_or_default(),
                    currency.to_owned(),
                    csv_text(r["payee"].as_str()),
                    csv_text(r["merchant"].as_str()),
                    csv_text(cat.map(|c| c.0.as_str())),
                    csv_text(cat.map(|c| c.1.as_str())),
                    csv_text(Some(&tag_text)),
                    csv_text(r["notes"].as_str()),
                    r["kind"].as_str().unwrap_or_default().to_owned(),
                    r["import_batch_id"].as_str().unwrap_or_default().to_owned(),
                ]
                .join(","),
            );
        }
    }
    // Excel opens UTF-8 CSV correctly only with a byte order mark.
    Ok(format!("\u{feff}{}\r\n", lines.join("\r\n")))
}
