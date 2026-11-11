
-- Tax-year view (US19): deduction sections of the old regime with their limits as of November 2026
-- (editable; the interface tells the user to check the current rules), and what counts under each.
CREATE TABLE tax_sections (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  limit_minor INTEGER CHECK (limit_minor IS NULL OR limit_minor >= 0),
  direction   TEXT NOT NULL DEFAULT 'out' CHECK (direction IN ('out', 'in')),
  note        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

INSERT INTO tax_sections (id, code, label, limit_minor, direction, note, sort_order, created_at, updated_at) VALUES
  ('tax_80c', '80C', 'Section 80C', 15000000, 'out', 'PPF, ELSS funds, life insurance premiums, EPF, home-loan principal, children''s tuition fees', 1, '2026-11-11T00:00:00.000Z', '2026-11-11T00:00:00.000Z'),
  ('tax_80ccd1b', '80CCD(1B)', 'Section 80CCD(1B)', 5000000, 'out', 'Your own NPS contributions, over and above 80C', 2, '2026-11-11T00:00:00.000Z', '2026-11-11T00:00:00.000Z'),
  ('tax_80d', '80D', 'Section 80D', 2500000, 'out', 'Health insurance premiums and preventive check-ups (higher for senior citizens)', 3, '2026-11-11T00:00:00.000Z', '2026-11-11T00:00:00.000Z'),
  ('tax_24b', '24(b)', 'Section 24(b)', 20000000, 'out', 'Interest on a loan for a home you live in', 4, '2026-11-11T00:00:00.000Z', '2026-11-11T00:00:00.000Z'),
  ('tax_80e', '80E', 'Section 80E', NULL, 'out', 'Interest on an education loan', 5, '2026-11-11T00:00:00.000Z', '2026-11-11T00:00:00.000Z'),
  ('tax_80g', '80G', 'Section 80G', NULL, 'out', 'Donations to eligible funds and charities (how much counts depends on the receiver)', 6, '2026-11-11T00:00:00.000Z', '2026-11-11T00:00:00.000Z'),
  ('tax_80tta', '80TTA', 'Section 80TTA', 1000000, 'in', 'Interest earned on savings accounts', 7, '2026-11-11T00:00:00.000Z', '2026-11-11T00:00:00.000Z');

CREATE TABLE tax_mappings (
  id              TEXT PRIMARY KEY,
  section_id      TEXT NOT NULL REFERENCES tax_sections (id),
  category_id     TEXT REFERENCES categories (id),
  loan_account_id TEXT REFERENCES accounts (id),
  loan_part       TEXT CHECK (loan_part IN ('interest', 'principal')),
  created_at      TEXT NOT NULL,
  CHECK ((category_id IS NULL) <> (loan_account_id IS NULL)),
  CHECK ((loan_account_id IS NULL) = (loan_part IS NULL))
);
CREATE UNIQUE INDEX tax_mappings_unique ON tax_mappings (section_id, COALESCE(category_id, ''), COALESCE(loan_account_id, ''), COALESCE(loan_part, ''));
