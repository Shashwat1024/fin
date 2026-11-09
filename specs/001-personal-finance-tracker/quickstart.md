# Quickstart & Validation Guide: Personal Finance Tracker

How to run Fin locally and prove each user story works. Data shapes are defined in
[data-model.md](./data-model.md) and [contracts/](./contracts/); this guide does not repeat them.

## Prerequisites

- Windows 10/11 x64, Node 24 LTS, npm, Git.
- No native build tools are needed (storage uses Node's built-in `node:sqlite`).
- VS Code terminals set `ELECTRON_RUN_AS_NODE=1`; the npm scripts and E2E fixtures strip it, so
  `npm run dev` works from any terminal.

## Setup

```powershell
npm install
npm run dev            # launches the app with hot reload
npm run typecheck; npm run lint; npm test        # unit + integration
npm run test:e2e       # builds, then runs Playwright against the real Electron app
$env:SCREENSHOTS=1; npx playwright test screenshots   # optional: screenshots in test-results/screens
npm run seed:perf      # optional: writes a 50k-transaction profile to a temp data dir
npm run package        # NSIS installer in release/
```

The app stores data in `%APPDATA%/Fin/`. Set `FIN_DATA_DIR` to point at a throwaway folder when
testing manually; E2E tests always use a temporary folder.

## Validation scenarios

### 1. Ledger (US1, SC-005)
1. Fresh data dir → onboarding shows INR, Asia/Kolkata, April FY; finish setup.
2. Create "HDFC Savings" (bank, opening ₹50,000) and "Cash" (₹2,000).
3. Quick-add (keyboard only) ₹450 Food expense from Cash → Cash shows ₹1,550.00.
4. Add ₹2,400 and split ₹1,500 / ₹900; try ₹1,500 / ₹800 → blocked with "₹100.00 remaining".
5. Transfer ₹10,000 HDFC → Cash → balances ₹37,600 (after split) / ₹11,550; month spending excludes transfer.
6. Delete a transaction, press undo → restored.

### 2. Import (US2, SC-002–SC-004)
1. Import `tests/fixtures/csv/hdfc_savings_oct.csv` into HDFC Savings with the HDFC preset.
2. Preview shows counts; the malformed row is listed with row number and reason.
3. Commit → counts match preview; open import history → batch listed with raw rows.
4. Re-import the same file → all rows `duplicate`, 0 imported.
5. Undo the first batch → HDFC balance and transaction count equal pre-import values.

### 3. Dashboard (US3)
Load demo data → every card shows a value, "as of" date, and drill-down whose total equals the card.

### 4. Backup / restore / export (US4, SC-008, SC-010)
1. Settings → Backup now (with and without passphrase).
2. Delete an account's transactions; restore the backup → counts/balances match the original.
3. Restore an encrypted backup with a wrong passphrase → error, no change.
4. Try restoring a random `.db` file → refused with explanation.
5. Export JSON and CSV; validate JSON `format: "fin-export", version: 1`.

### 5. Planning (US5) · Categorization (US6) · Forecast (US7)
- Rent recurring on the 31st → November occurrence on the 30th; record matching rent → `paid`.
- Assign income until To assign = ₹0.00; overspend a category, open next month → To assign reduced by the overspend.
- Rule "SWIGGY → Food › Delivery": preview count, apply, undo in one step.
- Forecast 30 days on demo data: low point and confidence shown; assumptions list starting balance, recurring items, baseline.

### 6. Privacy check (Constitution I)
Run `npm run test:e2e -- --grep offline`: the suite blocks all network via Electron session
`webRequest`, asserts zero outbound requests across the core flows, and reads the log file to check
it contains no amounts, payees, account names or file names.

### 7. Performance (SC-007)
Automated: `tests/integration/perf.test.ts` (query budgets on 50k transactions, part of `npm test`)
and `tests/e2e/perf.spec.ts` (cold start < 2 s and list filtering < 150 ms in the real app).
By hand: `npm run seed:perf -- <empty folder>`, then `$env:FIN_DATA_DIR='<folder>'; npm run dev`.

### 8. Accessibility and keyboard
`npx playwright test a11y` runs axe (WCAG 2.2 AA) on every screen in light and dark mode, checks
focus is visible and returns after dialogs. Press `?` in the app for every shortcut.

### 9. Packaged build
`npm run package`, then `$env:FIN_E2E_EXE="$PWD\release\win-unpacked\Fin.exe"; npx playwright test`
runs the whole suite against the packaged app. Results for 1.0: [checklists/release.md](./checklists/release.md).
