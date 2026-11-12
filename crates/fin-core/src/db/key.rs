//! The data key (Fin 2.7). With encryption on, `fin.db` is encrypted by SQLite3 Multiple Ciphers
//! (ChaCha20-Poly1305) with a random 256-bit key. The shell keeps the key protected by Windows
//! (`fin.key`) and hands it to the app; it is never logged, exported or shown.

use std::fmt;
use std::io::Read;
use std::path::Path;

use rusqlite::Connection;

use super::DbResult;
use crate::error::{AppError, ErrorCode};

/// The first 16 bytes of every plain SQLite file.
const SQLITE_HEADER: &[u8; 16] = b"SQLite format 3\0";

#[derive(Clone, PartialEq, Eq)]
pub struct DbKey([u8; 32]);

impl DbKey {
    /// A new random key.
    pub fn generate() -> DbKey {
        let mut b = [0u8; 32];
        getrandom::fill(&mut b).expect("the operating system provides random numbers");
        DbKey(b)
    }

    pub fn from_bytes(bytes: &[u8]) -> Option<DbKey> {
        Some(DbKey(bytes.try_into().ok()?))
    }

    /// 64 hexadecimal digits (test seams and tools).
    pub fn from_hex(hex: &str) -> Option<DbKey> {
        let hex = hex.trim();
        if hex.len() != 64 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        let bytes: Vec<u8> = (0..32).map(|i| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap_or(0)).collect();
        Self::from_bytes(&bytes)
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    fn hex(&self) -> String {
        self.0.iter().map(|b| format!("{b:02x}")).collect()
    }
}

/// Never print the key, even in debug output.
impl fmt::Debug for DbKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("DbKey(…)")
    }
}

/// Whether a file is a plain (unencrypted) SQLite database. A missing or empty file counts as plain:
/// a new database starts plain.
pub fn is_plain_file(path: &Path) -> bool {
    let Ok(mut f) = std::fs::File::open(path) else { return true };
    let mut head = [0u8; 16];
    match f.read(&mut head) {
        Ok(0) => true,
        Ok(16) => &head == SQLITE_HEADER,
        _ => false,
    }
}

/// Whether a file may be a database encrypted by Fin: not plain SQLite, and a whole number of pages
/// (encrypted pages keep their size). Any other file (a CSV, a picture) is simply not a Fin backup.
pub fn may_be_encrypted(path: &Path) -> bool {
    let len = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    len >= 1024 && len.is_multiple_of(512) && !is_plain_file(path)
}

/// Unlock an encrypted database on a freshly opened connection, before anything else is read.
pub fn apply_key(conn: &Connection, key: &DbKey) -> DbResult<()> {
    conn.pragma_update(None, "cipher", "chacha20")?;
    conn.pragma_update(None, "hexkey", key.hex())?;
    // The key is only checked when the first page is read.
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)).map_err(|_| wrong_key())?;
    Ok(())
}

pub fn wrong_key() -> AppError {
    AppError::new(
        ErrorCode::Io,
        "Fin's data is encrypted for another Windows account or computer, so it can't be opened here. \
         Restore a passphrase backup instead.",
    )
}

/// A `file:` URI for SQLite with query parameters (`VACUUM INTO` a copy with or without a key).
/// Characters with a meaning in URIs are percent-encoded, so any folder name works.
pub fn file_uri(path: &Path, key: Option<&DbKey>) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    let mut out = String::from("file:");
    if text.as_bytes().get(1) == Some(&b':') {
        // A drive letter: file:///C:/…
        out.push_str("///");
    }
    for b in text.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~/:".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    match key {
        Some(k) => out.push_str(&format!("?cipher=chacha20&hexkey={}", k.hex())),
        None => out.push_str("?key="),
    }
    out
}

/// Write a consistent copy of the database open on `conn` to `target`: encrypted with `key`, or plain.
pub fn copy_to(conn: &Connection, target: &Path, key: Option<&DbKey>) -> DbResult<()> {
    let _ = std::fs::remove_file(target);
    conn.execute("VACUUM INTO ?", [file_uri(target, key)])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("fin-key-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn hex_round_trip_and_debug_hides_it() {
        let k = DbKey::generate();
        assert_eq!(DbKey::from_hex(&k.hex()), Some(k.clone()));
        assert_eq!(DbKey::from_hex("abc"), None);
        assert_eq!(format!("{k:?}"), "DbKey(…)");
    }

    #[test]
    fn uris_encode_folder_names() {
        let k = DbKey::from_hex(&"ab".repeat(32)).unwrap();
        assert_eq!(
            file_uri(Path::new(r"C:\Users\A B\Fin #1\x%.db"), Some(&k)),
            format!("file:///C:/Users/A%20B/Fin%20%231/x%25.db?cipher=chacha20&hexkey={}", "ab".repeat(32))
        );
        assert_eq!(file_uri(Path::new("/tmp/x.db"), None), "file:/tmp/x.db?key=");
    }

    #[test]
    fn encrypted_copies_open_only_with_their_key() {
        let dir = temp("copies");
        let (plain, enc, back) = (dir.join("plain.db"), dir.join("enc ü #.db"), dir.join("back.db"));
        let key = DbKey::generate();
        let c = Connection::open(&plain).unwrap();
        c.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE t(a); INSERT INTO t VALUES ('secret note');").unwrap();
        copy_to(&c, &enc, Some(&key)).unwrap();
        drop(c);
        assert!(is_plain_file(&plain));
        assert!(!is_plain_file(&enc));
        assert!(!std::fs::read(&enc).unwrap().windows(11).any(|w| w == b"secret note"));

        let none = Connection::open(&enc).unwrap();
        assert!(none.query_row("SELECT count(*) FROM t", [], |r| r.get::<_, i64>(0)).is_err());
        let wrong = Connection::open(&enc).unwrap();
        assert!(apply_key(&wrong, &DbKey::generate()).is_err());
        let right = Connection::open(&enc).unwrap();
        apply_key(&right, &key).unwrap();
        assert_eq!(right.query_row("SELECT a FROM t", [], |r| r.get::<_, String>(0)).unwrap(), "secret note");

        copy_to(&right, &back, None).unwrap();
        drop(right);
        assert!(is_plain_file(&back));
        let c = Connection::open(&back).unwrap();
        assert_eq!(c.query_row("SELECT count(*) FROM t", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        assert!(is_plain_file(&dir.join("missing.db")));
        assert!(may_be_encrypted(&enc));
        assert!(!may_be_encrypted(&plain));
        let csv = dir.join("statement.csv");
        std::fs::write(
            &csv,
            "Date,Narration,Amount
01/10/26,CHAI,80.00
",
        )
        .unwrap();
        assert!(!is_plain_file(&csv) && !may_be_encrypted(&csv), "a CSV is not an encrypted backup");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
