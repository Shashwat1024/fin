//! Audit trail and undo (Constitution III), a port of `src/db/audit.ts`. Rows are stored as JSON
//! in column order, exactly as the TypeScript backend writes them, so a change made by either
//! backend can be undone by the other.

use std::collections::HashMap;

use rusqlite::params;
use rusqlite::params_from_iter;
use serde_json::{Map, Value};

use super::{Db, DbResult, json_to_sql, new_id, now_iso};
use crate::error::AppError;

/// Tables whose rows are audited and can be restored by undo.
const AUDITED: &[&str] = &[
    "accounts",
    "categories",
    "merchants",
    "tags",
    "transactions",
    "splits",
    "transaction_tags",
    "transfers",
    "import_batches",
    "import_rows",
    "mapping_presets",
    "recurring_items",
    "recurring_occurrences",
    "monthly_budgets",
    "goals",
    "goal_contributions",
    "rules",
    "valuations",
    "dismissed_insights",
];

pub type Row = Map<String, Value>;

fn columns(db: &Db, table: &str) -> DbResult<Vec<String>> {
    if !AUDITED.contains(&table) {
        return Err(internal(format!("Table {table} is not audited")));
    }
    db.query_map(&format!("PRAGMA table_info({table})"), [], |r| r.get::<_, String>(1))
}

fn internal(detail: String) -> AppError {
    let mut e = AppError::internal();
    e.detail = Some(detail);
    e
}

fn check_keys(db: &Db, table: &str, row: &Row) -> DbResult<Vec<String>> {
    let cols = columns(db, table)?;
    for k in row.keys() {
        if !cols.contains(k) {
            return Err(internal(format!("Unknown column {table}.{k}")));
        }
    }
    Ok(row.keys().cloned().collect())
}

pub fn read_row(db: &Db, table: &str, id: &str) -> DbResult<Option<Row>> {
    columns(db, table)?;
    db.get_json(&format!("SELECT * FROM {table} WHERE id = ?"), [id])
}

/// Records every write it performs so the whole group can be undone.
pub struct AuditWriter<'a> {
    db: &'a Db,
    pub group_id: String,
    seq: i64,
}

impl AuditWriter<'_> {
    fn log(
        &mut self,
        action: &str,
        entity: &str,
        entity_id: &str,
        before: Option<&Row>,
        after: Option<&Row>,
    ) -> DbResult<()> {
        let json = |r: Option<&Row>| r.map(|r| serde_json::to_string(r).unwrap_or_default());
        self.db.run(
            "INSERT INTO audit_log (id, group_id, seq, action, entity, entity_id, before, after) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![new_id("aud"), self.group_id, self.seq, action, entity, entity_id, json(before), json(after)],
        )?;
        self.seq += 1;
        Ok(())
    }

    pub fn insert(&mut self, table: &str, row: Row) -> DbResult<Row> {
        let id = row.get("id").and_then(Value::as_str).unwrap_or_default().to_owned();
        let keys = check_keys(self.db, table, &row)?;
        let sql = format!("INSERT INTO {table} ({}) VALUES ({})", keys.join(", "), super::placeholders(keys.len()));
        self.db.run(&sql, params_from_iter(keys.iter().map(|k| json_to_sql(&row[k]))))?;
        let after = read_row(self.db, table, &id)?.ok_or_else(|| AppError::not_found(table))?;
        self.log("insert", table, &id, None, Some(&after))?;
        Ok(after)
    }

    pub fn update(&mut self, table: &str, id: &str, patch: Row) -> DbResult<Row> {
        let Some(before) = read_row(self.db, table, id)? else {
            return Err(AppError::not_found(table));
        };
        let keys: Vec<String> = check_keys(self.db, table, &patch)?
            .into_iter()
            .filter(|k| k != "id" && before.get(k) != patch.get(k))
            .collect();
        if keys.is_empty() {
            return Ok(before);
        }
        let sql = format!(
            "UPDATE {table} SET {} WHERE id = ?",
            keys.iter().map(|k| format!("{k} = ?")).collect::<Vec<_>>().join(", ")
        );
        let mut values: Vec<rusqlite::types::Value> = keys.iter().map(|k| json_to_sql(&patch[k])).collect();
        values.push(rusqlite::types::Value::Text(id.to_owned()));
        self.db.run(&sql, params_from_iter(values))?;
        let after = read_row(self.db, table, id)?.ok_or_else(|| AppError::not_found(table))?;
        self.log("update", table, id, Some(&before), Some(&after))?;
        Ok(after)
    }

    pub fn remove(&mut self, table: &str, id: &str) -> DbResult<()> {
        let Some(before) = read_row(self.db, table, id)? else { return Ok(()) };
        self.db.run(&format!("DELETE FROM {table} WHERE id = ?"), [id])?;
        self.log("delete", table, id, Some(&before), None)
    }
}

pub struct Audited<T> {
    pub result: T,
    pub audit_group_id: String,
}

/// Run `f` atomically under a new audit group.
pub fn with_audit<T>(
    db: &Db,
    label: &str,
    undo_of: Option<&str>,
    f: impl FnOnce(&mut AuditWriter) -> DbResult<T>,
) -> DbResult<Audited<T>> {
    db.transaction(|| {
        let group_id = new_id("grp");
        db.run(
            "INSERT INTO audit_groups (id, at, label, undo_of) VALUES (?, ?, ?, ?)",
            params![group_id, now_iso(), label, undo_of],
        )?;
        let mut a = AuditWriter { db, group_id: group_id.clone(), seq: 0 };
        let result = f(&mut a)?;
        Ok(Audited { result, audit_group_id: group_id })
    })
}

/// Lookup rows (tags, merchants) another record now uses are left in place by an undo.
fn remove_unless_shared(db: &Db, a: &mut AuditWriter, entity: &str, id: &str) -> DbResult<()> {
    let sql = match entity {
        "tags" => "SELECT 1 FROM transaction_tags WHERE tag_id = ? LIMIT 1",
        "merchants" => "SELECT 1 FROM transactions WHERE merchant_id = ? LIMIT 1",
        _ => return a.remove(entity, id),
    };
    if db.query_row(sql, [id], |_| Ok(()))?.is_none() {
        a.remove(entity, id)?;
    }
    Ok(())
}

/// Two rows are the same when every key has the same value (missing on both sides counts too).
fn same_row(a: Option<&Row>, b: Option<&Row>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => a.keys().chain(b.keys()).all(|k| {
            a.get(k).unwrap_or(&Value::Null) == b.get(k).unwrap_or(&Value::Null)
                && a.contains_key(k) == b.contains_key(k)
        }),
        (None, None) => true,
        _ => false,
    }
}

struct LogEntry {
    action: String,
    entity: String,
    entity_id: String,
    before: Option<String>,
    after: Option<String>,
}

fn parse_row(s: &Option<String>) -> Option<Row> {
    s.as_deref().and_then(|s| serde_json::from_str::<Row>(s).ok())
}

/// Revert every change in a group, newest first. Refuses (CONFLICT) if a record it touched
/// changed afterwards, so undo never clobbers later edits. The undo is itself audited.
pub fn undo_group(db: &Db, group_id: &str) -> DbResult<Audited<i64>> {
    let group = db.query_row("SELECT label, undone_at FROM audit_groups WHERE id = ?", [group_id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
    })?;
    let Some((label, undone_at)) = group else { return Err(AppError::not_found("Change")) };
    if undone_at.is_some() {
        return Err(AppError::conflict("This change was already undone"));
    }
    let entries = db.query_map(
        "SELECT action, entity, entity_id, before, after FROM audit_log WHERE group_id = ? ORDER BY seq DESC",
        [group_id],
        |r| {
            Ok(LogEntry {
                action: r.get(0)?,
                entity: r.get(1)?,
                entity_id: r.get(2)?,
                before: r.get(3)?,
                after: r.get(4)?,
            })
        },
    )?;
    // The final state of each touched record must still be what this group left behind.
    let mut final_state: HashMap<(String, String), Option<Row>> = HashMap::new();
    let mut order: Vec<(String, String)> = Vec::new();
    for e in entries.iter().rev() {
        let key = (e.entity.clone(), e.entity_id.clone());
        if !final_state.contains_key(&key) {
            order.push(key.clone());
        }
        final_state.insert(key, parse_row(&e.after));
    }
    for key in &order {
        let current = read_row(db, &key.0, &key.1)?;
        if !same_row(current.as_ref(), final_state[key].as_ref()) {
            return Err(AppError::conflict(
                "Some records were changed after this action, so it can no longer be undone automatically",
            ));
        }
    }
    with_audit(db, &format!("Undo: {label}"), Some(group_id), |a| {
        for e in &entries {
            match e.action.as_str() {
                "insert" => remove_unless_shared(db, a, &e.entity, &e.entity_id)?,
                "delete" => {
                    a.insert(&e.entity, parse_row(&e.before).unwrap_or_default())?;
                }
                _ => {
                    a.update(&e.entity, &e.entity_id, parse_row(&e.before).unwrap_or_default())?;
                }
            }
        }
        db.run(
            "UPDATE audit_groups SET undone_at = ?, undone_by = ? WHERE id = ?",
            params![now_iso(), a.group_id, group_id],
        )?;
        Ok(entries.len() as i64)
    })
}

/// Build a row from `(column, value)` pairs, keeping their order.
#[macro_export]
macro_rules! row {
    ($($k:expr => $v:expr),* $(,)?) => {{
        let mut m = serde_json::Map::new();
        $( m.insert($k.to_string(), serde_json::json!($v)); )*
        m
    }};
}
