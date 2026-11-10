export default /* sql */ `
-- Insights and "looks recurring" suggestions the user has dismissed (FR-029, FR-022 P1). Only the
-- stable key is stored; the insight itself is recomputed from the ledger each time.
CREATE TABLE dismissed_insights (
  id           TEXT PRIMARY KEY,
  key          TEXT NOT NULL UNIQUE,
  dismissed_at TEXT NOT NULL
);
`
