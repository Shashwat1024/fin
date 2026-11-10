//! Categories, tags and merchants (`src/db/repos/categories.ts`, `src/db/seed/categories.ts`).

use std::collections::{HashMap, HashSet};

use rusqlite::params;
use serde_json::{Value, json};

use super::audit::AuditWriter;
use super::{Db, DbResult, new_id, now_iso, placeholders};
use crate::domain::import::narration::{merchant_key, merchant_name};
use crate::error::AppError;
use crate::row;

pub const UNCATEGORIZED: &str = "uncategorized";

pub fn list_categories(db: &Db) -> DbResult<Vec<Value>> {
    db.query_map(
        "SELECT c.id, c.name, c.parent_id, c.grp, c.is_system, c.archived_at, p.name AS parent_name
         FROM categories c LEFT JOIN categories p ON p.id = c.parent_id
         ORDER BY COALESCE(p.sort_order, c.sort_order), COALESCE(p.id, c.id), c.parent_id IS NOT NULL, c.sort_order, c.name",
        [],
        |r| {
            let name: String = r.get(1)?;
            let parent: Option<String> = r.get(6)?;
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "name": name,
                "parentId": r.get::<_, Option<String>>(2)?,
                "group": r.get::<_, String>(3)?,
                "isSystem": r.get::<_, i64>(4)? == 1,
                "archived": r.get::<_, Option<String>>(5)?.is_some(),
                "path": match parent { Some(p) => format!("{p} › {name}"), None => name.clone() },
            }))
        },
    )
}

pub fn assert_category_usable(db: &Db, id: &str) -> DbResult<()> {
    match db.query_row("SELECT archived_at FROM categories WHERE id = ?", [id], |r| r.get::<_, Option<String>>(0))? {
        None => Err(AppError::not_found("Category")),
        Some(Some(_)) => Err(AppError::invariant("This category is archived")),
        Some(None) => Ok(()),
    }
}

/// Parent category ids expanded to include their children (two-level tree), first-seen order.
pub fn expand_category_ids(db: &Db, ids: &[String]) -> DbResult<Vec<String>> {
    let real: Vec<&String> = ids.iter().filter(|i| *i != UNCATEGORIZED).collect();
    if real.is_empty() {
        return Ok(Vec::new());
    }
    let children = db.query_map(
        &format!("SELECT id FROM categories WHERE parent_id IN ({})", placeholders(real.len())),
        rusqlite::params_from_iter(real.iter()),
        |r| r.get::<_, String>(0),
    )?;
    let mut seen = HashSet::new();
    Ok(real.into_iter().cloned().chain(children).filter(|i| seen.insert(i.clone())).collect())
}

pub fn list_tags(db: &Db) -> DbResult<Vec<Value>> {
    db.query_map(
        "SELECT g.id, g.name, COUNT(t.id) AS usage FROM tags g
         LEFT JOIN transaction_tags tt ON tt.tag_id = g.id
         LEFT JOIN transactions t ON t.id = tt.transaction_id AND t.deleted_at IS NULL
         GROUP BY g.id ORDER BY usage DESC, g.name COLLATE NOCASE",
        [],
        |r| Ok(json!({ "id": r.get::<_, String>(0)?, "name": r.get::<_, String>(1)?, "usage": r.get::<_, i64>(2)? })),
    )
}

/// Tag names to ids (case-insensitive), creating missing tags inside the audit group.
pub fn resolve_tag_ids(db: &Db, a: &mut AuditWriter, names: &[String]) -> DbResult<Vec<String>> {
    let mut order: Vec<String> = Vec::new();
    let mut seen: HashMap<String, ()> = HashMap::new();
    for raw in names {
        let name = crate::domain::money::js_trim(raw);
        if !name.is_empty() && seen.insert(name.to_lowercase(), ()).is_none() {
            order.push(name.to_owned());
        }
    }
    let mut ids = Vec::new();
    for name in order {
        match db.query_row("SELECT id FROM tags WHERE name = ? COLLATE NOCASE", [&name], |r| r.get::<_, String>(0))? {
            Some(id) => ids.push(id),
            None => {
                let id = new_id("tag");
                a.insert("tags", row! { "id" => id, "name" => name, "created_at" => now_iso() })?;
                ids.push(id);
            }
        }
    }
    Ok(ids)
}

/// The merchant for a payee or narration ("UPI-SWIGGY-…" → Swiggy), created inside the audit
/// group when new. `None` when no usable name can be read.
pub fn resolve_merchant_id(db: &Db, a: &mut AuditWriter, payee: &str) -> DbResult<Option<String>> {
    let Some(name) = merchant_name(payee) else { return Ok(None) };
    let key = merchant_key(&name);
    if let Some(id) =
        db.query_row("SELECT id FROM merchants WHERE normalized_key = ?", [&key], |r| r.get::<_, String>(0))?
    {
        return Ok(Some(id));
    }
    let id = new_id("mer");
    let now = now_iso();
    a.insert(
        "merchants",
        row! { "id" => id, "display_name" => name, "normalized_key" => key, "created_at" => now, "updated_at" => now },
    )?;
    Ok(Some(id))
}

/// A merchant without creating one (for lines not yet imported).
pub fn find_merchant_id(db: &Db, payee: &str) -> DbResult<Option<String>> {
    match merchant_name(payee) {
        Some(name) => {
            db.query_row("SELECT id FROM merchants WHERE normalized_key = ?", [merchant_key(&name)], |r| r.get(0))
        }
        None => Ok(None),
    }
}

/// Give older transactions a merchant. Derived metadata, so written directly rather than as an
/// undoable change. Idempotent.
pub fn backfill_merchants(db: &Db) -> DbResult<usize> {
    let rows = db.query_map(
        "SELECT id, payee FROM transactions WHERE merchant_id IS NULL AND kind = 'standard' AND payee <> '' AND deleted_at IS NULL",
        [],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
    )?;
    if rows.is_empty() {
        return Ok(0);
    }
    let mut by_key: HashMap<String, String> = db
        .query_map("SELECT id, normalized_key FROM merchants", [], |r| {
            Ok((r.get::<_, String>(1)?, r.get::<_, String>(0)?))
        })?
        .into_iter()
        .collect();
    db.transaction(|| {
        let mut n = 0;
        for (txn_id, payee) in &rows {
            let Some(name) = merchant_name(payee) else { continue };
            let key = merchant_key(&name);
            let id = match by_key.get(&key) {
                Some(id) => id.clone(),
                None => {
                    let id = new_id("mer");
                    let now = now_iso();
                    db.run(
                        "INSERT INTO merchants (id, display_name, normalized_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                        params![id, name, key, now, now],
                    )?;
                    by_key.insert(key, id.clone());
                    id
                }
            };
            db.run("UPDATE transactions SET merchant_id = ? WHERE id = ?", params![id, txn_id])?;
            n += 1;
        }
        Ok(n)
    })
}

/// Default two-level categories for an Indian household; fully editable by the user.
/// `(name, group, children: (name, group override))`.
type Seed = (&'static str, &'static str, &'static [(&'static str, Option<&'static str>)]);

pub const DEFAULT_CATEGORIES: &[Seed] = &[
    (
        "Income",
        "income",
        &[
            ("Salary", None),
            ("Business & freelance", None),
            ("Interest", None),
            ("Dividends", None),
            ("Refunds & cashback", None),
            ("Gifts received", None),
            ("Other income", None),
        ],
    ),
    (
        "Housing",
        "needs",
        &[
            ("Rent", None),
            ("Maintenance", None),
            ("Electricity", None),
            ("Water", None),
            ("Cooking gas", None),
            ("Internet", None),
            ("Repairs", None),
        ],
    ),
    ("Food", "needs", &[("Groceries", None), ("Dining out", Some("wants")), ("Food delivery", Some("wants"))]),
    (
        "Transport",
        "needs",
        &[
            ("Fuel", None),
            ("Public transport", None),
            ("Cab & auto", None),
            ("Vehicle service", None),
            ("Parking & tolls", None),
        ],
    ),
    ("Bills", "needs", &[("Mobile", None), ("Insurance", None), ("Domestic help", None)]),
    ("Health", "needs", &[("Medicines", None), ("Doctor & tests", None), ("Fitness", Some("wants"))]),
    (
        "Shopping",
        "wants",
        &[("Clothing", None), ("Electronics", None), ("Household", Some("needs")), ("Personal care", None)],
    ),
    ("Entertainment", "wants", &[("Subscriptions", None), ("Movies & events", None), ("Hobbies", None)]),
    ("Travel", "wants", &[("Flights & trains", None), ("Hotels", None), ("Holiday spending", None)]),
    ("Education", "needs", &[("Fees", None), ("Books & courses", None)]),
    ("Family & giving", "wants", &[("Gifts given", None), ("Donations", None), ("Childcare", Some("needs"))]),
    (
        "Finance",
        "needs",
        &[("Loan EMI", None), ("Card fees & interest", None), ("Bank charges", None), ("Taxes", None)],
    ),
    (
        "Savings & investments",
        "goals",
        &[
            ("Mutual funds & SIP", None),
            ("Fixed deposits", None),
            ("Stocks", None),
            ("PPF / EPF / NPS", None),
            ("Emergency fund", Some("buffer")),
        ],
    ),
];

/// Insert the default categories if there are none yet. Returns true if seeded.
pub fn seed_default_categories(db: &Db) -> DbResult<bool> {
    if db.query_row("SELECT 1 FROM categories LIMIT 1", [], |_| Ok(()))?.is_some() {
        return Ok(false);
    }
    db.transaction(|| {
        let now = now_iso();
        let sql = "INSERT INTO categories (id, name, parent_id, grp, is_system, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)";
        for (i, (name, group, children)) in DEFAULT_CATEGORIES.iter().enumerate() {
            let parent_id = new_id("cat");
            db.run(sql, params![parent_id, name, Option::<String>::None, group, i as i64, now, now])?;
            for (j, (child, override_group)) in children.iter().enumerate() {
                db.run(sql, params![new_id("cat"), child, parent_id, override_group.unwrap_or(group), j as i64, now, now])?;
            }
        }
        Ok(())
    })?;
    db.exec("ANALYZE")?;
    Ok(true)
}
