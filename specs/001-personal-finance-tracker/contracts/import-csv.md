# Contract: CSV Import Mapping & Preview

## Mapping config (also the MappingPreset `config` JSON)

```ts
type Mapping = {
  encoding: 'utf-8' | 'utf-16le' | 'windows-1252';
  delimiter: ',' | ';' | '\t' | '|';
  headerRow: number;                 // 0-based index after skipping preamble
  skipFooterRows?: number;
  dateFormat: 'DD/MM/YYYY' | 'DD-MM-YYYY' | 'DD/MM/YY' | 'DD MMM YYYY' | 'YYYY-MM-DD' | 'MM/DD/YYYY';
  columns: {
    date: string; description: string;
    amount?: string;                 // amountMode 'single'
    debit?: string; credit?: string; // amountMode 'debit_credit'
    balance?: string; reference?: string; category?: string;
  };
  amountMode: 'single' | 'debit_credit';
  signInverted?: boolean;            // e.g. credit-card exports where purchases are positive
};
```

Amount cell parsing: strip currency symbols and spaces; accept Indian or western grouping; `Dr`
suffix or parentheses → negative, `Cr` suffix → positive (then `signInverted` applies). Blank debit
and blank credit in the same row → row error `AMOUNT_MISSING`.

## Preview response

```ts
type ImportPreview = {
  rows: {
    rowNumber: number;               // 1-based line number in the source file
    raw: string[];
    parsed?: { date: string; amount: Money; description: string; reference?: string;
               counterparty?: string; channel?: 'UPI' | 'IMPS' | 'NEFT' | 'RTGS' | 'CARD' | 'OTHER' };
    status: 'new' | 'duplicate' | 'possible_duplicate' | 'error';
    duplicateOf?: string;            // txn id
    error?: { code: 'DATE_INVALID' | 'AMOUNT_INVALID' | 'AMOUNT_MISSING' | 'COLUMN_MISSING'; message: string };
    suggestion?: { categoryId: string; source: 'rule' | 'merchant' };
    transferMatch?: string;          // existing opposite leg txn id
  }[];
  counts: { total: number; new: number; duplicate: number; possibleDuplicate: number; error: number };
  statementClosing?: Money;          // last balance cell, if mapped
  projectedBalanceAfterImport: Money;
};
```

Default decisions: `new` → import, `duplicate` → skip, `possible_duplicate` → user must choose,
`error` → cannot import (reported, retained in ImportRow as `failed`).

## Built-in presets (fixtures required for each)

HDFC Bank savings, ICICI Bank savings, SBI savings, Axis Bank savings, Kotak savings,
Generic credit card (single amount, `signInverted: true`). Fixture CSVs are synthetic.
