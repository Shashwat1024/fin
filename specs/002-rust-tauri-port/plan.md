# Implementation Plan: Rust backend on Tauri

**Branch**: `002-rust-tauri-port` | **Spec**: [spec.md](./spec.md)

## Technical context

- **Language**: Rust (stable, 1.99+, edition 2024) for the backend. TypeScript/React stays for the
  renderer.
- **Shell**: Tauri 2 with WebView2 on Windows 10/11. Packaged as an NSIS installer.
- **Storage**: SQLite through `rusqlite` with the `bundled` feature (FTS5 included), in WAL mode. It
  uses the same file, schema and migrations as 1.1.
- **Crates**:
  - `serde` / `serde_json` for the contract.
  - `ulid` for IDs.
  - `scrypt` and `aes-gcm` for backups.
  - `sha2` for import fingerprints and file hashes.
  - `csv` and `encoding_rs` for import.
  - `regex`.
  - `chrono` and `chrono-tz` to find today's date in a time zone.
  - `thiserror`.
- **Testing**:
  - `cargo test` for domain unit tests and database integration tests (temporary files, real
    migrations).
  - A parity harness that compares TypeScript and Rust output.
  - The existing Playwright suite, pointed at the Tauri app. WebView2 can be driven over CDP with
    `--remote-debugging-port`, enabled only in test builds.

## Layout

```
Cargo.toml                 workspace
crates/fin-core/           all backend logic; no Tauri dependency
  src/domain/              money, dates, ledger, recurrence, budget, goals, forecast, networth,
                           rules, insights, scenarios, import/{csv,dates,decode,fingerprint,mapping,narration,presets}
  src/db/                  connection, migrations, repos/*, audit, backup, crypto, export, seed
  src/contract/            request/response types (serde), validation with Zod-identical issues
  src/dispatch.rs          channel → handler, {ok,data}|{ok:false,error}
  src/bin/fin-cli.rs       JSON-lines dispatcher used by the parity harness
src-tauri/                 Tauri app: window, CSP, capabilities, dialogs, one `fin_invoke` command
src/renderer/lib/bridge.ts installs window.fin over Tauri `invoke` when running in Tauri
tests/parity/              the harness: runs TS dispatch and fin-cli on the same call scripts
```

## Key decisions

1. **One command, same contract.** `fin_invoke(channel, input) -> Result` mirrors the Electron
   preload exactly, so the renderer, TanStack Query hooks and error handling don't change.
2. **The TypeScript backend is the oracle.**
   - `tests/parity` runs scripted sequences of calls against both backends. Each starts from a
     fresh database, with a fixed "today" and fixed demo data.
   - The two outputs are compared after mapping generated IDs in the order they first appear and
     masking timestamps.
   - Each ported area turns its scripts on. The port of an area is finished when its parity
     scripts pass and its `cargo test` cases (ported from Vitest) pass.
3. **Text formatting is done by hand in Rust.**
   - en-IN currency formatting (lakh/crore grouping), short month names (en-IN uses "Sept") and
     the date formats used in backend text are implemented and checked against JS `Intl` output in
     parity vectors.
   - There is no ICU dependency.
4. **Validation**:
   - Hand-written `validate()` per input type, producing `{path, message}` with Zod's paths and the
     same messages from `schemas.ts`.
   - Parity scripts include invalid inputs to prove the messages match.
5. **Database ownership**:
   - One `Mutex<Connection>` in Tauri state.
   - Requests are serialised, as in Electron's single main thread.
   - Demo mode and restore swap the connection under the lock.
6. **Security**:
   - CSP is set in `tauri.conf.json`.
   - No `withGlobalTauri`.
   - The capability only allows `core:default` and Fin's own command.
   - Dialogs and opening the backup folder are called from Rust (`tauri-plugin-dialog`, `opener`),
     so the webview gets no plugin permissions.
   - No updater and no HTTP plugin.
7. **Change-over**:
   - Electron stays in the repository and keeps shipping until parity and the end-to-end suite pass
     on Tauri.
   - The final phase removes Electron, `src/main`, `src/preload`, `src/db` and the backend-only
     parts of `src/domain`, and switches `npm run dev` and `npm run package` to Tauri.

## Phases (one commit or more each, pushed)

| Phase | Scope | Done when |
|---|---|---|
| P0 | Workspace, Tauri shell loading the renderer, bridge, `fin-cli`, parity harness skeleton, money and dates | `cargo test` passes; money/dates parity vectors match JS; Tauri window opens the app (backend replies "not available yet") |
| P1 | Connection, migrations 1–6, settings, accounts, categories, tags, transactions, transfers, splits, audit and undo, FTS search, reconcile | Parity for US1 channels; US1 end-to-end tests pass on Tauri |
| P2 | Import: CSV parsing, mapping, presets, fingerprints, narration, preview, commit, history, undo | US2 parity and end-to-end tests |
| P3 | Dashboard, backup, crypto, restore, export, demo mode, daily auto backup | US3 and US4 parity and end-to-end tests; 1.1.1 backups restore |
| P4 | Recurring, budget, goals, categories and rules, suggestions | US5 and US6 parity and end-to-end tests |
| P5 | Forecast, net worth, valuations, insights, scenarios, recurring detection | US7 and US8 parity and end-to-end tests |
| P6 | Full end-to-end suite, axe and offline on Tauri; performance at 50,000 transactions; NSIS packaging; remove Electron; docs | SC-P1 to SC-P4 met; release 2.0.0 |

## Constitution check

- **I. Local-first:** passes. Tauri gets no network capability, and the offline test is re-run.
- **II. Exact money:** passes. `i64` paise and checked arithmetic, with the overflow rules of
  `Number.isSafeInteger` kept.
- **III. Never silently change history:** passes. The same audit and undo semantics, enforced by
  parity.
- **IV. Explain everything:** passes. Text is identical.
- **V. Domain separate from UI, test-first:** passes. `fin-core` has no UI or Tauri dependency, and
  its tests are ported before the code.
- **VI. Accessible:** passes. The renderer is unchanged, and axe is re-run on WebView2.
- **VII. Simplicity:** passes, with one Rust crate plus a thin shell.
