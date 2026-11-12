# Feature Specification: Shared life (Fin 2.5)

**Feature Branch**: `007-shared-life` · **Created**: 2026-11-11 · **Status**: In progress
**Input**: Roadmap release "Shared life" (`docs/ROADMAP.md`): who owes whom, then receipts and
warranties. Ships as Fin 2.5.0.

## Why

Dinners, trips and rent get split with friends and flatmates, and the money comes back days or weeks
later. Today Fin sees a large expense and, later, an unexplained credit. The user keeps the tally
elsewhere, or forgets.

## User scenarios

### User Story 21 - Who owes whom (Priority: P1)
**Acceptance**:
1. A People page lists the people the user shares money with, each with a balance in plain words:
   "Rahul owes you ₹1,200", "You owe Priya ₹300", "Settled up".
2. On an expense, **Shared with** records who owes a part of it (half by default). A person can be
   added there by name. Amounts the user owes, or money lent without a transaction (cash), are added
   on the person's page.
3. **Record a repayment** on a person's page suggests money that came in recently: first payments
   whose description names the person, then those of exactly the amount owed. Choosing one links it
   and reduces the balance; a repayment in cash can be recorded without a transaction.
4. Every entry links to its transaction; every change can be undone. People are in backups and the
   export.
5. Spending is not changed: Fin keeps showing what left the user's accounts. The Overview shows the
   balances ("Rahul owes you ₹1,200") when there are any.

### User Story 22 - Receipts and warranties (Priority: P2)
**Acceptance**:
1. A transaction can have files attached (images or PDFs up to 10 MB each), kept inside Fin's data
   file so backups, restore and the encrypted backup keep working as one file.
2. Attachments can be previewed and saved elsewhere, and removed (undoable).
3. An attachment can have a warranty end date; Accounts' sibling page "Warranties" lists them by date,
   and reminders (US11) mention warranties ending within 30 days.
4. Settings › Data shows how much space attachments use.

### Edge cases
- A share larger than the transaction: refused. A person cannot be deleted while their balance is not
  zero; they can be archived when settled.
- A repayment larger than what is owed: allowed (the balance turns the other way), shown clearly.
- Two people with the same name: refused (names are unique among active people).

## Requirements
- **FR-080** People and shares are stored, audited and exported; balances are pure sums.
- **FR-081** Repayment suggestions are a pure ranking of incoming transactions (name in the
  description, then exact amount, then recency) and are never applied without the user's choice.
- **FR-082** Attachments are stored in their own table so ledger queries are unaffected; the 50,000
  transaction budgets still hold.

## Success criteria
- **SC-022** A person's balance equals the sum of the entries listed on their page in 100% of tests.
- **SC-023** With 50,000 transactions the People page loads in under 100 ms.
