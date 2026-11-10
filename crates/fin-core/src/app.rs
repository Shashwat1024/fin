//! The open data folder: where files live and which database is open (`src/main/services/system.ts`).
//! Restore and demo mode (P3) swap the database here; handlers always get the one open now.

use std::path::{Path, PathBuf};

use crate::db::{Db, DbResult, categories, migrate};
use crate::error::AppError;

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub data_dir: PathBuf,
    pub db_file: PathBuf,
    pub backup_dir: PathBuf,
    pub log_file: PathBuf,
}

impl AppPaths {
    /// All user data lives in one folder; `FIN_DATA_DIR` overrides it (tests and manual QA).
    pub fn resolve(app_data_dir: &Path) -> AppPaths {
        let data_dir = std::env::var("FIN_DATA_DIR")
            .ok()
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty())
            .map_or_else(|| app_data_dir.join("Fin"), PathBuf::from);
        AppPaths {
            db_file: data_dir.join("fin.db"),
            backup_dir: data_dir.join("backups"),
            log_file: data_dir.join("logs").join("fin.log"),
            data_dir,
        }
    }

    pub fn in_dir(data_dir: &Path) -> AppPaths {
        AppPaths {
            data_dir: data_dir.to_path_buf(),
            db_file: data_dir.join("fin.db"),
            backup_dir: data_dir.join("backups"),
            log_file: data_dir.join("logs").join("fin.log"),
        }
    }
}

/// `YYYYMMDD-HHmmss` in local time, as backup file names use.
pub fn local_stamp() -> String {
    crate::clock::now().with_timezone(&chrono::Local).format("%Y%m%d-%H%M%S").to_string()
}

/// A consistent copy of the live database before a schema upgrade, named like other backups.
fn snapshot(db: &Db, dir: &Path, reason: &str) -> DbResult<PathBuf> {
    std::fs::create_dir_all(dir)
        .map_err(|_| AppError::new(crate::error::ErrorCode::Io, "Fin cannot write a backup"))?;
    let clean: String =
        reason.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect::<String>().to_lowercase();
    let file = dir.join(format!("fin-{}-{clean}.db", local_stamp()));
    db.run("VACUUM INTO ?", [file.to_string_lossy().as_ref()])?;
    Ok(file)
}

pub struct App {
    pub paths: AppPaths,
    db: Db,
    demo: bool,
}

impl App {
    /// Open (creating if needed) the data folder's database, upgrading it after a safety copy.
    pub fn open(paths: AppPaths) -> DbResult<App> {
        std::fs::create_dir_all(&paths.data_dir)
            .map_err(|_| AppError::new(crate::error::ErrorCode::Io, "Fin cannot create its data folder"))?;
        let db = Db::open(&paths.db_file)?;
        let backup_dir = paths.backup_dir.clone();
        let hook = move |d: &Db, from: i64| snapshot(d, &backup_dir, &format!("pre-upgrade-v{from}")).map(|_| ());
        migrate::migrate(&db, Some(&hook))?;
        categories::seed_default_categories(&db)?;
        categories::backfill_merchants(&db)?;
        Ok(App { paths, db, demo: false })
    }

    pub fn db(&self) -> &Db {
        &self.db
    }

    pub fn is_demo(&self) -> bool {
        self.demo
    }

    pub fn default_backup_dir(&self) -> String {
        self.paths.backup_dir.to_string_lossy().into_owned()
    }

    /// Closing is best-effort: WAL keeps committed data durable.
    pub fn close(self) {
        let _ = self.db.exec("PRAGMA optimize");
    }
}
