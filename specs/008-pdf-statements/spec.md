# Feature Specification: PDF statements (Fin 2.6)

**Feature Branch**: `008-pdf-statements` · **Created**: 2026-11-12 · **Status**: In progress
**Input**: "What else can we add" review: many banks (HDFC and ICICI among them) give statements as
PDF, and Fin imports CSV only. Ships as Fin 2.6.0.

## Why

Downloading a CSV is often hidden or missing in net banking, and card statements arrive as emailed
PDFs only, frequently password protected. Typing them in is the reason imports get skipped.

## User scenarios

### User Story 23 - Import a PDF statement (Priority: P1)
**Acceptance**:
1. Import accepts a `.pdf` statement alongside CSV. Fin reads it on this computer and rebuilds the
   statement's table; from there the same steps as CSV apply: layout detection, column mapping and
   saved layouts, duplicate check, balance check, history and undo.
2. HDFC Bank and ICICI Bank savings/current statements and HDFC and ICICI credit-card statements are
   recognised by their column headings. Other banks' table-shaped PDFs go through column mapping.
3. Narrations that wrap onto a second line are joined; repeated headings, page numbers and the
   statement summary are left out.
4. A password-protected PDF asks for its password, again when wrong; the password is never kept.
5. A scanned (image-only) PDF is explained: Fin can't read it; download the statement from net banking
   or as CSV.

### Edge cases
- Card statements that mark only credits ("Cr"): an unmarked amount is money spent.
- Amounts with "Dr"/"Cr" suffixes; a "0.00" in the unused withdrawal or deposit column.
- A PDF with text but no recognisable table: "Fin couldn't find a table of transactions".
- Re-importing the same PDF: every line is a duplicate, as for CSV.

## Requirements
- **FR-090** The table is rebuilt by a pure function from positioned text (`pdf-layout.ts`), tested
  without pdf.js; pdf.js loads only when a PDF is opened, with eval disabled and its worker bundled.
- **FR-091** A mapping can mark unmarked single amounts as money out (`unmarkedDebit`), in both the
  TypeScript and Rust contracts; saved layouts keep it.
- **FR-092** No network requests; tests use synthetic statements only.

## Success criteria
- **SC-024** The synthetic HDFC (two pages, wrapped narration) and protected ICICI statements import
  with balance checks of ₹0.00 difference.
