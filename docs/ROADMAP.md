# Fin roadmap after 1.1: 14 new features in 5 releases

## Context
Fin 1.1.0 is merged and tagged. Waiting to ship as 1.1.1 are the theme preview on the setup screen, the app icon, the Settings button in the sidebar and the Prettier pass (branches `fix/onboarding-theme-preview` and `chore/prettier-pass`). The user chose 14 more ideas from three groups: built for India, daily use, and making sense of it. This plan puts them in order, groups them into releases that each make sense on their own, and pins down how each one keeps to Fin's constitution:
- local only, with no network requests
- suggestions are never applied without the user's say-so, and every change can be undone
- money is stored as exact paise
- every number explains where it came from and how fresh it is
- domain logic is pure functions, written test-first
- the interface is calm, keyboard-first and accessible

Each release becomes one Spec Kit feature (`specs/00N-…`, run through `/speckit.specify` → `clarify` → `plan` → `tasks` → `implement`), on its own branch, with its own PR, version bump, packaged-installer validation and tag. This roadmap sets the order and the main design decisions. Each feature's `spec.md` and `plan.md` will hold the detail.

## Step 0: ship 1.1.1 first
1. Open one PR from `chore/prettier-pass`, which already contains the fix branch, into `main`.
2. Bump `package.json` to 1.1.1 and run `npm run package`.
3. Run the full test suite against the packaged app (`FIN_E2E_EXE`), and add the hash and results to `checklists/release.md`.
4. After the user merges, tag `v1.1.1`.

## Release order
| Release | Spec | Features | Why this order |
|---|---|---|---|
| 1.2 Daily use | 002-daily-use | Saved views, Credit-card cycles, Windows notifications, Spending calendar | These build on existing pieces and make Fin worth opening every day. Notifications need card due dates. |
| 1.3 Making sense of it | 003-understanding | Health summary, Monthly review, Year in review | Built mostly from existing queries. The monthly review uses saved views, card cycles and the health summary. |
| 1.4 Loans & deposits | 004-loans-deposits | Loan/EMI breakdown, FDs/RDs and maturities, Annual bills (set aside monthly) | All three are scheduled money that feeds the forecast, budget and What-if. |
| 1.5 Tax & investments | 005-tax-investments | Tax-year view, Mutual-fund statement (CAS) import | The tax view uses EMI interest and principal from 1.4 (Sec 24b, 80C). CAS import is the biggest single parser. |
| 1.6 Shared life | 006-shared-life | Who owes whom, Receipts and warranties | Receipts change the backup format, so they come once everything else is stable. Warranty reminders reuse the notifications from 1.2. |

---

## 1.2 Daily use

**Saved views**
- **Data:** migration `saved_views(id, name, filter_json, pinned, sort_order)`, audited.
- **Reuse:** the filter is exactly the existing Transactions URL search params (`TransactionFilters.tsx`, `TransactionsPage.tsx` reading `q`, `from`, `to` and `category`).
- **UI:** "Save view" on the filter bar. Pinned views appear in the sidebar under the main navigation (`AppShell.tsx`) and in the command palette (`CommandPalette.tsx`).

**Credit-card cycles**
- **Data:** add `statement_day` and `due_days_after` (nullable) to accounts, for `credit_card` only, set in `AccountForm.tsx`.
- **Domain:** new pure functions `src/domain/cardCycle.ts`.
  - Inputs are the cycle dates and the ledger.
  - Outputs are each statement's balance, the amount due, the due date, the amount paid against it (transfers into the card after the statement date) and the spending since the statement.
  - It handles month-end days the same way `recurrence.ts` does.
- **UI:**
  - The Accounts page gets a card panel showing the last statement, amount due, due date and spending since.
  - The Overview "Card dues" card says "₹X due on 12 Nov".
  - Unpaid statement amounts go into the forecast as outflows from the bank account on the due date. They use the existing assumption list in `src/domain/forecast.ts` and are labelled "Card bill (estimated from statement)".
  - If the user already has a recurring item for the card payment, it is not counted twice.

**Windows notifications**
- **Main process:** `src/main/services/notifications.ts`.
  - Uses Electron `Notification`, which works offline.
  - Checks on launch and then every hour while Fin is running.
  - Optional system-tray icon and "Start Fin when I sign in" (`app.setLoginItemSettings`). Both are off by default.
- **Rules (pure, in `src/domain/reminders.ts`):** recurring item due tomorrow or overdue, card bill due in N days, forecast drops below the buffer within 7 days.
- **Settings:**
  - Notifications get a card on the Settings page with one switch per rule, the number of days' notice and quiet hours.
  - Stored in the `settings` key/value table.
  - Remember which notifications were already sent (`notification_log(key, sent_at)`) so none repeats.
- **Text:** neutral, like "Rent (₹25,000) is due tomorrow". Clicking a notification opens the matching screen. The text never goes to the log file.

**Spending calendar**
- **Repo:** a daily spending query (`src/db/repos/insights.ts` or a new `calendar.ts`) that excludes transfers, using the same rules as month-to-date spending in `dashboard.ts`.
- **UI:** a month grid heatmap on the Insights page, as a new "Calendar" tab next to Insights and What if.
  - Colour shades of a single hue, following the dataviz skill, with weekends marked.
  - Clicking a day opens `/transactions?from=d&to=d`.
  - A table view is provided through `ChartTable.tsx`.

---

## 1.3 Making sense of it

**Plain-language health summary**
- **Domain:** pure functions in `src/domain/health.ts`, each returning a value, the inputs and what it is compared against.
  - **Emergency cover:** liquid cash divided by the average monthly "needs" spending over 3 months.
  - **EMI to income:** monthly EMI recurring items divided by average monthly income.
  - **Savings-rate trend:** over 6 months.
  - **Card dues as a share of liquid cash.**
- **UI:** shown as a short neutral paragraph at the top of Insights and as an Overview card. Every figure links to the records behind it, as FR-028 requires.
- **Wording:** no scores and no judgemental words. It states facts, for example "Your savings would cover about 4.2 months of essential spending."

**Monthly review**
- **UI:** a `/review/:month` page with 5 steps, shown with `StepIndicator.tsx`. Each step reuses an existing piece:
  1. Uncategorised transactions: the Transactions list with a filter, plus category suggestions.
  2. Reconcile each account: `ReconcileDialog.tsx`.
  3. How the budget went: data from `BudgetPage`.
  4. Insights for the month.
  5. Set next month's budget, with a "copy last month" option.
- **Data:** `month_reviews(month, completed_at)`.
- **Entry point:** an Overview prompt appears from the 1st to the 7th of each month.

**Year in review**
- **Domain:** `src/domain/yearReview.ts` covers either the financial year (using `fyStartMonth`) or the calendar year.
  - Totals in and out, and the top categories and merchants.
  - Biggest changes compared with the year before, which reuses the insight detectors in `src/domain/insights.ts`.
  - Savings rate by month, goals reached and the change in net worth.
- **PDF export:** the main process renders a print-only route to PDF with `webContents.printToPDF`, then shows a save dialog. No network is involved.

---

## 1.4 Loans & deposits

**Loan / EMI breakdown**
- **Data:** add `loan_principal_minor`, `rate_bp`, `tenure_months` and `start_date` to `loan` accounts, all optional.
- **Domain:** `src/domain/amortization.ts` builds the schedule.
  - Interest is worked out in exact paise, with rounding specified the way banks do it.
  - It shows principal and interest for each EMI and the outstanding balance.
  - Prepayment shows the result two ways: shorter tenure or smaller EMI.
- **Linking to real payments:** an EMI recurring item matched to a payment suggests splitting it into principal (a transfer to the loan account) and interest (an expense category). The user accepts the split; it is never applied automatically.
- **What-if:** `loan_prepayment` in `src/domain/scenarios.ts` is upgraded to use the full schedule, showing interest saved and months saved.

**FDs, RDs and maturities**
- **Data:** a new account type `deposit` (an asset), with `rate_bp`, `compounding`, `start_date`, `maturity_date`, `payout_account_id` and `kind fd|rd`. It needs a migration and a zod enum update.
- **Domain:** `src/domain/deposits.ts` works out the value accrued so far and the maturity amount, matching Indian bank conventions (quarterly compounding for FDs, RD formula).
- **Shown in:** net worth uses the accrued value unless a manual valuation is entered, which takes priority (existing `networth.ts`). The forecast adds the maturity as an inflow to the payout account. Maturity can trigger a notification (from 1.2).

**Annual bills (set aside monthly)**
- **Data:** a "set aside monthly" toggle on yearly or quarterly recurring items (`set_aside` column), linked to a budget category.
- **Domain:** the amount to set aside each month is the amount still needed divided by months until it's due, following the same pattern as goals in `src/domain/goals.ts`.
- **UI:** the Budget page shows "Suggested: ₹4,200 for Car insurance (due Mar)" as a suggestion the user can accept. It is never assigned automatically.

---

## 1.5 Tax & investments

**Tax-year view**
- **Data:**
  - `tax_sections` holds code, label and annual limit. It is seeded with 80C ₹1.5 L, 80CCD(1B) ₹50k, 80D, 24(b) ₹2 L, 80E and 80G, and HRA is shown for information only. The user can edit everything, with a note on when the limits were last reviewed.
  - A category gets an optional `tax_section_id`, and a single transaction can override it.
  - Loan principal and interest from 1.4 are mapped in automatically, as a suggestion.
- **UI:**
  - A `/tax` page for the selected financial year, with progress against each limit and the records behind each figure.
  - A banner says it covers the old tax regime and that the new regime allows few deductions.
  - "Export for my CA" produces a CSV and a PDF.
  - The wording never calculates tax owed or recommends investments, in line with the PRD's no-advice rule.

**Mutual-fund statement (CAS) import**
- **Parsing:** CAMS and KFintech CAS PDFs are parsed locally with `pdfjs-dist` in the main process. Many CAS files are password protected, so the password is asked for each time and never stored.
- **Domain:** `src/domain/import/cas.ts` reads folio, scheme, units, NAV, value and the statement date from the extracted text, and is tested with synthetic text fixtures. No real statements are committed.
- **Result:**
  - One `investment` account per AMC or folio, chosen by the user.
  - Values are written as valuations dated to the statement date.
  - Optionally, purchases and redemptions are imported as transactions, using the same preview → confirm → undo flow as the import wizard (ImportBatch).
- **Scope:** live NAV prices are explicitly out of scope because they would need the network.

---

## 1.6 Shared life

**Who owes whom**
- **Data:**
  - `people(id, name)`.
  - `owed_items(id, person_id, transaction_id?, split_id?, amount_minor, direction owes_me|i_owe, settled_txn_id?, note)`.
- **Ledger:** the owed share is recorded through a split into a system category, "Owed to me / Shared", which is excluded from spending, budget and insights. Spending totals therefore show only the user's own share.
- **Domain:** `src/domain/ious.ts` works out the balance per person and suggests settlement matches. An incoming payment whose narration names the person (the UPI narration parser in `src/domain/import/narration.ts`) and whose amount matches is offered as a match the user confirms.
- **UI:**
  - A "People" page.
  - A "Split with…" action in `TransactionDialog.tsx` and `SplitEditor.tsx`.
  - Overview shows "Rahul owes ₹1,200".

**Receipts and warranties**
- **Storage:**
  - An `attachments(id, transaction_id, file_name, mime, sha256, size, blob)` table inside SQLite, so backup, restore, encrypted backup and JSON export keep working as single files.
  - Each file is limited to 10 MB and must be an image or PDF.
  - The blob sits in its own table, so the 50,000-transaction queries are unaffected.
- **Warranties:** `warranty_until` on the attachment or transaction feeds a reminder through notifications (1.2).
- **UI:** drag and drop in the transaction dialog, a preview of the attachment, and a "Warranties" list under Accounts or Settings.
- **Size:** backups get bigger, and Settings › Data shows how much space attachments use.

---

## Rules every release must follow
- **Migrations:** `src/db/migrate.ts` and `src/db/migrations/000N_*.ts`, each in a transaction with a backup taken first. Every new table that holds user data goes into `AUDITED` in `src/db/audit.ts` and into `src/db/export.ts`. Each release bumps the version in `contracts/export-json.md`, and restoring an older backup migrates it upward.
- **Data access:** handlers follow `(ctx, input)` in `src/main/handlers.ts`, with entries in `src/shared/contract.ts`, `schemas.ts` (zod) and `types.ts`, and hooks in `src/renderer/lib/queries.ts`.
- **UI:**
  - Build from the existing shadcn components and shared components: `StatCard`, `ChartTable`, `LineChart`, `FormField`, `EmptyState`, `ConfirmDialog` and `Combobox`.
  - Every new screen goes into the a11y spec in both themes and into the command palette.
  - Keyboard shortcuts are added where it makes sense.
- **Demo data:** each feature is seeded into `src/db/seed/demo.ts`: a card with cycles, a home loan, an FD, people who owe money, tax-section mappings and an annual insurance bill.
- **Privacy:**
  - `tests/e2e/offline.spec.ts` covers the new flows.
  - Nothing financial is logged.
  - The PDF parser runs in the main process with no network.
  - Notification text stays out of the log.

## Verification for each release
- `npm run typecheck && npm run lint && npm run format:check && npm test`, including domain unit tests written first for each new `src/domain/*.ts` module:
  - card cycles across month-end and February
  - the amortization table against a bank-published EMI schedule
  - FD and RD maturity against known bank calculators
  - the tax section totals
  - CAS parsing on synthetic text
  - IOU balances
- Integration tests run each repository through the real migrations, including restoring a backup from the previous version.
- A new Playwright spec per release (`tests/e2e/us9-…`), and the a11y and offline specs extended.
- 50,000-transaction performance budgets for the new queries in `tests/integration/perf.test.ts`. The calendar and health summary must each take under 300 ms.
- `npm run package`, then the full end-to-end suite run against `release\win-unpacked\Fin.exe`, with the results recorded in `checklists/release.md`.
- A manual check with the demo data, following a new `quickstart.md` section for each feature.
