export default /* sql */ `
-- Hand-entered values for investments, loans and other assets or liabilities (FR-028). value_minor
-- is what the user sees: the worth of an asset, or the amount owed on a liability. The latest
-- valuation on or before a date replaces the ledger balance for that date.
CREATE TABLE valuations (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts (id),
  date        TEXT NOT NULL,
  value_minor INTEGER NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (account_id, date)
);
`
