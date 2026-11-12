# Tasks: PDF statements

## P0: Groundwork
- [x] P001 `pdf-layout.ts` with unit tests first (HDFC two pages, ICICI serial column, card Cr, scanned)
- [x] P002 `unmarkedDebit` mapping option (TS mapping, TS and Rust schemas); vectors regenerated
- [x] P003 HDFC and ICICI card presets (TS and Rust)

## P1: Import a PDF (US23)
- [x] P101 `pdfItems()`; shared `PdfPasswordForm`; wizard reads `.pdf`; scanned and no-table messages
- [x] P102 File step accepts PDF; privacy line
- [x] P103 `us23-pdf-import.spec.ts` (HDFC two pages, protected ICICI, duplicates, scanned, undo)

## P2: Release 2.6.0
- [x] P201 Perf; full e2e on the release build
- [x] P202 Docs, version 2.6.0, installer, PR
