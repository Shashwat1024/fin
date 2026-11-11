# Tasks: Tax and investments

## G0: Groundwork
- [x] G001 Migration 0010 (tax sections seeded, mappings); audited and exported; schemas (TS + Rust)
  and vectors

## G1: Tax-year view (US19)
- [x] G101 `domain/tax.rs` with tests first
- [x] G102 `tax.year`, `tax.updateSection`, `tax.map`, `tax.unmap`, `tax.exportCsv`; tests
- [x] G103 `TaxPage` (sections, categories, loan suggestions, limits, export, print); navigation
- [x] G104 `us19-tax.spec.ts`; a11y

## G2: CAS import (US20)
- [x] G201 `domain/cas.rs` parser with synthetic-text tests first
- [x] G202 `cas.preview`, `cas.commit`; tests
- [ ] G203 pdf.js text extraction with password; `CasImport` mapping UI
- [ ] G204 `us20-cas.spec.ts` (PDF generated at test time); a11y

## G3: Release 2.4.0
- [ ] G301 Demo data (tax mappings); perf; full e2e on the release build
- [ ] G302 Docs, version 2.4.0, installer, PR
