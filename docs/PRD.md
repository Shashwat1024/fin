# Product Requirements Document — Fin (Personal Finance Tracker)

| | |
|---|---|
| **Status** | Draft v1.0 |
| **Owner** | Shashwat |
| **Last updated** | 2026-11-08 |
| **Spec** | [specs/001-personal-finance-tracker/spec.md](../specs/001-personal-finance-tracker/spec.md) |
| **Constitution** | [.specify/memory/constitution.md](../.specify/memory/constitution.md) |

## 1. Overview

**Fin** is a private desktop app that works offline. It helps one person see where their money is, where it is going, and whether the coming weeks are financially safe. It does this without bank logins, user accounts or cloud services. All data stays on the user's computer.

## 2. Problem

- Bank apps show one account at a time and nothing about upcoming weeks.
- Most budgeting apps require cloud access to bank data, which is a privacy cost many people won't pay.
- Spreadsheets are fragile. Imports break them, formulas drift, and they have no audit trail.

Individuals in India have statements full of UPI transactions, several bank and card accounts, recurring EMIs and subscriptions, and an April–March financial year. They have no trustworthy local tool that answers three questions:

1. *How much can I safely spend right now?*
2. *What is coming up?*
3. *Am I on track for my goals?*

## 3. Target user

- **Primary persona:** a salaried or freelance individual in India who is comfortable with technology. They have 2–6 accounts (savings, salary, one or two credit cards, a loan/EMI, investments) and download statements as CSV roughly once a month.
- **What they value:** privacy, exact numbers, speed, keyboard efficiency, and staying in control of any automation.
- **Not targeted:** households sharing one ledger, small businesses, accountants, and people who expect automatic bank sync.

## 4. Goals and non-goals

### Goals (1.0)

| # | Goal | Measured by |
|---|---|---|
| G1 | An accurate, reconciled picture of all accounts quickly | First account reconciled within 15 minutes of first launch |
| G2 | Low-effort monthly maintenance | Importing and reviewing one month's statement takes under 2 minutes per account |
| G3 | See ahead | Upcoming commitments and a 30/60/90-day forecast with honest confidence labels |
| G4 | Plan intentionally | A zero-based monthly plan and savings goals |
| G5 | Never lose or silently change data | Zero data-loss incidents, and every bulk change can be undone |

### Non-goals (1.0)

- Bank or aggregator connections, and storing bank credentials.
- Multiple users, sharing or collaboration.
- Cloud sync, remote analytics or telemetry.
- Automated financial or investment advice.
- OCR receipt capture.
- Multiple currencies inside one ledger. The data model is currency-aware, but the 1.0 UI is INR-only.
- Mobile apps.

## 5. User journeys (priority order)

1. **Set up** — Create a profile (INR, timezone, financial year) → add accounts with opening balances → import a first statement or enter transactions by hand → reconcile.
2. **Monthly import** — Download a CSV → the import wizard detects the format or applies a saved preset → preview, validate and review duplicates → confirm → accept or adjust category suggestions → reconcile against the statement's closing balance.
3. **Daily check-in** — Open the dashboard → see the cash position, spending so far this month, the next 14 days of commitments, and the forecast's low point → quick-add a cash expense.
4. **Monthly planning** — Assign the month's income across categories and goals until "To assign" reaches ₹0 → track how much is still available as the month goes on.
5. **Look ahead** — Open the forecast → see when cash could get tight → open the assumptions behind it.
6. **Protect** — Automatic daily backups, manual backup before risky changes, restore with a clear warning, and export to CSV/JSON.

## 6. Functional requirements

Priority: **P0** = required for 1.0 · **P1** = targeted for 1.0, can slip · **P2** = v1.1

### 6.1 Profile and settings
| ID | Pri | Requirement |
|---|---|---|
| PR-01 | P0 | A local profile with currency (default INR), timezone (default Asia/Kolkata), financial-year start month (default April), first day of the week, and number format (Indian lakh/crore grouping, ₹ symbol). |
| PR-02 | P1 | Light, dark and system themes. |

### 6.2 Accounts
| ID | Pri | Requirement |
|---|---|---|
| AC-01 | P0 | Create, edit and archive accounts of these types: cash, bank, credit card, investment, loan, other asset, other liability. Each has an opening balance and an opening date. |
| AC-02 | P0 | Each account's balance is computed from its ledger. Liabilities are shown as amounts owed. |
| AC-03 | P1 | Reconcile an account against a statement's closing balance and show any difference. |

### 6.3 Transactions
| ID | Pri | Requirement |
|---|---|---|
| TX-01 | P0 | Add, edit and delete transactions with date, amount, payee/merchant, category, tags and notes. A delete can be undone. |
| TX-02 | P0 | Split one transaction across several categories. The split amounts must add up to the total. |
| TX-03 | P0 | A transfer between accounts is stored as two linked entries and is excluded from income and spending totals. |
| TX-04 | P0 | Quick-add from anywhere in the app using only the keyboard. |
| TX-05 | P0 | Search and filter by text, date range (including presets for this month, last month and the current financial year), account, category, tag and amount range. |
| TX-06 | P1 | Bulk-edit category and tags on many transactions, undoable in one step. Save filter presets. |

### 6.4 CSV import
| ID | Pri | Requirement |
|---|---|---|
| IM-01 | P0 | A guided wizard: choose file → map columns (one signed amount column, or separate debit and credit columns) → set date format → preview with row-level validation → review duplicates → confirm. |
| IM-02 | P0 | Each import is saved as an import batch recording the file name, file fingerprint, time, row counts and the original rows. Undoing a batch removes only the transactions that batch created. |
| IM-03 | P0 | Duplicate detection. Exact matches are skipped by default. Possible matches (same amount, date within ±2 days) are flagged for the user to decide. Rows that are genuinely identical and repeat within the same file are kept. |
| IM-04 | P0 | Invalid rows are never silently dropped. Each one is reported with its row number and the reason. |
| IM-05 | P1 | Saved mapping presets, including built-in presets for common Indian bank exports. |
| IM-06 | P1 | Pull the counterparty and reference out of UPI, IMPS and NEFT narrations. |

### 6.5 Categorization
| ID | Pri | Requirement |
|---|---|---|
| CA-01 | P0 | Two-level categories, starting from a default set the user can edit. |
| CA-02 | P0 | User-defined rules (conditions → category, tags or merchant name). Applying a rule to past transactions requires a preview and explicit confirmation. |
| CA-03 | P1 | Suggestions learned from how the user has categorized the same merchant before. These are only ever suggestions. |

### 6.6 Recurring items
| ID | Pri | Requirement |
|---|---|---|
| RC-01 | P0 | Define recurring income, bills, subscriptions, EMIs, transfers and savings contributions, each with a schedule, expected amount, tolerance and account. |
| RC-02 | P0 | Expected occurrences are matched to actual transactions. Items that are overdue or missed are flagged. |
| RC-03 | P1 | Detect likely recurring items from history and suggest them. |

### 6.7 Budgets and goals
| ID | Pri | Requirement |
|---|---|---|
| BG-01 | P0 | A zero-based monthly budget per category, showing to-assign, assigned, spent and available. |
| BG-02 | P0 | Savings goals with a target amount, deadline and contributions, plus a projected completion date and the monthly amount required. |
| BG-03 | P1 | Category groups: Needs, Wants, Goals, Buffer. |

### 6.8 Dashboard and insights
| ID | Pri | Requirement |
|---|---|---|
| DI-01 | P0 | A dashboard showing cash position, spending so far this month compared with the same point last month, savings rate, budget progress, the next 14 days of commitments, goals and net worth. |
| DI-02 | P0 | A 30/60/90-day cash-flow forecast showing the lowest projected balance and its date, a warning when it falls below the buffer, a confidence label and the list of assumptions. |
| DI-03 | P0 | Every number shows how fresh its data is ("as of" date, latest import for each account) and drills down to the transactions behind it. |
| DI-04 | P1 | Net-worth history, including assets and liabilities the user values manually. |
| DI-05 | P2 | What-if simulator: salary change, new subscription, large purchase, loan prepayment, savings rate. Never changes real data. |
| DI-06 | P2 | Behavior insights: subscription creep, weekend and late-night spending, category drift, unusual purchases. Wording is neutral, and each insight can be dismissed. |

### 6.9 Data and resilience
| ID | Pri | Requirement |
|---|---|---|
| DR-01 | P0 | Export transactions to CSV, and export all data to JSON in a documented, versioned format. |
| DR-02 | P0 | Manual backups plus automatic daily backups, keeping the last 14. Backups are listed in Settings. |
| DR-03 | P0 | Restore checks the backup file, backs up the current data automatically, and asks for explicit confirmation showing what will be replaced. |
| DR-04 | P1 | Backups encrypted with a passphrase. |
| DR-05 | P1 | A demo mode with sample data, kept fully separate from real data. |

## 7. Non-functional requirements

| Area | Requirement |
|---|---|
| Privacy | Normal use makes no network requests. Logs and error reports never contain amounts, descriptions or account names. |
| Integrity | Money is stored exactly, never as floating-point. Every change that touches several records succeeds or fails as a whole. Every visible change leaves an audit entry. Original imported rows are kept. |
| Performance (50,000 transactions) | Cold start under 2 s. Filtering the transaction list under 150 ms. Dashboard loads under 300 ms. Previewing a 1,000-row CSV under 1 s. |
| Reliability | If a data upgrade fails, it rolls back and the app does not open in a broken state. A backup is taken automatically before any upgrade or restore. |
| Accessibility | WCAG 2.2 AA contrast. Every action works from the keyboard, with visible focus. Charts have text or table alternatives. |
| Platform | Windows 10/11 x64 for 1.0. Nothing in the design should block macOS or Linux later. |

## 8. Key concepts

Settings, Account, Transaction, Split, Transfer, Category, Tag, Merchant, Rule, Recurring Item and Occurrence, Monthly Budget, Goal and Contribution, Valuation (asset/liability snapshot), Import Batch and Import Row, Mapping Preset, Audit Entry, Backup.

## 9. Decisions on open questions

These defaults are recorded in the spec's Clarifications section and can be revisited.

1. **Cash position** includes cash and bank accounts only. Credit-card dues are shown next to it as "due soon" and count in net worth.
2. **Budget rollover:** an unspent positive amount carries over to next month's category. Overspending reduces next month's "To assign".
3. **Backup location:** the app's own data folder by default, and the user can choose another folder.

## 10. Release plan

| Milestone | Content |
|---|---|
| M0 | Repository, Spec Kit, PRD, constitution, spec |
| M1 | Foundation: app shell, local storage, settings, test harness |
| M2–M3 | Accounts, transactions, splits, transfers, search |
| M4 | CSV import wizard |
| M5 | Rules, recurring items, budgets, goals |
| M6 | Dashboard, forecast, net worth |
| M7 | Export, backup and restore |
| M8 | Polish, accessibility, performance, installer → **1.0** |
| v1.1 | What-if simulator, behavior insights, financial-health narrative |

## 11. Success metrics

There is no telemetry, so these are checked by hand while using the app and by automated tests.

- First account reconciled within 15 minutes of installing.
- Monthly import and review takes under 2 minutes per account. From the second month on, at least 80% of imported rows are categorized automatically.
- Zero data-loss incidents, and the automated backup-and-restore round-trip test always passes.
- For users who have set up their recurring items, the 30-day forecast's lowest point lands within ±10% of the actual lowest balance.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Bank CSV formats vary and change | Flexible column mapper, saved presets, and original rows kept so a file can be parsed again |
| An inaccurate forecast damages trust | Confidence labels, an assumptions panel, and wording that presents it as an estimate |
| A bad restore or data upgrade loses data | Automatic backup beforehand, integrity checks, and changes that apply all at once or not at all |
| Scope creep | Insights and the simulator are held to v1.1. 1.0 ships P0 plus whichever P1 items are ready. |
