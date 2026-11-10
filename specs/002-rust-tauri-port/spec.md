# Feature Specification: Rust backend on Tauri (Fin 2.0)

**Feature Branch**: `002-rust-tauri-port` · **Created**: 2026-11-10 · **Status**: In progress
**Input**: "I want this app to be written in Rust" → option A: keep the React interface, move everything
behind it (domain logic, storage, backup, import, files) to Rust, and replace Electron with Tauri.

## Why

- **Smaller and lighter.** The Electron installer is about 108 MB because it carries a whole Chromium
  and Node. Tauri uses WebView2, which is already part of Windows 10/11, so the installer should be
  around 10 MB, with less memory used and a faster start.
- **Stricter code for money logic.** Rust's type system and its exhaustive `match` checks suit exact
  money and date rules.
- The owner wants the product in Rust.

## What does not change (user-visible)

Fin 2.0 behaves exactly like 1.1.1. Every screen, flow, number, label, keyboard shortcut and
accessibility behaviour is the same. This is a port, not a redesign.

## User scenarios

### US-P1: Existing users upgrade with nothing lost (P1)
A 1.1.x user installs 2.0. Fin opens their existing `%APPDATA%\Fin\fin.db` with every account,
transaction, import, rule, budget, goal, valuation and dismissed insight intact.

**Acceptance**:
1. Every table and row in a 1.1.1 database is unchanged after it is opened by 2.0. The schema
   version stays at 6 unless a later migration is added.
2. Backups made by 1.1.1, both `.db` and passphrase-protected `.finbackup`, restore in 2.0.
   Backups made by 2.0 restore in 2.0.
3. JSON and CSV exports have exactly the same structure and values as 1.1.1.

### US-P2: Every feature works the same (P1)
All flows in User Stories 1–8 behave as in 1.1.1.

**Acceptance**:
1. For each of the 76 request types, given the same database and the same "today", the Rust backend
   returns the same result as the TypeScript one. A parity harness checks this, ignoring only
   generated IDs and timestamps.
2. The existing Playwright end-to-end suite (27 specs, including axe accessibility and offline)
   passes against the Tauri build.

### US-P3: Still private and offline (P1)
**Acceptance**:
1. The app makes no network requests. The offline end-to-end check passes against the Tauri build.
2. Tauri capabilities allow only what Fin uses: file open and save dialogs, and opening the backup
   folder. There is no shell, HTTP or arbitrary file-system access from the webview.
3. The strict CSP is kept.
4. Logs never contain amounts, payees or account names. The existing log check covers this.

### US-P4: Smaller, faster app (P2)
**Acceptance**:
1. The installer is at most 20 MB.
2. Cold start is under 2 s.
3. The 50,000-transaction budgets hold or improve: ledger filter under 150 ms, Overview under
   300 ms, 1,000-row CSV preview under 1 s.

## Requirements

- **FR-P01**: The renderer (`src/renderer`) is reused unchanged except for the bridge that sends
  requests: `window.fin.invoke(channel, input)` → a Tauri command.
- **FR-P02**: The request and response contract (`src/shared/contract.ts`, `types.ts`) stays the
  source of truth. The Rust input types reject anything Zod rejects. Validation failures return the
  same `{ code: 'VALIDATION', issues: [{ path, message }] }` with the same field paths and messages.
- **FR-P03**: The same SQLite schema and migrations are used. New migrations are written once, in
  Rust.
- **FR-P04**: Backup encryption is the same format (scrypt with the same parameters, AES-256-GCM,
  same header). Restore runs the same integrity and identity checks.
- **FR-P05**: Text the backend produces (insight titles, assumption lists, CSV export) is identical,
  including en-IN money formatting (₹1,25,000.00) and en-IN month names ("Sept").
- **FR-P06**: The Electron build remains the shipping app until the Tauri build passes everything.
  Then Electron, Node-only code and their dependencies are removed (FR-P07).
- **FR-P07**: After the switch, the TypeScript copies of backend-only code (`src/db`, `src/main`)
  are deleted. `src/domain` keeps only what the renderer imports for display.

## Out of scope

New features (roadmap 1.2+, now 2.1+), macOS/Linux builds, code signing, and auto-update.

## Success criteria

- **SC-P1**: The parity harness passes for all 76 request types on the demo database and the
  50,000-transaction database.
- **SC-P2**: 27/27 end-to-end tests pass against the packaged Tauri app.
- **SC-P3**: Installer ≤ 20 MB, cold start < 2 s, with performance budgets met.
- **SC-P4**: A 1.1.1 user's data folder opens in 2.0 with identical exports.
