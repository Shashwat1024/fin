export default /* sql */ `
CREATE TABLE mapping_presets (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  mapping    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX mapping_presets_name ON mapping_presets (name COLLATE NOCASE);

CREATE TABLE import_batches (
  id                      TEXT PRIMARY KEY,
  account_id              TEXT NOT NULL REFERENCES accounts (id),
  file_name               TEXT NOT NULL,
  file_sha256             TEXT,
  mapping                 TEXT NOT NULL,
  imported_at             TEXT NOT NULL,
  rows_total              INTEGER NOT NULL,
  rows_imported           INTEGER NOT NULL,
  rows_duplicate          INTEGER NOT NULL,
  rows_skipped            INTEGER NOT NULL,
  rows_failed             INTEGER NOT NULL,
  rows_ignored            INTEGER NOT NULL,
  statement_closing_minor INTEGER,
  statement_closing_date  TEXT,
  undone_at               TEXT
);
CREATE INDEX import_batches_account ON import_batches (account_id, imported_at);
CREATE INDEX import_batches_hash ON import_batches (file_sha256);

-- Every source line is kept exactly as read, with what happened to it (Constitution II).
CREATE TABLE import_rows (
  id             TEXT PRIMARY KEY,
  batch_id       TEXT NOT NULL REFERENCES import_batches (id) ON DELETE CASCADE,
  row_number     INTEGER NOT NULL,
  raw            TEXT NOT NULL,
  outcome        TEXT NOT NULL CHECK (outcome IN ('imported','duplicate','possible_duplicate_imported','possible_duplicate_skipped','failed','ignored')),
  message        TEXT,
  transaction_id TEXT
);
CREATE INDEX import_rows_batch ON import_rows (batch_id, row_number);

CREATE INDEX txn_import_batch ON transactions (import_batch_id);
`
