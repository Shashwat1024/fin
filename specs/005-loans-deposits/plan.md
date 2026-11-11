# Implementation Plan: Loans and deposits

**Spec**: [spec.md](./spec.md) · **Branch**: `005-loans-deposits` (on top of `004-understanding`) ·
**Release**: Fin 2.3.0

## Data (migration 0009_loans_deposits.sql, schema v9)

Columns on `accounts` (all nullable, ignored for other types):
`rate_bp` (annual rate in basis points, loans and deposits), `loan_principal_minor`, `tenure_months`,
`first_emi_date`, `deposit_kind` ('fd' | 'rd'), `maturity_date`, `installment_minor` (RD),
`payout_account_id`. Deposits stay `type = 'investment'`: adding a type would need rebuilding the
accounts table, whose type list is a CHECK constraint.

`recurring_items.set_aside INTEGER NOT NULL DEFAULT 0`.

## Domain

- `domain/amortization.rs`: `emi(principal, rate_bp, months)` (nearest rupee),
  `schedule(terms) -> Vec<Row { n, date, emi, interest, principal, balance }>`, `position(schedule,
  today)`, `prepay(terms, at, amount, mode) -> { interest_saved, months_saved, new_emi }`.
  Integer arithmetic for interest: `round_half_up(balance × rate_bp / 120000)`.
- `domain/deposits.rs`: `fd_value(principal, rate_bp, start, at)`, `rd_value(instalment, rate_bp,
  start, at)` (each instalment compounds from its date), maturity = value at the maturity date.
- `domain/set_aside.rs`: `monthly_set_aside(amount, available, months_left)`.

## Requests

- `accounts.create/update` accept the new fields; the DTO carries them.
- `loans.schedule { id }` → `LoanDto` (terms, EMI, schedule, position today).
- `accounts.list` stays fast: loan/deposit summaries come from `loans.summary` / `deposits.summary`
  (all loans / deposits at once) used by the Accounts page.
- `scenarios.run` loan prepayment gains `tenure` and `emi` outcomes when the loan has terms.
- Net worth: deposits without valuations get computed values (month ends and today).
- Forecast: deposit maturities as events (`deposit:<id>`), kind `deposit` in assumptions.
- `recurring.*` accept `setAside`; `budget.month` rows gain `suggestion { itemName, dueDate,
  amountMinor }`.

## Interface

AccountForm sections for loans and deposits; `LoanPanel` (with schedule dialog) and
`DepositPanel` on Accounts; What if shows both prepayment outcomes; Budget row suggestion with an
Assign button; recurring dialog "Set aside monthly" for yearly/quarterly items; demo data (home
loan, an FD, car insurance set aside).

## Tests

Unit: EMI against SC-018 and other published values; schedule clears exactly; zero rate; prepayment
both ways; FD/RD values against bank-calculator examples; set-aside rounding. DB: fields round-trip,
net worth uses computed deposit values, forecast maturity event, budget suggestion. e2e
`us16-loans`, `us17-deposits`, `us18-set-aside`; a11y; perf.
