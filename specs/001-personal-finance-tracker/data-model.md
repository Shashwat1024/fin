# Data Model: Personal Finance Tracker

**Feature**: [spec.md](./spec.md) · **Research**: [research.md](./research.md) · **Date**: 2026-11-08

Conventions: all money columns are `*_minor INTEGER` (paise) with a sibling or inherited
`currency TEXT` (ISO-4217, default `INR`). Calendar dates are `TEXT 'YYYY-MM-DD'`; instants are
`TEXT` UTC ISO-8601. Primary keys are `TEXT` ULIDs (sortable, generated in main process). Soft delete
uses `deleted_at`. Every mutating operation writes an `audit_log` row in the same transaction.

## Settings (singleton, key/value)

| Field | Type | Rules |
|---|---|---|
| currency | TEXT | ISO-4217; default `INR` |
| timezone | TEXT | IANA; default `Asia/Kolkata` |
| fy_start_month | INTEGER | 1–12; default 4 |
| week_start | INTEGER | 0–6; default 1 (Monday) |
| locale | TEXT | default `en-IN` |
| buffer_minor | INTEGER | ≥ 0; forecast warning threshold |
| backup_dir | TEXT? | null = app data folder |
| theme | TEXT | `system` \| `light` \| `dark` |
| app_id / schema_version | TEXT / INTEGER | identity marker used by restore validation |

## Account

| Field | Type | Rules |
|---|---|---|
| id | TEXT PK | |
| name | TEXT | required, unique among non-archived |
| type | TEXT | `cash` \| `bank` \| `credit_card` \| `investment` \| `loan` \| `other_asset` \| `other_liability` |
| nature | TEXT | derived: `asset` for cash/bank/investment/other_asset; `liability` otherwise |
| currency | TEXT | default settings.currency |
| opening_balance_minor | INTEGER | signed; for liabilities positive = owed |
| opening_date | TEXT date | required |
| is_liquid | INTEGER | 1 for cash/bank (cash position per Clarification 1) |
| archived_at | TEXT? | archived accounts hidden but kept in totals history |
| sort_order, created_at, updated_at | | |

**Balance** = opening_balance + Σ transaction amounts (non-deleted) for the account. Stored sign
convention: inflow positive, outflow negative, for all account types; liabilities display
`−balance` as "owed".

## Transaction

| Field | Type | Rules |
|---|---|---|
| id | TEXT PK | |
| account_id | FK Account | required |
| posted_date | TEXT date | required |
| amount_minor | INTEGER | non-zero; sign as above |
| payee_raw | TEXT | original description |
| merchant_id | FK Merchant? | |
| category_id | FK Category? | null when split (see Split) or uncategorised |
| notes | TEXT? | |
| kind | TEXT | `standard` \| `transfer` \| `opening_adjustment` |
| transfer_id | FK Transfer? | required iff kind = transfer |
| import_batch_id | FK ImportBatch? | null for manual |
| import_row_id | FK ImportRow? | |
| fingerprint | TEXT? | see research R10 |
| occurrence_index | INTEGER | default 0 |
| recurring_occurrence_id | FK? | set when matched |
| status | TEXT | `cleared` \| `pending` |
| deleted_at, created_at, updated_at | | |

Indexes: `(account_id, posted_date)`, `(category_id, posted_date)`,
unique `(account_id, fingerprint, occurrence_index) WHERE fingerprint IS NOT NULL AND deleted_at IS NULL`.
FTS5 table `transaction_fts(payee_raw, notes, merchant_name)`.

## Split

| Field | Type | Rules |
|---|---|---|
| id | TEXT PK | |
| transaction_id | FK Transaction | |
| category_id | FK Category | required |
| amount_minor | INTEGER | same sign as parent; Σ splits = parent amount (enforced in domain + check on save) |
| memo | TEXT? | |

A transaction has either `category_id` or ≥ 2 splits, never both.

## Transfer

| Field | Type | Rules |
|---|---|---|
| id | TEXT PK | |
| from_txn_id / to_txn_id | FK Transaction | amounts are exact negatives of each other |
| created_at | | |

Pairing imported legs: when an imported row matches an existing transfer leg (opposite account,
same absolute amount, date ± 3 days) the user is offered to link instead of creating a duplicate.

## Category / Tag / Merchant

- **Category**: `id, name, parent_id? (max depth 2), group (needs|wants|goals|buffer|income|transfer),
  is_system, archived_at`. Deleting a used category requires `replacement_id`.
- **Tag**: `id, name (unique, case-insensitive)`; join `transaction_tag(transaction_id, tag_id)`.
- **Merchant**: `id, display_name, normalized_key (unique), default_category_id?` (learned
  suggestion source, CA-03).

## Rule

| Field | Type | Rules |
|---|---|---|
| id, name, priority | | lower priority value evaluated first |
| conditions | TEXT JSON | `[{field: description|merchant|amount|account, op: contains|equals|regex|between, value}]`, AND-ed |
| actions | TEXT JSON | `{categoryId?, tagIds?, merchantName?}` |
| enabled | INTEGER | |

Rules produce **suggestions**; application to history goes through a previewed, audited bulk change.

## RecurringItem / RecurringOccurrence

- **RecurringItem**: `id, name, kind (income|bill|subscription|emi|transfer|savings), account_id,
  to_account_id?, category_id?, amount_minor, tolerance_bp (basis points, default 1000 = 10%),
  frequency, interval, anchor_date, by_month_day?, by_weekday?, end_date?, count?, active`.
- **RecurringOccurrence**: `id, item_id, due_date, expected_minor, state (expected|paid|overdue|skipped),
  matched_txn_id?`. Generated on demand for a horizon (≤ 400 days) and persisted when matched/skipped.
  *As built (US5)*: only user decisions are stored (`state paid|skipped`, unique per item and date);
  automatic matches and `expected`/`overdue` are derived on every read, so editing or deleting a
  transaction re-evaluates them exactly. `interval` is stored as `interval_count`, `count` as `occurrences`.

State transitions: `expected → paid` (match) · `expected → overdue` (due_date + grace < today) ·
`overdue → paid` (late match) · `any → skipped` (user) · `paid → expected` (unmatch/undo).

## MonthlyBudget

`(month TEXT 'YYYY-MM', category_id) PK, assigned_minor INTEGER` (as built: an `id` key for the audit
log plus `UNIQUE (month, category_id)`; only needs/wants/goals/buffer categories are budgeted). Spent/available/carry are derived
(research R14), never stored, so history recomputes exactly.

## Goal / GoalContribution

- **Goal**: `id, name, target_minor, target_date?, linked_account_id?, category_id?, created_at, achieved_at?`.
- **GoalContribution**: `id, goal_id, date, amount_minor, transaction_id?`.
- Derived: progress = Σ contributions (or linked account balance); required_monthly =
  remaining / months_left; projected_date from trailing-3-month average contribution.

## Valuation

`id, account_id (investment|other_asset|other_liability|loan), date, value_minor, note`. Net worth at
date d = Σ asset balances/valuations − Σ liability balances/valuations (latest valuation ≤ d wins
over ledger balance for investment/other types).

## ImportBatch / ImportRow / MappingPreset

- **ImportBatch**: `id, account_id, file_name, file_sha256, preset_id?, mapping JSON, imported_at,
  rows_total, rows_imported, rows_skipped_duplicate, rows_failed, statement_closing_minor?,
  undone_at?`.
- **ImportRow**: `id, batch_id, row_number, raw JSON (original cells), outcome
  (imported|duplicate|possible_duplicate_kept|possible_duplicate_skipped|failed), error?, transaction_id?`.
- **MappingPreset**: `id, name, institution?, is_builtin, config JSON (delimiter, encoding,
  header_row, date_format, columns, amount_mode single|debit_credit, sign_inverted)`.

Undo batch: soft-deletes transactions with `import_batch_id = batch` in one transaction; rows edited
after import are listed in the confirmation and removed only if the user confirms (edge case).

## AuditEntry

`id, at (UTC), action (create|update|delete|restore|bulk), entity, entity_id?, group_id (bulk/undo
unit), before JSON?, after JSON?`. Stored locally only; never written to logs. Undo replays
`before` for all entries in a `group_id` (inverse operations), itself audited.

## Backup (metadata, file-based)

`fin-YYYYMMDD-HHmmss[.finbackup|.db]` in backup_dir, with sidecar-free validation via `app_id`,
`schema_version`, and row counts read at list time.
