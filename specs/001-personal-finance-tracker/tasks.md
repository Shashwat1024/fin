---

description: "Task list for the Personal Finance Tracker (Fin)"
---

# Tasks: Personal Finance Tracker

**Input**: Design documents from `/specs/001-personal-finance-tracker/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: INCLUDED — the constitution's Quality Standards require automated tests for core
calculations, import validation, duplicate detection, migrations, backup/restore, and persistence.
Within each story, write tests first and confirm they fail before implementing.

**Organization**: Tasks are grouped by user story so each story is an independently testable increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US8 from spec.md
- Paths follow the structure in plan.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and tooling

- [x] T001 Scaffold electron-vite React + TypeScript project at repository root (`package.json`, `electron.vite.config.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/main.tsx`)
- [x] T002 Configure strict TypeScript project references for main/preload/renderer/domain in `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`
- [x] T003 [P] Configure ESLint + Prettier with a `no-restricted-imports` rule forbidding electron/better-sqlite3/react imports under `src/domain/**` in `eslint.config.js`
- [x] T004 [P] Install and configure Tailwind CSS and shadcn/ui (Radix) with design tokens and light/dark themes in `src/renderer/styles/globals.css` and `components.json`
- [x] T005 [P] Configure Vitest with coverage thresholds (≥ 90% lines for `src/domain`) in `vitest.config.ts`
- [x] T006 [P] Configure Playwright for Electron with temp data dir fixture in `playwright.config.ts` and `tests/e2e/fixtures.ts`
- [x] T007 ~~Add `better-sqlite3`~~ Use built-in `node:sqlite` (see research R3 update — no native rebuild needed); document in `package.json` scripts (`dev`, `build`, `typecheck`, `lint`, `test`, `test:e2e`, `seed:perf`, `package`)
- [x] T008 [P] Configure electron-builder NSIS target (Windows x64, app id, icon) in `electron-builder.yml`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure every user story depends on

**⚠️ CRITICAL**: No user story work begins until this phase is complete

- [x] T009 [P] Write unit tests for Money (add, subtract, negate, largest-remainder allocate, en-IN format, parse with grouping/Dr/Cr/parentheses) in `tests/unit/domain/money.test.ts`
- [x] T010 [P] Write unit tests for calendar dates (today in timezone, month math, month-end clamp, FY range for April start) in `tests/unit/domain/dates.test.ts`
- [x] T011 [P] Implement Money type and helpers in `src/domain/money.ts`
- [x] T012 [P] Implement calendar-date helpers in `src/domain/dates.ts`
- [x] T013 Implement DB connection (WAL, foreign_keys, app_id marker) in `src/db/connection.ts` and data paths (`%APPDATA%/Fin`, `FIN_DATA_DIR` override, demo DB) in `src/main/paths.ts`
- [x] T014 Implement migration runner with `schema_migrations`, per-migration transaction, and pre-migration backup hook in `src/db/migrate.ts`
- [x] T015 Create initial schema (settings, accounts, transactions, splits, transfers, categories, tags, transaction_tag, merchants, audit_log, FTS5 table, indexes per data-model.md) in `src/db/migrations/0001_init.sql`
- [x] T016 Write integration tests for migrations (fresh apply, idempotent re-run, failure rolls back) in `tests/integration/db/migrate.test.ts`
- [x] T017 [P] Implement settings repository with defaults (INR, Asia/Kolkata, FY April, en-IN, theme) in `src/db/repos/settings.ts`
- [x] T018 Implement audit log + undo-by-group (inverse replay, itself audited) in `src/db/repos/audit.ts` with tests in `tests/integration/db/audit.test.ts`
- [x] T019 Define IPC contract types and `Result` envelope in `src/shared/contract.ts` and base Zod schemas (Money, date, ids, filters) in `src/shared/schemas.ts`
- [x] T020 Implement IPC handler registry (validate → service → Result, error mapping) in `src/main/ipc.ts` and typed `window.fin` bridge in `src/preload/index.ts` and `src/renderer/lib/ipc.ts`
- [x] T021 [P] Implement redacting logger (no amounts, payees, account names) in `src/main/logging.ts` with tests in `tests/unit/main/logging.test.ts`
- [x] T022 Harden Electron window (contextIsolation, sandbox, nodeIntegration off, CSP, block navigation/window.open/permissions, no remote content) in `src/main/index.ts`
- [x] T023 [P] Build app shell: sidebar routes, keyboard navigation, theme switcher, TanStack Query client in `src/renderer/App.tsx`, `src/renderer/routes.tsx`, `src/renderer/lib/queryClient.ts`
- [x] T024 [P] Create shared state components (Empty, Loading, ErrorState) and `MoneyText` in `src/renderer/components/states/` and `src/renderer/components/MoneyText.tsx`
- [x] T025 [P] Implement command palette (Ctrl+K) skeleton with route commands in `src/renderer/components/CommandPalette.tsx`
- [x] T026 Seed default two-level category set (with groups needs/wants/goals/buffer/income/transfer) in `src/db/seed/categories.ts`

**Checkpoint**: App launches, migration 0001 applied, IPC round-trip works, shell keyboard-navigable

---

## Phase 3: User Story 1 - Set up accounts and record transactions (Priority: P1) 🎯 MVP

**Goal**: Profile, accounts, transactions, splits, transfers, quick-add, search, undo

**Independent Test**: quickstart §1 — balances match hand calculation after expenses, split, transfer, delete+undo

### Tests for User Story 1

- [x] T027 [P] [US1] Unit tests for ledger (balance from opening + txns, split sum validation, transfer leg negation, liability "owed" display) in `tests/unit/domain/ledger.test.ts`
- [x] T028 [P] [US1] Integration tests for accounts & transactions repos (CRUD, soft delete, splits, transfers atomicity, filter query + total, FTS search) in `tests/integration/db/transactions.test.ts`
- [x] T029 [P] [US1] E2E flow: onboarding → accounts → quick-add → split → transfer → delete/undo in `tests/e2e/us1-ledger.spec.ts`

### Implementation for User Story 1

- [x] T030 [P] [US1] Implement ledger domain logic in `src/domain/ledger.ts`
- [x] T031 [P] [US1] Implement accounts repository with computed balances in `src/db/repos/accounts.ts`
- [x] T032 [US1] Implement transactions repository (create/update/delete with splits, tags, audit; filter query with cursor + total; FTS) in `src/db/repos/transactions.ts`
- [x] T033 [US1] Implement transfers (paired legs in one transaction) in `src/db/repos/transfers.ts`
- [x] T034 [US1] Implement services + IPC handlers for `settings.*`, `accounts.*`, `txns.*`, `transfers.create`, `undo.apply` in `src/main/services/ledger.ts`
- [x] T035 [P] [US1] Build onboarding (profile defaults, first account) in `src/renderer/features/onboarding/`
- [x] T036 [P] [US1] Build accounts list/detail/editor with archive in `src/renderer/features/accounts/`
- [x] T037 [US1] Build virtualized transaction table with inline edit, filters (text, date presets incl. current FY, account, category, tag, amount) and filtered total in `src/renderer/features/transactions/TransactionTable.tsx`
- [x] T038 [US1] Build split editor with live remaining-difference and transfer form in `src/renderer/features/transactions/SplitEditor.tsx` and `TransferForm.tsx`
- [x] T039 [US1] Build keyboard-only quick-add dialog (Ctrl+N, global) in `src/renderer/components/QuickAdd.tsx`
- [x] T040 [US1] Add undo toast wired to `auditGroupId` and bulk category/tag edit in `src/renderer/features/transactions/BulkActions.tsx`
- [x] T041 [US1] Build settings screen (currency, timezone, FY start, week start, theme) in `src/renderer/features/settings/`

**Checkpoint**: US1 independently usable — MVP ✅ (2026-11-09: E2E `tests/e2e/us1-ledger.spec.ts` passes, incl. offline request check)

---

## Phase 4: User Story 2 - Import bank and card statements (Priority: P1)

**Goal**: Guided CSV import with presets, validation, duplicates, batches, undo, reconcile

**Independent Test**: quickstart §2 — fixture import, re-import yields 0 new, undo restores exactly

### Tests for User Story 2

- [x] T042 [P] [US2] Create synthetic fixture CSVs (HDFC, ICICI, SBI, Axis, Kotak, generic card; incl. preamble lines, Dr/Cr, blank cells, a malformed row, repeated identical rows) in `tests/fixtures/csv/`
- [x] T043 [P] [US2] Unit tests for sniffing (encoding, delimiter, header row after preamble) in `tests/unit/domain/import/sniff.test.ts`
- [x] T044 [P] [US2] Unit tests for amount parsing and mapping→parsed rows with per-row errors in `tests/unit/domain/import/parse.test.ts`
- [x] T045 [P] [US2] Unit tests for fingerprint normalisation, occurrence index, possible-duplicate window in `tests/unit/domain/import/fingerprint.test.ts`
- [x] T046 [P] [US2] Integration tests for import commit, re-import idempotency, batch undo (incl. edited rows), reconcile in `tests/integration/db/import.test.ts`
- [x] T047 [P] [US2] E2E import wizard flow incl. duplicate review and undo in `tests/e2e/us2-import.spec.ts`

### Implementation for User Story 2

- [x] T048 [US2] Add migration for import_batches, import_rows, mapping_presets in `src/db/migrations/0002_imports.sql`
- [x] T049 [P] [US2] Implement sniffing (decode + delimiter + header detection) in `src/domain/import/decode.ts` and `src/domain/import/csv.ts`
- [x] T050 [P] [US2] Implement mapping parser (reusing `parseAmount` from `src/domain/money.ts`) and date parsing in `src/domain/import/mapping.ts` and `src/domain/import/dates.ts`
- [x] T051 [P] [US2] Implement fingerprinting and duplicate classification in `src/domain/import/fingerprint.ts`
- [x] T052 [P] [US2] Author built-in presets per contracts/import-csv.md in `src/domain/import/presets.ts`
- [x] T053 [US2] Implement imports repository (batch, raw rows, presets, commit in one transaction, undo) in `src/db/repos/imports.ts`
- [x] T054 [US2] Implement import IPC (`import.preview`, `.commit`, `.batches`, `.batchRows`, `.undo`, `.presets`, `.savePreset`, `accounts.reconcile`) in `src/main/handlers.ts`; files are read and parsed in the renderer with the shared domain code
- [x] T055 [US2] Build import wizard steps (file → mapping → date format → preview → duplicates → confirm) in `src/renderer/features/import/ImportWizard.tsx`
- [x] T056 [US2] Build import history with raw-row viewer and undo confirmation (lists edited rows) in `src/renderer/features/import/ImportHistory.tsx`
- [x] T057 [US2] Build reconcile dialog showing computed vs statement balance in `src/renderer/features/accounts/ReconcileDialog.tsx`

**Checkpoint**: US1 + US2 work independently ✅ (2026-11-09: `tests/e2e/us2-import.spec.ts` passes)

---

## Phase 5: User Story 3 - Understand my financial position at a glance (Priority: P1)

**Goal**: Dashboard with drillable, freshness-labelled metrics

**Independent Test**: quickstart §3 — every metric equals its drill-down total (SC-005)

### Tests for User Story 3

- [x] T058 [P] [US3] Integration tests for dashboard summary (cash position = cash+bank only, MTD vs same point last month, savings rate, card dues, net worth, asOf/sources) in `tests/integration/db/dashboard.test.ts`
- [x] T059 [P] [US3] E2E: each card drill-down total equals card value in `tests/e2e/us3-dashboard.spec.ts`

### Implementation for User Story 3

- [x] T060 [US3] Implement dashboard aggregation queries (single round trip) in `src/db/repos/dashboard.ts` and IPC `dashboard.summary` (as built: handler in `src/main/handlers.ts`, no separate service)
- [x] T061 [P] [US3] Build dashboard cards with sparklines, `asOf`/source badges, and DrillDownLink in `src/renderer/features/dashboard/`
- [x] T062 [P] [US3] Build dashboard empty state with add-account/import/demo actions in `src/renderer/features/dashboard/DashboardEmpty.tsx`
- [x] T063 [US3] Provide accessible table fallbacks for every chart in `src/renderer/components/ChartTable.tsx`

**Checkpoint**: US1–US3 functional ✅ (2026-11-09: `tests/e2e/us3-dashboard.spec.ts` passes; the demo-data action on the empty dashboard arrives with demo mode in US4)

---

## Phase 6: User Story 4 - Protect, export, and recover my data (Priority: P1)

**Goal**: Backups (auto/manual/encrypted), safe restore, CSV/JSON export, demo mode, offline guarantee

**Independent Test**: quickstart §4 and §6 — round-trip restore exact; wrong passphrase and invalid file are no-ops; zero network requests

### Tests for User Story 4

- [x] T064 [P] [US4] Integration tests for backup create/list/retention(14)/inspect/restore round-trip, older-schema migrate-up, invalid file refusal in `tests/integration/db/backup.test.ts`
- [x] T065 [P] [US4] Unit tests for encrypted backup format (scrypt + AES-256-GCM; wrong passphrase fails) in `tests/unit/db/encryption.test.ts`
- [x] T066 [P] [US4] Tests for JSON export v1 shape and CSV columns per contracts/export-json.md in `tests/integration/db/export.test.ts`
- [x] T067 [P] [US4] E2E offline test blocking all network and asserting zero outbound requests across core flows in `tests/e2e/offline.spec.ts`

### Implementation for User Story 4

- [x] T068 [US4] Implement backup create/list/inspect/restore with pre-restore backup and relaunch in `src/db/backup.ts`
- [x] T069 [US4] Implement `.finbackup` encryption/decryption in `src/db/backupCrypto.ts`
- [x] T070 [US4] Schedule daily automatic backup on launch with retention and wire pre-migration backup in `src/main/services/backup.ts` (as built: `system.ts` with `autoBackupIfDue` in `src/db/backup.ts`)
- [x] T071 [P] [US4] Implement JSON and CSV exporters in `src/db/export.ts` and IPC `export.*`
- [x] T072 [US4] Build Settings › Data screen (backup now, list, restore with explicit overwrite confirmation showing counts/date, export, backup folder picker) in `src/renderer/features/settings/DataSettings.tsx` (+ `BackupDialogs.tsx`)
- [x] T073 [US4] Implement demo mode (separate DB file, seeded dataset, clear banner) in `src/db/seed/demo.ts` and `src/main/services/demo.ts` (as built: `system.ts`, banner in `features/demo/`)

**Checkpoint**: 1.0 P1 stories complete (US1–US4) ✅ (2026-11-09: `tests/e2e/us4-data.spec.ts` and `tests/e2e/offline.spec.ts` pass)

---

## Phase 7: User Story 5 - Plan monthly money (Priority: P2)

**Goal**: Recurring items with matching, zero-based budget with rollover, savings goals

**Independent Test**: quickstart §5 — month-end clamping, matching, To assign = ₹0, rollover rule, goal projection

### Tests for User Story 5

- [x] T074 [P] [US5] Unit tests for recurrence expansion (month-end, 29 Feb, interval > 1, end date/count) and matching tolerance in `tests/unit/domain/recurrence.test.ts`
- [x] T075 [P] [US5] Unit tests for budget math (to assign, available, positive carry, overspend reduces next To assign) in `tests/unit/domain/budget.test.ts`
- [x] T076 [P] [US5] Unit tests for goal progress, required monthly, projected date in `tests/unit/domain/goals.test.ts` (+ integration: `tests/integration/db/planning.test.ts`)

### Implementation for User Story 5

- [x] T077 [US5] Add migration for recurring_items, recurring_occurrences, monthly_budgets, goals, goal_contributions in `src/db/migrations/0003_planning.ts` (occurrences store only user decisions: skips and hand-linked payments)
- [x] T078 [P] [US5] Implement recurrence domain in `src/domain/recurrence.ts`
- [x] T079 [P] [US5] Implement budget domain in `src/domain/budget.ts`
- [x] T080 [P] [US5] Implement goals domain in `src/domain/goals.ts`
- [x] T081 [US5] Implement repos + services + IPC (`recurring.*`, `budget.*`, `goals.*`) in `src/db/repos/planning.ts` (as built: no separate service; handlers in `src/main/handlers.ts`)
- [x] T082 [P] [US5] Build recurring items list/editor and upcoming/overdue view in `src/renderer/features/recurring/`
- [x] T083 [P] [US5] Build zero-based budget month view with keyboard assignment and group subtotals in `src/renderer/features/budget/`
- [x] T084 [P] [US5] Build goals view with progress and projection in `src/renderer/features/goals/`
- [x] T085 [US5] Add 14-day commitments and goals cards to dashboard in `src/renderer/features/dashboard/` (+ a To assign card; `PlanningCards.tsx`)

**Checkpoint**: US5 complete ✅ (2026-11-09: `tests/e2e/us5-planning.spec.ts` passes; demo data includes recurring items, budgets and goals)

---

## Phase 8: User Story 6 - Categorize with controllable rules and suggestions (Priority: P2)

**Goal**: Category management, rules with preview/apply/undo, merchant suggestions, narration parsing

**Independent Test**: rule preview → apply → single-step undo; suggestions applied only on accept

### Tests for User Story 6

- [x] T086 [P] [US6] Unit tests for rule condition evaluation and priority in `tests/unit/domain/rules.test.ts`
- [x] T087 [P] [US6] Unit tests for UPI/IMPS/NEFT narration extraction across fixture formats in `tests/unit/domain/import/narration.test.ts`
- [x] T088 [P] [US6] Integration tests for category delete-with-replacement, rule apply-to-history + undo, merchant-learned suggestions in `tests/integration/db/categorization.test.ts`

### Implementation for User Story 6

- [x] T089 [US6] Add migration for rules and merchant default category in `src/db/migrations/0004_rules.ts` (merchants table already existed; adds a merchant index; older rows get merchants on startup via `backfillMerchants`)
- [x] T090 [P] [US6] Implement rules engine in `src/domain/rules.ts`
- [x] T091 [P] [US6] Implement narration parser in `src/domain/import/narration.ts` and wire into import preview (merchant per line, stored on the transaction)
- [x] T092 [US6] Implement repos + IPC (`categories.*`, `rules.*`, `suggestions.forTxns`) in `src/db/repos/categorization.ts` (as built: no separate service)
- [x] T093 [P] [US6] Build category manager (two-level tree, merge, delete with replacement) in `src/renderer/features/categories/`
- [x] T094 [P] [US6] Build rules editor with history preview and confirm in `src/renderer/features/categories/RuleDialogs.tsx` (Categories page, Rules tab)
- [x] T095 [US6] Show suggestions in import preview and transaction table with accept/reject in `src/renderer/features/import/` and `src/renderer/features/transactions/`

**Checkpoint**: US6 complete ✅ (2026-11-09: `tests/e2e/us6-categorization.spec.ts` passes)

---

## Phase 9: User Story 7 - Anticipate cash flow (Priority: P2)

**Goal**: 30/60/90-day explainable forecast and net-worth history

**Independent Test**: fixture-based forecast points, low point, confidence label match expectations

### Tests for User Story 7

- [x] T096 [P] [US7] Unit tests for forecast (projection, low point, buffer ranges, confidence thresholds, assumptions list) in `tests/unit/domain/forecast.test.ts` (assumptions list covered in `tests/integration/db/insights.test.ts`)
- [x] T097 [P] [US7] Unit tests for net worth with valuations overriding ledger for investment/other types in `tests/unit/domain/networth.test.ts`

### Implementation for User Story 7

- [x] T098 [US7] Add migration for valuations in `src/db/migrations/0005_valuations.ts` (as built: SQL in a TS module like 0001–0004)
- [x] T099 [P] [US7] Implement forecast domain in `src/domain/forecast.ts`
- [x] T100 [P] [US7] Implement net-worth domain in `src/domain/networth.ts`
- [x] T101 [US7] Implement services + IPC (`forecast.run`, `networth.history`, `valuations.list/upsert/delete`) in `src/db/repos/insights.ts` (as built: no separate service)
- [x] T102 [P] [US7] Build forecast view (balance line, low point, buffer highlight, confidence, assumptions panel) in `src/renderer/features/forecast/`
- [x] T103 [P] [US7] Build net-worth view with valuation entry and monthly history in `src/renderer/features/networth/`
- [x] T104 [US7] Add forecast low-point card to dashboard in `src/renderer/features/dashboard/ForecastCard.tsx` (the Net worth card now uses valuations and drills to the Net worth page)

---

## Phase 10: Polish & Cross-Cutting Concerns (Release 1.0)

- [ ] T105 [P] Keyboard shortcuts sheet and full keyboard audit of every screen in `src/renderer/components/ShortcutsSheet.tsx`
- [ ] T106 [P] Accessibility pass (AA contrast tokens, focus rings, ARIA labels) with axe checks in `tests/e2e/a11y.spec.ts`
- [ ] T107 [P] 50k-transaction perf seed in `src/db/seed/perf.ts` and perf assertions in `tests/e2e/perf.spec.ts`
- [ ] T108 Profile and optimise slow queries/rendering to meet plan.md performance goals
- [ ] T109 [P] Update README with install, data location, privacy, backup guidance, and disk-encryption note in `README.md`
- [ ] T110 Run full quickstart.md validation on the packaged NSIS build and record results in `specs/001-personal-finance-tracker/checklists/release.md`

---

## Phase 11: User Story 8 - Behavior insights & what-if (Priority: P3, v1.1)

- [ ] T111 [P] [US8] Unit tests for insight detectors (subscription creep, weekend/late-night, category drift, unusual purchase) in `tests/unit/domain/insights.test.ts`
- [ ] T112 [P] [US8] Unit tests asserting what-if scenarios never mutate inputs in `tests/unit/domain/scenarios.test.ts`
- [ ] T113 [US8] Implement insight detectors with cited sources in `src/domain/insights.ts`
- [ ] T114 [US8] Implement what-if scenarios layered on forecast/goals in `src/domain/scenarios.ts`
- [ ] T115 [US8] Build insights feed (dismissible, neutral language) and scenario simulator in `src/renderer/features/insights/`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)** → **Foundational (2)** → user stories.
- **US1 (3)** is required by all other stories (ledger).
- **US2 (4)**, **US3 (5)**, **US4 (6)** depend only on US1 and may proceed in parallel after it.
- **US5 (7)** depends on US1; its dashboard card (T085) depends on US3.
- **US6 (8)** depends on US1; T091/T095 integrate with US2.
- **US7 (9)** depends on US5 (recurring items) and US3 (dashboard card).
- **Polish (10)** after all 1.0 stories (US1–US7). **US8 (11)** after 1.0.

### Within Each User Story

- Tests first (must fail) → migrations → domain → repos → services/IPC → UI → integration.

### Parallel Opportunities

- Setup: T003–T006, T008.
- Foundational: T009–T012, T017, T021, T023–T025.
- All [P] test tasks inside a story can run together; domain modules marked [P] are independent files.
- After US1: US2, US3, US4 can be developed concurrently.

## Parallel Example: User Story 2

```text
Task: "T043 Unit tests for sniffing in tests/unit/domain/import/sniff.test.ts"
Task: "T044 Unit tests for amount parsing in tests/unit/domain/import/parse.test.ts"
Task: "T045 Unit tests for fingerprinting in tests/unit/domain/import/fingerprint.test.ts"
Task: "T049 Implement sniffing in src/domain/import/sniff.ts"
Task: "T051 Implement fingerprinting in src/domain/import/fingerprint.ts"
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup → Phase 2 Foundational.
2. Phase 3 US1 → validate with quickstart §1 → usable manual ledger.

### Incremental Delivery

1. US2 (import) → US3 (dashboard) → US4 (backup/export): first dogfoodable release.
2. US5 (planning) → US6 (rules) → US7 (forecast) → Polish → **1.0**.
3. US8 → **v1.1**.

## Notes

- Fixture CSVs MUST be synthetic; never commit real statements (`imports/`, `statements/` are git-ignored).
- Commit after each task or logical group; keep every commit green on `npm run typecheck && npm test`.
