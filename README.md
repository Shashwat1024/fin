# Fin

A private, offline personal finance tracker for Windows, in Indian rupees. Fin keeps your accounts,
imported bank statements, budget, goals, forecast and net worth on your own computer. There is no
account to create, no bank login and nothing in the cloud.

## Install

1. Build the installer (see [Development](#development)) or use one you were given:
   `release\Fin Setup 1.1.0.exe`.
2. Run it. Fin installs for your Windows user only, so no administrator rights are needed, and you
   can choose the folder.
3. The installer is not code-signed yet, so Windows SmartScreen may warn about an unknown publisher.
   Choose **More info › Run anyway** only for an installer you built yourself or trust.

On first launch Fin asks for your first account and its starting balance, or you can explore with
demo data first (demo data is kept apart from yours and thrown away when you leave it).

Press `?` at any time to see every keyboard shortcut, or `Ctrl+K` for the command palette.

## Your data

| What | Where |
|---|---|
| Your ledger | `%APPDATA%\Fin\fin.db` (a SQLite file) |
| Automatic backups | `%APPDATA%\Fin\backups\`, or the folder you choose in Settings › Data |
| Logs | `%APPDATA%\Fin\logs\fin.log`. These record what happened, never amounts, payees or account names. |

**Privacy.** Fin makes no network requests at all and blocks any attempt to make one. The test
suite checks this across every flow, and checks the log file for financial details. Uninstalling
Fin leaves your data folder in place, so delete `%APPDATA%\Fin` yourself if you want it gone.

**Backups.**
- Fin backs up once a day when it starts and keeps the last 14. It also backs up before any
  upgrade or restore.
- Use **Settings › Data › Back up now** before big changes, such as a large import or merging
  categories.
- Keep an occasional copy somewhere other than this computer, such as a USB drive. A backup on the
  same disk does not survive the disk failing.
- If you point the backup folder at a cloud-synced drive (OneDrive, Google Drive), copies of your
  data go to that service. Use a passphrase-protected backup if you do.
- **Restore** checks the file first, shows what it contains, and backs up your current data before
  replacing it.

**Encryption.**
- `fin.db` itself is not encrypted. Anyone who can sign in to your Windows account, or read the
  disk, can read it.
- Turn on **BitLocker** (or Device Encryption on Windows Home) so the disk is encrypted at rest.
- Backups can be protected with a passphrase (`.finbackup`: scrypt key derivation and AES-256-GCM).
  A forgotten passphrase cannot be recovered, and Fin never stores it.

**Export.** Settings › Data exports all transactions to CSV for spreadsheets, or everything to a
documented JSON file ([format](specs/001-personal-finance-tracker/contracts/export-json.md)), so
your data is never locked in.

## Development

This repository uses [GitHub Spec Kit](https://github.com/github/spec-kit) for specification-driven
development (`/speckit.specify` → `/speckit.plan` → `/speckit.tasks` → `/speckit.implement`).
The [PRD](docs/PRD.md), [constitution](.specify/memory/constitution.md) and
[specification](specs/001-personal-finance-tracker/spec.md) describe what Fin does and why.

Requires Node 24+ on Windows. No native build tools are needed, because storage uses Node's built-in
`node:sqlite`.

```powershell
npm install
npm run dev          # launch the app with hot reload
npm test             # unit + integration tests (includes 50k-transaction query budgets)
npm run test:e2e     # build, then end-to-end tests against the real Electron app
npm run lint; npm run typecheck
npm run package      # Windows installer in release\
npm run seed:perf    # a 50,000-transaction data folder for manual performance checks
```

Set `FIN_DATA_DIR` to use a different data folder, for example a throwaway one while testing. Set
`FIN_E2E_EXE=release\win-unpacked\Fin.exe` to run the end-to-end suite against the packaged app.
How to validate each feature by hand is in
[quickstart.md](specs/001-personal-finance-tracker/quickstart.md).

## Status

- ✅ User Story 1 (MVP): accounts, transactions, splits, transfers, quick-add, search & filters,
  bulk edit, undo, onboarding, settings, command palette.
- ✅ User Story 2: CSV statement import with built-in HDFC / ICICI / SBI / Axis / Kotak / card
  layouts, saved layouts, duplicate detection, balance check, import history with raw lines and
  one-step batch undo, and reconciliation against a statement balance.
- ✅ User Story 3: overview with cash position, month-to-date spending vs the same point last
  month, income, savings rate, card dues and net worth. Each card links to the records that add
  up to it, shows how current its data is (per account, incl. latest import), and the six-month
  money in/out chart has a table view.
- ✅ User Story 4: daily automatic backups (last 14 kept), manual and passphrase-protected backups,
  restore that checks the file and backs up your current data first, JSON/CSV export, demo mode,
  and an offline test across every core flow.
- ✅ User Story 5: recurring income, bills, EMIs and subscriptions (month-end dates handled,
  payments matched automatically, overdue ones flagged, skip or link by hand); a zero-based monthly
  budget with keyboard entry, carry-forward and overspending taken from next month; savings goals
  with the monthly amount needed and a projected date; Overview cards for all three.
- ✅ User Story 6: category manager (add, rename, move, regroup, merge or delete with a replacement),
  rules with a live match count, a preview of exactly what would change and one-step undo, merchants
  read from UPI/IMPS/NEFT/card narrations, and category suggestions (from rules and your past choices
  for the same merchant) in the ledger and import review — never applied until accepted.
- ✅ User Story 7: 30/60/90-day cash-flow forecast (lowest point and date, days below your buffer
  with the payments behind them, a High/Medium/Low confidence label and every assumption listed),
  and net-worth history by month with values you record for investments and loans.
- ✅ Release polish: keyboard shortcuts sheet (`?`), WCAG 2.2 AA checks on every screen in both
  themes, 50,000-transaction performance checks, and a Windows installer. Results:
  [checklists/release.md](specs/001-personal-finance-tracker/checklists/release.md).
- ✅ User Story 8 (v1.1): **Insights** — category and merchant spending against your usual months,
  subscription price rises and more subscriptions than six months ago, a weekend pattern, and
  one-off purchases far above your usual — each citing its comparison and the transactions behind
  it, and dismissible with undo. **What if** — a new bill, a pay change, a large purchase, a loan
  prepayment or saving more, shown against your real forecast and goals without saving anything.
  The Recurring page also suggests payments that **look recurring** and sets them up in one step.
  (Late-night spending is not detected: statements give dates, not times.)

