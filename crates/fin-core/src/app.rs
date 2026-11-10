//! The open data folder: where files live, which database is open, and everything that swaps it
//! (restore, and demo mode from P4) — `src/main/services/system.ts`. Handlers always get the
//! database that is open at the moment of the request.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use crate::db::backup::{
    DEFAULT_KDF, auto_backup_if_due, count_data, create_backup, prepare_backup, swap_database_file,
};
use crate::db::{Db, DbResult, categories, migrate, settings};
use crate::error::{AppError, ErrorCode};

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
        Self::in_dir(&data_dir)
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

/// Operating-system dialogs. The Tauri shell shows real ones; tools and tests answer in advance.
pub trait Dialogs: Send {
    fn choose_file(&self, title: &str) -> Option<PathBuf>;
    fn choose_save_path(&self, title: &str, default_name: &str, ext: &str) -> Option<PathBuf>;
    fn choose_folder(&self, title: &str) -> Option<PathBuf>;
    fn open_folder(&self, path: &Path);
}

/// Dialog answers given in advance (fin-cli and tests).
#[derive(Default)]
pub struct PresetDialogs {
    pub file: Option<PathBuf>,
    pub save: Option<PathBuf>,
    pub folder: Option<PathBuf>,
}

impl Dialogs for PresetDialogs {
    fn choose_file(&self, _: &str) -> Option<PathBuf> {
        self.file.clone()
    }
    fn choose_save_path(&self, _: &str, _: &str, _: &str) -> Option<PathBuf> {
        self.save.clone()
    }
    fn choose_folder(&self, _: &str) -> Option<PathBuf> {
        self.folder.clone()
    }
    fn open_folder(&self, _: &Path) {}
}

fn io(message: &str) -> AppError {
    AppError::new(ErrorCode::Io, message)
}

/// A consistent copy of the live database before a schema upgrade, named like other backups.
fn snapshot(db: &Db, dir: &Path, reason: &str) -> DbResult<PathBuf> {
    fs::create_dir_all(dir).map_err(|_| io("Fin cannot write a backup"))?;
    let clean: String =
        reason.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect::<String>().to_lowercase();
    let file = dir.join(format!("fin-{}-{clean}.db", crate::db::backup::local_stamp()));
    db.run("VACUUM INTO ?", [file.to_string_lossy().as_ref()])?;
    Ok(file)
}

pub struct App {
    pub paths: AppPaths,
    pub work_dir: PathBuf,
    pub dialogs: Box<dyn Dialogs>,
    db: Db,
    demo: bool,
}

impl App {
    /// Open (creating if needed) the data folder's database, upgrading it after a safety copy.
    /// Scratch files left by a crash are removed first.
    pub fn open(paths: AppPaths, dialogs: Box<dyn Dialogs>) -> DbResult<App> {
        fs::create_dir_all(&paths.data_dir).map_err(|_| io("Fin cannot create its data folder"))?;
        let work_dir = paths.data_dir.join("tmp");
        let _ = fs::remove_dir_all(&work_dir);
        let _ = fs::create_dir_all(&work_dir);
        let db = Self::open_real(&paths)?;
        Ok(App { paths, work_dir, dialogs, db, demo: false })
    }

    fn open_real(paths: &AppPaths) -> DbResult<Db> {
        let db = Db::open(&paths.db_file)?;
        let backup_dir = paths.backup_dir.clone();
        let hook = move |d: &Db, from: i64| snapshot(d, &backup_dir, &format!("pre-upgrade-v{from}")).map(|_| ());
        migrate::migrate(&db, Some(&hook))?;
        categories::seed_default_categories(&db)?;
        categories::backfill_merchants(&db)?;
        Ok(db)
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

    /// The folder backups go to: the one chosen in Settings, or the default.
    pub fn backup_dir(&self) -> DbResult<PathBuf> {
        let s = settings::get_settings(&self.db)?;
        Ok(s["backupDir"]
            .as_str()
            .filter(|d| !d.is_empty())
            .map_or_else(|| self.paths.backup_dir.clone(), PathBuf::from))
    }

    /// Close the live database (best effort: WAL keeps committed data durable).
    fn close_db(&mut self) -> DbResult<()> {
        let _ = self.db.exec("PRAGMA optimize");
        let placeholder = Db::open_in_memory()?;
        drop(std::mem::replace(&mut self.db, placeholder));
        Ok(())
    }

    /// Replace the live database with a checked backup, after backing up the current data.
    pub fn restore(&mut self, path: &Path, passphrase: Option<&str>) -> DbResult<Value> {
        let prepared = prepare_backup(path, passphrase, &self.work_dir);
        let valid = prepared.inspection["valid"] == true;
        let Some(candidate) = prepared.file.clone().filter(|_| valid) else {
            let message = if valid {
                "The backup could not be read".to_owned()
            } else {
                prepared.inspection["message"].as_str().unwrap_or_default().to_owned()
            };
            return Err(AppError::new(ErrorCode::Validation, message));
        };
        let pre_restore = create_backup(&self.db, &self.backup_dir()?, "pre-restore", None, DEFAULT_KDF)?;
        self.close_db()?;
        if swap_database_file(&self.paths.db_file, &candidate).is_err() {
            let _ = fs::remove_file(&candidate);
            self.db = Self::open_real(&self.paths)?;
            return Err(io("Fin could not replace your data file. Nothing was changed."));
        }
        match Self::open_real(&self.paths) {
            // An older backup is upgraded to the current schema on open.
            Ok(db) => self.db = db,
            Err(_) => {
                // Put the data back exactly as it was before the restore.
                let back = self.work_dir.join("put-back.db");
                let _ = fs::copy(pre_restore["path"].as_str().unwrap_or_default(), &back);
                let _ = swap_database_file(&self.paths.db_file, &back);
                self.db = Self::open_real(&self.paths)?;
                return Err(AppError::invariant("That backup could not be opened, so your data was left as it was."));
            }
        }
        Ok(json!({ "preRestoreBackup": pre_restore, "counts": count_data(&self.db)? }))
    }

    /// Once per day on launch; falls back to the default folder if the chosen one fails.
    pub fn daily_backup(&self) -> Option<Value> {
        if self.demo {
            return None;
        }
        let mut dirs = vec![self.backup_dir().ok()?];
        if dirs[0] != self.paths.backup_dir {
            dirs.push(self.paths.backup_dir.clone());
        }
        for dir in dirs {
            if let Ok(made) = auto_backup_if_due(&self.db, &dir) {
                return made;
            }
        }
        None
    }

    pub fn close(mut self) {
        let _ = self.close_db();
    }
}
