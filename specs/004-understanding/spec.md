# Feature Specification: Making sense of it (Fin 2.2)

**Feature Branch**: `004-understanding` · **Created**: 2026-11-11 · **Status**: In progress
**Input**: Roadmap release "Making sense of it" (`docs/ROADMAP.md`): a plain-language health summary,
a monthly review and a year in review. Ships as Fin 2.2.0.

## Why

Fin has every number, but the user has to know where to look and what it means together. These
features turn the ledger into a few plain sentences, a short routine at the start of each month, and
a look back at the year — always as facts with the records behind them, never as scores or advice.

## User scenarios

### User Story 13 - Health summary (Priority: P1)
A user opens Insights or the Overview and reads where they stand in a few neutral sentences.

**Acceptance**:
1. Four measures, each with its value, what it is computed from, and a link to the records behind
   it:
   - **Emergency cover**: cash and bank balances divided by the average monthly essential spending
     (categories in the "needs" group) over the last three complete months. "Your cash would cover
     about 4.2 months of essential spending."
   - **EMIs to income**: monthly EMIs (recurring items of kind EMI, as a monthly amount) divided by
     the average monthly income over the last three complete months.
   - **Savings rate**: the last three complete months against the three before ("22%, up from 15%").
   - **Card dues to cash**: what is owed on credit cards as a share of cash and bank balances.
2. A measure that cannot be computed says why ("Not enough history yet: needs a complete month of
   transactions"; "No income recorded in the last three months").
3. The summary is a short paragraph at the top of Insights and a card on the Overview. No scores,
   grades, colours for good or bad, or advice.
4. Transactions can be filtered by category group (for the essential-spending drill-down), shown as
   a removable filter.

### User Story 14 - Monthly review (Priority: P1)
At the start of a month the user walks through last month in five short steps.

**Acceptance**:
1. A review page for any month (`/review/2026-10`) with five steps, any of which can be skipped:
   (1) categorise what is uncategorised, (2) check each account against its statement,
   (3) see how the budget went, (4) read the month's insights, (5) set next month's budget, with
   "Copy this month's amounts".
2. Each step shows live counts (e.g. "3 transactions to categorise") and links to the screen that
   does the work; nothing is changed without the user's action.
3. **Mark as reviewed** records the month. From the 1st to the 7th of a month, the Overview offers
   "Review October" until it is reviewed or dismissed for that month.
4. Copying a budget is one undoable change, and only fills categories with nothing assigned.

### User Story 15 - Year in review (Priority: P2)
The user looks back at a financial year (or calendar year).

**Acceptance**:
1. A year page with a choice of financial year (the user's FY start) or calendar year, defaulting to
   the last complete financial year once one exists, otherwise the current one so far.
2. It shows money in and out, net saved and the savings rate; money in and out by month (chart with
   a table view); the top five categories and merchants; the biggest changes by category against
   the year before (when there is one); goals reached in the year; and net worth at the start and
   end.
3. Every figure links to the transactions behind it.
4. **Print or save as PDF** opens Windows' print dialog with a print layout (no sidebar), where
   "Microsoft Print to PDF" saves a file. Nothing leaves the computer.

### Edge cases
- Less than one complete month of history; no "needs" categories used; no cash accounts.
- A month with no transactions: the review still opens; steps say there is nothing to do.
- A year with no data before the user's first transaction is shown from the first transaction, and
  says so.
- Demo data: all three work on the demo ledger.

## Requirements

- **FR-050** Health measures are pure functions of balances, monthly totals and recurring items, each
  returning its value, inputs and comparison (FR-027/FR-028 style explanations).
- **FR-051** Wording is neutral and factual (PRD: no advice).
- **FR-052** `month_reviews(month, reviewed_at)`; reviewing is audited and undoable.
- **FR-053** `budget.copyMonth` copies assigned amounts into categories with none, in one audited
  change.
- **FR-054** Year totals use the Overview's rules (transfers excluded), so a year equals the sum of
  its months.
- **FR-055** Offline and private as everywhere else; printing uses the operating system's dialog.

## Success criteria

- **SC-015** With 50,000 transactions: health summary under 300 ms, year in review under 500 ms, a
  month's review counts under 300 ms; the Overview within its 300 ms budget.
- **SC-016** The year's money out equals the sum of its months' "Spent" in 100% of tested years.
- **SC-017** New screens pass axe in both themes and work with the keyboard alone.
