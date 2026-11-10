//! JSON-lines front end to the dispatcher, used by the parity harness (tests/parity).
//! Opens the data folder in `FIN_DATA_DIR`, then reads one `{"channel": "...", "input": ...}` per
//! line on stdin and writes one result per line.

use std::io::{self, BufRead, Write};

use fin_core::app::{App, AppPaths};
use serde_json::{Value, json};

fn main() {
    let Some(dir) = std::env::var_os("FIN_DATA_DIR") else {
        eprintln!("Set FIN_DATA_DIR to the data folder to use");
        std::process::exit(2);
    };
    let mut app = match App::open(AppPaths::in_dir(std::path::Path::new(&dir))) {
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
