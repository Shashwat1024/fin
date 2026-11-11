# Implementation Plan: Making sense of it

**Spec**: [spec.md](./spec.md) · **Branch**: `004-understanding` (on top of `003-daily-use`) ·
**Release**: Fin 2.2.0

Same layout as 2.0/2.1: pure rules in `crates/fin-core/src/domain`, queries in `db`, request schemas
in both `contract/inputs.rs` and `src/shared/schemas.ts` (contract vectors regenerated), interface
in `src/renderer`.

## Data (migration 0008_reviews.sql, schema v8)

```sql
CREATE TABLE month_reviews (id TEXT PRIMARY KEY, month TEXT NOT NULL UNIQUE, state TEXT NOT NULL
  CHECK (state IN ('reviewed','dismissed')), at TEXT NOT NULL);
```
Audited (undo) and exported as `monthReviews` (additive, format v1).

## Requests

| Channel | Input | Output |
|---|---|---|
| `health.summary` | – | `HealthDto` (four measures, each value/inputs/comparison/reason) |
| `review.month` | `{ month }` | `MonthReviewDto` (counts for the five steps, state) |
| `review.setState` | `{ month, state: 'reviewed' \| 'dismissed' \| null }` | `Mutation<{ review }>` |
| `review.prompt` | – | `{ month } \| null` (Overview prompt, 1st–7th) |
| `budget.copyMonth` | `{ from, to }` | `Mutation<{ copied }>` |
| `review.year` | `{ basis: 'fy' \| 'calendar', year }` | `YearReviewDto` |

`txns.query` already takes `categoryIds`; the Transactions page gains a `group` URL filter that expands
to the group's categories.

## Domain

- `domain/health.rs`: `emergency_cover`, `emi_share`, `savings_trend`, `card_share` from plain
  inputs; each returns `Measure { key, value, text, reason }`. Unit tests first.
- `domain/year_review.rs`: period for a basis and year; top-N with ties broken by name; changes
  against the previous year. Unit tests first.

## Interface

- `features/insights/HealthSummary.tsx` (paragraph with links; also the Overview card).
- `features/review/MonthReviewPage.tsx` (route `/review/:month`, `StepIndicator`, reuses the
  Transactions link, `ReconcileDialog`, budget data, insights list); Overview prompt card.
- `features/review/YearReviewPage.tsx` (route `/year`), `MonthlyFlowChart`-style chart with
  `ChartCard`; print stylesheet (`@media print`) hiding the shell; `window.print()`.
- Command palette entries; a11y screens.

## Tests

Rust unit tests for health and year rules; DB tests for review state, budget copy (undo, only empty
categories), year totals equal the sum of monthly Overview figures; perf budgets; e2e
`us13-health`, `us14-month-review`, `us15-year`; a11y.
