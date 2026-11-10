# Implementation Plan: Daily use

**Spec**: [spec.md](./spec.md) · **Branch**: `003-daily-use` · **Release**: Fin 2.1.0

## Shape

Everything follows the 2.0 layout: pure rules in `crates/fin-core/src/domain`, storage and queries
in `crates/fin-core/src/db`, requests in `handlers.rs` with their input schemas in
`contract/inputs.rs` **and** `src/shared/schemas.ts` (kept identical; `tests/parity/vectors/contract.json`
is regenerated and replayed by `crates/fin-core/tests/contract_vectors.rs`), the interface in
`src/renderer`. The shell (`src-tauri`) only gains what needs the operating system: notifications,
the tray and start-at-login.

## Data (migration 0007_daily_use.sql, schema v7)

```sql
ALTER TABLE accounts ADD COLUMN statement_day INTEGER;      -- 1..31, credit cards only
ALTER TABLE accounts ADD COLUMN due_days_after INTEGER;     -- 1..60
CREATE TABLE saved_views (id, name, query, pinned, sort_order, created_at, updated_at);
CREATE TABLE notification_log (key TEXT PRIMARY KEY, sent_at TEXT NOT NULL);
```

- `saved_views` is audited (undo) and exported as `savedViews`; the account fields are exported as
  `statementDay` / `dueDaysAfter`. Both are additive, so export stays format v1 (contract allows
  additive fields). `notification_log` is bookkeeping: not audited, not exported.
- New settings keys (flat, like the existing ones): `notifyEnabled` (false), `notifyRecurring`
  (true), `notifyCardDue` (true), `notifyLowCash` (true), `cardDueNoticeDays` (3),
  `quietHoursStart` ("22:00"), `quietHoursEnd` ("08:00"), `notifyShowAmounts` (true),
  `keepInTray` (false), `startAtLogin` (false).

## Requests

| Channel | Input | Output |
|---|---|---|
| `views.list` | – | `SavedViewDto[]` |
| `views.create` | `{ name, query, pinned? }` | `Mutation<{ view }>` |
| `views.update` | `{ id, patch: { name?, query?, pinned? } }` | `Mutation<{ view }>` |
| `views.delete` | `{ id }` | `Mutation<{}>` |
| `cards.cycles` | – | `CardCycleDto[]` (credit cards with a cycle) |
| `insights.calendar` | `{ month }` | `SpendingCalendarDto` |
| `reminders.preview` | – | `ReminderDto[]` due now, not recorded |
| `reminders.test` | – | `null` (shell shows a sample notification) |

`accounts.create/update` accept `statementDay` and `dueDaysAfter` (nullable). `dashboard.summary`
`cardDues` gains `nextDue: { accountId, accountName, amountMinor, dueDate } | null` and `allPaid`.
`forecast.run` events and assumptions gain card bills.

## Domain

- `domain/card_cycle.rs`: `statement_date_on_or_before(day, date)`, `next_statement_date`,
  `cycle(input) -> CardCycle { statement_date, statement_minor, due_date, credits_since_minor,
  remaining_minor, spent_since_minor, next_statement_date, next_due_date, status }`. Owed amounts in
  display terms (positive = owed). Month-end clamping as in `recurrence.rs`.
- `domain/reminders.rs`: `due(input) -> Vec<Reminder { key, kind, title, body, route }>` from
  occurrences (due tomorrow / overdue), card cycles (due within N days, unpaid), the forecast's first
  day below buffer within 7 days, settings and the local time; quiet hours; text with or without
  amounts. Keys: `recurring:{item}:{due}:{tomorrow|overdue}`, `card:{account}:{statement}`,
  `lowcash:{date}`.
- Calendar: a query (`db/calendar.rs`) with the same spending rule as `dashboard.rs` (`kind =
  'standard'`, `amount_minor < 0`, all accounts); grouping in SQL.

## Shell (src-tauri)

- `App::take_due_reminders(now)` (fin-core) computes and records reminders atomically; the shell
  runs it after warm-up and then hourly, showing each with `tauri-winrt-notification` (Tauri's own
  WinRT toast crate; works offline). App id: the bundle identifier when installed, PowerShell's in
  development. Activation focuses the window and emits `fin://navigate` with the route; the renderer
  listens with `@tauri-apps/api/event`.
- Tray (`tauri` feature `tray-icon`) created when `keepInTray` is on; close-requested hides the
  window instead of quitting. Start-at-login with `tauri-plugin-autostart` (HKCU Run key, starts with
  `--background`). The shell applies these at start and after every successful `settings.update`.
- `tauri-plugin-single-instance`: launching Fin again focuses the running window (important once it
  can hide in the tray). Skipped when `FIN_DATA_DIR` is set, so tests and throwaway data folders can
  run side by side.
- Test seams (only with `FIN_DATA_DIR`): `FIN_E2E_NOTIFICATIONS=<file>` appends each notification as a
  JSON line instead of showing it; autostart is never written to the registry in that mode.
- Logs: `notify.sent kind=… count=…`, never text.

## Interface

- Transactions: `filtersToQuery` (inverse of the existing URL parsing); **Save view** in the filter
  bar; a view header menu (rename, pin, update, delete). The page remounts on a new query string so
  sidebar links switch views. Sidebar "Views" section; palette group "Saved views".
- Accounts: `AccountForm` cycle fields for credit cards; `CardCyclePanel` per card.
- Overview: Card dues subtitle from `nextDue`.
- Insights: **Calendar** tab (`SpendingCalendar.tsx`), sequential single-hue ramp validated with the
  dataviz validator in both themes, text colour chosen per step, `ChartTable` alternative.
- Settings: **Notifications** card (`NotificationSettings.tsx`) and **Background** options.
- Navigation listener (`lib/navigate-events.ts`).

## Tests

- Rust unit tests first for `card_cycle` (month ends, February, leap year, no statement yet, overpaid,
  refunds) and `reminders` (each kind, quiet hours across midnight, repeats suppressed, amounts
  hidden). DB tests for views (audit/undo), calendar total = dashboard spent, forecast card events and
  the no-double-count rule.
- `perf.rs` budgets: `cards.cycles`, `insights.calendar`, reminder check.
- Playwright: `us9-views.spec.ts`, `us10-cards.spec.ts`, `us11-reminders.spec.ts` (through the
  notification file seam), `us12-calendar.spec.ts`; a11y and offline specs extended.
- Demo data: card cycles on the demo card, a saved view.
