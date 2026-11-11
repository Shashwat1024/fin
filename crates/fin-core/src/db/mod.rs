//! Storage: one SQLite file, opened and used exactly as Fin 1.x did, so a 1.x data folder opens as
//! it is.

pub mod accounts;
pub mod audit;
pub mod backup;
pub mod calendar;
pub mod cards;
pub mod categories;
pub mod categorization;
pub mod dashboard;
pub mod demo;
pub mod deposits;
pub mod export;
pub mod forecast;
pub mod health;
pub mod imports;
pub mod loans;
pub mod migrate;
pub mod networth;
pub mod patterns;
pub mod planning;
pub mod reminders;
pub mod review;
pub mod seed_perf;
pub mod settings;
pub mod transactions;
pub mod views;
pub mod year;

use std::cell::{Cell, RefCell};
use std::path::Path;
use std::sync::Mutex;

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{Connection, OpenFlags, Params, Row};
use serde_json::{Map, Value};

use crate::error::{AppError, ErrorCode};

/// SQLite `application_id` marker ("FIN1") used to recognise Fin databases on restore.
pub const APP_ID: i64 = 0x4649_4e31;

pub type DbResult<T> = Result<T, AppError>;

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        // The detail stays out of the user-facing message (it can contain data); keep it for
        // constraint checks such as unique names.
        let mut err = AppError::internal();
        err.detail = Some(e.to_string());
        err
    }
}

pub struct Db {
    pub conn: Connection,
    depth: Cell<u32>,
    /// The account list (`list_accounts`), kept until anything is written on this connection.
    /// Several requests behind one screen need it, and its balances add up every transaction.
    pub(crate) accounts_cache: RefCell<Option<(i64, bool, Vec<Value>)>>,
}

impl Db {
    pub fn open(path: &Path) -> DbResult<Db> {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        Self::configure(conn)
    }

    /// A second, read-only connection to a live database (backups while the app keeps working).
    pub fn open_read_only(path: &Path) -> DbResult<Db> {
        let conn =
            Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
        conn.execute_batch("PRAGMA busy_timeout = 5000;")?;
        Ok(Db { conn, depth: Cell::new(0), accounts_cache: RefCell::new(None) })
    }

    /// Wrap an already-open connection (used to inspect backups).
    pub fn from_connection(conn: Connection) -> Db {
        Db { conn, depth: Cell::new(0), accounts_cache: RefCell::new(None) }
    }

    pub fn open_in_memory() -> DbResult<Db> {
        Self::configure(Connection::open_in_memory()?)
    }

    fn configure(conn: Connection) -> DbResult<Db> {
        // A 64 MB page cache keeps a 50k-transaction ledger in memory (NFR budgets).
        conn.execute_batch(
            "PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; \
             PRAGMA cache_size = -65536; PRAGMA temp_store = MEMORY;",
        )?;
        Ok(Db { conn, depth: Cell::new(0), accounts_cache: RefCell::new(None) })
    }

    /// Rows inserted, changed or deleted on this connection since it opened (including by
    /// triggers and in transactions later rolled back). It only grows, so an unchanged value means
    /// nothing was written.
    pub fn total_changes(&self) -> DbResult<i64> {
        Ok(self.conn.query_row("SELECT total_changes()", [], |r| r.get(0))?)
    }

    /// Run `f` atomically. Nested calls use savepoints, so an inner failure rolls back only its
    /// part and an outer failure rolls back everything (Constitution II).
    pub fn transaction<T>(&self, f: impl FnOnce() -> DbResult<T>) -> DbResult<T> {
        let level = self.depth.get();
        let sp = format!("sp_{level}");
        self.conn.execute_batch(&if level == 0 { "BEGIN IMMEDIATE".to_owned() } else { format!("SAVEPOINT {sp}") })?;
        self.depth.set(level + 1);
        let result = f();
        self.depth.set(level);
        match result {
            Ok(v) => {
                self.conn.execute_batch(&if level == 0 { "COMMIT".to_owned() } else { format!("RELEASE {sp}") })?;
                Ok(v)
            }
            Err(e) => {
                let _ = self.conn.execute_batch(&if level == 0 {
                    "ROLLBACK".to_owned()
                } else {
                    format!("ROLLBACK TO {sp}; RELEASE {sp}")
                });
                Err(e)
            }
        }
    }

    pub fn exec(&self, sql: &str) -> DbResult<()> {
        self.conn.execute_batch(sql)?;
        Ok(())
    }

    pub fn run(&self, sql: &str, params: impl Params) -> DbResult<usize> {
        Ok(self.conn.prepare_cached(sql)?.execute(params)?)
    }

    /// All rows as JSON objects in column order (like `node:sqlite`'s `all()`).
    pub fn all_json(&self, sql: &str, params: impl Params) -> DbResult<Vec<Map<String, Value>>> {
        let mut stmt = self.conn.prepare_cached(sql)?;
        let names: Vec<String> = stmt.column_names().map(str::to_owned).collect();
        let rows = stmt.query_map(params, |r| row_json(r, &names))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn get_json(&self, sql: &str, params: impl Params) -> DbResult<Option<Map<String, Value>>> {
        let mut stmt = self.conn.prepare_cached(sql)?;
        let names: Vec<String> = stmt.column_names().map(str::to_owned).collect();
        let mut rows = stmt.query(params)?;
        Ok(match rows.next()? {
            Some(r) => Some(row_json(r, &names)?),
            None => None,
        })
    }

    pub fn query_map<T>(
        &self,
        sql: &str,
        params: impl Params,
        f: impl FnMut(&Row) -> rusqlite::Result<T>,
    ) -> DbResult<Vec<T>> {
        let mut stmt = self.conn.prepare_cached(sql)?;
        let rows = stmt.query_map(params, f)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn query_row<T>(
        &self,
        sql: &str,
        params: impl Params,
        f: impl FnOnce(&Row) -> rusqlite::Result<T>,
    ) -> DbResult<Option<T>> {
        let mut stmt = self.conn.prepare_cached(sql)?;
        let mut rows = stmt.query(params)?;
        Ok(match rows.next()? {
            Some(r) => Some(f(r)?),
            None => None,
        })
    }
}

/// A SQLite value as the TypeScript backend sees it (integers are numbers, NULL is null).
pub fn sql_to_json(v: ValueRef) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::from(i),
        ValueRef::Real(f) => serde_json::Number::from_f64(f).map_or(Value::Null, Value::Number),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Value::Array(b.iter().map(|x| Value::from(*x)).collect()),
    }
}

pub fn json_to_sql(v: &Value) -> SqlValue {
    match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(i64::from(*b)),
        Value::Number(n) => n.as_i64().map_or_else(|| SqlValue::Real(n.as_f64().unwrap_or(0.0)), SqlValue::Integer),
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

fn row_json(r: &Row, names: &[String]) -> rusqlite::Result<Map<String, Value>> {
    let mut m = Map::with_capacity(names.len());
    for (i, n) in names.iter().enumerate() {
        m.insert(n.clone(), sql_to_json(r.get_ref(i)?));
    }
    Ok(m)
}

static ULID: Mutex<Option<ulid::Generator>> = Mutex::new(None);

/// `prefix_<ULID>`, monotonic within a millisecond (like the `ulid` package's monotonicFactory).
pub fn new_id(prefix: &str) -> String {
    let mut g = ULID.lock().unwrap_or_else(|p| p.into_inner());
    let generator = g.get_or_insert_with(ulid::Generator::new);
    let at: std::time::SystemTime = crate::clock::now().into();
    let id = generator.generate_from_datetime(at).unwrap_or_else(|overflow| overflow.commit_overflow_random());
    format!("{prefix}_{id}")
}

/// UTC instant in JavaScript's `toISOString()` format, e.g. `2026-11-10T08:12:34.567Z`.
pub fn now_iso() -> String {
    crate::clock::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// True when a SQLite error was a unique-constraint failure on `table`.
pub fn is_unique_violation(e: &AppError, table: &str) -> bool {
    e.code == ErrorCode::Internal
        && e.detail.as_deref().is_some_and(|d| d.contains(&format!("UNIQUE constraint failed: {table}")))
}

/// `?, ?, ?` for `n` parameters.
pub fn placeholders(n: usize) -> String {
    vec!["?"; n].join(", ")
}

/// A fresh, migrated in-memory database with the default categories, for tests.
#[cfg(test)]
pub fn test_db() -> Db {
    let db = Db::open_in_memory().expect("in-memory database");
    migrate::migrate(&db, None).expect("migrations");
    categories::seed_default_categories(&db).expect("categories");
    db
}
