//! JSON-lines front end to the dispatcher, used by the parity harness (tests/parity).
//! Opens the data folder in `FIN_DATA_DIR`, then reads one `{"channel": "...", "input": ...}` per
//! line on stdin and writes one result per line.

use std::io::{self, BufRead, Write};

use fin_core::app::{App, AppPaths, PresetDialogs};
use serde_json::{Value, json};

fn main() {
    let Some(dir) = std::env::var_os("FIN_DATA_DIR") else {
        eprintln!("Set FIN_DATA_DIR to the data folder to use");
        std::process::exit(2);
    };
    // `fin-cli --seed-perf`: write the 50,000-transaction performance profile into FIN_DATA_DIR.
    if std::env::args().any(|a| a == "--seed-perf") {
        let paths = AppPaths::in_dir(std::path::Path::new(&dir));
        if paths.db_file.exists() {
            eprintln!("{} already exists; choose an empty folder.", paths.db_file.display());
            std::process::exit(1);
        }
        let started = std::time::Instant::now();
        let app = App::open(paths, Box::new(PresetDialogs::default())).unwrap_or_else(|e| {
            eprintln!("Cannot open the data folder: {e}");
            std::process::exit(1)
        });
        let today = fin_core::domain::dates::today_in("Asia/Kolkata");
        match fin_core::db::seed_perf::seed_perf_data(app.db(), &today, 50_000) {
            Ok(n) => {
                let _ = app.db().exec("PRAGMA wal_checkpoint(TRUNCATE)");
                println!("Wrote {n} transactions in {} ms", started.elapsed().as_millis());
            }
            Err(e) => {
                eprintln!("Seeding failed: {e}");
                std::process::exit(1);
            }
        }
        app.close();
        return;
    }
    let mut app = match App::open(AppPaths::in_dir(std::path::Path::new(&dir)), Box::new(PresetDialogs::default())) {
        Ok(app) => app,
        Err(e) => {
            eprintln!("Cannot open the data folder: {e}");
            std::process::exit(1);
        }
    };
    let stdin = io::stdin();
    let mut out = io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            // Test tooling: {"setNow": "<RFC 3339>"} moves the clock for the parity harness.
            // Test tooling: {"dialogs": {"file", "save", "folder"}} answers the next dialogs.
            Ok(req) if req.get("dialogs").is_some() => {
                let path = |k: &str| req["dialogs"][k].as_str().map(std::path::PathBuf::from);
                app.dialogs =
                    Box::new(PresetDialogs { file: path("file"), save: path("save"), folder: path("folder") });
                json!({ "ok": true, "data": null })
            }
            Ok(req) if req.get("setNow").is_some() => {
                let at = req["setNow"].as_str().and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok());
                fin_core::clock::set_now(at.map(|d| d.with_timezone(&chrono::Utc)));
                json!({ "ok": true, "data": null })
            }
            Ok(req) => {
                let channel = req.get("channel").and_then(Value::as_str).unwrap_or_default().to_owned();
                fin_core::dispatch::dispatch(&mut app, &channel, req.get("input").cloned())
            }
            Err(_) => json!({ "ok": false, "error": { "code": "VALIDATION", "message": "Bad request" } }),
        };
        let _ = writeln!(out, "{reply}");
        let _ = out.flush();
    }
    app.close();
}
