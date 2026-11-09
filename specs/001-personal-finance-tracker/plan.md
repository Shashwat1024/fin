# Implementation Plan: Personal Finance Tracker

**Branch**: `001-personal-finance-tracker` | **Date**: 2026-11-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-personal-finance-tracker/spec.md` · Product intent: [docs/PRD.md](../../docs/PRD.md)

## Summary

A single-user, offline Windows desktop app ("Fin") for tracking accounts, transactions, CSV
imports, recurring items, zero-based budgets, goals, net worth, and an explainable cash-flow
forecast. Technical approach: an Electron shell with a React/TypeScript renderer; all data in a
local SQLite file owned by the main process; a pure-TypeScript domain layer (money, dates, ledger,
import parsing, recurrence, budgets, forecast) that is unit-tested independently of UI and storage;
a Zod-validated, typed IPC contract between renderer and main. Delivery is by user story in
priority order, with US1 (ledger) as the MVP. See [research.md](./research.md) for all decisions.

## Technical Context

**Language/Version**: TypeScript 5.x (strict) on Node 24 LTS (Electron's bundled Node for runtime)

**Primary Dependencies**: Electron (current stable) + electron-vite, React, Tailwind CSS, shadcn/ui (Radix), TanStack Query/Table/Virtual, Recharts, cmdk, Zod, date-fns, PapaParse, ulid, built-in `node:sqlite` (see research R3 update); electron-builder for packaging

**Storage**: SQLite (built-in `node:sqlite`, WAL) at `%APPDATA%/Fin/fin.db`; numbered SQL migrations; FTS5 for search; file backups in `%APPDATA%/Fin/backups/` (configurable)

**Testing**: Vitest (domain unit + DB integration on temp files through real migrations), Playwright `_electron` (E2E smoke), coverage ≥ 90% lines on `src/domain`

**Target Platform**: Windows 10/11 x64 desktop (architecture keeps macOS/Linux possible)

**Project Type**: desktop-app (single project, Electron main/preload/renderer)

**Performance Goals**: with 50k transactions — cold start < 2 s; ledger filter < 150 ms; dashboard < 300 ms; 1,000-row CSV preview < 1 s; 60 fps scrolling in the ledger

**Constraints**: offline-only (no network requests); exact integer money; atomic multi-record writes; no financial data in logs; WCAG 2.2 AA; keyboard-complete

**Scale/Scope**: 1 user; ~10 accounts; up to 50k transactions (~10 years); ~10 screens; ~40 IPC channels

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Pre-research | Post-design |
|---|---|---|---|
| I. Private by Default | No network calls; renderer sandboxed; logs redact amounts/descriptions/account names | ✅ planned (R8) | ✅ CSP + navigation blocking + redacting logger in `src/main/logging.ts`; E2E offline check (quickstart §6) |
| II. Exact, Trustworthy Numbers | Integer minor units; calendar-date storage; atomic writes; source rows kept | ✅ (R5, R6) | ✅ data-model uses `*_minor INTEGER`, `TEXT date`; every repo mutation wrapped in `db.transaction`; ImportRow keeps raw cells |
| III. Explainable Automation | Suggestions require acceptance; forecasts show assumptions/confidence/freshness | ✅ (R13) | ✅ `rules.preview`/`applyToHistory`, `suggestions.*`, forecast `assumptions[]`, dashboard `asOf/sources` in contracts |
| IV. Recoverable Changes | Undo for bulk/destructive ops; auto-backup before migrations & restore | ✅ (R4, R15) | ✅ `audit_log.group_id` + `undo.apply`; `import.undo`; restore flow inspect→confirm→pre-backup |
| V. Focused Simplicity | Single user, no auth; P2/v1.1 items not in 1.0 | ✅ | ✅ US8 scheduled after 1.0; no auth/sync code paths |
| VI. Calm, Keyboard-First, Accessible | Keyboard reachability, AA contrast, chart alternatives, empty/loading/error states | ✅ (R2) | ✅ Radix primitives, cmdk palette, chart `<table>` fallbacks, state components in `src/renderer/components/states/` |
| Quality: domain isolation + tests | Domain free of Electron/DB imports; tests for core calcs, import, dupes, migrations, backup | ✅ (R16) | ✅ ESLint `no-restricted-imports` rule on `src/domain/**`; test tasks included in tasks.md |

No violations → Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/001-personal-finance-tracker/
├── spec.md
├── plan.md              # This file
├── research.md          # Phase 0 decisions (R1–R17)
├── data-model.md        # Phase 1 entities, fields, invariants, state transitions
├── quickstart.md        # Phase 1 run & validation guide
├── contracts/
│   ├── ipc.md           # Renderer ↔ main channels, envelopes, invariants
│   ├── import-csv.md    # Mapping config, preview shape, presets
│   └── export-json.md   # Export format v1 + CSV columns
├── checklists/requirements.md
└── tasks.md             # /speckit.tasks output
```

### Source Code (repository root)

```text
src/
├── domain/                 # Pure TS, no Electron/DB/React imports
│   ├── money.ts            # Money type, add/sub/allocate, parse & format (en-IN)
│   ├── dates.ts            # calendar dates, today-in-timezone, FY ranges, month math
│   ├── ledger.ts           # balances, split validation, transfer legs
│   ├── recurrence.ts       # schedule expansion, matching
│   ├── budget.ts           # zero-based month math & rollover
│   ├── goals.ts            # progress & projection
│   ├── forecast.ts         # daily projection, low point, confidence, assumptions
│   ├── networth.ts
│   ├── rules.ts            # condition evaluation → suggestions
│   └── import/
│       ├── sniff.ts        # encoding/delimiter/header detection
│       ├── parse.ts        # mapping → parsed rows + errors
│       ├── amount.ts       # Dr/Cr/parentheses/grouping parsing
│       ├── fingerprint.ts  # normalisation + sha256 + occurrence index
│       ├── narration.ts    # UPI/IMPS/NEFT extraction
│       └── presets/*.json  # built-in bank mappings
├── db/
│   ├── connection.ts       # open, pragmas, app_id marker
│   ├── migrate.ts          # runner + pre-migration backup
│   ├── migrations/0001_init.sql …
│   ├── repos/              # accounts, transactions, categories, rules, recurring,
│   │                       # budgets, goals, valuations, imports, audit, settings
│   ├── backup.ts           # create/list/inspect/restore, encryption
│   └── seed/               # default categories, demo dataset, 50k perf seed
├── shared/
│   ├── contract.ts         # channel → request/response types
│   └── schemas.ts          # Zod schemas
├── main/
│   ├── index.ts            # app lifecycle, window, security hardening
│   ├── ipc.ts              # handler registry (validate → service → Result)
│   ├── services/           # orchestrate domain + repos per channel group
│   ├── paths.ts            # %APPDATA%/Fin, demo DB path
│   └── logging.ts          # redacting logger
├── preload/index.ts        # contextBridge `window.fin`
└── renderer/
    ├── main.tsx, App.tsx, routes.tsx
    ├── lib/ipc.ts, lib/format.ts, lib/queryClient.ts
    ├── components/ui/      # shadcn components
    ├── components/states/  # Empty, Loading, ErrorState
    ├── components/         # MoneyText, CommandPalette, QuickAdd, DrillDownLink, Sparkline
    └── features/
        ├── onboarding/ accounts/ transactions/ import/ categories/ rules/
        ├── recurring/ budget/ goals/ dashboard/ forecast/ networth/ settings/

tests/
├── unit/domain/            # *.test.ts mirroring src/domain
├── integration/db/         # repos, migrations, backup/restore, import commit/undo
├── e2e/                    # Playwright Electron flows
└── fixtures/csv/           # synthetic bank statements per preset
```

**Structure Decision**: Single Electron project with four source roots (`domain`, `db`, `main`,
`preload`/`renderer`) plus `shared` for the IPC contract. Domain isolation is enforced by lint rule.

## Delivery Phases (maps to tasks.md)

| Phase | Scope | Exit criteria |
|---|---|---|
| 1 Setup | Scaffold, tooling, scripts, lint rules | `npm run dev` opens window; `npm run typecheck && npm test` green |
| 2 Foundational | DB + migrations, settings, money/dates, IPC skeleton, audit/undo, app shell, logging, security | Migration 0001 applied; IPC round-trip test; shell navigable by keyboard |
| 3 US1 (MVP) | Accounts, transactions, splits, transfers, quick-add, search, undo | US1 acceptance scenarios pass in E2E |
| 4 US2 | Import wizard, presets, dupes, batches, undo, reconcile | Fixture imports; re-import = 0 new; undo exact |
| 5 US3 | Dashboard metrics with drill-down & freshness | Metric = drill-down total (SC-005) |
| 6 US4 | Export, backups, restore, encryption, demo mode, offline check | Round-trip restore exact; wrong passphrase no-op |
| 7 US5 | Recurring, budgets, goals | Recurrence/budget/goal tests; US5 scenarios |
| 8 US6 | Categories mgmt, rules, suggestions, narration parsing | Preview→apply→undo; suggestions only on accept |
| 9 US7 | Forecast + net-worth history | Fixture forecasts match expected points & confidence |
| 10 Polish | a11y audit, perf (50k), onboarding, installer | NFR targets met on packaged build → **1.0** |
| 11 US8 (v1.1) | Insights & what-if | After 1.0 |

## Complexity Tracking

Not applicable — no Constitution Check violations.
