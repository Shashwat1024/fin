# Plan: PDF statements (Fin 2.6)

- The PDF becomes the same `Table` the CSV parser produces, so the wizard, presets, preview, commit
  and undo are reused unchanged. No new requests.
- `src/renderer/lib/pdf-text.ts`: `pdfItems()` returns every text item with page, x, y and width;
  `pdfText()` (CAS) is built on it. Password prompts through a shared `PdfPasswordForm`.
- `src/domain/import/pdf-layout.ts` (pure): items → lines (baseline) → cells (gap) → columns from the
  header line found by `detectHeaderRow`. Amounts join the column whose heading ends nearest their
  right edge; text joins the column it starts in. A dated line starts a row; a text-only line close
  below continues it. Repeated headers are skipped; summary and footer lines end the table until the
  next dated line.
- Presets: HDFC and ICICI account PDFs use the same headings as their CSV exports; new HDFC and ICICI
  card presets (single amount, `unmarkedDebit`), in TS and in Rust's built-in list.
- Tests: unit (`pdf-layout`, card presets, `unmarkedDebit`); contract vectors regenerated; e2e
  `us23-pdf-import` with PDFs generated at test time (`tests/e2e/pdf.ts`, now with positioned text
  over several pages).
