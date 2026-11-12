//! Fin 2.7: encrypting the data file, backups and restore with this computer's key, and the app
//! lock enforced by `dispatch`. Synthetic data only.

use std::path::Path;

use fin_core::app::{App, AppPaths, PresetDialogs};
use fin_core::db::key::{DbKey, is_plain_file};
use fin_core::dispatch::dispatch;
use serde_json::{Value, json};

fn open(dir: &Path, key: Option<DbKey>) -> App {
    App::open_with_key(AppPaths::in_dir(dir), Box::new(PresetDialogs::default()), key).unwrap()
}

fn call(app: &mut App, channel: &str, input: Value) -> Value {
    let r = dispatch(app, channel, Some(input));
    assert_eq!(r["ok"], true, "{channel}: {r}");
    r["data"].clone()
}

fn add_account(app: &mut App, name: &str) {
    call(
        app,
        "accounts.create",
        json!({ "name": name, "type": "bank", "openingBalanceMinor": 5_000_000, "openingDate": "2026-10-01" }),
    );
}

fn accounts(app: &mut App) -> usize {
    call(app, "accounts.list", json!({})).as_array().unwrap().len()
}

#[test]
fn encryption_on_and_off_keeps_every_record() {
    let dir = tempfile::tempdir().unwrap();
    let key = DbKey::generate();
    let mut app = open(dir.path(), Some(key.clone()));
    add_account(&mut app, "Savings");
    call(&mut app, "backup.create", json!({}));
    let db_file = dir.path().join("fin.db");
    assert!(is_plain_file(&db_file));

    let status = call(&mut app, "encryption.set", json!({ "on": true }));
    assert_eq!(status["encrypted"], true);
    assert!(!is_plain_file(&db_file));
    assert!(!std::fs::read(&db_file).unwrap().windows(7).any(|w| w == b"Savings"));
    // The backup made before is now encrypted too.
    let list = call(&mut app, "backup.list", json!({}));
    assert!(list.as_array().unwrap().iter().all(|b| b["keyed"] == true), "{list}");
    add_account(&mut app, "Wallet");
    app.close();

    // Reopens with the key; without it (another account) it can't.
    assert!(App::open_with_key(AppPaths::in_dir(dir.path()), Box::new(PresetDialogs::default()), None).is_err());
    assert!(
        App::open_with_key(AppPaths::in_dir(dir.path()), Box::new(PresetDialogs::default()), Some(DbKey::generate()))
            .is_err()
    );
    let mut app = open(dir.path(), Some(key.clone()));
    assert_eq!(accounts(&mut app), 2);

    // The daily backup is encrypted like the live file.
    let daily = app.daily_backup().expect("a daily backup");
    assert!(!is_plain_file(Path::new(daily["path"].as_str().unwrap())));

    let status = call(&mut app, "encryption.set", json!({ "on": false }));
    assert_eq!(status["encrypted"], false);
    assert!(is_plain_file(&db_file));
    assert_eq!(accounts(&mut app), 2);
    app.close();
}

#[test]
fn backups_restore_across_encryption_states() {
    let dir = tempfile::tempdir().unwrap();
    let key = DbKey::generate();
    let mut app = open(dir.path(), Some(key.clone()));
    add_account(&mut app, "Savings");
    let plain_backup = call(&mut app, "backup.create", json!({}))["path"].as_str().unwrap().to_owned();
    call(&mut app, "encryption.set", json!({ "on": true }));
    // The earlier plain backup was encrypted in place when encryption was turned on.
    assert!(!is_plain_file(Path::new(&plain_backup)));
    let keyed = call(&mut app, "backup.create", json!({}));
    assert_eq!(keyed["keyed"], true);
    let sealed = call(&mut app, "backup.create", json!({ "passphrase": "correct horse battery" }));
    assert_eq!(sealed["encrypted"], true);
    add_account(&mut app, "Wallet");

    // A keyed backup restores while encryption is on, and the file stays encrypted.
    let path = keyed["path"].as_str().unwrap();
    let inspection = call(&mut app, "backup.inspect", json!({ "path": path }));
    assert_eq!(inspection["valid"], true);
    assert_eq!(inspection["keyed"], true);
    call(&mut app, "backup.restore", json!({ "path": path, "confirm": true }));
    assert_eq!(accounts(&mut app), 1);
    assert!(app.is_encrypted());

    // With encryption off, a keyed backup is decrypted on restore.
    call(&mut app, "encryption.set", json!({ "on": false }));
    call(&mut app, "backup.restore", json!({ "path": path, "confirm": true }));
    assert!(!app.is_encrypted());
    assert_eq!(accounts(&mut app), 1);

    // On another computer (another key, or none) a keyed backup is refused with a clear reason,
    // and the passphrase backup restores.
    let other = tempfile::tempdir().unwrap();
    let mut elsewhere = open(other.path(), Some(DbKey::generate()));
    let r = call(&mut elsewhere, "backup.inspect", json!({ "path": path }));
    assert_eq!(r["reason"], "OTHER_COMPUTER");
    let sealed_path = sealed["path"].as_str().unwrap();
    let r = call(
        &mut elsewhere,
        "backup.restore",
        json!({ "path": sealed_path, "passphrase": "correct horse battery", "confirm": true }),
    );
    assert_eq!(r["counts"]["accounts"], 1);
    assert!(!elsewhere.is_encrypted());
    elsewhere.close();
    app.close();
}

#[test]
fn the_lock_is_enforced_by_dispatch() {
    let dir = tempfile::tempdir().unwrap();
    let mut app = open(dir.path(), None);
    add_account(&mut app, "Savings");
    let s = call(&mut app, "lock.configure", json!({ "pin": "4821", "afterMinutes": 5 }));
    assert_eq!(s["enabled"], true);
    assert_eq!(s["locked"], false);
    assert_eq!(call(&mut app, "lock.now", json!({}))["locked"], true);

    let refused = dispatch(&mut app, "accounts.list", None);
    assert_eq!(refused["error"]["code"], "LOCKED");
    assert_eq!(dispatch(&mut app, "settings.get", None)["error"]["code"], "LOCKED");
    assert_eq!(dispatch(&mut app, "lock.status", None)["ok"], true);

    let wrong = dispatch(&mut app, "lock.unlock", Some(json!({ "pin": "1111" })));
    assert_eq!(wrong["error"]["message"], "That PIN is not right.");
    assert_eq!(call(&mut app, "lock.unlock", json!({ "pin": "4821" }))["locked"], false);
    assert_eq!(accounts(&mut app), 1);
    app.close();

    // Fin opens locked; five wrong PINs make the next try wait.
    let mut app = open(dir.path(), None);
    assert!(app.is_locked());
    for _ in 0..5 {
        dispatch(&mut app, "lock.unlock", Some(json!({ "pin": "0000" })));
    }
    let waiting = dispatch(&mut app, "lock.unlock", Some(json!({ "pin": "4821" })));
    assert!(waiting["error"]["message"].as_str().unwrap().starts_with("Too many tries"), "{waiting}");
    assert!(call(&mut app, "lock.status", json!({}))["waitSeconds"].as_i64().unwrap() > 0);

    // Windows Hello is answered by the shell, which unlocks directly.
    fin_core::lock::unlock(&mut app);
    // The PIN hash never reaches the interface or the export.
    let settings = call(&mut app, "settings.get", json!({}));
    assert!(settings.get("lock").is_none());
    let off = call(&mut app, "lock.configure", json!({ "pin": null }));
    assert_eq!(off["enabled"], false);
    assert_eq!(call(&mut app, "lock.now", json!({}))["locked"], false);
    app.close();
}

#[test]
fn a_file_that_is_not_a_backup_is_named_as_such() {
    let dir = tempfile::tempdir().unwrap();
    let mut app = open(dir.path(), Some(DbKey::generate()));
    let csv = dir.path().join("statement.csv");
    std::fs::write(&csv, "Date,Narration,Amount\n01/10/26,CHAI POINT,80.00\n").unwrap();
    let r = call(&mut app, "backup.inspect", json!({ "path": csv.to_string_lossy() }));
    assert_eq!(r["reason"], "NOT_FIN", "{r}");
    app.close();
}
