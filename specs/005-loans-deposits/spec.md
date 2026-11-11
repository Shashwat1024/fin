# Feature Specification: Loans and deposits (Fin 2.3)

**Feature Branch**: `005-loans-deposits` · **Created**: 2026-11-11 · **Status**: In progress
**Input**: Roadmap release "Loans & deposits" (`docs/ROADMAP.md`): loan/EMI breakdown, fixed and
recurring deposits with maturities, and annual bills set aside monthly. Ships as Fin 2.3.0.

## Why

EMIs, deposits and annual bills are scheduled money. Fin knows when they happen but not what they
are made of: how much of an EMI is interest, what a deposit is worth today and at maturity, and how
much to put aside each month for the insurance bill due in March.

## User scenarios

### User Story 16 - Loan schedule and EMI breakdown (Priority: P1)
**Acceptance**:
1. Loan accounts take optional terms: amount borrowed, annual interest rate, tenure in months and the
   first EMI date. The EMI is calculated (nearest rupee) and shown; nothing is required.
2. For a loan with terms, the Accounts page shows this month's EMI split into principal and
   interest, interest and principal paid so far and still to pay, the outstanding amount per the
   schedule, and the end date. A full schedule (table) opens from it.
3. Interest is computed in exact paise each month on the outstanding balance (rounded half up); the
   last EMI clears the balance exactly.
4. What-if "loan prepayment" on a loan with terms shows interest saved and months saved for both
   choices banks offer: a shorter tenure (same EMI) or a smaller EMI (same tenure).

### User Story 17 - Fixed and recurring deposits (Priority: P1)
**Acceptance**:
1. An investment account can be marked as a fixed deposit (FD) or recurring deposit (RD) with the
   interest rate, maturity date, the monthly instalment (RD) and the account the money goes to at
   maturity. The amount deposited is the start balance (FD) or the instalments (RD).
2. Interest compounds quarterly, like most Indian banks; a part quarter earns simple interest. The
   value today and the maturity amount are shown.
3. Net worth uses the value today for a deposit with no recorded value; a recorded value always
   takes priority.
4. The forecast counts a maturity as money in to the payout account (when it is cash or bank) on the
   maturity date, listed in its assumptions.

### User Story 18 - Annual bills set aside monthly (Priority: P2)
**Acceptance**:
1. A yearly or quarterly recurring payment with a category can be marked "set aside monthly".
2. The Budget page suggests, for that category, the monthly amount still needed: what is not yet
   set aside (the category's available money) divided by the months left before it is due
   ("Suggested ₹4,200 for Car insurance, due in March"). Assigning it is one click and never
   automatic.

### Edge cases
- Zero interest loans (EMI = principal ÷ months); a rate change is not modelled (edit the terms).
- A deposit already matured: value is the maturity amount; Fin notes "Matured on … — record the
  payout and archive the deposit".
- A set-aside bill due this month: the rest is suggested at once.

## Requirements

- **FR-060** Amortisation, deposit growth and set-aside amounts are pure functions with unit tests
  against hand-computed and published examples.
- **FR-061** Terms are optional and editable; changing them never changes transactions.
- **FR-062** New account fields and the set-aside flag are exported (additive, format v1).
- **FR-063** Every figure states its basis ("from your loan terms"), and none is presented as the
  bank's statement.

## Success criteria

- **SC-018** An EMI and its schedule match a standard reducing-balance calculator to the rupee
  (e.g. ₹10,00,000 at 9% for 60 months: EMI ₹20,758).
- **SC-019** With 50,000 transactions the Accounts page, forecast and Overview stay within budget.
