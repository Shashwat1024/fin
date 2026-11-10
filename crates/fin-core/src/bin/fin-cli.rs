//! JSON-lines front end to the dispatcher, used by the parity harness (tests/parity).
//! Reads one `{"channel": "...", "input": ...}` per line on stdin and writes one result per line.

use std::io::{self, BufRead, Write};

use serde_json::{Value, json};

fn main() {
    let stdin = io::stdin();
    let mut out = io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(req) => {
                let channel = req
                    .get("channel")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                fin_core::dispatch::dispatch(
                    channel,
                    req.get("input").cloned().unwrap_or(Value::Null),
                )
            }
            Err(_) => {
                json!({ "ok": false, "error": { "code": "VALIDATION", "message": "Bad request" } })
            }
        };
        let _ = writeln!(out, "{reply}");
        let _ = out.flush();
    }
}
