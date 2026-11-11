//! Schema migrations (`crates/fin-core/migrations/*.sql`; 1–6 are shared with Fin 1.x). Each runs in its own transaction; a failure rolls back
//! completely so the app never opens a half-upgraded database.

use super::{APP_ID, Db, DbResult, now_iso};
use crate::error::{AppError, ErrorCode};

pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub sql: &'static str,
}

pub const MIGRATIONS: &[Migration] = &[
    Migration { version: 1, name: "init", sql: include_str!("../../migrations/0001_init.sql") },
    Migration { version: 2, name: "imports", sql: include_str!("../../migrations/0002_imports.sql") },
    Migration { version: 3, name: "planning", sql: include_str!("../../migrations/0003_planning.sql") },
    Migration { version: 4, name: "rules", sql: include_str!("../../migrations/0004_rules.sql") },
    Migration { version: 5, name: "valuations", sql: include_str!("../../migrations/0005_valuations.sql") },
    Migration {
        version: 6,
        name: "dismissed_insights",
        sql: include_str!("../../migrations/0006_dismissed_insights.sql"),
    },
    Migration { version: 7, name: "daily_use", sql: include_str!("../../migrations/0007_daily_use.sql") },
    Migration { version: 8, name: "reviews", sql: include_str!("../../migrations/0008_reviews.sql") },
];

pub const LATEST_SCHEMA_VERSION: i64 = 8;

fn migration_error(message: String) -> AppError {
    AppError::new(ErrorCode::Internal, message)
}

pub fn current_schema_version(db: &Db) -> DbResult<i64> {
    let exists = db.query_row(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
        [],
        |_| Ok(()),
    )?;
    if exists.is_none() {
        return Ok(0);
    }
    Ok(db
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |r| r.get::<_, Option<i64>>(0))?
        .flatten()
        .unwrap_or(0))
}

pub struct MigrateResult {
    pub from: i64,
    pub to: i64,
    pub applied: Vec<i64>,
}

/// Apply pending migrations in order. `before_migrate` runs once before upgrading a database
/// that already has data (the pre-upgrade backup).
/// Runs once before upgrading a database that already has data (the pre-upgrade backup).
pub type BeforeMigrate<'a> = &'a dyn Fn(&Db, i64) -> DbResult<()>;

pub fn migrate(db: &Db, before_migrate: Option<BeforeMigrate>) -> DbResult<MigrateResult> {
    let app_id: i64 = db.query_row("PRAGMA application_id", [], |r| r.get(0))?.unwrap_or(0);
    if app_id != 0 && app_id != APP_ID {
        return Err(migration_error("This file is not a Fin database".into()));
    }
    db.exec(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)",
    )?;
    let from = current_schema_version(db)?;
    if from > LATEST_SCHEMA_VERSION {
        return Err(migration_error(format!(
            "Database schema v{from} is newer than this app (v{LATEST_SCHEMA_VERSION})"
        )));
    }
    let pending: Vec<&Migration> = MIGRATIONS.iter().filter(|m| m.version > from).collect();
    if !pending.is_empty()
        && from > 0
        && let Some(hook) = before_migrate
    {
        hook(db, from)?;
    }
    let mut applied = Vec::new();
    for m in pending {
        db.exec("BEGIN IMMEDIATE")?;
        let step = db.exec(m.sql).and_then(|_| {
            db.run(
                "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
                rusqlite::params![m.version, m.name, now_iso()],
            )
        });
        match step {
            Ok(_) => db.exec("COMMIT")?,
            Err(e) => {
                let _ = db.exec("ROLLBACK");
                return Err(migration_error(format!(
                    "Migration {} ({}) failed: {}",
                    m.version,
                    m.name,
                    e.detail.unwrap_or(e.message)
                )));
            }
        }
        applied.push(m.version);
    }
    db.exec(&format!("PRAGMA application_id = {APP_ID}"))?;
    Ok(MigrateResult { from, to: from.max(LATEST_SCHEMA_VERSION), applied })
}
