
-- Who owes whom (US21). An entry's amount is positive when the person owes the user more (their share
-- of an expense, money lent) and negative when less (their repayment, or the user's share they paid).
CREATE TABLE people (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  archived_at TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX people_active_name ON people (name COLLATE NOCASE) WHERE archived_at IS NULL;

CREATE TABLE shares (
  id             TEXT PRIMARY KEY,
  person_id      TEXT NOT NULL REFERENCES people (id),
  date           TEXT NOT NULL,
  amount_minor   INTEGER NOT NULL CHECK (amount_minor <> 0),
  kind           TEXT NOT NULL CHECK (kind IN ('share', 'repayment', 'manual')),
  note           TEXT,
  transaction_id TEXT REFERENCES transactions (id),
  created_at     TEXT NOT NULL
);
CREATE INDEX shares_person ON shares (person_id, date);
CREATE INDEX shares_transaction ON shares (transaction_id);
