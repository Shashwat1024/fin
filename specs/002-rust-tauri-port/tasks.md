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
- [x] R400 demo.enter/demo.exit and the demo seed (same household, same pseudo-random amounts)
- [x] R401 recurrence domain, recurring items, occurrences, candidates, setOccurrence
- [x] R402 budget month and assign; goals and contributions
- [x] R403 categories create/update/usage/delete; rules CRUD, preview and apply; suggestions
  (pulled into P2: import preview needs suggestions). Rule patterns use `fancy-regex` for
  JavaScript-like lookaround and backreferences.
- [x] R404 Parity (`planning.parity.test.ts`, 110 steps incl. the whole demo household) and end-to-end:
  onboarding, US1, US2, US3, US5 and US6 pass against the Tauri build (12/12)

## P5: Forecast and insights (US7, US8)
- [x] R501 forecast domain, forecast.run (assumptions, buffer ranges, confidence); networth and valuations (done in P3)
- [x] R502 insights detectors, dismiss/restore, recurring.detectCandidates, scenarios.run; the log file
  (same events and redaction as 1.x)
- [x] R503 Parity (`insights.parity.test.ts`): a nine-month ledger that triggers every insight kind and
  both suggestion rhythms, the demo household, and the clock moved forward three times; 233 + demo
  steps match. All 76 channels now run in Rust. End-to-end on Tauri: 26/27 (the remaining one is
  cold start on the debug build, measured on release in P6). Found and fixed a real race in 1.x: a
  save finishing after Ctrl+N/Ctrl+T could close the dialog the shortcut had just opened.

## P6: Switch-over and release 2.0.0
- [x] R601 Full end-to-end suite, axe (both themes) and offline against the packaged Tauri app
- [x] R602 Performance at 50,000 transactions (Rust benchmarks plus end-to-end timing)
- [x] R603 NSIS installer, size ≤ 20 MB, icon
- [x] R604 Remove Electron, `src/main`, `src/preload`, `src/db` and backend-only domain code; update
  README, quickstart and release checklist
- [ ] R605 Version 2.0.0, PR, tag
