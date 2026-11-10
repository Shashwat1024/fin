# Feature Specification: Personal Finance Tracker

**Feature Branch**: `001-personal-finance-tracker`

**Created**: 2026-11-08

**Status**: Draft (ready for planning)

**Input**: User description: "Create a private finance tracker for personal use with CSV imports, recurring items, cash-flow forecasts, goals, behavior insights, net worth, zero-based budgets, automation, and a beautiful dashboard." Product intent is detailed in [docs/PRD.md](../../docs/PRD.md).

## Clarifications

### Session 2026-11-08

- Q: Do credit-card balances count toward "cash position"? → A: No. Cash position = cash + bank accounts. Card dues are shown beside it as "due soon" and are included in net worth.
- Q: What is the default budget rollover behaviour? → A: Unspent positive category balances carry forward to the same category next month; overspending reduces next month's "To assign".
- Q: Where are automatic backups stored? → A: In the application's local data folder by default; the user may choose a different folder.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Set up accounts and record transactions (Priority: P1) 🎯 MVP

As the sole user, I want to create my profile and accounts, then add, edit, split, transfer, and delete transactions quickly from the keyboard, so I have an accurate ledger even before I import anything.

**Why this priority**: Every other capability (imports, dashboard, budgets, forecasts) depends on a correct ledger of accounts and transactions.

**Independent Test**: On a fresh install, create a profile, two accounts with opening balances, record expenses, a split, and a transfer, then verify every account balance matches a hand calculation.

**Acceptance Scenarios**:

1. **Given** a first launch, **When** I complete setup, **Then** a local profile exists with INR, Asia/Kolkata timezone, an April financial-year start, and Indian digit grouping (e.g. ₹1,25,000.00), all editable.
2. **Given** an account with an opening balance, **When** I add, edit, or delete transactions, **Then** the account balance updates immediately and exactly.
3. **Given** a ₹2,400 transaction, **When** I split it into ₹1,500 Groceries and ₹900 Household, **Then** the split saves; **and when** the parts do not sum to ₹2,400, **Then** saving is blocked with the remaining difference shown.
4. **Given** two accounts, **When** I record a ₹10,000 transfer, **Then** one account decreases and the other increases by ₹10,000 and income/spending totals are unchanged.
5. **Given** any screen, **When** I trigger quick-add from the keyboard, **Then** I can enter amount, date, payee, account, and category and save without using a pointer.
6. **Given** I deleted a transaction, **When** I choose undo, **Then** it is restored with its original details.
7. **Given** many transactions, **When** I search by text or filter by date range, account, category, tag, or amount, **Then** only matching transactions are listed with a total.

---

### User Story 2 - Import bank and card statements (Priority: P1)

As the sole user, I want to import CSV statements through a guided mapper with preview, validation, and duplicate review, and undo an import if it was wrong, so monthly maintenance is fast and safe.

**Why this priority**: CSV import is the main data-entry path; without it the product does not scale beyond manual entry.

**Independent Test**: Import a representative statement, verify the created rows, re-import the same file and confirm zero new rows, then undo the first batch and confirm the ledger matches its prior state.

**Acceptance Scenarios**:

1. **Given** a CSV file, **When** I start an import, **Then** I can map date, description, amount (either a single signed column or separate debit and credit columns), optional balance and reference, choose the date format, and choose the target account.
2. **Given** a mapping, **When** I preview, **Then** each row shows its parsed values or a specific validation error with the row number; invalid rows are never silently dropped.
3. **Given** rows that exactly match existing transactions, **When** I review, **Then** they are marked as duplicates and skipped by default; rows that only resemble existing ones (same amount, date within 2 days) are flagged for my decision.
4. **Given** a confirmed import, **When** I view import history, **Then** I see the batch with file name, time, and counts of imported, skipped, and failed rows, and can open the original source rows.
5. **Given** a completed batch, **When** I undo it, **Then** exactly the transactions created by that batch are removed and nothing else changes.
6. **Given** I saved a mapping for a bank, **When** I import another file from that bank, **Then** the mapping is applied automatically and I only review.
7. **Given** a statement closing balance, **When** I reconcile, **Then** the app shows whether the computed balance matches and the difference if not.

---

### User Story 3 - Understand my financial position at a glance (Priority: P1)

As the sole user, I want a calm dashboard showing cash position, spending this month, savings rate, upcoming commitments, budget progress, goals, and net worth, where every number can be traced to its sources.

**Why this priority**: The overview is the primary reason to open the app daily and delivers value as soon as US1/US2 data exists.

**Independent Test**: Seed known accounts and transactions, open the dashboard, and verify every metric against independently calculated values and its drill-down list.

**Acceptance Scenarios**:

1. **Given** accounts and transactions, **When** I open the dashboard, **Then** I see cash position, month-to-date spending versus the same point last month, savings rate, upcoming commitments for 14 days, budget progress, goals, and net worth.
2. **Given** any dashboard metric, **When** I select it, **Then** I see the transactions and accounts that produce it, and their total equals the metric.
3. **Given** data from imports, **When** I view a metric, **Then** it shows an "as of" date and the latest import date of each contributing account.
4. **Given** no data, **When** I open the dashboard, **Then** a helpful empty state explains how to add an account, import, or try demo data.

---

### User Story 4 - Protect, export, and recover my data (Priority: P1)

As the sole user, I want automatic and manual local backups, a safe restore, and full export, so my financial history is private and never lost.

**Why this priority**: Privacy and recoverability are non-negotiable for financial data (Constitution I, IV).

**Independent Test**: Create data, back it up, change data, restore, and verify that transaction counts, balances, budgets, and goals equal the backed-up state; export and inspect the files.

**Acceptance Scenarios**:

1. **Given** normal use, **When** the app starts on a new day, **Then** an automatic backup is created and only the most recent 14 automatic backups are kept.
2. **Given** a backup file, **When** I restore it, **Then** the app validates the file, shows what will be replaced (counts and date of backup), automatically backs up current data, and only proceeds after explicit confirmation.
3. **Given** a corrupt or unrelated file, **When** I try to restore it, **Then** the restore is refused with an explanation and current data is unchanged.
4. **Given** my data, **When** I export, **Then** I receive transactions as CSV and the full dataset as documented, versioned JSON.
5. **Given** I choose an encrypted backup with a passphrase, **When** I restore it with a wrong passphrase, **Then** the restore fails and no data changes.
6. **Given** normal operation, **When** the network is unavailable or blocked, **Then** every feature works and no financial data leaves the device.

---

### User Story 5 - Plan monthly money with recurring items, budgets, and goals (Priority: P2)

As the sole user, I want to define recurring income and commitments, assign every rupee of the month to categories and goals, and track savings goals, so my money has an intentional purpose.

**Why this priority**: Planning turns history into decisions, but depends on a reliable ledger (US1–US2).

**Independent Test**: Create recurring items, a monthly budget, and a goal; record a month of transactions; verify projected vs. actual occurrences, budget figures, and goal projection against hand calculations.

**Acceptance Scenarios**:

1. **Given** a recurring item (e.g. rent monthly on the 31st), **When** I view upcoming months, **Then** occurrences appear on valid dates (the last day in shorter months) and are labelled as expected rather than actual.
2. **Given** an expected occurrence, **When** a matching transaction (within the amount tolerance and a few days) is recorded, **Then** the occurrence is marked as paid; **and when** none appears by its date, **Then** it is flagged as overdue.
3. **Given** a month's income, **When** I assign amounts to categories and goals, **Then** I see To assign, Assigned, Spent, and Available per category, and "To assign" reaches exactly ₹0 when fully allocated.
4. **Given** month end, **When** the next month begins, **Then** rollover follows the clarified rule (positive carries forward; overspending reduces next month's To assign).
5. **Given** a goal of ₹3,00,000 by a target date, **When** I record contributions, **Then** progress, projected completion date, and the monthly amount needed to stay on track are shown.

---

### User Story 6 - Categorize with controllable rules and suggestions (Priority: P2)

As the sole user, I want hierarchical categories, tags, merchants, and rules that suggest categories, without anything silently rewriting my history.

**Why this priority**: Good categorization makes budgets and insights meaningful and keeps monthly review under two minutes.

**Independent Test**: Create a rule, preview its effect on history, apply it, then undo; import new rows and confirm suggestions appear but are applied only on acceptance.

**Acceptance Scenarios**:

1. **Given** default categories, **When** I add, rename, nest (two levels), or merge categories, **Then** existing transactions keep correct assignments; deleting a used category requires choosing a replacement.
2. **Given** a rule (e.g. description contains "SWIGGY" → Food › Delivery), **When** I apply it to history, **Then** I first see how many and which transactions would change and must confirm; the change can be undone in one step.
3. **Given** imported rows, **When** rules or my past choices for the same merchant suggest a category, **Then** the suggestion is shown and applied only when I accept it.
4. **Given** a UPI-style narration, **When** it is imported, **Then** the counterparty name is extracted as the merchant where recognisable.

---

### User Story 7 - Anticipate cash flow (Priority: P2)

As the sole user, I want a 30/60/90-day cash-flow forecast that explains its assumptions and confidence, so I can spot tight periods before they happen.

**Why this priority**: A high-value differentiator that depends on accurate history and recurring items (US1, US5).

**Independent Test**: Provide fixed starting balances, recurring items, and history; compare forecast points, low point, and confidence label against a hand-calculated expectation.

**Acceptance Scenarios**:

1. **Given** balances and recurring items, **When** I open the forecast, **Then** I see a projected daily balance for 30, 60, or 90 days, the lowest projected balance, and its date.
2. **Given** a minimum buffer I set, **When** the projection falls below it, **Then** the period is highlighted with the items that cause it.
3. **Given** any forecast, **When** I open its assumptions, **Then** I see the starting balance, each recurring item included, and the estimated everyday spending used.
4. **Given** less than 60 days of history, **When** the forecast is shown, **Then** it is labelled Low confidence and described as an estimate, never as a guaranteed balance.

---

### User Story 8 - Learn from behavior and what-if scenarios (Priority: P3, v1.1)

As the sole user, I want explainable insights (subscription creep, weekend/late-night spending, category drift, unusual purchases) and what-if scenarios, without judgemental language and without changing real data.

**Why this priority**: Valuable once tracking and planning are reliable; deferred to v1.1.

**Independent Test**: Seed recognisable patterns, generate insights, and verify each cites its comparison period and transactions; run a scenario and confirm real data is unchanged.

**Acceptance Scenarios**:

1. **Given** comparable periods, **When** spending in a category or merchant changes materially, **Then** an insight shows the change, the comparison basis, and supporting transactions, and can be dismissed.
2. **Given** a what-if change (new bill, salary change, large purchase, loan prepayment, savings rate), **When** I run it, **Then** I see its effect on forecast and goals, and no stored data changes.

### Edge Cases

- CSV dates, digit grouping, signs ("Dr"/"Cr" suffixes, parentheses), headers, encodings, and column names vary by institution; debit/credit columns may have blank cells.
- Credit-card statements may use the opposite sign convention from bank statements.
- Statements may overlap previous imports, or contain pending, reversed, refunded, or genuinely repeated identical rows.
- A transfer may be imported from both accounts' statements and must be paired, not double-counted.
- Recurring items may fall on the 29th–31st, on 29 February, or have intervals greater than one.
- An imported transaction may be edited later and must remain traceable to its source batch; undoing that batch must explain how edited rows are handled.
- A forecast may have no history, conflicting recurring items, or missing balances.
- Restoring a backup from an older app version must upgrade it safely.
- Large imports must stay responsive and must never partially succeed without a visible result.
- The system clock or timezone may change between sessions.

## Requirements *(mandatory)*

### Functional Requirements

**Profile & accounts**

- **FR-001**: System MUST operate for one local user without any account, sign-in, or hosted service.
- **FR-002**: System MUST provide settings for currency (default INR), timezone (default Asia/Kolkata), financial-year start month (default April), first weekday, and Indian digit grouping.
- **FR-003**: System MUST support accounts of type cash, bank, credit card, investment, loan, other asset, and other liability, each with an opening balance and date, and allow archiving.
- **FR-004**: System MUST compute account balances from the ledger exactly, presenting liabilities as amounts owed.
- **FR-005**: System MUST allow reconciling an account against a statement balance and show the difference.

**Transactions**

- **FR-006**: System MUST allow creating, editing, and deleting transactions with date, amount, payee/merchant, category, tags, and notes; deletion MUST be undoable.
- **FR-007**: System MUST support splitting a transaction across categories and MUST reject splits whose parts do not sum to the total.
- **FR-008**: System MUST record transfers as linked pairs that are excluded from income and spending totals.
- **FR-009**: System MUST provide keyboard-only quick-add reachable from any screen.
- **FR-010**: System MUST support search and filters by text, date range (with this-month, last-month, and current-financial-year presets), account, category, tag, and amount range, showing the filtered total.
- **FR-011**: System MUST support bulk category/tag edits that can be undone as one action.

**Import**

- **FR-012**: System MUST import CSV files through mapping, date-format selection, preview with per-row validation, and duplicate review before anything is saved.
- **FR-013**: System MUST support both single signed-amount columns and separate debit/credit columns.
- **FR-014**: System MUST detect exact duplicates (skipped by default) and possible duplicates (flagged), and MUST keep genuinely repeated identical rows within one file.
- **FR-015**: System MUST record every import as a batch with source metadata and original rows, and MUST support undoing a batch.
- **FR-016**: System MUST let the user save mapping presets and apply them automatically to later files.
- **FR-017**: System MUST extract the counterparty from common UPI/IMPS/NEFT narrations when recognisable.

**Categorization**

- **FR-018**: System MUST support two-level categories, tags, and merchants, starting from an editable default category set.
- **FR-019**: System MUST support user-defined rules whose effects on history are previewed and confirmed before applying, and are undoable.
- **FR-020**: System MUST present automated category suggestions for review and MUST NOT apply them without user acceptance.

**Planning**

- **FR-021**: System MUST support recurring income, bills, subscriptions, EMIs, transfers, and savings contributions with schedule, expected amount, tolerance, and account.
- **FR-022**: System MUST match expected occurrences to actual transactions and flag overdue occurrences.
- **FR-023**: System MUST provide monthly zero-based budgets showing To assign, Assigned, Spent, and Available, with the clarified rollover rule.
- **FR-024**: System MUST support goals with target, deadline, contributions, progress, projected completion date, and required monthly amount.

**Insights**

- **FR-025**: System MUST show a dashboard with cash position, month-to-date spending vs. last month, savings rate, 14-day commitments, budget progress, goals, and net worth, each drillable to its source records.
- **FR-026**: System MUST show data freshness ("as of" and latest import per account) on every insight.
- **FR-027**: System MUST provide 30/60/90-day forecasts with lowest balance and date, buffer warning, confidence label, and an assumptions list.
- **FR-028**: System MUST track net-worth history including manually valued assets and liabilities.
- **FR-029** *(v1.1)*: System MUST provide behavior insights and what-if scenarios that cite their sources and never change stored data.
  *As built*: insights are category/merchant changes, subscription price rises and creep, weekend
  spending and unusual purchases. Time-of-day patterns are out of scope because statements record
  dates only. Dismissing an insight is the one stored (and undoable) change.

**Data & resilience**

- **FR-030**: System MUST export transactions as CSV and the full dataset as documented, versioned JSON.
- **FR-031**: System MUST create daily automatic backups (keeping 14) and on-demand backups, and list them.
- **FR-032**: System MUST validate a backup before restoring, back up current data first, and require explicit confirmation describing what will be replaced.
- **FR-033**: System MUST support passphrase-encrypted backups.
- **FR-034**: System MUST provide a demo mode whose data is fully separate from real data.
- **FR-035**: System MUST record an audit entry for every user-visible data change.
- **FR-036**: System MUST make no network requests in normal operation and MUST NOT write amounts, descriptions, or account names to logs.
- **FR-037**: System MUST give actionable error messages and MUST NOT silently discard invalid data.

### Key Entities

- **Settings**: Currency, timezone, financial-year start, formatting, buffer amount, backup preferences.
- **Account**: Type, name, currency, opening balance and date, archived flag; asset or liability nature.
- **Transaction**: Account, date, amount, payee/merchant, category, tags, notes, source (manual or import batch), audit history.
- **Split**: A portion of a transaction assigned to a category; parts sum to the parent amount.
- **Transfer**: A linked pair of transactions moving money between two accounts.
- **Category / Tag / Merchant**: Two-level category tree; free tags; normalised merchant names.
- **Rule**: Conditions (text, merchant, amount range, account) and actions (category, tags, merchant).
- **Recurring Item / Occurrence**: Schedule and expected amount; generated occurrences with expected/paid/overdue state.
- **Monthly Budget**: Assigned amount per category per month, with rollover.
- **Goal / Contribution**: Target, deadline, and contributions.
- **Valuation**: A dated manual value for an asset or liability.
- **Import Batch / Import Row / Mapping Preset**: Source file record, original rows with outcomes, reusable mappings.
- **Audit Entry**: Who/what/when of each change, enabling undo.
- **Backup**: A recoverable snapshot with metadata.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user creates a profile, adds an account, and reconciles it to a statement within 15 minutes of first launch.
- **SC-002**: Importing and reviewing one month's statement (≈150 rows) for a previously mapped bank takes under 2 minutes.
- **SC-003**: Re-importing an already imported file creates zero additional transactions and reports every skipped row.
- **SC-004**: Undoing an import batch returns account balances and transaction counts exactly to their pre-import values.
- **SC-005**: Every dashboard metric equals the total of its drill-down records, to the paisa, across all supported account types.
- **SC-006**: From the dashboard, the user can identify the next 14 days of commitments and the forecast's lowest balance date within 30 seconds.
- **SC-007**: With 50,000 transactions, the app opens in under 2 seconds, filters respond in well under a second, and a 1,000-row import preview appears in under 1 second.
- **SC-008**: Backup-then-restore reproduces transaction counts, balances, budgets, and goals exactly; a failed or cancelled restore leaves data unchanged in 100% of tested cases.
- **SC-009**: After two months of use, at least 80% of newly imported rows receive a correct category suggestion.
- **SC-010**: All core workflows complete with networking disabled, and no outbound requests are observed.
- **SC-011**: Every primary workflow can be completed using only the keyboard.

## Assumptions

- The first release is a standalone desktop application for one Windows user; other desktop platforms may follow.
- INR is the only currency in the 1.0 interface; the data model stays currency-aware.
- CSV files are the only external data source; direct bank connections are out of scope.
- The user verifies imported data and keeps backup copies in a location of their choosing.
- Investment and loan values are entered manually.
- Mobile apps, multi-user use, cloud sync, OCR, and automated financial advice are out of scope.
- User Story 8 (insights and what-if) is targeted for v1.1 and does not block 1.0.
