# Implementation Plan: Tax and investments

**Spec**: [spec.md](./spec.md) · **Branch**: `006-tax-investments` (on top of `005-loans-deposits`) ·
**Release**: Fin 2.4.0

## Data (migration 0010_tax.sql, schema v10)

```sql
tax_sections(id, code UNIQUE, label, limit_minor NULL, direction 'out'|'in', note, sort_order, ...)
tax_mappings(id, section_id, category_id NULL, loan_account_id NULL, loan_part 'interest'|'principal' NULL, created_at)
```
Sections are seeded by the migration with fixed ids (`tax_80c`, …). Both tables are audited and
exported (`taxSections`, `taxMappings`, additive).

## Requests

| Channel | Input | Output |
|---|---|---|
| `tax.year` | `{ year? }` (FY start year) | `TaxYearDto` |
| `tax.updateSection` | `{ id, label?, limitMinor? }` | `Mutation<{}>` |
| `tax.map` | `{ sectionId, categoryId? , loanAccountId?, loanPart? }` | `Mutation<{}>` |
| `tax.unmap` | `{ id }` | `Mutation<{}>` |
| `tax.exportCsv` | `{ year }` | `{ path } \| null` (save dialog) |
| `cas.preview` | `{ text }` | `CasPreviewDto` |
| `cas.commit` | `{ statementDate, folios: [{ key, accountId?, newName?, valueMinor }] }` | `Mutation<{ created, valued }>` |

## Domain
- `domain/tax.rs`: Indian FY for a date and its label ("FY 2026-27 · AY 2027-28"); counted amount
  within a limit; loan interest and principal paid in a year from a schedule.
- `domain/cas.rs`: parse CAS text into folios → schemes (units, NAV, NAV date, cost, value) and the
  statement date. Tolerant of both CAMS and KFintech wording; Indian number formats.

## Interface
- `features/tax/TaxPage.tsx` (route `/tax`, sidebar and palette): year picker, regime note, sections
  with progress against limits, categories and loans counted with remove, add category, loan
  suggestions, edit limit dialog, Export for my CA, Print.
- `features/import/CasImport.tsx` (Import page tab): PDF picker → pdf.js (`pdfjs-dist`, bundled,
  worker from the app, `isEvalSupported: false`) with a password prompt → text → `cas.preview` →
  mapping table → `cas.commit`.

## Tests
Unit: FY labels, limits, loan amounts in a year; CAS parser on synthetic CAMS and KFintech text
(folios with several schemes, Indian numbers, missing fields → error). DB: section totals equal the
transaction query; mapping undo; CAS commit creates accounts and valuations, undoable. e2e
`us19-tax` and `us20-cas` (the CAS spec generates a small password-protected PDF at test time from
synthetic text, so no statement is committed). a11y; perf.
