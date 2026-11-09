# Personal Finance Tracker

Private, local-first desktop finance tracker for personal use.

## Project workflow

This repository uses [GitHub Spec Kit](https://github.com/github/spec-kit) for specification-driven development. The workflow is:

1. `/speckit.constitution`
2. `/speckit.specify`
3. `/speckit.plan`
4. `/speckit.tasks`
5. `/speckit.implement`

The product requirements are in [docs/PRD.md](docs/PRD.md). Project principles are recorded in [.specify/memory/constitution.md](.specify/memory/constitution.md). The initial product specification is in [specs/001-personal-finance-tracker/spec.md](specs/001-personal-finance-tracker/spec.md).

## Privacy boundary

The initial product is single-user and local-only. It does not require an account, hosted backend, or bank credentials.

- Your data lives in `%APPDATA%\Fin` (`fin.db`), with backups in `%APPDATA%\Fin\backups` unless you choose another
  folder in Settings › Data. A cloud-synced backup folder sends copies of your data through that service.
- The database itself is not encrypted. Turn on disk encryption (BitLocker) and use passphrase-protected backups
  (`.finbackup`: scrypt + AES-256-GCM). A forgotten passphrase cannot be recovered.
- The app blocks all network requests; `tests/e2e/offline.spec.ts` checks this across every core flow.

## Running locally

Requires Node 24+ on Windows.

```powershell
npm install
npm run dev          # launch the app
npm test             # unit + integration tests
npm run test:e2e     # end-to-end tests against the real Electron app
npm run lint; npm run typecheck
```

Data is stored in `%APPDATA%\Fin\` (`fin.db`, `backups\`, `logs\`). Set `FIN_DATA_DIR` to use a
different folder, for example a throwaway one while testing.

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
- ⏭️ Next: categorization rules and suggestions (US6).
  See [tasks.md](specs/001-personal-finance-tracker/tasks.md).

