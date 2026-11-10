//! The single request entry point, mirroring `src/main/dispatch.ts`: validate, run one handler,
//! and always answer `{ ok: true, data }` or `{ ok: false, error }`. Never panics across the
//! boundary.

use serde_json::{Value, json};

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

pub type HandlerResult = Result<Value, AppError>;

fn ok(data: Value) -> Value {
    json!({ "ok": true, "data": data })
}

fn err(e: AppError) -> Value {
    json!({ "ok": false, "error": e })
}

/// Handle one request from the (untrusted) interface.
pub fn dispatch(channel: &str, _payload: Value) -> Value {
    if !CHANNELS.contains(&channel) {
        return err(AppError::new(ErrorCode::Validation, "Unknown request"));
    }
    let result: HandlerResult = Err(AppError::new(
        ErrorCode::Internal,
        "This part of Fin is not available in this build yet.",
    ));
    match result {
        Ok(data) => ok(data),
        Err(e) => err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_channels_are_rejected() {
        let r = dispatch("nope", Value::Null);
        assert_eq!(r["ok"], false);
        assert_eq!(r["error"]["code"], "VALIDATION");
        assert_eq!(r["error"]["message"], "Unknown request");
    }

    #[test]
    fn contract_has_every_channel_once() {
        let mut seen = std::collections::HashSet::new();
        assert!(CHANNELS.iter().all(|c| seen.insert(*c)));
    }
}
