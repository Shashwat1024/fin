# Quickstart & Validation Guide: Personal Finance Tracker

How to run Fin locally and prove each user story works. Data shapes are defined in
[data-model.md](./data-model.md) and [contracts/](./contracts/); this guide does not repeat them.

## Prerequisites

- Windows 10/11 x64 (WebView2 is built in), Node 24 LTS, npm, Git.
- Since 2.0: the Rust toolchain (`winget install Rustlang.Rustup`) and the Visual Studio C++ Build
  Tools. The backend is `crates/fin-core`, hosted by the Tauri shell in `src-tauri`
  ([002-rust-tauri-port](../002-rust-tauri-port/spec.md)).

## Setup

```powershell
npm install
npm run dev            # launches the app with hot reload of the interface
npm run typecheck; npm run lint; npm test        # interface and domain unit tests
npm run test:rust      # Rust tests and the frozen 1.x parity vectors
npm run test:e2e       # builds (debug), then runs Playwright against the real app over WebView2's CDP
$env:SCREENSHOTS=1; npx playwright test screenshots   # optional: screenshots in test-results/screens
npm run seed:perf      # optional: writes a 50k-transaction profile to a temp data dir
npm run package        # NSIS installer in target/release/bundle/nsis/
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

### 5b. Insights and what-if (US8, v1.1)
- Demo data → **Insights**: "Spotify now costs ₹139", a Shopping › Clothing change against the Aug–Sept
  average, and a weekend pattern, each with the transactions behind it and a link to all of them.
- Dismiss one → it disappears with an Undo; "Show dismissed" brings it back.
- **What if** tab: add a ₹1,50,000 purchase and ₹10,000 a month for Emergency fund → the lowest balance
  and the goal date move; the Forecast and Goals pages are unchanged afterwards.
- **Recurring** → "Looks recurring" lists Domestic help; **Set up…** opens the dialog filled in.
- Late-night spending is not detected: statements carry dates, not times of day.

### 5c. Daily use (US9–US12, v2.1)
Automated: `us9-views`, `us10-cards`, `us11-reminders`, `us12-calendar`. By hand, with demo data:
- **Saved views**: the sidebar shows "Food delivery"; open it, change the search, then View options ›
  Save current filters to this view. Rename, unpin and delete it, then Undo.
- **Card cycles**: Accounts › Demo Credit Card shows the last statement, what is due and by when,
  and the next statement; each amount opens its transactions. Edit the card to change the statement
  day. The Forecast's assumptions say the bill is counted from the recurring card payment.
- **Reminders**: Settings › Reminders › turn on, then **Show a test notification** (a Windows
  notification appears). "Due now" lists what would be reminded. With **Keep Fin running in the
  tray** on, closing the window leaves the tray icon; its menu reopens or quits Fin. **Start Fin when
  I sign in** adds Fin to Windows' start-up apps (not with `FIN_DATA_DIR` set).
- **Spending calendar**: Insights › Calendar; previous month; choose a day.

### 5d. Making sense of it (US13–US15, v2.2)
Automated: `us13-health`, `us14-month-review`, `us15-year`. By hand, with demo data:
- **Health summary**: the Overview and Insights show "Where you stand"; each sentence links to its
  records ("Essential spending" opens Transactions filtered to the needs categories).
- **Monthly review**: Ctrl+K › Review last month; step through the five steps; Copy this month’s
  amounts on the last step, then Undo; Mark as reviewed. (The Overview offers it from the 1st to the
  7th.)
- **Year in review**: Insights › Year in review; switch financial/calendar year; open a top category;
  Print or save as PDF (choose Microsoft Print to PDF).

### 5e. Loans and deposits (US16–US18, v2.3)
Automated: `us16-loans`, `us17-deposits`, `us18-set-aside`. By hand, with demo data:
- **Loans**: Accounts › Home loan shows the EMI, the next instalment's principal and interest and
  what is still owed; Full schedule lists every EMI. Insights › What if › Loan prepayment on the home
  loan shows months and interest saved, or the smaller EMI.
- **Deposits**: Accounts › SBI fixed deposit shows deposited, worth today and at maturity; Net worth
  says it is "worked out from the deposit's rate"; the Forecast lists it under Deposits maturing when
  it falls in the period.
- **Set aside**: Budget › Bills › Insurance suggests a monthly amount for Car insurance; Assign.

### 6. Privacy check (Constitution I)
Run `npm run test:e2e -- --grep offline`: the window's content security policy blocks every
request that is not Fin's own, the suite asserts zero outbound requests across the core flows, and reads the log file to check
it contains no amounts, payees, account names or file names.

### 7. Performance (SC-007)
Automated: `npm run test:perf` (`crates/fin-core/tests/perf.rs`, query budgets on 50k transactions)
and `tests/e2e/perf.spec.ts` (cold start < 2 s and list filtering < 150 ms in the real app).
By hand: `npm run seed:perf -- <empty folder>`, then `$env:FIN_DATA_DIR='<folder>'; npm run dev`.

### 8. Accessibility and keyboard
`npx playwright test a11y` runs axe (WCAG 2.2 AA) on every screen in light and dark mode, checks
focus is visible and returns after dialogs. Press `?` in the app for every shortcut.

### 9. Packaged build
`npm run package`, then `$env:FIN_TAURI_EXE="$PWD\target\release\fin.exe"; npx playwright test`
runs the whole suite against the release build (the same `fin.exe` the installer lays down).
Results per release: [checklists/release.md](./checklists/release.md).
