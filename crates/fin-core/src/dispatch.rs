//! The single request entry point, mirroring `src/main/dispatch.ts`: validate, run one handler,
//! and always answer `{ ok: true, data }` or `{ ok: false, error }`. Never panics across the
//! boundary.

use serde_json::{Value, json};

use crate::app::App;
use crate::error::{AppError, ErrorCode};

/// Every request channel in the contract (`src/shared/contract.ts`). Channels move from
/// "not ported yet" to a real handler phase by phase (specs/002-rust-tauri-port/tasks.md).
pub const CHANNELS: &[&str] = &[
    "settings.get",
    "settings.update",
    "accounts.list",
    "accounts.create",
    "accounts.update",
    "accounts.archive",
    "categories.list",
    "tags.list",
    "txns.query",
    "txns.get",
    "txns.create",
    "txns.update",
    "txns.delete",
    "txns.bulkUpdate",
    "transfers.create",
    "transfers.update",
    "payees.suggest",
    "activity.list",
    "undo.apply",
    "accounts.reconcile",
    "import.presets",
    "import.savePreset",
    "import.preview",
    "import.commit",
    "import.batches",
    "import.batchRows",
    "import.undo",
    "dashboard.summary",
    "app.status",
    "backup.list",
    "backup.create",
    "backup.pickFile",
    "backup.inspect",
    "backup.restore",
    "backup.chooseFolder",
    "backup.openFolder",
    "export.json",
    "export.csv",
    "demo.enter",
    "demo.exit",
    "recurring.list",
    "recurring.create",
    "recurring.update",
    "recurring.delete",
    "recurring.occurrences",
    "recurring.candidates",
    "recurring.setOccurrence",
    "budget.month",
    "budget.assign",
    "goals.list",
    "goals.create",
    "goals.update",
    "goals.delete",
    "goals.contribute",
    "goals.deleteContribution",
    "categories.create",
    "categories.update",
    "categories.usage",
    "categories.delete",
    "rules.list",
    "rules.create",
    "rules.update",
    "rules.delete",
    "rules.preview",
    "rules.apply",
    "suggestions.forTxns",
    "forecast.run",
    "networth.history",
    "valuations.list",
    "valuations.upsert",
    "valuations.delete",
    "insights.list",
    "insights.dismiss",
    "insights.restore",
    "recurring.detectCandidates",
    "scenarios.run",
];

fn ok(data: Value) -> Value {
    json!({ "ok": true, "data": data })
}

fn err(e: AppError) -> Value {
    json!({ "ok": false, "error": e })
}

/// Handle one request from the (untrusted) interface. `input` is `None` when the interface sent
/// nothing (JavaScript `undefined`), which some schemas accept and `null` does not. Never panics
/// across the boundary: every failure becomes an error result without financial details.
pub fn dispatch(app: &mut App, channel: &str, input: Option<Value>) -> Value {
    match validate(channel, input) {
        Err(e) => {
            let event = if e.message == "Unknown request" { "ipc.unknown_channel" } else { "ipc.invalid" };
            crate::log::warn(event, &[("channel", crate::log::Ctx::Text(channel))]);
            err(e)
        }
        // The app lock (Fin 2.7) is enforced here, so no interface can skip it.
        Ok(_) if app.lock.locked && !crate::lock::allowed_while_locked(channel) => err(crate::lock::locked_error()),
        Ok(cleaned) => {
            let input = cleaned.unwrap_or(Value::Null);
            let started = std::time::Instant::now();
            match crate::handlers::handle(app, channel, &input) {
                Some(Ok(data)) => {
                    let ms = started.elapsed().as_millis() as i64;
                    crate::log::debug(
                        "ipc.ok",
                        &[("channel", crate::log::Ctx::Text(channel)), ("ms", crate::log::Ctx::Num(ms))],
                    );
                    ok(data)
                }
                Some(Err(e)) => {
                    if e.code == ErrorCode::Internal {
                        crate::log::error("ipc.internal_error", &[("channel", crate::log::Ctx::Text(channel))]);
                    } else {
                        let code = serde_json::to_value(e.code).ok();
                        let code = code.as_ref().and_then(Value::as_str).unwrap_or_default();
                        crate::log::info(
                            "ipc.app_error",
                            &[("channel", crate::log::Ctx::Text(channel)), ("code", crate::log::Ctx::Text(code))],
                        );
                    }
                    err(public(e))
                }
                None => err(crate::handlers::not_ported()),
            }
        }
    }
}

/// Validate a request against its channel's schema; `Ok` carries the cleaned input.
pub fn validate(channel: &str, input: Option<Value>) -> Result<Option<Value>, AppError> {
    let Some(schema) = crate::contract::inputs::schema_for(channel) else {
        return Err(AppError::new(ErrorCode::Validation, "Unknown request"));
    };
    crate::contract::schema::validate(schema, input.as_ref()).map_err(|issues| {
        let issues: Vec<Value> =
            issues.into_iter().map(|(path, message)| json!({ "path": path, "message": message })).collect();
        AppError::new(ErrorCode::Validation, "Some fields are invalid").with_issues(Value::Array(issues))
    })
}

/// Internal errors reach the interface only as the generic message.
fn public(e: AppError) -> AppError {
    if e.code == ErrorCode::Internal { AppError { detail: None, ..AppError::internal() } } else { e }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_channels_are_rejected() {
        let r = err(validate("nope", None).unwrap_err());
        assert_eq!(r["ok"], false);
        assert_eq!(r["error"]["code"], "VALIDATION");
        assert_eq!(r["error"]["message"], "Unknown request");
    }

    #[test]
    fn invalid_input_reports_field_issues() {
        let r = err(validate("accounts.create", Some(json!({ "name": "  ", "type": "bank" }))).unwrap_err());
        assert_eq!(r["error"]["code"], "VALIDATION");
        assert_eq!(r["error"]["message"], "Some fields are invalid");
        assert_eq!(r["error"]["issues"][0], json!({ "path": "name", "message": "Required" }));
        assert_eq!(r["error"]["issues"][1]["path"], "openingDate");
    }

    #[test]
    fn every_channel_has_a_schema() {
        assert!(CHANNELS.iter().all(|c| crate::contract::inputs::schema_for(c).is_some()));
    }

    #[test]
    fn contract_has_every_channel_once() {
        let mut seen = std::collections::HashSet::new();
        assert!(CHANNELS.iter().all(|c| seen.insert(*c)));
    }
}
