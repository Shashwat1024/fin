
-- Credit-card billing cycle (US10): the statement day of the month (a day past the month's end
-- means its last day) and the days from the statement to the payment due date. Credit cards only.
ALTER TABLE accounts ADD COLUMN statement_day INTEGER CHECK (statement_day BETWEEN 1 AND 31);
ALTER TABLE accounts ADD COLUMN due_days_after INTEGER CHECK (due_days_after BETWEEN 1 AND 60);

-- Saved Transactions filters (US9). `query` holds the filters as URL search parameters.
CREATE TABLE saved_views (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  query      TEXT NOT NULL,
  pinned     INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Reminders already shown as notifications (US11), so none repeats. Bookkeeping only: not audited
-- or exported.
CREATE TABLE notification_log (
  key     TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL
);
