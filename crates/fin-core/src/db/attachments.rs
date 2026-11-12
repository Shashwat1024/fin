//! Receipts and warranties (US22): files attached to transactions, kept inside the data file so a
//! backup stays one file. Details are audited (undoable); contents are stored apart and not audited,
//! so undo never copies whole files. Contents left behind by a removal are cleared at the next start.

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use rusqlite::params;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};

use super::audit::with_audit;
use super::{Db, DbResult, new_id, now_iso};
use crate::domain::dates::diff_days;
use crate::error::AppError;
use crate::row;

/// The largest file that can be attached.
pub const MAX_BYTES: usize = 10 * 1024 * 1024;
const TYPES: &[&str] = &["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"];

fn dto(r: &Map<String, Value>) -> Value {
    json!({
        "id": r["id"],
        "transactionId": r["transaction_id"],
        "fileName": r["file_name"],
        "mime": r["mime"],
        "size": r["size"],
        "warrantyUntil": r["warranty_until"],
        "createdAt": r["created_at"],
    })
}

fn get(db: &Db, id: &str) -> DbResult<Map<String, Value>> {
    db.get_json("SELECT * FROM attachments WHERE id = ?", [id])?.ok_or_else(|| AppError::not_found("Attachment"))
}

pub fn list(db: &Db, transaction_id: &str) -> DbResult<Vec<Value>> {
    Ok(db
        .all_json("SELECT * FROM attachments WHERE transaction_id = ? ORDER BY created_at, id", [transaction_id])?
        .iter()
        .map(dto)
        .collect())
}

pub fn add(db: &Db, input: &Value) -> DbResult<Value> {
    let txn = input["transactionId"].as_str().unwrap_or_default();
    let exists = db.query_row("SELECT 1 FROM transactions WHERE id = ? AND deleted_at IS NULL", [txn], |_| Ok(()))?;
    if exists.is_none() {
        return Err(AppError::not_found("Transaction"));
    }
    let mime = input["mime"].as_str().unwrap_or_default();
    if !TYPES.contains(&mime) {
        return Err(AppError::invariant("Attach a photo (PNG, JPEG, WebP or GIF) or a PDF"));
    }
    let bytes = STANDARD
        .decode(input["dataBase64"].as_str().unwrap_or_default())
        .map_err(|_| AppError::invariant("That file could not be read"))?;
    if bytes.is_empty() {
        return Err(AppError::invariant("That file is empty"));
    }
    if bytes.len() > MAX_BYTES {
        return Err(AppError::invariant("Files can be up to 10 MB"));
    }
    let sha = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect::<String>();
    let name = input["fileName"].as_str().unwrap_or("Receipt").trim().to_owned();
    let audited = with_audit(db, &format!("Attach {name}"), None, |a| {
        let id = new_id("att");
        let now = now_iso();
        db.run("INSERT INTO attachment_data (id, data) VALUES (?, ?)", params![id, bytes])?;
        a.insert(
            "attachments",
            row! {
                "id" => id, "transaction_id" => txn, "file_name" => name, "mime" => mime, "size" => bytes.len() as i64,
                "sha256" => sha, "warranty_until" => input.get("warrantyUntil").cloned().unwrap_or(Value::Null),
                "created_at" => now, "updated_at" => now,
            },
        )?;
        Ok(id)
    })?;
    Ok(json!({ "attachment": dto(&get(db, &audited.result)?), "auditGroupId": audited.audit_group_id }))
}

/// The file's name, type and contents.
pub fn contents(db: &Db, id: &str) -> DbResult<(String, String, Vec<u8>)> {
    let a = get(db, id)?;
    let data: Vec<u8> = db
        .query_row("SELECT data FROM attachment_data WHERE id = ?", [id], |r| r.get(0))?
        .ok_or_else(|| AppError::not_found("Attachment"))?;
    Ok((
        a["file_name"].as_str().unwrap_or_default().to_owned(),
        a["mime"].as_str().unwrap_or_default().to_owned(),
        data,
    ))
}

pub fn get_data(db: &Db, id: &str) -> DbResult<Value> {
    let (name, mime, data) = contents(db, id)?;
    Ok(json!({ "fileName": name, "mime": mime, "dataBase64": STANDARD.encode(data) }))
}

pub fn update(db: &Db, input: &Value) -> DbResult<Value> {
    let id = input["id"].as_str().unwrap_or_default();
    let current = get(db, id)?;
    let label = format!("Edit {}", current["file_name"].as_str().unwrap_or_default());
    let audited = with_audit(db, &label, None, |a| {
        a.update(
            "attachments",
            id,
            row! { "warranty_until" => input.get("warrantyUntil").cloned().unwrap_or(Value::Null), "updated_at" => now_iso() },
        )?;
        Ok(())
    })?;
    Ok(json!({ "attachment": dto(&get(db, id)?), "auditGroupId": audited.audit_group_id }))
}

pub fn remove(db: &Db, id: &str) -> DbResult<Value> {
    let current = get(db, id)?;
    let label = format!("Remove {}", current["file_name"].as_str().unwrap_or_default());
    let audited = with_audit(db, &label, None, |a| a.remove("attachments", id))?;
    Ok(json!({ "auditGroupId": audited.audit_group_id }))
}

/// Contents whose details were removed (and not restored by undo). Run at start.
pub fn purge_orphans(db: &Db) -> DbResult<usize> {
    db.run("DELETE FROM attachment_data WHERE id NOT IN (SELECT id FROM attachments)", [])
}

/// Files with a warranty date, soonest first, with their transaction.
pub fn warranties(db: &Db, today: &str) -> DbResult<Vec<Value>> {
    Ok(db
        .all_json(
            "SELECT a.id, a.file_name, a.warranty_until, a.transaction_id, t.payee, t.posted_date, t.amount_minor
       FROM attachments a JOIN transactions t ON t.id = a.transaction_id
       WHERE a.warranty_until IS NOT NULL AND t.deleted_at IS NULL ORDER BY a.warranty_until, a.id",
            [],
        )?
        .iter()
        .map(|r| {
            let until = r["warranty_until"].as_str().unwrap_or_default();
            json!({
                "attachmentId": r["id"],
                "fileName": r["file_name"],
                "warrantyUntil": until,
                "daysLeft": diff_days(until, today).unwrap_or(0),
                "transactionId": r["transaction_id"],
                "payee": r["payee"],
                "date": r["posted_date"],
                "amountMinor": -r["amount_minor"].as_i64().unwrap_or(0),
            })
        })
        .collect())
}

pub fn usage(db: &Db) -> DbResult<Value> {
    let (count, bytes): (i64, i64) = db
        .query_row("SELECT COUNT(*), COALESCE(SUM(size), 0) FROM attachments", [], |r| Ok((r.get(0)?, r.get(1)?)))?
        .unwrap_or((0, 0));
    Ok(json!({ "count": count, "bytes": bytes }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::accounts::create_account;
    use crate::db::audit::undo_group;
    use crate::db::test_db;
    use crate::db::transactions::create_transaction;

    #[test]
    fn files_are_attached_checked_removed_with_undo_and_purged() {
        let db = test_db();
        let bank =
            create_account(&db, &json!({ "name": "Bank", "type": "bank", "openingDate": "2026-10-01" })).unwrap();
        let bank = bank["account"]["id"].as_str().unwrap().to_owned();
        let txn = create_transaction(
            &db,
            &json!({ "accountId": bank, "postedDate": "2026-11-01", "amountMinor": -4_500_000, "payee": "Croma" }),
        )
        .unwrap()["txn"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let png = STANDARD.encode(b"\x89PNG not really");
        let att = add(
            &db,
            &json!({ "transactionId": txn, "fileName": "bill.png", "mime": "image/png", "dataBase64": png, "warrantyUntil": "2027-11-01" }),
        )
        .unwrap();
        let id = att["attachment"]["id"].as_str().unwrap().to_owned();
        assert_eq!(att["attachment"]["size"], 15);
        assert!(add(&db, &json!({ "transactionId": txn, "fileName": "x.exe", "mime": "application/x-msdownload", "dataBase64": png })).is_err());
        assert_eq!(contents(&db, &id).unwrap().2, b"\x89PNG not really");
        assert_eq!(usage(&db).unwrap(), json!({ "count": 1, "bytes": 15 }));

        let w = warranties(&db, "2027-10-20").unwrap();
        assert_eq!((w[0]["payee"].clone(), w[0]["daysLeft"].clone()), (json!("Croma"), json!(12)));

        // Undo of a removal brings the file back, contents included, until the next start.
        let removed = remove(&db, &id).unwrap();
        assert!(list(&db, &txn).unwrap().is_empty());
        undo_group(&db, removed["auditGroupId"].as_str().unwrap()).unwrap();
        assert_eq!(contents(&db, &id).unwrap().0, "bill.png");
        // A backup (plain and passphrase-protected) carries the file's contents.
        let dir = tempfile::tempdir().unwrap();
        for passphrase in [None, Some("correct horse")] {
            let made = crate::db::backup::create_backup(
                &db,
                dir.path(),
                "manual",
                passphrase,
                crate::db::backup::Kdf { log_n: 10, r: 8, p: 1 },
            )
            .unwrap();
            let file = std::path::PathBuf::from(made["path"].as_str().unwrap());
            let bytes = std::fs::read(&file).unwrap();
            let plain = match passphrase {
                Some(p) => crate::db::backup::decrypt_backup(&bytes, p).unwrap(),
                None => bytes,
            };
            let copy = dir.path().join("check.db");
            std::fs::write(&copy, plain).unwrap();
            let restored = Db::open_read_only(&copy, None).unwrap();
            let data: Vec<u8> = restored
                .query_row("SELECT data FROM attachment_data WHERE id = ?", [&id], |r| r.get(0))
                .unwrap()
                .unwrap();
            assert_eq!(data, contents(&db, &id).unwrap().2);
            drop(restored);
            std::fs::remove_file(&copy).unwrap();
        }

        remove(&db, &id).unwrap();
        assert_eq!(purge_orphans(&db).unwrap(), 1);
        assert_eq!(usage(&db).unwrap()["count"], 0);
    }
}
