# Contract: CSV Import Mapping & Preview

## Mapping config (also the MappingPreset `mapping` JSON, without `headerRow`)

Source of truth: `src/domain/import/mapping.ts`.

```ts
type Mapping = {
  headerRow: number                  // index of the header among non-blank rows (bank preambles skipped)
  dateOrder: 'dmy' | 'mdy' | 'ymd'   // separators, 2/4-digit years, month names and times handled automatically
  amountMode: 'single' | 'debit_credit' | 'indicator'
  columns: {                         // referenced by header text (case/punctuation-insensitive)
    date: string; description: string
    amount?: string                  // 'single' and 'indicator'
    debit?: string; credit?: string  // 'debit_credit'
    indicator?: string               // 'indicator': a column holding Dr / Cr
    balance?: string; reference?: string
  }
  signInverted?: boolean             // e.g. card exports where purchases are positive
}
```

Encoding (BOM → UTF-8/UTF-16; else strict UTF-8; else Windows-1252) and the delimiter (`,` `;` tab
`|`) are detected automatically. Amount cells accept Indian or western grouping, currency symbols,
`Dr`/`Cr` suffixes and parentheses. Lines with neither a date nor an amount (totals, footers) are
reported as "not a transaction line" and never imported.

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

Default decisions: `new` → import, `duplicate` → skip (never importable), `possible_duplicate` →
skipped unless the user ticks it, `error` → cannot import (reported, retained in ImportRow as
`failed`). As built, the renderer produces the parsed rows and the main process returns per-row
statuses (`import.preview`); `import.commit` re-classifies before writing. The `transferMatch` and
`suggestion` fields are deferred to US6.

## Built-in presets (fixtures required for each)

HDFC Bank savings, ICICI Bank savings, SBI savings, Axis Bank savings, Kotak savings,
Generic credit card (single amount, `signInverted: true`). Fixture CSVs are synthetic.
