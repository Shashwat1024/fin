# Feature Specification: Daily use (Fin 1.2 features on 2.x)

**Feature Branch**: `003-daily-use` · **Created**: 2026-11-10 · **Status**: In progress
**Input**: Roadmap release "Daily use" (`docs/ROADMAP.md`): saved views, credit-card cycles, Windows
notifications and a spending calendar. Ships as Fin 2.1.0 on the Rust/Tauri foundation.

## Why

Fin answers questions well once it is opened, but nothing brings the user back between imports.
These four features make it worth opening every day: the transactions the user looks at most are
one click away, card bills stop being a surprise, Fin can remind the user of what is due even when
they are not looking at it, and a month of spending can be read at a glance.

## User scenarios

### User Story 9 - Saved views (Priority: P1)
A user who checks "Swiggy and Zomato this month" or "uncategorised card spending" every week saves
the filter once and opens it from the sidebar or the command palette.

**Acceptance**:
1. With any filter applied on Transactions, **Save view** asks for a name and whether to pin it to
   the sidebar (on by default). The view stores the filters, not the results: "This month" stays
   this month.
2. Pinned views are listed under the main navigation; every view is in the command palette under
   "Saved views". Opening one shows Transactions with exactly those filters and the view's name.
3. While a view is open, the user can rename it, pin or unpin it, replace its filters with the
   current ones, or delete it. Each change can be undone.
4. Views are included in backups and the JSON export.

### User Story 10 - Credit-card cycles (Priority: P1)
A user records each card's statement day and how many days later payment is due. Fin shows what
was billed, what is still due and by when, and counts the bill in the forecast.

**Acceptance**:
1. Credit-card accounts have two optional fields: statement day (1–31; a day past the end of the
   month means the last day) and days until due (1–60). Other account types do not show them.
2. For each card with a cycle, the Accounts page shows the last statement (date and amount), the
   due date, payments and credits since the statement, the amount still due, spending since the
   statement and the next statement date. Each figure links to the transactions behind it.
3. The statement amount is what was owed at the end of the statement day. Payments and refunds
   after the statement reduce the amount still due; new spending does not change it.
4. The Overview "Card dues" card says when the next unpaid bill is due ("₹12,400 due on 2 Dec") or,
   when nothing is unpaid, that the latest bills are paid.
5. The forecast counts each unpaid statement as money out of cash and bank on its due date, and the
   spending since the statement on the next due date, labelled "Card bill (estimated from
   statement)" in the assumptions. A card that already has a recurring payment set up is not
   counted twice; the assumptions say which one was used.
6. Minimum amount due, interest and late fees are not modelled (they depend on the bank).

### User Story 11 - Reminders as Windows notifications (Priority: P2)
A user who keeps Fin running gets a Windows notification for a bill due tomorrow, an overdue
payment, a card bill due soon, or cash about to fall below their buffer.

**Acceptance**:
1. Settings › Notifications has a main switch (off by default) and one switch per reminder:
   recurring payments due tomorrow or overdue; card bills due within N days (N = 1–10, default 3);
   cash forecast to drop below the buffer within 7 days. Quiet hours (default 22:00–08:00) hold
   reminders until they end. "Include amounts" (on by default) can hide amounts and names.
2. Fin checks when it starts and every hour while it runs. Each reminder is shown once; a reminder
   for the same payment or bill never repeats.
3. Clicking a notification opens Fin on the matching screen (Recurring, Accounts or Forecast).
4. Optional, off by default: **Keep Fin running in the tray** (closing the window hides it; the tray
   icon reopens or quits it) and **Start Fin when I sign in** (starts in the tray; needs the tray
   option).
5. Notification text never goes to the log file. Nothing is sent over the network: notifications
   are shown by Windows on this computer.
6. **Show a test notification** in Settings shows one immediately.

### User Story 12 - Spending calendar (Priority: P2)
A user looks at a month as a calendar shaded by how much was spent each day.

**Acceptance**:
1. Insights has a **Calendar** tab with a month grid starting on the user's week start, weekends
   marked, each day shaded by spending (darker is more). Previous and next month buttons; the month
   is in the address so it can be returned to.
2. Spending uses the same rule as the Overview (money out, transfers excluded); the month's total
   equals the Overview figure for a full month.
3. Choosing a day opens Transactions for that day. Each day has an accessible label ("Tue 4 Nov:
   ₹1,250 spent, 3 transactions"), and a table view lists every day.
4. Below the grid: the month total, the number of no-spend days, and the highest day.

### Edge cases
- Statement day 31 in a 30-day month and in February (last day of the month); a card added after
  its last statement date (no statement yet); a statement that was overpaid (nothing due, credit
  shown); refunds after the statement.
- A view whose category was deleted opens without that filter (its transactions moved to the
  replacement); a view on an archived account still shows that account's transactions.
- Two views with the same name are allowed; the sidebar shows them in the order created.
- Fin closed (not in the tray) shows no notifications; the next start catches up with anything due
  tomorrow or overdue, but not with reminders whose moment has passed (a bill paid since).
- Demo mode shows no notifications.

## Requirements

- **FR-040** Saved views: create, rename, pin, update filters, delete; audited and undoable;
  included in backup and export (additive field `savedViews`, export format v1).
- **FR-041** Card cycle fields on credit-card accounts; cleared when the type changes away from
  credit card; included in export (additive account fields).
- **FR-042** Card cycle figures are pure functions of the cycle settings, the opening balance and
  the card's transactions, and are explained by drill-downs (FR-028).
- **FR-043** Forecast includes card bills per US10 §5 with every assumption listed (FR-027).
- **FR-044** Reminders are pure functions of the ledger, settings and the local time; the shell
  only shows them. Sent reminders are recorded so none repeats.
- **FR-045** Tray and start-at-login are opt-in and reversible from Settings.
- **FR-046** Spending calendar per US12, with a table alternative (WCAG 2.2 AA).
- **FR-047** Everything works offline; no new network access of any kind (Constitution I).

## Success criteria

- **SC-012** With 50,000 transactions: card cycles for all cards under 100 ms, calendar month under
  100 ms, reminder check under 300 ms; the Overview stays within its 300 ms budget.
- **SC-013** Every new screen and dialog passes axe (WCAG 2.2 AA) in light and dark themes and can be
  used with the keyboard alone.
- **SC-014** The calendar's month total equals the Overview "Spent" figure for that month in 100% of
  tested months.

## Assumptions

- Statement balances come from Fin's own ledger, so they match the bank's statement only when the
  card's transactions are complete; the reconcile flow (FR-005) is the way to check.
- Notifications use the Windows toast system for the installed app's identity; in development they
  appear under PowerShell's name.
