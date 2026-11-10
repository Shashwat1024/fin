
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE accounts (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  type                  TEXT NOT NULL CHECK (type IN ('cash','bank','credit_card','investment','loan','other_asset','other_liability')),
  currency              TEXT NOT NULL DEFAULT 'INR',
  opening_balance_minor INTEGER NOT NULL DEFAULT 0,
  opening_date          TEXT NOT NULL,
  notes                 TEXT,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  archived_at           TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE UNIQUE INDEX accounts_active_name ON accounts (name COLLATE NOCASE) WHERE archived_at IS NULL;

CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  parent_id   TEXT REFERENCES categories (id),
  grp         TEXT NOT NULL CHECK (grp IN ('needs','wants','goals','buffer','income','transfer')),
  is_system   INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX categories_active_name ON categories (COALESCE(parent_id, ''), name COLLATE NOCASE) WHERE archived_at IS NULL;

CREATE TABLE merchants (
  id                  TEXT PRIMARY KEY,
  display_name        TEXT NOT NULL,
  normalized_key      TEXT NOT NULL UNIQUE,
  default_category_id TEXT REFERENCES categories (id),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX tags_name ON tags (name COLLATE NOCASE);

CREATE TABLE transfers (
  id          TEXT PRIMARY KEY,
  from_txn_id TEXT NOT NULL,
  to_txn_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE transactions (
  id                      TEXT PRIMARY KEY,
  account_id              TEXT NOT NULL REFERENCES accounts (id),
  posted_date             TEXT NOT NULL,
  amount_minor            INTEGER NOT NULL CHECK (amount_minor <> 0),
  payee                   TEXT NOT NULL DEFAULT '',
  merchant_id             TEXT REFERENCES merchants (id),
  category_id             TEXT REFERENCES categories (id),
  notes                   TEXT,
  kind                    TEXT NOT NULL DEFAULT 'standard' CHECK (kind IN ('standard','transfer')),
  transfer_id             TEXT REFERENCES transfers (id) DEFERRABLE INITIALLY DEFERRED,
  status                  TEXT NOT NULL DEFAULT 'cleared' CHECK (status IN ('cleared','pending')),
  import_batch_id         TEXT,
  import_row_id           TEXT,
  fingerprint             TEXT,
  occurrence_index        INTEGER NOT NULL DEFAULT 0,
  recurring_occurrence_id TEXT,
  deleted_at              TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  CHECK ((kind = 'transfer') = (transfer_id IS NOT NULL))
);
CREATE INDEX txn_account_date  ON transactions (account_id, posted_date) WHERE deleted_at IS NULL;
CREATE INDEX txn_date          ON transactions (posted_date, id) WHERE deleted_at IS NULL;
CREATE INDEX txn_category_date ON transactions (category_id, posted_date) WHERE deleted_at IS NULL;
CREATE INDEX txn_transfer      ON transactions (transfer_id);
CREATE UNIQUE INDEX txn_fingerprint ON transactions (account_id, fingerprint, occurrence_index)
  WHERE fingerprint IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE splits (
  id             TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
  category_id    TEXT NOT NULL REFERENCES categories (id),
  amount_minor   INTEGER NOT NULL CHECK (amount_minor <> 0),
  memo           TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX splits_txn ON splits (transaction_id);
CREATE INDEX splits_category ON splits (category_id);

CREATE TABLE transaction_tags (
  id             TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
  tag_id         TEXT NOT NULL REFERENCES tags (id),
  UNIQUE (transaction_id, tag_id)
);
CREATE INDEX transaction_tags_tag ON transaction_tags (tag_id);

-- Full-text search over payee and notes (external content, kept in sync by triggers).
CREATE VIRTUAL TABLE txn_fts USING fts5 (
  payee, notes,
  content = 'transactions', content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER txn_fts_ai AFTER INSERT ON transactions BEGIN
  INSERT INTO txn_fts (rowid, payee, notes) VALUES (new.rowid, new.payee, COALESCE(new.notes, ''));
END;
CREATE TRIGGER txn_fts_ad AFTER DELETE ON transactions BEGIN
  INSERT INTO txn_fts (txn_fts, rowid, payee, notes) VALUES ('delete', old.rowid, old.payee, COALESCE(old.notes, ''));
END;
CREATE TRIGGER txn_fts_au AFTER UPDATE OF payee, notes ON transactions BEGIN
  INSERT INTO txn_fts (txn_fts, rowid, payee, notes) VALUES ('delete', old.rowid, old.payee, COALESCE(old.notes, ''));
  INSERT INTO txn_fts (rowid, payee, notes) VALUES (new.rowid, new.payee, COALESCE(new.notes, ''));
END;

-- Audit trail: every user-visible change, grouped so a group can be undone as one action.
CREATE TABLE audit_groups (
  id        TEXT PRIMARY KEY,
  at        TEXT NOT NULL,
  label     TEXT NOT NULL,
  undo_of   TEXT REFERENCES audit_groups (id),
  undone_at TEXT,
  undone_by TEXT
);
CREATE TABLE audit_log (
  id        TEXT PRIMARY KEY,
  group_id  TEXT NOT NULL REFERENCES audit_groups (id),
  seq       INTEGER NOT NULL,
  action    TEXT NOT NULL CHECK (action IN ('insert','update','delete')),
  entity    TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before    TEXT,
  after     TEXT,
  UNIQUE (group_id, seq)
);
CREATE INDEX audit_log_entity ON audit_log (entity, entity_id);
