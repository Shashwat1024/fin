
-- Categorisation rules (FR-019): AND-ed conditions as JSON, one category as the action.
CREATE TABLE rules (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  priority    INTEGER NOT NULL DEFAULT 100,
  enabled     INTEGER NOT NULL DEFAULT 1,
  conditions  TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories (id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Merchants are learned from narrations/payees; suggestions use each merchant's past categories.
CREATE INDEX txn_merchant ON transactions (merchant_id) WHERE deleted_at IS NULL;
