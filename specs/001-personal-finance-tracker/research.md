# Research: Personal Finance Tracker

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-11-08

Each entry records the Decision, Rationale, and Alternatives considered. All Technical Context
unknowns in plan.md are resolved here.

## R1. Desktop shell

- **Decision**: Electron (current stable at scaffold time) built with electron-vite; packaged with
  electron-builder (NSIS installer, Windows x64).
- **Rationale**: Node 24 is already installed; no Rust toolchain is present. Electron gives a mature
  path for a native SQLite module, file dialogs, and Playwright-driven E2E tests. Bundle size is an
  acceptable trade-off for a single-user desktop app.
- **Alternatives**: Tauri 2 (smaller binary, but requires Rust install and Rust-side DB code or an
  SQL plugin, splitting domain logic across languages); PWA in a browser (weaker file-system access,
  storage eviction risk — conflicts with Constitution IV).

## R2. UI stack

- **Decision**: React + TypeScript (strict), Tailwind CSS, shadcn/ui 4 (`radix-nova` style, Radix primitives; components generated into `src/renderer/components/ui`),
  TanStack Query (server-state over IPC), TanStack Table + TanStack Virtual (50k-row ledger),
  Recharts (charts), cmdk (command palette), Zustand only for ephemeral UI state.
- **Rationale**: Radix primitives give keyboard/ARIA behavior needed for Constitution VI; TanStack
  Query models the DB as the single source of truth with cache invalidation after mutations.
- **Alternatives**: Svelte/SvelteKit (smaller ecosystem for accessible table/command components);
  Redux (unnecessary global store).

## R3. Storage engine

- **Decision**: SQLite via `better-sqlite3` in the Electron main process only, WAL mode,
  `foreign_keys=ON`, `synchronous=NORMAL`. Data file at `%APPDATA%/Fin/fin.db`.
- **Rationale**: Synchronous, fast, fully transactional (Constitution II atomicity); exposes the
  SQLite online backup API for consistent hot backups.
- **Alternatives**: `node:sqlite` (still evolving API; revisit later); sql.js/WASM in renderer
  (whole DB in memory, manual persistence); IndexedDB (no SQL, weak reporting queries).
- **Risk**: native module ABI mismatch with Electron → use `electron-builder install-app-deps`
  (postinstall) and verify in Phase 1.

**Update 2026-11-09 — decision changed to `node:sqlite`.** Electron 45 ships Node 24.22, whose
built-in `node:sqlite` (`DatabaseSync`) is synchronous, transactional, includes FTS5, and exposes
`backup()`; `VACUUM INTO` gives synchronous consistent snapshots. Using it removes the native-module
ABI rebuild risk entirely (no `better-sqlite3`, no build tools), and the same module runs under
Vitest. Verified in both system Node and Electron's Node.

## R4. Migrations

- **Decision**: Numbered SQL migrations (`src/db/migrations/0001_init.ts`, exporting the SQL text so every bundler/test runner loads them identically) applied in order at
  startup inside one transaction per migration, tracked in `schema_migrations`. An automatic backup
  is taken before applying any pending migration.
- **Rationale**: Auditable SQL, no ORM magic, satisfies Constitution IV.
- **Alternatives**: Drizzle/Kysely migrations (extra layer; may adopt Kysely later only as a typed
  query builder if raw SQL becomes unwieldy).

## R5. Money representation

- **Decision**: `amount_minor INTEGER` (paise) + `currency TEXT` (ISO-4217). Domain `Money` type
  wraps a `bigint`-safe integer (values fit in JS `number` safe range for personal finance; enforce
  `Number.isSafeInteger`). Display via `Intl.NumberFormat('en-IN', { style: 'currency', currency })`.
  Parsing accepts `1,25,000.50`, `1,25,000.50 Dr`, `(500.00)`, `-500`.
- **Rationale**: Exact arithmetic (Constitution II); en-IN gives lakh/crore grouping natively.
- **Alternatives**: decimal.js strings (heavier, unnecessary for 2-decimal currencies).
- **Allocation rule**: when dividing (e.g. split evenly), use largest-remainder so parts always sum
  to the total.

## R6. Dates and time

- **Decision**: Posting/occurrence dates stored as `TEXT 'YYYY-MM-DD'` (calendar date, no time zone);
  audit/created timestamps stored as UTC ISO-8601. "Today" is derived using the configured timezone
  (`Intl.DateTimeFormat` with `timeZone`). Date math via `date-fns` on plain calendar dates.
- **Rationale**: Avoids off-by-one-day bugs around midnight/timezone changes (edge case: clock/TZ
  change).
- **Alternatives**: Temporal API (not yet universally available in the Electron Node/Chromium build;
  revisit).

## R7. IPC boundary & validation

- **Decision**: A single typed contract (`src/shared/contract.ts`) of request/response pairs; Zod
  schemas validate every request in the main process. Preload exposes `window.fin.invoke(channel,
  payload)` via `contextBridge`; no raw `ipcRenderer` exposure.
- **Rationale**: Untrusted-renderer posture; one schema source for UI forms, IPC, and import rows.
- **Alternatives**: tRPC-over-IPC (extra dependency for little gain at this scale).

## R8. Electron security baseline

- **Decision**: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
  `webSecurity: true`; strict CSP (`default-src 'self'`); block `will-navigate`, `window.open`, and
  permission requests; no remote content; no auto-update or telemetry in 1.0.
- **Rationale**: Constitution I (no network, no leakage).

## R9. CSV parsing & detection

- **Decision**: PapaParse (in main process, streaming for large files) with BOM/UTF-8/UTF-16
  detection via `chardet`-style sniffing (fallback Windows-1252); delimiter auto-detect; header row
  detection skips bank preamble lines (scan the first 30 rows for a row matching known header
  tokens such as "Date", "Narration", "Withdrawal", "Deposit", "Debit", "Credit").
- **Presets (data, not code)**: JSON mapping presets seeded for HDFC, ICICI, SBI, Axis, Kotak, and a
  generic credit-card layout; user presets stored in DB.
- **Alternatives**: csv-parse (also good; PapaParse chosen for robust auto-detection).

## R10. Duplicate fingerprint

- **Decision**: `fingerprint = sha256(account_id | posted_date | amount_minor | normalize(description))`
  where normalize = uppercase, collapse whitespace, strip reference-like digit runs ≥ 6. Within one
  file, identical fingerprints get an `occurrence_index` (0,1,2…) so genuinely repeated rows are kept;
  uniqueness is enforced on `(fingerprint, occurrence_index)` per account. Possible duplicates:
  same account, same amount, |date diff| ≤ 2 days, different fingerprint → flagged.
- **Rationale**: Satisfies FR-014 and SC-003 deterministically.

**Update 2026-11-09 (as built)**: files are read, decoded and parsed in the renderer with the shared
domain code (`src/domain/import/*`), so mapping previews are instant and no file paths cross IPC;
the main process re-validates every row (Zod) and re-classifies duplicates before committing.
Columns are referenced by header text (presets survive different preamble lengths). A third
amount layout, "amount + Dr/Cr column" (Kotak), was added. The fingerprint is stored as the exact
readable key `date|amount|NORMALISED DESCRIPTION` rather than a SHA-256 (no collisions possible),
and reference digits are kept (stripping them could merge distinct same-day payments).

## R11. UPI / IMPS / NEFT narration parsing

- **Decision**: Ordered regex table in `src/domain/import/narration.ts`, e.g.
  `UPI/<ref>/<name>/<vpa>/...`, `UPI-<name>-<vpa>-<ref>`, `NEFT-<ifsc/ref>-<name>`,
  `IMPS/<ref>/<name>`; outputs `{ channel, counterparty, reference }`. Unknown formats fall back to
  the raw description. Fixture-driven tests per bank.

## R12. Recurrence

- **Decision**: Own small recurrence model `{ frequency: daily|weekly|monthly|yearly, interval,
  anchorDate, byMonthDay?, byWeekday?, endDate?, count? }`; month-day beyond month length clamps to
  the last day (31 → 30/28/29). Occurrence matching: same account, amount within tolerance
  (default ±10% or fixed), date within ±3 days; unmatched past occurrences become `overdue`.
- **Alternatives**: rrule.js (full RFC 5545 is more than needed; clamping semantics differ).

## R13. Forecast model

- **Decision**: Deterministic daily projection over N days:
  `balance[d] = start + Σ recurring expected on d + baseline[d]`, where start = current liquid
  balance (cash + bank), recurring = unmatched future occurrences, baseline = median daily
  non-recurring spending by weekday over the last 90 days (excluding transfers and recurring-matched
  rows). Card dues are included on the card's recurring payment item, not on purchase dates.
  Confidence: **High** if ≥ 90 days history and ≥ 80% of projected outflow is from recurring items;
  **Low** if < 60 days history; otherwise **Medium**. Output includes the assumptions list used.
- **Rationale**: Explainable (Constitution III), testable with fixtures.
- **Alternatives**: statistical/ML models (opaque, violates explainability).

## R14. Budget math

- **Decision**: Per month m and category c: `available[c,m] = carry[c,m] + assigned[c,m] −
  spent[c,m]` where `carry[c,m] = max(available[c,m−1], 0)`. `toAssign[m] = income[m] +
  toAssign_carry[m] − Σ assigned[c,m] + Σ min(available[c,m−1], 0)` (overspend reduces next month's
  To assign). Income = inflows categorised to "Income" group in month m.
- **Rationale**: Encodes the clarified rollover rule exactly.

## R15. Backup, restore, encryption

- **Decision**: Backups via `better-sqlite3` `db.backup(path)` to `fin-YYYYMMDD-HHmmss.db`
  (auto: once per local day on launch, retain 14; manual: unlimited). Restore: open candidate
  read-only, `PRAGMA integrity_check`, check `app_id` marker and schema version (≤ current; migrate
  up after restore), count rows for the confirmation dialog, back up current DB, swap files, relaunch.
  Encrypted `.finbackup`: header (magic, version, scrypt params N=2^17,r=8,p=1, salt, IV) +
  AES-256-GCM ciphertext of the SQLite backup; authenticated, so a wrong passphrase fails cleanly.
- **Rationale**: Node `crypto` only (no extra native deps); Constitution IV.
- **Alternatives**: SQLCipher for at-rest encryption (extra native build; deferred — rely on OS disk
  encryption, documented in README).
- **As built (US4)**: `node:sqlite` has no backup API, so backups use `VACUUM INTO` (consistent and
  transactional) written to a `.tmp` name and renamed. Files are `fin-YYYYMMDD-HHmmss-<kind>.db|.finbackup`
  (kinds: auto, manual, pre-restore, pre-upgrade). The `.finbackup` header is
  `"FINBAK" 00 01 | log2N | r | p | salt(16) | iv(12) | tag(16)`, and the header is GCM associated data.
  Candidates are copied/decrypted into `<data>/tmp`, checked (`application_id`, `quick_check`, schema
  version), then swapped in by rename with the old file kept aside until the swap succeeds. The DB is
  reopened in-process (migrating up) instead of relaunching; if the restored file cannot be opened, the
  pre-restore backup is put back. Demo mode opens a separate fresh `demo.db`.

## R16. Testing strategy

- **Decision**: Vitest for `src/domain` (unit) and `src/db` (integration against temp-file SQLite
  through real migrations); Playwright `_electron` for E2E smoke flows; fixture CSVs under
  `tests/fixtures/csv/` (synthetic, never real statements). Coverage gate ≥ 90% lines on
  `src/domain`. Constitution Quality Standards require these tests, so tests ARE included in tasks.
- **Note on native module in tests**: Vitest runs under system Node, so `better-sqlite3` is built
  for Node for tests and rebuilt for Electron for the app (`npm rebuild` scripts handle both).

## R17. Performance approach

- **Decision**: Indexes on `(account_id, posted_date)`, `(category_id, posted_date)`, `fingerprint`;
  FTS5 virtual table on description/payee/notes for text search; virtualized table rendering;
  dashboard aggregates computed by SQL in one round trip; seeding script producing 50k synthetic
  transactions for profiling.
