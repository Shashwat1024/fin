//! The log file (`src/main/logging.ts`, Constitution I): what happened, never amounts, payees or
//! account names. Event names are fixed strings; context is limited to allow-listed keys, and
//! any text in it is redacted (digits become '#', quoted text is dropped).

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};

use regex::Regex;

const ALLOWED_KEYS: [&str; 9] = ["channel", "code", "ms", "kind", "count", "version", "from", "to", "phase"];
const MAX_BYTES: u64 = 1_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level {
    Debug,
    Info,
    Warn,
    Error,
}

impl Level {
    fn name(self) -> &'static str {
        match self {
            Level::Debug => "DEBUG",
            Level::Info => "INFO",
            Level::Warn => "WARN",
            Level::Error => "ERROR",
        }
    }
}

/// A context value: numbers we generate ourselves, or text that is always redacted.
pub enum Ctx<'a> {
    Num(i64),
    Text(&'a str),
}

static QUOTED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#""[^"]*"|'[^']*'|“[^“]*“|”[^”]*”|‘[^‘]*‘|’[^’]*’"#).unwrap());

/// Digits become '#', quoted text is dropped, at most 200 characters.
pub fn redact(value: &str) -> String {
    let unquoted = QUOTED.replace_all(value, "\"…\"");
    unquoted.chars().map(|c| if c.is_ascii_digit() { '#' } else { c }).take(200).collect()
}

pub fn format_line(level: Level, event: &str, ctx: &[(&str, Ctx)]) -> String {
    let safe: Vec<String> = ctx
        .iter()
        .filter(|(k, _)| ALLOWED_KEYS.contains(k))
        .map(|(k, v)| match v {
            // Durations, counts and versions are numbers we generate, not user data.
            Ctx::Num(n) if matches!(*k, "ms" | "count" | "version") => format!("{k}={n}"),
            Ctx::Num(n) => format!("{k}={}", redact(&n.to_string())),
            Ctx::Text(t) => format!("{k}={}", redact(t)),
        })
        .collect();
    let at = crate::clock::now().format("%Y-%m-%dT%H:%M:%S%.3fZ");
    let tail = if safe.is_empty() { String::new() } else { format!(" {}", safe.join(" ")) };
    format!("{at} {} {}{tail}", level.name(), redact(event))
}

struct Sink {
    file: PathBuf,
    min: Level,
}

static SINK: Mutex<Option<Sink>> = Mutex::new(None);

/// Send log lines to `file` (rotated to `.1` past 1 MB). Before this, nothing is logged.
pub fn init(file: PathBuf, min: Level) {
    if let Some(dir) = file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    *SINK.lock().unwrap_or_else(|p| p.into_inner()) = Some(Sink { file, min });
}

pub fn write(level: Level, event: &str, ctx: &[(&str, Ctx)]) {
    let guard = SINK.lock().unwrap_or_else(|p| p.into_inner());
    let Some(sink) = guard.as_ref() else { return };
    if level < sink.min {
        return;
    }
    // Logging must never break the app.
    if fs::metadata(&sink.file).is_ok_and(|m| m.len() > MAX_BYTES) {
        let _ = fs::rename(&sink.file, sink.file.with_extension("log.1"));
    }
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&sink.file) {
        let _ = writeln!(f, "{}", format_line(level, event, ctx));
    }
}

pub fn info(event: &str, ctx: &[(&str, Ctx)]) {
    write(Level::Info, event, ctx);
}
pub fn warn(event: &str, ctx: &[(&str, Ctx)]) {
    write(Level::Warn, event, ctx);
}
pub fn error(event: &str, ctx: &[(&str, Ctx)]) {
    write(Level::Error, event, ctx);
}
pub fn debug(event: &str, ctx: &[(&str, Ctx)]) {
    write(Level::Debug, event, ctx);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redaction_drops_quotes_digits_and_unknown_keys() {
        assert_eq!(redact(r#"payee "Swiggy" 450"#), "payee \"…\" ###");
        let line = format_line(
            Level::Info,
            "ipc.ok",
            &[("channel", Ctx::Text("txns.create")), ("ms", Ctx::Num(12)), ("payee", Ctx::Text("Swiggy"))],
        );
        assert!(line.ends_with(" INFO ipc.ok channel=txns.create ms=12"), "{line}");
    }
}
