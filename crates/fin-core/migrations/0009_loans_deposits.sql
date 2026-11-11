
-- Loan terms (US16), deposit terms (US17; deposits are investment accounts) and annual bills set
-- aside monthly (US18). All optional.
ALTER TABLE accounts ADD COLUMN rate_bp INTEGER CHECK (rate_bp BETWEEN 0 AND 10000);
ALTER TABLE accounts ADD COLUMN loan_principal_minor INTEGER CHECK (loan_principal_minor > 0);
ALTER TABLE accounts ADD COLUMN tenure_months INTEGER CHECK (tenure_months BETWEEN 1 AND 600);
ALTER TABLE accounts ADD COLUMN first_emi_date TEXT;
ALTER TABLE accounts ADD COLUMN deposit_kind TEXT CHECK (deposit_kind IN ('fd', 'rd'));
ALTER TABLE accounts ADD COLUMN maturity_date TEXT;
ALTER TABLE accounts ADD COLUMN installment_minor INTEGER CHECK (installment_minor > 0);
ALTER TABLE accounts ADD COLUMN payout_account_id TEXT REFERENCES accounts (id);

ALTER TABLE recurring_items ADD COLUMN set_aside INTEGER NOT NULL DEFAULT 0;
