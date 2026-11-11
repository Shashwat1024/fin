# Tasks: Making sense of it

Each phase is committed and pushed when its checks pass.

## E0: Groundwork
- [x] E001 Migration 0008 (month_reviews, audited, exported); schema v8
- [x] E002 Contract entries (TS + Rust); regenerate vectors

## E1: Health summary (US13)
- [x] E101 `domain/health.rs` with tests; `db/health.rs`; `health.summary`
- [x] E102 Transactions `group` filter
- [x] E103 `HealthSummary` on Insights and the Overview
- [x] E104 `us13-health.spec.ts`; a11y

## E2: Monthly review (US14)
- [x] E201 `review.month`, `review.setState`, `review.prompt`, `budget.copyMonth`; tests
- [x] E202 `MonthReviewPage` with five steps; Overview prompt; palette
- [x] E203 `us14-month-review.spec.ts`; a11y

## E3: Year in review (US15)
- [ ] E301 `domain/year_review.rs` with tests; `review.year`; year = sum of months test
- [ ] E302 `YearReviewPage`, chart and table, print layout
- [ ] E303 `us15-year.spec.ts`; a11y

## E4: Release 2.2.0
- [ ] E401 Perf budgets (SC-015); full e2e on the release build
- [ ] E402 Docs, version 2.2.0, installer, PR, tag after merge
