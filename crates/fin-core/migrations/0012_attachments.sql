
-- Receipts and warranties (US22). A file's details are audited (undoable); its contents live apart,
-- outside the audit log, so undo never copies megabytes. Contents whose details were removed are
-- cleared when Fin next starts.
CREATE TABLE attachments (
  id             TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions (id),
  file_name      TEXT NOT NULL,
  mime           TEXT NOT NULL,
  size           INTEGER NOT NULL CHECK (size > 0),
  sha256         TEXT NOT NULL,
  warranty_until TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX attachments_transaction ON attachments (transaction_id);
CREATE INDEX attachments_warranty ON attachments (warranty_until) WHERE warranty_until IS NOT NULL;

CREATE TABLE attachment_data (
  id   TEXT PRIMARY KEY,
  data BLOB NOT NULL
);
