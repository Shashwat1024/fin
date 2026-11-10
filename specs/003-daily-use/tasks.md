# Tasks: Daily use

Each phase is committed and pushed when its checks pass (fmt, clippy, Rust tests, typecheck, lint,
unit tests, parity vectors, the phase's e2e spec).

## D0: Groundwork
- [x] D001 Migration 0007 (card cycle columns, saved_views, notification_log); schema v7; audited and
  exported tables; settings defaults and schemas for the new keys
- [x] D002 Contract entries (TS + Rust) for the new channels; regenerate contract vectors

## D1: Saved views (US9)
- [x] D101 `db/views.rs` with audit; handlers; tests (create, update, delete, undo, export)
- [x] D102 `filtersToQuery`; Save view dialog; view header menu; page remount on query change
- [x] D103 Sidebar "Views" and palette "Saved views"; demo view
- [x] D104 `us9-views.spec.ts`; a11y

## D2: Spending calendar (US12)
- [x] D201 `db/calendar.rs`, `insights.calendar`; test month total = dashboard spent
- [x] D202 `SpendingCalendar.tsx` (validated ramp, both themes), month navigation, table view
- [x] D203 `us12-calendar.spec.ts`; a11y

## D3: Card cycles (US10)
- [ ] D301 `domain/card_cycle.rs` with unit tests first
- [ ] D302 Account fields (create/update/DTO/export); `cards.cycles`; dashboard `nextDue`
- [ ] D303 Forecast card-bill events and assumptions, no double counting; tests
- [ ] D304 AccountForm fields, `CardCyclePanel`, Overview subtitle; demo card cycle
- [ ] D305 `us10-cards.spec.ts`; a11y

## D4: Reminders, tray, start at login (US11)
- [ ] D401 `domain/reminders.rs` with unit tests first; `App::take_due_reminders`; `reminders.preview`
- [ ] D402 Shell: toasts with activation → navigate, hourly check, test seam, logging
- [ ] D403 Shell: tray, close-to-tray, autostart, single instance; applied on settings change
- [ ] D404 Settings › Notifications and Background; navigate listener
- [ ] D405 `us11-reminders.spec.ts`; offline spec covers reminders

## D5: Release 2.1.0
- [ ] D501 Perf budgets (SC-012); full e2e on the release build
- [ ] D502 README, quickstart sections, release checklist; version 2.1.0; installer; PR; tag
