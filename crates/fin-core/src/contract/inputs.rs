//! Request input schemas, a line-for-line port of `src/shared/schemas.ts` and the channel table in
//! `src/shared/contract.ts`. Keep the order of fields and checks identical: it decides the order
//! of reported issues.

use std::collections::HashMap;
use std::sync::LazyLock;

use regex::Regex;
use serde_json::{Value, json};

use super::schema::*;
use crate::domain::dates::{is_calendar_date, is_time_zone};
use crate::domain::money::MAX_SAFE;

pub const ACCOUNT_TYPES: &[&str] =
    &["cash", "bank", "credit_card", "investment", "loan", "other_asset", "other_liability"];
pub const FREQUENCIES: &[&str] = &["weekly", "monthly", "yearly"];
const CATEGORY_GROUPS: &[&str] = &["needs", "wants", "goals", "buffer", "income", "transfer"];

static CURRENCY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Z]{3}$").unwrap());
static MONTH_KEY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{4}-(0[1-9]|1[0-2])$").unwrap());
static TIME_OF_DAY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^([01]\d|2[0-3]):[0-5]\d$").unwrap());

fn str_of(v: &Value) -> &str {
    v.as_str().unwrap_or_default()
}

/// Integer minor units within the safe-integer range.
fn minor() -> Schema {
    int().min(-MAX_SAFE).max(MAX_SAFE)
}
fn calendar_date() -> Schema {
    string().refine(|v| is_calendar_date(str_of(v)), "Invalid date (expected YYYY-MM-DD)")
}
fn id() -> Schema {
    string().min_len(1).max_len(64)
}
fn name() -> Schema {
    string().trim().min_len_msg(1, "Required").max_len(120)
}
fn notes() -> Schema {
    string().max_len(2000).nullable()
}
fn empty() -> Schema {
    object(vec![]).optional()
}
fn non_zero(v: &Value) -> bool {
    v.as_f64() != Some(0.0)
}
fn currency() -> Schema {
    string().pattern(&CURRENCY, "/^[A-Z]{3}$/")
}
/// 24-hour local time, HH:MM.
fn time_of_day() -> Schema {
    string().pattern(&TIME_OF_DAY, r"/^([01]\d|2[0-3]):[0-5]\d$/")
}
fn days() -> Schema {
    union(vec![literal(json!(30)), literal(json!(60)), literal(json!(90))])
}

fn settings_patch() -> Schema {
    object(vec![
        ("currency", currency().optional()),
        ("timezone", string().refine(|v| is_time_zone(str_of(v)), "Unknown time zone").optional()),
        ("fyStartMonth", int().min(1).max(12).optional()),
        ("weekStart", int().min(0).max(6).optional()),
        ("locale", string().min_len(2).max_len(20).optional()),
        ("theme", enumeration(&["system", "light", "dark"]).optional()),
        ("bufferMinor", minor().min(0).optional()),
        ("onboarded", boolean().optional()),
        ("backupDir", string().max_len(1000).nullable().optional()),
        ("notifyEnabled", boolean().optional()),
        ("notifyRecurring", boolean().optional()),
        ("notifyCardDue", boolean().optional()),
        ("notifyLowCash", boolean().optional()),
        ("cardDueNoticeDays", int().min(1).max(10).optional()),
        ("quietHoursStart", time_of_day().optional()),
        ("quietHoursEnd", time_of_day().optional()),
        ("notifyShowAmounts", boolean().optional()),
        ("keepInTray", boolean().optional()),
        ("startAtLogin", boolean().optional()),
    ])
}

fn account_input() -> Schema {
    object(vec![
        ("name", name()),
        ("type", enumeration(ACCOUNT_TYPES)),
        ("openingBalanceMinor", minor().optional()),
        ("openingDate", calendar_date()),
        ("notes", notes().optional()),
        ("currency", currency().optional()),
        ("statementDay", int().min(1).max(31).nullable().optional()),
        ("dueDaysAfter", int().min(1).max(60).nullable().optional()),
        ("rateBp", int().min(0).max(10000).nullable().optional()),
        ("loanPrincipalMinor", minor().min(1).nullable().optional()),
        ("tenureMonths", int().min(1).max(600).nullable().optional()),
        ("firstEmiDate", calendar_date().nullable().optional()),
        ("depositKind", enumeration(&["fd", "rd"]).nullable().optional()),
        ("maturityDate", calendar_date().nullable().optional()),
        ("installmentMinor", minor().min(1).nullable().optional()),
        ("payoutAccountId", id().nullable().optional()),
    ])
}

fn split_part() -> Schema {
    object(vec![("categoryId", id()), ("amountMinor", minor()), ("memo", string().max_len(500).nullable().optional())])
}
fn tag_names() -> Schema {
    array(string().trim().min_len(1).max_len(40)).max_len(20)
}

fn txn_input() -> Schema {
    object(vec![
        ("accountId", id()),
        ("postedDate", calendar_date()),
        ("amountMinor", minor().refine(non_zero, "Amount cannot be zero")),
        ("payee", string().trim().max_len(300).optional()),
        ("notes", notes().optional()),
        ("categoryId", id().nullable().optional()),
        ("splits", array(split_part()).max_len(50).optional()),
        ("tags", tag_names().optional()),
        ("status", enumeration(&["cleared", "pending"]).optional()),
    ])
}

fn transfer_input() -> Schema {
    object(vec![
        ("fromAccountId", id()),
        ("toAccountId", id()),
        ("postedDate", calendar_date()),
        ("amountMinor", minor().min_msg(1, "Amount must be greater than zero")),
        ("notes", notes().optional()),
    ])
}

fn txn_filter() -> Schema {
    object(vec![
        ("text", string().max_len(200).optional()),
        ("from", calendar_date().optional()),
        ("to", calendar_date().optional()),
        ("accountIds", array(id()).max_len(200).optional()),
        ("categoryIds", array(id()).max_len(500).optional()),
        ("categoryGroup", category_group().optional()),
        ("tagIds", array(id()).max_len(200).optional()),
        ("minAmountMinor", minor().min(0).optional()),
        ("maxAmountMinor", minor().min(0).optional()),
        ("direction", enumeration(&["in", "out"]).optional()),
        ("kind", enumeration(&["standard", "transfer"]).optional()),
        ("importBatchId", id().optional()),
        ("cursor", string().max_len(200).optional()),
        ("limit", int().min(1).max(500).optional()),
    ])
}

fn mapping_schema() -> Schema {
    object(vec![
        ("headerRow", int().min(0).max(1000)),
        ("dateOrder", enumeration(&["dmy", "mdy", "ymd"])),
        ("amountMode", enumeration(&["single", "debit_credit", "indicator"])),
        (
            "columns",
            object(vec![
                ("date", string().max_len(200)),
                ("description", string().max_len(200)),
                ("amount", string().max_len(200).optional()),
                ("debit", string().max_len(200).optional()),
                ("credit", string().max_len(200).optional()),
                ("indicator", string().max_len(200).optional()),
                ("balance", string().max_len(200).optional()),
                ("reference", string().max_len(200).optional()),
            ]),
        ),
        ("signInverted", boolean().optional()),
    ])
}

const MAX_IMPORT_ROWS: usize = 20_000;

fn raw_cells() -> Schema {
    array(string().max_len(2000)).max_len(100)
}

fn imported_line() -> Schema {
    object(vec![
        ("rowNumber", int().min(1)),
        ("raw", raw_cells()),
        ("date", calendar_date()),
        ("amountMinor", minor().refine(non_zero, "Amount cannot be zero")),
        ("description", string().max_len(1000)),
        ("reference", string().max_len(200).nullable().optional()),
        ("balanceMinor", minor().nullable().optional()),
    ])
}

fn import_preview_input() -> Schema {
    object(vec![
        ("accountId", id()),
        ("fileHash", string().max_len(128).nullable().optional()),
        (
            "rows",
            array(imported_line().pick(&["rowNumber", "date", "amountMinor", "description"])).max_len(MAX_IMPORT_ROWS),
        ),
    ])
}

fn import_commit_input() -> Schema {
    object(vec![
        ("accountId", id()),
        ("fileName", string().trim().min_len(1).max_len(260)),
        ("fileHash", string().max_len(128).nullable().optional()),
        ("mapping", mapping_schema()),
        ("rows", array(imported_line()).max_len(MAX_IMPORT_ROWS)),
        (
            "rejected",
            array(object(vec![
                ("rowNumber", int().min(1)),
                ("raw", raw_cells()),
                ("status", enumeration(&["error", "ignored"])),
                ("message", string().max_len(500)),
            ]))
            .max_len(MAX_IMPORT_ROWS),
        ),
        ("importPossibleDuplicates", array(int().min(1)).max_len(MAX_IMPORT_ROWS)),
        ("statementClosing", object(vec![("date", calendar_date()), ("balanceMinor", minor())]).nullable().optional()),
        (
            "categories",
            array(object(vec![("rowNumber", int().min(1)), ("categoryId", id())])).max_len(MAX_IMPORT_ROWS).optional(),
        ),
        ("savePresetAs", string().trim().min_len(1).max_len(80).nullable().optional()),
    ])
}

fn passphrase() -> Schema {
    string().min_len_msg(8, "Use at least 8 characters").max_len(200)
}
fn backup_inspect_input() -> Schema {
    object(vec![("path", string().min_len(1).max_len(4000)), ("passphrase", string().max_len(200).optional())])
}

fn month_key() -> Schema {
    string().check(Check::Custom(|v| MONTH_KEY.is_match(str_of(v)), "Invalid month (expected YYYY-MM)", &[]))
}

fn recurring_input() -> Schema {
    object(vec![
        ("name", name()),
        ("kind", enumeration(&["income", "bill", "subscription", "emi", "transfer", "savings"])),
        ("accountId", id()),
        ("toAccountId", id().nullable().optional()),
        ("categoryId", id().nullable().optional()),
        ("amountMinor", minor().min_msg(1, "Amount must be greater than zero")),
        ("toleranceBp", int().min(0).max(5000).optional()),
        ("frequency", enumeration(FREQUENCIES)),
        ("interval", int().min_msg(1, "At least 1").max(52).optional()),
        ("anchorDate", calendar_date()),
        ("endDate", calendar_date().nullable().optional()),
        ("count", int().min(1).max(1000).nullable().optional()),
        ("notes", notes().optional()),
        ("active", boolean().optional()),
        ("setAside", boolean().optional()),
    ])
    .refine_at(
        |v| match v["endDate"].as_str() {
            Some(end) => end >= v["anchorDate"].as_str().unwrap_or_default(),
            None => true,
        },
        "The end date is before the first date",
        &["endDate"],
    )
    .refine_at(
        |v| match v["toAccountId"].as_str() {
            Some(to) if !to.is_empty() => Some(to) != v["accountId"].as_str(),
            _ => true,
        },
        "Choose a different account",
        &["toAccountId"],
    )
}

fn occurrence_ref() -> Schema {
    object(vec![("itemId", id()), ("dueDate", calendar_date())])
}

fn goal_input() -> Schema {
    object(vec![
        ("name", name()),
        ("targetMinor", minor().min_msg(1, "Target must be greater than zero")),
        ("targetDate", calendar_date().nullable().optional()),
        ("linkedAccountId", id().nullable().optional()),
        ("notes", notes().optional()),
    ])
}

fn category_group() -> Schema {
    enumeration(CATEGORY_GROUPS)
}

fn rule_text() -> Schema {
    string().trim().min_len_msg(1, "Enter some text").max_len(200)
}

fn rule_condition() -> Schema {
    discriminated(
        "field",
        vec![
            (
                "description",
                object(vec![
                    ("field", literal(json!("description"))),
                    ("op", enumeration(&["contains", "equals", "startsWith", "regex"])),
                    ("value", rule_text()),
                ]),
            ),
            (
                "merchant",
                object(vec![
                    ("field", literal(json!("merchant"))),
                    ("op", enumeration(&["equals", "contains"])),
                    ("value", rule_text()),
                ]),
            ),
            (
                "amount",
                object(vec![
                    ("field", literal(json!("amount"))),
                    ("op", literal(json!("between"))),
                    ("min", minor().min(0).nullable().optional()),
                    ("max", minor().min(0).nullable().optional()),
                ]),
            ),
            (
                "direction",
                object(vec![
                    ("field", literal(json!("direction"))),
                    ("op", literal(json!("equals"))),
                    ("value", enumeration(&["in", "out"])),
                ]),
            ),
            (
                "account",
                object(vec![("field", literal(json!("account"))), ("op", literal(json!("equals"))), ("value", id())]),
            ),
        ],
    )
}

fn rule_input() -> Schema {
    object(vec![
        ("name", name()),
        ("priority", int().min(0).max(10_000).optional()),
        ("enabled", boolean().optional()),
        ("conditions", array(rule_condition()).min_len_msg(1, "Add at least one condition").max_len(10)),
        ("categoryId", id()),
    ])
}

fn scenario_change() -> Schema {
    let positive = || minor().min_msg(1, "Enter an amount");
    let non_zero_amount = || minor().refine(non_zero, "Enter an amount");
    discriminated(
        "kind",
        vec![
            (
                "new_bill",
                object(vec![
                    ("kind", literal(json!("new_bill"))),
                    ("name", name()),
                    ("amountMinor", positive()),
                    ("frequency", enumeration(FREQUENCIES)),
                    ("startDate", calendar_date()),
                ]),
            ),
            (
                "income_change",
                object(vec![
                    ("kind", literal(json!("income_change"))),
                    ("amountMinor", non_zero_amount()),
                    ("fromDate", calendar_date()),
                ]),
            ),
            (
                "large_purchase",
                object(vec![
                    ("kind", literal(json!("large_purchase"))),
                    ("name", name()),
                    ("amountMinor", positive()),
                    ("date", calendar_date()),
                ]),
            ),
            (
                "loan_prepayment",
                object(vec![
                    ("kind", literal(json!("loan_prepayment"))),
                    ("loanId", id()),
                    ("amountMinor", positive()),
                    ("date", calendar_date()),
                ]),
            ),
            (
                "savings_change",
                object(vec![
                    ("kind", literal(json!("savings_change"))),
                    ("goalId", id().nullable()),
                    ("amountMinor", non_zero_amount()),
                    ("fromDate", calendar_date()),
                ]),
            ),
        ],
    )
}

fn build() -> HashMap<&'static str, Schema> {
    let id_input = || object(vec![("id", id())]);
    let ids = || array(id()).min_len(1).max_len(5000);
    let entries: Vec<(&'static str, Schema)> = vec![
        ("settings.get", empty()),
        ("settings.update", settings_patch()),
        ("accounts.list", object(vec![("includeArchived", boolean().optional())]).optional()),
        ("accounts.create", account_input()),
        ("accounts.update", object(vec![("id", id()), ("patch", account_input().partial())])),
        ("accounts.archive", object(vec![("id", id()), ("archived", boolean())])),
        ("categories.list", empty()),
        ("tags.list", empty()),
        ("txns.query", txn_filter()),
        ("txns.get", id_input()),
        ("txns.create", txn_input()),
        ("txns.update", object(vec![("id", id()), ("patch", txn_input().partial())])),
        ("txns.delete", object(vec![("ids", ids())])),
        (
            "txns.bulkUpdate",
            object(vec![
                ("ids", ids()),
                ("categoryId", id().nullable().optional()),
                ("addTags", tag_names().optional()),
                ("removeTagIds", array(id()).max_len(50).optional()),
            ]),
        ),
        ("transfers.create", transfer_input()),
        ("transfers.update", object(vec![("transferId", id()), ("patch", transfer_input().partial())])),
        ("payees.suggest", object(vec![("prefix", string().max_len(100)), ("limit", int().min(1).max(20).optional())])),
        ("activity.list", object(vec![("limit", int().min(1).max(200).optional())]).optional()),
        ("undo.apply", object(vec![("auditGroupId", id())])),
        (
            "accounts.reconcile",
            object(vec![("id", id()), ("statementDate", calendar_date()), ("statementBalanceMinor", minor())]),
        ),
        ("import.presets", empty()),
        (
            "import.savePreset",
            object(vec![
                ("name", string().trim().min_len(1).max_len(80)),
                ("mapping", mapping_schema().omit(&["headerRow"])),
            ]),
        ),
        ("import.preview", import_preview_input()),
        ("import.commit", import_commit_input()),
        ("import.batches", empty()),
        ("import.batchRows", id_input()),
        ("import.undo", object(vec![("batchId", id()), ("includeEdited", boolean())])),
        ("dashboard.summary", object(vec![("asOf", calendar_date().optional())]).optional()),
        ("app.status", empty()),
        ("backup.list", empty()),
        ("backup.create", object(vec![("passphrase", passphrase().optional())]).optional()),
        ("backup.pickFile", empty()),
        ("backup.inspect", backup_inspect_input()),
        ("backup.restore", backup_inspect_input().extend(vec![("confirm", literal(json!(true)))])),
        ("backup.chooseFolder", empty()),
        ("backup.openFolder", empty()),
        ("export.json", empty()),
        ("export.csv", empty()),
        ("demo.enter", empty()),
        ("demo.exit", empty()),
        ("recurring.list", empty()),
        ("recurring.create", recurring_input()),
        ("recurring.update", object(vec![("id", id()), ("input", recurring_input())])),
        ("recurring.delete", id_input()),
        (
            "recurring.occurrences",
            object(vec![("from", calendar_date()), ("to", calendar_date())])
                .refine(|v| str_of(&v["from"]) <= str_of(&v["to"]), "from must not be after to"),
        ),
        ("recurring.candidates", occurrence_ref()),
        (
            "recurring.setOccurrence",
            occurrence_ref()
                .extend(vec![("action", enumeration(&["skip", "match", "reset"])), ("txnId", id().optional())]),
        ),
        ("budget.month", object(vec![("month", month_key())])),
        (
            "budget.assign",
            object(vec![
                ("month", month_key()),
                ("categoryId", id()),
                ("assignedMinor", minor().min_msg(0, "Assign zero or more")),
            ]),
        ),
        ("goals.list", empty()),
        ("goals.create", goal_input()),
        ("goals.update", object(vec![("id", id()), ("input", goal_input())])),
        ("goals.delete", id_input()),
        (
            "goals.contribute",
            object(vec![
                ("goalId", id()),
                ("date", calendar_date()),
                ("amountMinor", minor().refine(non_zero, "Amount cannot be zero")),
                ("note", string().trim().max_len(300).nullable().optional()),
            ]),
        ),
        ("goals.deleteContribution", id_input()),
        (
            "categories.create",
            object(vec![
                ("name", name()),
                ("parentId", id().nullable().optional()),
                ("group", category_group().optional()),
            ]),
        ),
        (
            "categories.update",
            object(vec![
                ("id", id()),
                ("name", name().optional()),
                ("parentId", id().nullable().optional()),
                ("group", category_group().optional()),
            ]),
        ),
        ("categories.usage", id_input()),
        ("categories.delete", object(vec![("id", id()), ("replacementId", id().nullable().optional())])),
        ("rules.list", empty()),
        ("rules.create", rule_input()),
        ("rules.update", object(vec![("id", id()), ("input", rule_input())])),
        ("rules.delete", id_input()),
        (
            "rules.preview",
            object(vec![
                ("ruleId", id().optional()),
                ("rule", rule_input().optional()),
                ("onlyUncategorized", boolean().optional()),
            ]),
        ),
        ("rules.apply", object(vec![("ruleId", id()), ("txnIds", ids())])),
        ("suggestions.forTxns", object(vec![("txnIds", array(id()).max_len(1000))])),
        ("forecast.run", object(vec![("days", days())])),
        (
            "networth.history",
            object(vec![("from", calendar_date().optional()), ("to", calendar_date().optional())]).optional(),
        ),
        ("valuations.list", object(vec![("accountId", id())])),
        (
            "valuations.upsert",
            object(vec![
                ("accountId", id()),
                ("date", calendar_date()),
                ("valueMinor", minor().min_msg(0, "Enter the value as a positive amount")),
                ("note", string().trim().max_len(500).nullable().optional()),
            ]),
        ),
        ("valuations.delete", id_input()),
        ("insights.list", object(vec![("includeDismissed", boolean().optional())]).optional()),
        ("insights.dismiss", object(vec![("key", string().min_len(1).max_len(300))])),
        ("insights.restore", object(vec![("key", string().min_len(1).max_len(300))])),
        ("recurring.detectCandidates", empty()),
        ("scenarios.run", object(vec![("days", days()), ("changes", array(scenario_change()).max_len(20))])),
        ("views.list", empty()),
        (
            "views.create",
            object(vec![("name", name()), ("query", string().max_len(2000)), ("pinned", boolean().optional())]),
        ),
        (
            "views.update",
            object(vec![
                ("id", id()),
                (
                    "patch",
                    object(vec![
                        ("name", name().optional()),
                        ("query", string().max_len(2000).optional()),
                        ("pinned", boolean().optional()),
                    ]),
                ),
            ]),
        ),
        ("views.delete", id_input()),
        ("cards.cycles", empty()),
        ("insights.calendar", object(vec![("month", month_key())])),
        ("reminders.preview", empty()),
        ("reminders.test", empty()),
        ("health.summary", empty()),
        ("review.month", object(vec![("month", month_key())])),
        (
            "review.setState",
            object(vec![("month", month_key()), ("state", enumeration(&["reviewed", "dismissed"]).nullable())]),
        ),
        ("review.prompt", empty()),
        ("loans.summary", empty()),
        ("loans.schedule", id_input()),
        ("deposits.summary", empty()),
        ("tax.year", object(vec![("year", int().min(2000).max(2100).optional())]).optional()),
        (
            "tax.updateSection",
            object(vec![
                ("id", id()),
                ("label", name().optional()),
                ("limitMinor", minor().min(0).nullable().optional()),
            ]),
        ),
        (
            "tax.map",
            object(vec![
                ("sectionId", id()),
                ("categoryId", id().optional()),
                ("loanAccountId", id().optional()),
                ("loanPart", enumeration(&["interest", "principal"]).optional()),
            ]),
        ),
        ("tax.unmap", id_input()),
        ("tax.exportCsv", object(vec![("year", int().min(2000).max(2100))])),
        ("people.list", empty()),
        ("people.create", object(vec![("name", name())])),
        ("people.update", object(vec![("id", id()), ("name", name().optional()), ("archived", boolean().optional())])),
        ("people.entries", id_input()),
        (
            "people.addEntry",
            object(vec![
                ("personId", id().optional()),
                ("personName", name().optional()),
                ("transactionId", id().optional()),
                ("amountMinor", minor().refine(non_zero, "Enter an amount")),
                ("date", calendar_date().optional()),
                ("note", string().trim().max_len(300).nullable().optional()),
            ]),
        ),
        ("people.deleteEntry", id_input()),
        ("people.forTransaction", id_input()),
        ("people.repaymentCandidates", id_input()),
        (
            "people.settle",
            object(vec![
                ("personId", id()),
                ("transactionId", id().optional()),
                ("amountMinor", minor().min(1).optional()),
                ("date", calendar_date().optional()),
                ("note", string().trim().max_len(300).nullable().optional()),
            ]),
        ),
        ("cas.preview", object(vec![("text", string().min_len(1).max_len(2_000_000))])),
        (
            "cas.commit",
            object(vec![
                ("statementDate", calendar_date()),
                (
                    "folios",
                    array(object(vec![
                        ("key", string().max_len(300)),
                        ("accountId", id().optional()),
                        ("newName", name().optional()),
                        ("valueMinor", minor().min(0)),
                    ]))
                    .min_len(1)
                    .max_len(200),
                ),
            ]),
        ),
        ("budget.copyMonth", object(vec![("from", month_key()), ("to", month_key())])),
        (
            "review.year",
            object(vec![("basis", enumeration(&["fy", "calendar"])), ("year", int().min(1900).max(9999).optional())]),
        ),
    ];
    entries.into_iter().collect()
}

static SCHEMAS: LazyLock<HashMap<&'static str, Schema>> = LazyLock::new(build);

/// The input schema for a channel, or `None` for an unknown channel.
pub fn schema_for(channel: &str) -> Option<&'static Schema> {
    SCHEMAS.get(channel)
}
