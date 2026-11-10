# Tasks: Rust backend on Tauri

Format: `[ID] [P?] Description`. `[P]` means the task can run in parallel with the others. Each
phase ends with tests, a commit and a push.

## P0: Foundation
- [x] R001 Cargo workspace (`Cargo.toml`), `crates/fin-core` crate skeleton, `rust-toolchain.toml`
- [x] R002 Tauri 2 app in `src-tauri` (window 1320×860, min 960×640, icon, CSP, minimal capability,
  single `fin_invoke` command returning `{ok:false, error:{code:'INTERNAL'}}` for channels not
  ported yet)
- [x] R003 Renderer bridge: install `window.fin` over Tauri `invoke` when running in Tauri; keep the
  Electron preload path
- [x] R004 `npm run tauri:dev` and `tauri:build` scripts; Vite config for the renderer on its own
- [x] R005 [P] Port `domain/money` (+ tests): checked i64, allocate, parseAmount, toMajorString,
  en-IN grouping and whole-rupee prose (`formatMoney` is display-only and stays in the renderer)
- [x] R006 [P] Port `domain/dates` (+ tests): calendar arithmetic, FY, presets, todayIn
  (chrono-tz), en-IN formatDate and month names
- [~] R007 `fin-cli` JSON-lines dispatcher (done). The `tests/parity` call-script harness (TS
  dispatch versus fin-cli, ID and timestamp normalisation) moves to P1, where it first has calls to
  compare; it needs a fixed "today" in both backends.
- [x] R008 Parity vectors for money and date formatting generated from JS `Intl`, checked in Rust

## P1: Ledger (US1)
- [ ] R101 Connection (WAL, foreign keys), migrations 1–6 as embedded SQL, schema_version, pre-upgrade snapshot
- [ ] R102 Contract types and validation for US1 channels (Zod-identical issues)
- [ ] R103 settings, accounts, categories (seed), tags, payees.suggest
- [ ] R104 txns query/get/create/update/delete/bulkUpdate, splits, transfers, FTS
- [ ] R105 audit log, activity.list, undo.apply; accounts.reconcile
- [ ] R106 Parity scripts for US1; US1 end-to-end tests on Tauri

## P2: Import (US2)
- [ ] R201 decode (UTF-8/UTF-16/Windows-1252), csv, dates, mapping, presets, fingerprint, narration
- [ ] R202 import.preview/commit/batches/batchRows/undo/savePreset/presets
- [ ] R203 Parity and end-to-end tests for US2

## P3: Overview, backup and data (US3, US4)
- [ ] R301 dashboard.summary, app.status
- [ ] R302 backup create/list/inspect/restore, `.finbackup` crypto (format-compatible), daily auto-backup, retention
- [ ] R303 export.json/export.csv, demo mode (seed), dialogs and open-folder via Tauri plugins
- [ ] R304 Restore a 1.1.1 backup (both kinds) in the Rust build; parity and end-to-end tests for US3 and US4

## P4: Planning and categorisation (US5, US6)
- [ ] R401 recurrence domain, recurring items, occurrences, candidates, setOccurrence
- [ ] R402 budget month and assign; goals and contributions
- [ ] R403 categories create/update/usage/delete; rules CRUD, preview and apply; suggestions; merchants
- [ ] R404 Parity and end-to-end tests for US5 and US6

## P5: Forecast and insights (US7, US8)
- [ ] R501 forecast domain, forecast.run; networth and valuations
- [ ] R502 insights detectors, dismiss/restore, recurring.detectCandidates, scenarios.run
- [ ] R503 Parity and end-to-end tests for US7 and US8

## P6: Switch-over and release 2.0.0
- [ ] R601 Full end-to-end suite, axe (both themes) and offline against the packaged Tauri app
- [ ] R602 Performance at 50,000 transactions (Rust benchmarks plus end-to-end timing)
- [ ] R603 NSIS installer, size ≤ 20 MB, icon
- [ ] R604 Remove Electron, `src/main`, `src/preload`, `src/db` and backend-only domain code; update
  README, quickstart and release checklist
- [ ] R605 Version 2.0.0, PR, tag
