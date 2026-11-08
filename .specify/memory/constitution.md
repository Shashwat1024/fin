<!--
Sync Impact Report
- Version change: 1.0.0 → 1.1.0 (MINOR: new principle added, existing guidance materially expanded)
- Modified principles:
  - II. Trustworthy Numbers → II. Exact, Trustworthy Numbers (integer minor units, date rules, atomicity)
  - V. Focused Simplicity (adds single-user / no-auth rule and scope discipline)
- Added principles: VI. Calm, Keyboard-First, Accessible Experience
- Added sections: none (Quality Standards expanded with domain-isolation and test rules)
- Removed sections: none
- Templates: plan/spec/tasks templates read the constitution at runtime; no edits required
- Deferred TODOs: none
-->
# Personal Finance Tracker Constitution

## Core Principles

### I. Private by Default
The application is a single-user, local-first product. Financial data MUST remain on the user's
device unless an explicitly designed, opt-in feature changes that boundary. Normal operation MUST
NOT make network requests. Logs, diagnostics, exports, and backups MUST avoid leaking sensitive
financial data (amounts, descriptions, account names) into places the user did not choose.

### II. Exact, Trustworthy Numbers
Every balance, budget, forecast, and insight MUST be reproducible from persisted inputs.
Monetary values MUST be stored as integer minor units with an explicit currency code; floating-point
arithmetic MUST NOT be used for money. Calendar dates MUST be stored as local calendar dates and
instants as UTC timestamps, interpreted with the user's configured timezone. Any change touching more
than one record MUST be atomic. Imports MUST preserve source rows, and automated categorization or
suggestions MUST be reviewable and reversible.

### III. Explainable Automation
Forecasts, categorization suggestions, recurring projections, and behavioral insights MUST show their
assumptions, source signals, confidence, and data freshness. The product MUST present estimates as
estimates and MUST NOT provide disguised investment or financial advice. Automation MUST suggest;
the user MUST confirm before historical data is changed.

### IV. Recoverable Changes
Destructive actions and bulk operations MUST be confirmable, auditable, and reversible where
practical. A backup MUST be taken automatically before schema upgrades and restores. The application
MUST provide reliable export and backup/restore paths before advanced automation is treated as
complete.

### V. Focused Simplicity
Features MUST serve the personal finance workflow and remain understandable to one user. There is
no authentication, multi-user, or multi-tenant design. Prefer a small, well-tested vertical slice
over speculative integrations or opaque automation; items outside the PRD's P0/P1 scope MUST NOT
enter a release without a spec amendment.

### VI. Calm, Keyboard-First, Accessible Experience
Every common action MUST be reachable from the keyboard. Interfaces MUST meet WCAG 2.2 AA contrast,
show visible focus, and provide text alternatives for charts. Language about spending MUST be
neutral and non-judgemental. Every screen MUST have designed empty, loading, and error states.

## Quality Standards

- User-facing errors MUST explain what happened and how to recover.
- Domain logic (money, dates, ledger, recurrence, budgets, forecasts, import parsing, rules) MUST be
  independent of UI and storage frameworks so it can be unit-tested in isolation.
- Core calculations, import validation, duplicate detection, migrations, backup/restore, and
  persistence boundaries MUST have automated tests.
- Accessibility, keyboard navigation, and clear empty/loading/error states are part of feature
  completeness.
- Documentation and specifications MUST be updated when behavior or data contracts change.

## Development Workflow

Work MUST proceed through the Spec Kit artifacts: constitution, specification, plan, and tasks.
The product-level source of intent is `docs/PRD.md`. A feature is ready to implement only after its
user scenarios, acceptance criteria, data boundaries, and measurable success criteria are explicit.
Changes MUST preserve existing behavior and pass the smallest relevant automated checks before
broader validation.

## Governance

This constitution supersedes conflicting project practices. Amendments MUST be made in this file
with a semantic version change and a brief rationale in the Sync Impact Report. Every implementation
plan and review MUST check privacy, numerical correctness, recoverability, explainability, and
accessibility.

**Version**: 1.1.0 | **Ratified**: 2026-11-08 | **Last Amended**: 2026-11-08
