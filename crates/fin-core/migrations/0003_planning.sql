
-- Recurring income and commitments (FR-021). amount_minor is signed from account_id's side:
-- income positive, everything else negative. With to_account_id it is a transfer between accounts.
CREATE TABLE recurring_items (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('income','bill','subscription','emi','transfer','savings')),
  account_id     TEXT NOT NULL REFERENCES accounts (id),
  to_account_id  TEXT REFERENCES accounts (id),
  category_id    TEXT REFERENCES categories (id),
  amount_minor   INTEGER NOT NULL CHECK (amount_minor <> 0),
  tolerance_bp   INTEGER NOT NULL DEFAULT 1000 CHECK (tolerance_bp BETWEEN 0 AND 10000),
  frequency      TEXT NOT NULL CHECK (frequency IN ('weekly','monthly','yearly')),
  interval_count INTEGER NOT NULL DEFAULT 1 CHECK (interval_count >= 1),
  anchor_date    TEXT NOT NULL,
  end_date       TEXT,
  occurrences    INTEGER CHECK (occurrences IS NULL OR occurrences >= 1),
  notes          TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- Only user decisions are stored (a skip, or a payment linked by hand). Automatic matches and the
-- expected/overdue states are derived, so editing a transaction re-evaluates them exactly.
CREATE TABLE recurring_occurrences (
  id             TEXT PRIMARY KEY,
  item_id        TEXT NOT NULL REFERENCES recurring_items (id),
  due_date       TEXT NOT NULL,
  state          TEXT NOT NULL CHECK (state IN ('paid','skipped')),
  matched_txn_id TEXT REFERENCES transactions (id),
  created_at     TEXT NOT NULL,
  UNIQUE (item_id, due_date),
  CHECK ((state = 'paid') = (matched_txn_id IS NOT NULL))
);
CREATE INDEX recurring_occurrences_txn ON recurring_occurrences (matched_txn_id);

-- Assigned amounts only; carry, spent and available are derived (research R14).
CREATE TABLE monthly_budgets (
  id             TEXT PRIMARY KEY,
  month          TEXT NOT NULL,
  category_id    TEXT NOT NULL REFERENCES categories (id),
  assigned_minor INTEGER NOT NULL CHECK (assigned_minor >= 0),
  updated_at     TEXT NOT NULL,
  UNIQUE (month, category_id)
);

CREATE TABLE goals (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  target_minor      INTEGER NOT NULL CHECK (target_minor > 0),
  target_date       TEXT,
  linked_account_id TEXT REFERENCES accounts (id),
  notes             TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  archived_at       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE goal_contributions (
  id           TEXT PRIMARY KEY,
  goal_id      TEXT NOT NULL REFERENCES goals (id),
  date         TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor <> 0),
  note         TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX goal_contributions_goal ON goal_contributions (goal_id, date);
