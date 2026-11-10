//! Backups, restore checks and the encrypted `.finbackup` format (`src/db/backup.ts`,
//! `src/db/backupCrypto.ts`). Files are interchangeable with Fin 1.x in both directions.
//!
//! Encrypted file layout (research R15):
//!   magic "FINBAK" 0x00 0x01 (8) | log2 N (1) | r (1) | p (1) | salt (16) | iv (12) | tag (16) | ciphertext
//! The key is scrypt(NFC(passphrase), salt); AES-256-GCM authenticates the ciphertext and the
//! header (as associated data), so a wrong passphrase or tampering fails cleanly.

use std::fs;
use std::path::{Path, PathBuf};

use aes_gcm::aead::{AeadInOut, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce, Tag};
use rusqlite::{Connection, OpenFlags};
use serde_json::{Value, json};
use unicode_normalization::UnicodeNormalization;

use super::migrate::LATEST_SCHEMA_VERSION;
use super::{APP_ID, Db, DbResult};
use crate::error::{AppError, ErrorCode};

const MAGIC: [u8; 8] = [0x46, 0x49, 0x4e, 0x42, 0x41, 0x4b, 0x00, 0x01];
const HEADER_LEN: usize = MAGIC.len() + 3 + 16 + 12;
const TAG_LEN: usize = 16;

/// Automatic daily backups kept; manual and safety backups are never pruned automatically.
pub const AUTO_BACKUP_KEEP: usize = 14;

#[derive(Debug, Clone, Copy)]
pub struct Kdf {
    pub log_n: u8,
    pub r: u8,
    pub p: u8,
}

pub const DEFAULT_KDF: Kdf = Kdf { log_n: 17, r: 8, p: 1 };

#[derive(Debug, PartialEq, Eq)]
pub enum CryptoError {
    WrongPassphrase,
    NotEncrypted,
    Corrupt,
}

fn derive_key(passphrase: &str, salt: &[u8], kdf: Kdf) -> Result<[u8; 32], CryptoError> {
    let params = scrypt::Params::new(kdf.log_n, kdf.r.into(), kdf.p.into()).map_err(|_| CryptoError::Corrupt)?;
    let normalized: String = passphrase.nfc().collect();
    let mut key = [0u8; 32];
    scrypt::scrypt(normalized.as_bytes(), salt, &params, &mut key).map_err(|_| CryptoError::Corrupt)?;
    Ok(key)
}

pub fn is_encrypted_backup(data: &[u8]) -> bool {
    data.len() >= MAGIC.len() && data[..MAGIC.len()] == MAGIC
}

fn random<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    getrandom::fill(&mut b).expect("the operating system provides random numbers");
    b
}

pub fn encrypt_backup(plain: &[u8], passphrase: &str, kdf: Kdf) -> Result<Vec<u8>, CryptoError> {
    let salt: [u8; 16] = random();
    let iv: [u8; 12] = random();
    let mut header = Vec::with_capacity(HEADER_LEN);
    header.extend_from_slice(&MAGIC);
    header.extend_from_slice(&[kdf.log_n, kdf.r, kdf.p]);
    header.extend_from_slice(&salt);
    header.extend_from_slice(&iv);
    let key = derive_key(passphrase, &salt, kdf)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| CryptoError::Corrupt)?;
    let nonce = Nonce::try_from(&iv[..]).map_err(|_| CryptoError::Corrupt)?;
    let mut body = plain.to_vec();
    let tag =
        cipher.encrypt_inout_detached(&nonce, &header, body.as_mut_slice().into()).map_err(|_| CryptoError::Corrupt)?;
    let mut out = header;
    out.extend_from_slice(&tag);
    out.extend_from_slice(&body);
    Ok(out)
}

pub fn decrypt_backup(data: &[u8], passphrase: &str) -> Result<Vec<u8>, CryptoError> {
    if !is_encrypted_backup(data) {
        return Err(CryptoError::NotEncrypted);
    }
    if data.len() < HEADER_LEN + TAG_LEN {
        return Err(CryptoError::Corrupt);
    }
    let o = MAGIC.len();
    let kdf = Kdf { log_n: data[o], r: data[o + 1], p: data[o + 2] };
    if !(10..=20).contains(&kdf.log_n) || !(1..=32).contains(&kdf.r) || !(1..=16).contains(&kdf.p) {
        return Err(CryptoError::Corrupt);
    }
    let salt = &data[o + 3..o + 19];
    let iv = &data[o + 19..o + 31];
    let header = &data[..HEADER_LEN];
    let tag = Tag::try_from(&data[HEADER_LEN..HEADER_LEN + TAG_LEN]).map_err(|_| CryptoError::Corrupt)?;
    let key = derive_key(passphrase, salt, kdf)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| CryptoError::Corrupt)?;
    let nonce = Nonce::try_from(iv).map_err(|_| CryptoError::Corrupt)?;
    let mut body = data[HEADER_LEN + TAG_LEN..].to_vec();
    // GCM cannot tell a wrong key from a damaged file; a wrong passphrase is far likelier.
    cipher
        .decrypt_inout_detached(&nonce, header, body.as_mut_slice().into(), &tag)
        .map_err(|_| CryptoError::WrongPassphrase)?;
    Ok(body)
}

// ---- Files ------------------------------------------------------------------------------------

/// Local time as `YYYYMMDD-HHmmss` and `YYYY-MM-DD`, like backup names in Fin 1.x.
pub fn local_stamp() -> String {
    crate::clock::now().with_timezone(&chrono::Local).format("%Y%m%d-%H%M%S").to_string()
}
pub fn local_date() -> String {
    crate::clock::now().with_timezone(&chrono::Local).format("%Y-%m-%d").to_string()
}

fn kind_of(token: &str) -> &'static str {
    if token.starts_with("pre-upgrade") {
        "pre-upgrade"
    } else if token == "auto" {
        "auto"
    } else if token == "pre-restore" {
        "pre-restore"
    } else {
        "manual"
    }
}

/// `fin-YYYYMMDD-HHmmss-<kind>[_n].(db|finbackup)` → (createdAt, kind, encrypted).
pub fn parse_backup_name(name: &str) -> Option<(String, &'static str, bool)> {
    let rest = name.strip_prefix("fin-")?;
    let (stem, ext) = rest.rsplit_once('.')?;
    let encrypted = match ext {
        "db" => false,
        "finbackup" => true,
        _ => return None,
    };
    let b = stem.as_bytes();
    if b.len() < 17 || b[8] != b'-' || b[15] != b'-' {
        return None;
    }
    let digits = |r: std::ops::Range<usize>| stem[r].bytes().all(|c| c.is_ascii_digit());
    if !digits(0..8) || !digits(9..15) {
        return None;
    }
    let mut token = &stem[16..];
    // A trailing `_n` (second backup in the same second) is not part of the kind.
    if let Some((t, n)) = token.rsplit_once('_')
        && !n.is_empty()
        && n.bytes().all(|c| c.is_ascii_digit())
    {
        token = t;
    }
    if token.is_empty() || !token.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-') {
        return None;
    }
    let created =
        format!("{}-{}-{}T{}:{}:{}", &stem[0..4], &stem[4..6], &stem[6..8], &stem[9..11], &stem[11..13], &stem[13..15]);
    Some((created, kind_of(token), encrypted))
}

fn info(path: &Path) -> Option<Value> {
    let name = path.file_name()?.to_string_lossy().into_owned();
    let (created, kind, encrypted) = parse_backup_name(&name)?;
    let size = fs::metadata(path).ok()?.len();
    Some(json!({
        "fileName": name,
        "path": path.to_string_lossy(),
        "sizeBytes": size,
        "createdAt": created,
        "kind": kind,
        "encrypted": encrypted,
    }))
}

/// Newest first: by creation time, then file name.
pub fn newest_first(a: &Value, b: &Value) -> std::cmp::Ordering {
    let k = |v: &Value, f: &str| v[f].as_str().unwrap_or_default().to_owned();
    k(b, "createdAt").cmp(&k(a, "createdAt")).then_with(|| k(b, "fileName").cmp(&k(a, "fileName")))
}

/// Backups in a folder, newest first. Unrelated files are ignored.
pub fn list_backups(dir: &Path) -> Vec<Value> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<Value> = entries.flatten().filter_map(|e| info(&e.path())).collect();
    out.sort_by(newest_first);
    out
}

fn free_name(dir: &Path, stamp: &str, kind: &str, ext: &str) -> PathBuf {
    for i in 1.. {
        let suffix = if i == 1 { String::new() } else { format!("_{i}") };
        let p = dir.join(format!("fin-{stamp}-{kind}{suffix}.{ext}"));
        let tmp = PathBuf::from(format!("{}.tmp", p.display()));
        if !p.exists() && !tmp.exists() {
            return p;
        }
    }
    unreachable!()
}

fn io_err(message: &str) -> AppError {
    AppError::new(ErrorCode::Io, message)
}

/// A consistent copy of the live database (VACUUM INTO), optionally encrypted. Written under a
/// temporary name and renamed, so a half-written file never looks like a backup.
pub fn create_backup(db: &Db, dir: &Path, kind: &str, passphrase: Option<&str>, kdf: Kdf) -> DbResult<Value> {
    fs::create_dir_all(dir).map_err(|_| io_err("Fin cannot write to that folder. Choose another one."))?;
    let final_path = free_name(dir, &local_stamp(), kind, if passphrase.is_some() { "finbackup" } else { "db" });
    let tmp = PathBuf::from(format!("{}.tmp", final_path.display()));
    let result = (|| -> DbResult<()> {
        match passphrase {
            Some(pass) => {
                let plain = PathBuf::from(format!("{}.plain.tmp", final_path.display()));
                db.run("VACUUM INTO ?", [plain.to_string_lossy().as_ref()])?;
                let bytes = fs::read(&plain);
                let _ = fs::remove_file(&plain);
                let bytes = bytes.map_err(|_| io_err("Fin could not read the backup it just made."))?;
                let sealed = encrypt_backup(&bytes, pass, kdf).map_err(|_| AppError::internal())?;
                fs::write(&tmp, sealed).map_err(|_| io_err("Fin cannot write to that folder. Choose another one."))?;
            }
            None => {
                db.run("VACUUM INTO ?", [tmp.to_string_lossy().as_ref()])?;
            }
        }
        fs::rename(&tmp, &final_path).map_err(|_| io_err("Fin cannot write to that folder. Choose another one."))?;
        Ok(())
    })();
    let _ = fs::remove_file(&tmp);
    result?;
    info(&final_path).ok_or_else(AppError::internal)
}

/// Delete the oldest automatic backups beyond `keep`.
pub fn prune_auto_backups(dir: &Path, keep: usize) -> Vec<String> {
    let old: Vec<Value> = list_backups(dir).into_iter().filter(|b| b["kind"] == "auto").skip(keep).collect();
    for b in &old {
        let _ = fs::remove_file(b["path"].as_str().unwrap_or_default());
    }
    old.iter().map(|b| b["fileName"].as_str().unwrap_or_default().to_owned()).collect()
}

/// Once per local day: an automatic backup, then prune old ones. `None` when one exists today.
pub fn auto_backup_if_due(db: &Db, dir: &Path) -> DbResult<Option<Value>> {
    let today = local_date();
    if list_backups(dir)
        .iter()
        .any(|b| b["kind"] == "auto" && b["createdAt"].as_str().is_some_and(|c| c.starts_with(&today)))
    {
        return Ok(None);
    }
    let made = create_backup(db, dir, "auto", None, DEFAULT_KDF)?;
    prune_auto_backups(dir, AUTO_BACKUP_KEEP);
    Ok(Some(made))
}

// ---- Restore checks ---------------------------------------------------------------------------

pub struct Prepared {
    pub inspection: Value,
    pub file: Option<PathBuf>,
}

fn fail(reason: &str, message: &str) -> Prepared {
    Prepared { inspection: json!({ "valid": false, "reason": reason, "message": message }), file: None }
}

/// Record counts for a database, as shown before a restore and in Settings › Data.
pub fn count_data(db: &Db) -> DbResult<Value> {
    crate::handlers::count_data(db)
}

/// Copy (or decrypt) a backup into `work_dir` and check it is a healthy Fin database this app
/// can open. The returned file is what a restore puts in place; callers delete it when done.
pub fn prepare_backup(path: &Path, passphrase: Option<&str>, work_dir: &Path) -> Prepared {
    if !path.is_file() {
        return fail("NOT_FOUND", "The backup file could not be found.");
    }
    if fs::create_dir_all(work_dir).is_err() {
        return fail("NOT_FOUND", "The backup file could not be found.");
    }
    let token: [u8; 6] = random();
    let hex: String = token.iter().map(|b| format!("{b:02x}")).collect();
    let file = work_dir.join(format!("candidate-{hex}.db"));
    let Ok(raw) = fs::read(path) else { return fail("NOT_FOUND", "The backup file could not be found.") };
    let encrypted = is_encrypted_backup(&raw);
    if encrypted {
        let Some(pass) = passphrase.filter(|p| !p.is_empty()) else {
            return fail("NEEDS_PASSPHRASE", "This backup is protected. Enter its passphrase.");
        };
        match decrypt_backup(&raw, pass) {
            Ok(plain) => {
                if fs::write(&file, plain).is_err() {
                    return fail("DAMAGED", "The backup file is damaged.");
                }
            }
            Err(CryptoError::WrongPassphrase) => {
                return fail("WRONG_PASSPHRASE", "The passphrase is not correct, or the file is damaged.");
            }
            Err(_) => return fail("DAMAGED", "The backup file is damaged."),
        }
    } else if fs::write(&file, &raw).is_err() {
        return fail("DAMAGED", "The backup file is damaged.");
    }
    let result = check_candidate(&file, encrypted);
    if result.file.is_none() {
        let _ = fs::remove_file(&file);
    }
    result
}

fn check_candidate(file: &Path, encrypted: bool) -> Prepared {
    let checked = (|| -> Result<Prepared, rusqlite::Error> {
        let probe = Connection::open_with_flags(file, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
        let app_id: i64 = probe.query_row("PRAGMA application_id", [], |r| r.get(0))?;
        if app_id != APP_ID {
            return Ok(fail("NOT_FIN", "This file is not a Fin backup."));
        }
        let check: String = probe.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        if check != "ok" {
            return Ok(fail("DAMAGED", "The backup file is damaged."));
        }
        let db = Db::from_connection(probe);
        let schema_version = super::migrate::current_schema_version(&db).map_err(|_| rusqlite::Error::InvalidQuery)?;
        if schema_version > LATEST_SCHEMA_VERSION {
            return Ok(fail(
                "TOO_NEW",
                "This backup was made by a newer version of Fin. Update the app to restore it.",
            ));
        }
        // Restore expects a self-contained file.
        db.conn.pragma_update(None, "journal_mode", "DELETE")?;
        let counts = count_data(&db).map_err(|_| rusqlite::Error::InvalidQuery)?;
        Ok(Prepared {
            inspection: json!({
                "valid": true,
                "encrypted": encrypted,
                "schemaVersion": schema_version,
                "needsUpgrade": schema_version < LATEST_SCHEMA_VERSION,
                "counts": counts,
            }),
            file: Some(file.to_path_buf()),
        })
    })();
    checked.unwrap_or_else(|_| fail("NOT_FIN", "This file is not a Fin backup."))
}

/// Check a backup without changing anything.
pub fn inspect_backup(path: &Path, passphrase: Option<&str>, work_dir: &Path) -> Value {
    let p = prepare_backup(path, passphrase, work_dir);
    if let Some(f) = &p.file {
        let _ = fs::remove_file(f);
    }
    p.inspection
}

/// Put a prepared database file in place of the (closed) live database. The old file is kept
/// aside until the new one is in place, and put back if anything fails.
pub fn swap_database_file(db_file: &Path, candidate: &Path) -> std::io::Result<()> {
    let aside = PathBuf::from(format!("{}.replaced", db_file.display()));
    let _ = fs::remove_file(&aside);
    for ext in ["-wal", "-shm"] {
        let _ = fs::remove_file(format!("{}{ext}", db_file.display()));
    }
    let had = db_file.exists();
    if had {
        fs::rename(db_file, &aside)?;
    }
    if let Err(e) = fs::rename(candidate, db_file) {
        if had {
            let _ = fs::rename(&aside, db_file);
        }
        return Err(e);
    }
    let _ = fs::remove_file(&aside);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_wrong_passphrase() {
        let kdf = Kdf { log_n: 10, r: 8, p: 1 };
        let sealed = encrypt_backup(b"hello fin", "cafe\u{301} ☕", kdf).unwrap();
        assert!(is_encrypted_backup(&sealed));
        // NFC: "é" typed either way is the same passphrase.
        assert_eq!(decrypt_backup(&sealed, "caf\u{e9} ☕").unwrap(), b"hello fin");
        assert_eq!(decrypt_backup(&sealed, "wrong"), Err(CryptoError::WrongPassphrase));
        let mut tampered = sealed.clone();
        *tampered.last_mut().unwrap() ^= 1;
        assert_eq!(decrypt_backup(&tampered, "caf\u{e9} ☕"), Err(CryptoError::WrongPassphrase));
        assert_eq!(decrypt_backup(b"plain", "x"), Err(CryptoError::NotEncrypted));
    }

    #[test]
    fn backup_names() {
        assert_eq!(
            parse_backup_name("fin-20261110-093000-auto.db"),
            Some(("2026-11-10T09:30:00".into(), "auto", false))
        );
        assert_eq!(parse_backup_name("fin-20261110-093000-manual_2.finbackup").map(|p| p.1), Some("manual"));
        assert_eq!(parse_backup_name("fin-20261110-093000-pre-upgrade-v5.db").map(|p| p.1), Some("pre-upgrade"));
        assert_eq!(parse_backup_name("fin-20261110-093000-pre-restore.db").map(|p| p.1), Some("pre-restore"));
        assert_eq!(parse_backup_name("notes.txt"), None);
        assert_eq!(parse_backup_name("fin-2026111-093000-auto.db"), None);
        assert_eq!(parse_backup_name("fin-20261110-093000-.db"), None);
    }
}
