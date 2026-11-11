//! Channel → handler (`src/main/handlers.ts`). Inputs arrive already validated and cleaned, so a
//! field the schema requires is present with the right type.

use serde_json::{Value, json};

use crate::app::App;
use std::path::{Path, PathBuf};

use crate::db::backup::{self as backups, DEFAULT_KDF};
use crate::db::{
    DbResult, accounts, audit, calendar, cards, categories, categorization, dashboard, export, forecast, health,
    imports, loans, networth, patterns, planning, reminders, review, settings, transactions, views, year,
};
use crate::error::{AppError, ErrorCode};

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(Value::as_str).unwrap_or_default()
}

fn ids(v: &Value, k: &str) -> Vec<String> {
    v.get(k)
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_owned)).collect())
        .unwrap_or_default()
}

fn count(db: &crate::db::Db, sql: &str) -> DbResult<i64> {
    Ok(db.query_row(sql, [], |r| r.get::<_, i64>(0))?.unwrap_or(0))
}

/// Record counts shown before a restore and in Settings › Data.
pub fn count_data(db: &crate::db::Db) -> DbResult<Value> {
    let has_imports = db
        .query_row("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'import_batches'", [], |_| Ok(()))?
        .is_some();
    Ok(json!({
        "accounts": count(db, "SELECT COUNT(*) FROM accounts WHERE archived_at IS NULL")?,
        "transactions": count(db, "SELECT COUNT(*) FROM transactions WHERE deleted_at IS NULL")?,
        // Backups from before imports existed (schema v1) have no import tables.
        "importBatches": if has_imports { count(db, "SELECT COUNT(*) FROM import_batches WHERE undone_at IS NULL")? } else { 0 },
        "latestTxnDate": db.query_row("SELECT MAX(posted_date) FROM transactions WHERE deleted_at IS NULL", [], |r| r.get::<_, Option<String>>(0))?.flatten(),
    }))
}

fn activity(app: &App, limit: i64) -> DbResult<Value> {
    let rows = app.db().query_map(
        "SELECT g.id, g.at, g.label, g.undone_at, g.undo_of FROM audit_groups g ORDER BY g.id DESC LIMIT ?",
        [limit],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
            ))
        },
    )?;
    Ok(Value::Array(
        rows.into_iter()
            .enumerate()
            .map(|(i, (id, at, label, undone_at, undo_of))| {
                json!({
                    "id": id,
                    "at": at,
                    "label": label,
                    "undone": undone_at.is_some(),
                    "isUndo": undo_of.is_some(),
                    // Only the most recent change is offered for one-click undo; older ones may conflict.
                    "canUndo": i == 0 && undone_at.is_none(),
                })
            })
            .collect(),
    ))
}

fn io(message: &str) -> AppError {
    AppError::new(ErrorCode::Io, message)
}

fn no_demo(app: &App, what: &str) -> DbResult<()> {
    if app.is_demo() {
        return Err(AppError::invariant(format!("{what} is not available with demo data. Exit the demo first.")));
    }
    Ok(())
}

/// Fails with a plain message unless Fin can create and write files in `dir`.
fn writable(dir: &Path) -> DbResult<()> {
    let probe = dir.join(format!(".fin-write-test-{}", std::process::id()));
    let ok = std::fs::create_dir_all(dir).is_ok() && std::fs::write(&probe, b"").is_ok();
    let _ = std::fs::remove_file(&probe);
    if ok { Ok(()) } else { Err(io("Fin cannot write to that folder. Choose another one.")) }
}

fn path_str(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Backups, export and other requests that touch files or swap the open database.
fn handle_files(app: &mut App, channel: &str, input: &Value) -> Option<DbResult<Value>> {
    let passphrase = |k: &str| input.get(k).and_then(Value::as_str).filter(|p| !p.is_empty()).map(str::to_owned);
    let result = match channel {
        "backup.list" => (|| {
            // Safety copies made before upgrades always go to the default folder, so list both.
            let mut seen: Vec<Value> = Vec::new();
            for b in backups::list_backups(&app.backup_dir()?)
                .into_iter()
                .chain(backups::list_backups(&app.paths.backup_dir))
            {
                match seen.iter_mut().find(|x| x["path"] == b["path"]) {
                    Some(slot) => *slot = b,
                    None => seen.push(b),
                }
            }
            seen.sort_by(backups::newest_first);
            Ok(Value::Array(seen))
        })(),
        "backup.create" => (|| {
            no_demo(app, "Backing up")?;
            let dir = app.backup_dir()?;
            writable(&dir)?;
            backups::create_backup(app.db(), &dir, "manual", passphrase("passphrase").as_deref(), DEFAULT_KDF)
        })(),
        "backup.pickFile" => {
            Ok(app.dialogs.choose_file("Choose a Fin backup").map_or(Value::Null, |p| json!({ "path": path_str(&p) })))
        }
        "backup.inspect" => Ok(backups::inspect_backup(
            &PathBuf::from(s(input, "path")),
            passphrase("passphrase").as_deref(),
            &app.work_dir,
        )),
        "backup.restore" => (|| {
            no_demo(app, "Restoring")?;
            app.restore(&PathBuf::from(s(input, "path")), passphrase("passphrase").as_deref())
        })(),
        "backup.chooseFolder" => (|| {
            no_demo(app, "Changing the backup folder")?;
            let Some(dir) = app.dialogs.choose_folder("Choose where to keep backups") else { return Ok(Value::Null) };
            writable(&dir)?;
            let mut patch = serde_json::Map::new();
            patch.insert("backupDir".into(), json!(path_str(&dir)));
            settings::update_settings(app.db(), &patch).map(Value::Object)
        })(),
        "backup.openFolder" => (|| {
            let dir = app.backup_dir()?;
            let _ = std::fs::create_dir_all(&dir);
            app.dialogs.open_folder(&dir);
            Ok(Value::Null)
        })(),
        "export.json" => (|| {
            let name = format!("fin-export-{}.json", backups::local_date());
            let Some(path) = app.dialogs.choose_save_path("Export all data", &name, "json") else {
                return Ok(Value::Null);
            };
            let text = format!(
                "{}
",
                export::to_js_pretty(&export::export_json(app.db())?)
            );
            std::fs::write(&path, text).map_err(|_| io("Fin could not write the export file."))?;
            Ok(json!({ "path": path_str(&path) }))
        })(),
        "export.csv" => (|| {
            let name = format!("fin-transactions-{}.csv", backups::local_date());
            let Some(path) = app.dialogs.choose_save_path("Export transactions", &name, "csv") else {
                return Ok(Value::Null);
            };
            std::fs::write(&path, export::export_transactions_csv(app.db())?)
                .map_err(|_| io("Fin could not write the export file."))?;
            Ok(json!({ "path": path_str(&path) }))
        })(),
        "demo.enter" => app.enter_demo().and_then(|_| status(app)),
        "demo.exit" => app.exit_demo().and_then(|_| status(app)),
        _ => return None,
    };
    Some(result)
}

fn status(app: &App) -> DbResult<Value> {
    Ok(json!({
        "demo": app.is_demo(),
        "dataDir": app.paths.data_dir.to_string_lossy(),
        "backupDir": path_str(&app.backup_dir()?),
        "defaultBackupDir": app.default_backup_dir(),
        "counts": count_data(app.db())?,
    }))
}

/// `None` when the channel is not ported to Rust yet.
pub fn handle(app: &mut App, channel: &str, input: &Value) -> Option<DbResult<Value>> {
    if let Some(r) = handle_files(app, channel, input) {
        return Some(r);
    }
    let today = || settings::today(app.db());
    let db = app.db();
    let result = match channel {
        "settings.get" => settings::get_settings(db).map(Value::Object),
        "settings.update" => {
            settings::update_settings(db, input.as_object().unwrap_or(&Default::default())).map(Value::Object)
        }
        "accounts.list" => {
            accounts::list_accounts(db, input.get("includeArchived").and_then(Value::as_bool).unwrap_or(false))
                .map(Value::Array)
        }
        "accounts.create" => accounts::create_account(db, input),
        "accounts.update" => accounts::update_account(db, s(input, "id"), &input["patch"]),
        "accounts.archive" => {
            accounts::set_account_archived(db, s(input, "id"), input["archived"].as_bool().unwrap_or(false))
        }
        "accounts.reconcile" => accounts::reconcile(
            db,
            s(input, "id"),
            s(input, "statementDate"),
            input["statementBalanceMinor"].as_i64().unwrap_or(0),
        ),
        "categories.list" => categories::list_categories(db).map(Value::Array),
        "tags.list" => categories::list_tags(db).map(Value::Array),
        "txns.query" => transactions::query_transactions(db, input),
        "txns.get" => transactions::get_transaction(db, s(input, "id")),
        "txns.create" => transactions::create_transaction(db, input),
        "txns.update" => transactions::update_transaction(db, s(input, "id"), &input["patch"]),
        "txns.delete" => transactions::delete_transactions(db, &ids(input, "ids")),
        "txns.bulkUpdate" => transactions::bulk_update(db, input),
        "transfers.create" => transactions::create_transfer(db, input),
        "transfers.update" => transactions::update_transfer(db, s(input, "transferId"), &input["patch"]),
        "payees.suggest" => transactions::suggest_payees(
            db,
            s(input, "prefix"),
            input.get("limit").and_then(Value::as_u64).unwrap_or(8) as usize,
        )
        .map(Value::Array),
        "activity.list" => activity(app, input.get("limit").and_then(Value::as_i64).unwrap_or(50)),
        "undo.apply" => audit::undo_group(db, s(input, "auditGroupId"))
            .map(|r| json!({ "reverted": r.result, "auditGroupId": r.audit_group_id })),
        "import.presets" => imports::list_presets(db).map(Value::Array),
        "import.savePreset" => imports::save_preset(db, s(input, "name"), &input["mapping"]),
        "import.preview" => imports::preview_import(db, input),
        "import.commit" => imports::commit_import(db, input),
        "import.batches" => imports::list_batches(db, 100).map(Value::Array),
        "import.batchRows" => imports::batch_rows(db, s(input, "id")).map(Value::Array),
        "import.undo" => {
            imports::undo_import(db, s(input, "batchId"), input["includeEdited"].as_bool().unwrap_or(false))
        }
        "categories.create" => categorization::create_category(db, input),
        "categories.update" => categorization::update_category(db, input),
        "categories.usage" => categorization::category_usage(db, s(input, "id")),
        "categories.delete" => {
            categorization::delete_category(db, s(input, "id"), input.get("replacementId").and_then(Value::as_str))
        }
        "rules.list" => categorization::list_rules(db).map(Value::Array),
        "rules.create" => categorization::create_rule(db, input),
        "rules.update" => categorization::update_rule(db, s(input, "id"), &input["input"]),
        "rules.delete" => categorization::delete_rule(db, s(input, "id")),
        "rules.preview" => {
            let only = input.get("onlyUncategorized").and_then(Value::as_bool).unwrap_or(true);
            if let Some(id) = input.get("ruleId").and_then(Value::as_str) {
                categorization::preview_saved_rule(db, id, only)
            } else if let Some(rule) = input.get("rule") {
                categorization::preview_rule(db, &categorization::draft_rule(rule), only)
            } else {
                Err(AppError::invariant("Choose a rule to preview"))
            }
        }
        "rules.apply" => categorization::apply_rule(db, s(input, "ruleId"), &ids(input, "txnIds")),
        "suggestions.forTxns" => categorization::suggest_for_txns(db, &ids(input, "txnIds")).map(Value::Array),
        "dashboard.summary" => (|| match input.get("asOf").and_then(Value::as_str) {
            Some(d) => dashboard::dashboard_summary(db, d),
            None => dashboard::dashboard_summary(db, &today()?),
        })(),
        "networth.history" => (|| {
            networth::net_worth_history_for(
                db,
                &today()?,
                input.get("from").and_then(Value::as_str),
                input.get("to").and_then(Value::as_str),
            )
        })(),
        "recurring.list" => (|| planning::list_recurring(db, &today()?).map(Value::Array))(),
        "recurring.create" => (|| planning::create_recurring(db, input, &today()?))(),
        "recurring.update" => (|| planning::update_recurring(db, s(input, "id"), &input["input"], &today()?))(),
        "recurring.delete" => planning::delete_recurring(db, s(input, "id")),
        "recurring.occurrences" => {
            (|| planning::list_occurrences(db, s(input, "from"), s(input, "to"), &today()?).map(Value::Array))()
        }
        "recurring.candidates" => {
            planning::occurrence_candidates(db, s(input, "itemId"), s(input, "dueDate")).map(Value::Array)
        }
        "recurring.setOccurrence" => planning::set_occurrence(db, input),
        "budget.month" => planning::budget_month(db, s(input, "month")),
        "budget.assign" => planning::assign_budget(
            db,
            s(input, "month"),
            s(input, "categoryId"),
            input["assignedMinor"].as_i64().unwrap_or(0),
        ),
        "goals.list" => (|| planning::list_goals(db, &today()?).map(Value::Array))(),
        "goals.create" => (|| planning::create_goal(db, input, &today()?))(),
        "goals.update" => (|| planning::update_goal(db, s(input, "id"), &input["input"], &today()?))(),
        "goals.delete" => planning::delete_goal(db, s(input, "id")),
        "goals.contribute" => (|| planning::contribute(db, input, &today()?))(),
        "goals.deleteContribution" => planning::delete_contribution(db, s(input, "id")),
        "forecast.run" => (|| forecast::forecast(db, input["days"].as_i64().unwrap_or(30), &today()?))(),
        "scenarios.run" => (|| {
            let changes = input["changes"].as_array().cloned().unwrap_or_default();
            forecast::what_if(db, input["days"].as_i64().unwrap_or(30), &changes, &today()?)
        })(),
        "insights.list" => (|| {
            patterns::list_insights(
                db,
                &today()?,
                input.get("includeDismissed").and_then(Value::as_bool).unwrap_or(false),
            )
        })(),
        "insights.dismiss" => patterns::dismiss_insight(db, s(input, "key")),
        "insights.restore" => patterns::restore_insight(db, s(input, "key")),
        "recurring.detectCandidates" => (|| patterns::recurring_suggestions(db, &today()?).map(Value::Array))(),
        "valuations.list" => networth::list_valuations(db, s(input, "accountId")).map(Value::Array),
        "valuations.upsert" => (|| networth::upsert_valuation(db, input, &today()?))(),
        "valuations.delete" => networth::delete_valuation(db, s(input, "id")),
        "views.list" => views::list_views(db).map(Value::Array),
        "views.create" => views::create_view(db, input),
        "views.update" => views::update_view(db, s(input, "id"), &input["patch"]),
        "views.delete" => views::delete_view(db, s(input, "id")),
        "reminders.preview" => reminders::preview(db).map(Value::Array),
        "reminders.test" => Ok(reminders::test_reminder()),
        "review.month" => review::review_month(db, s(input, "month")),
        "review.setState" => {
            review::set_review_state(db, s(input, "month"), input.get("state").and_then(Value::as_str))
        }
        "review.prompt" => (|| review::review_prompt(db, &today()?))(),
        "budget.copyMonth" => review::copy_budget(db, s(input, "from"), s(input, "to")),
        "review.year" => {
            (|| year::year_review(db, s(input, "basis"), input.get("year").and_then(Value::as_i64), &today()?))()
        }
        "loans.summary" => (|| loans::loans_summary(db, &today()?).map(Value::Array))(),
        "loans.schedule" => (|| loans::loan_schedule(db, s(input, "id"), &today()?))(),
        "health.summary" => (|| health::health_summary(db, &today()?))(),
        "cards.cycles" => (|| cards::card_cycles(db, &today()?).map(Value::Array))(),
        "insights.calendar" => (|| calendar::spending_calendar(db, s(input, "month"), &today()?))(),
        "app.status" => status(app),
        _ => return None,
    };
    Some(result)
}

pub fn not_ported() -> AppError {
    AppError::new(ErrorCode::Internal, "This part of Fin is not available in this build yet.")
}
