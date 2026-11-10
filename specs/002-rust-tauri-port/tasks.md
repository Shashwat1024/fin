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
- [x] R007 `fin-cli` JSON-lines dispatcher; the call-script harness landed in P1 (R106), with a
  fixed clock in both backends (Vitest fake timers / `FIN_FAKE_NOW`).
- [x] R008 Parity vectors for money and date formatting generated from JS `Intl`, checked in Rust

## P1: Ledger (US1)
- [x] R101 Connection (WAL, foreign keys), migrations 1–6 shared as `.sql` with the TypeScript
  backend, schema_version, pre-upgrade snapshot
- [x] R102 Validation for **all 76** channels (Zod-identical issues), proven by 3,233 Zod-generated
  vectors (`tests/parity/contract-vectors`)
- [x] R103 settings, accounts, categories (seed, merchant backfill), tags, payees.suggest, app.status
- [x] R104 txns query/get/create/update/delete/bulkUpdate, splits, transfers, FTS; narration
  parser (139 parity vectors)
- [x] R105 audit log, activity.list, undo.apply; accounts.reconcile
- [x] R106 Parity harness (`tests/parity/harness.ts`): a 66-step US1 script matches on both
  backends, and Rust reads, edits and undoes a ledger written by the TypeScript backend.
  `FIN_E2E_SHELL=tauri` runs Playwright against the Tauri build; first-run setup works. The
  Overview needs channels from P3–P5, so the end-to-end suite on Tauri is the P6 gate.

## P2: Import (US2)
- [x] R201 Fingerprints and built-in presets. Reading the file (decode, CSV, dates, mapping, preset
  matching) runs in the interface, which stays TypeScript, so it is not ported.
- [x] R202 import.preview/commit/batches/batchRows/undo/savePreset/presets
- [x] R203 Parity (`tests/parity/import.parity.test.ts`): all six bank fixtures previewed and
  imported, re-import as duplicates, possible duplicates kept and skipped, accepted suggestions,
  presets, history, undo with edited rows. The harness can move the clock mid-script.

## P3: Overview, backup and data (US3, US4)
- [x] R301 dashboard.summary, app.status; net worth now/history and valuations (pulled from P5)
- [x] R302 backup create/list/inspect/restore, `.finbackup` crypto (format-compatible), daily auto-backup, retention
- [x] R303 export.json/export.csv (byte-identical), dialogs and open-folder via Tauri plugins called
  from Rust (no webview permissions). Demo mode moves to P4: its seed uses the planning code.
- [x] R304 Encrypted backups restore across 1.x and 2.0 in both directions, with NFC passphrases
  (`tests/parity/backup-interop.test.ts`); 81-step data parity (`data.parity.test.ts`); the US1
  end-to-end suite passes against the Tauri build. Parity now runs as `npm run test:parity`.

## P4: Planning and categorisation (US5, US6)
- [ ] R400 demo.enter/demo.exit and the demo seed (needs R401–R402)
- [ ] R401 recurrence domain, recurring items, occurrences, candidates, setOccurrence
- [ ] R402 budget month and assign; goals and contributions
- [x] R403 categories create/update/usage/delete; rules CRUD, preview and apply; suggestions
  (pulled into P2: import preview needs suggestions). Rule patterns use `fancy-regex` for
  JavaScript-like lookaround and backreferences.
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
