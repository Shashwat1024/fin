import { detectHeaderRow, normalizeHeader, type Table } from './csv'

/**
 * Rebuilding a statement table from a PDF's positioned text (Fin 2.6). Pure: the interface reads the
 * PDF with pdf.js and passes its text items here, so this runs and is tested without it.
 *
 * A bank statement PDF is a table drawn as loose words. The steps:
 * 1. words on one baseline make a line; words close together make one cell;
 * 2. the header line (found as for CSV files) gives the columns;
 * 3. amounts are right-aligned, so they join the column whose header ends nearest their right edge;
 *    other text joins the column it starts in;
 * 4. a line with a date starts a row; a line without one continues the row above (narrations wrap);
 * 5. repeated headers, page footers and summaries are left out.
 */

/** One piece of text on a page. `y` grows upwards, as in PDF coordinates. */
export type PdfItem = { page: number; x: number; y: number; width: number; text: string }

type Cell = { x0: number; x1: number; text: string }
type Line = { page: number; y: number; cells: Cell[] }

/** Baselines within this many points are one line. */
const SAME_LINE = 2
/** Words closer than this (points) belong to one cell. */
const SAME_CELL = 3.5

const DATE =
  /^(\d{1,2}[/\-. ](\d{1,2}|[A-Za-z]{3,9})[/\-. ]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2} [A-Za-z]{3,9},? \d{4})$/
const AMOUNT = /^[-+(]?(₹|Rs\.?|INR)?\s*[\d,]+(\.\d{1,2})?\)?(\s*(Cr|Dr|CR|DR|cr|dr)\.?)?$/
/** Lines that end the table on a page: summaries, totals, footers. */
const END =
  /^(statement summary|opening balance|closing balance|total|page \d+( of \d+)?|generated on|this is a (computer|system) generated|\*{3}|end of statement)/i

export const looksLikeDate = (s: string) => DATE.test(s.trim())
const looksLikeAmount = (s: string) => AMOUNT.test(s.trim()) && /\d/.test(s)

function lines(items: readonly PdfItem[]): Line[] {
  const sorted = items
    .filter((i) => i.text.trim() !== '')
    .slice()
    .sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)
  const out: { page: number; y: number; items: PdfItem[] }[] = []
  for (const it of sorted) {
    const last = out.at(-1)
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= SAME_LINE) last.items.push(it)
    else out.push({ page: it.page, y: it.y, items: [it] })
  }
  return out.map((l) => {
    const cells: Cell[] = []
    for (const it of l.items.sort((a, b) => a.x - b.x)) {
      const prev = cells.at(-1)
      const x1 = it.x + Math.max(0, it.width)
      if (prev && it.x - prev.x1 <= SAME_CELL) {
        prev.text = `${prev.text} ${it.text.trim()}`.trim()
        prev.x1 = Math.max(prev.x1, x1)
      } else cells.push({ x0: it.x, x1, text: it.text.trim() })
    }
    return { page: l.page, y: l.y, cells }
  })
}

const lineText = (l: Line) => normalizeHeader(l.cells.map((c) => c.text).join(' '))

export type PdfTableResult = Table & {
  /** No text at all: a scanned image. */
  scanned: boolean
}

export function pdfTable(items: readonly PdfItem[]): PdfTableResult {
  const all = lines(items)
  const empty = { rows: [], lineNumbers: [], delimiter: '', scanned: items.every((i) => !i.text.trim()) }
  if (all.length === 0) return empty
  const headerIndex = detectHeaderRow(all.map((l) => l.cells.map((c) => c.text)))
  const header = all[headerIndex]
  if (!header || header.cells.length < 3) return empty
  const columns = header.cells
  const headerKey = lineText(header)
  // Columns holding the date that starts a row: a header naming a date, or else the first column.
  const dateColumns = columns
    .map((c, i) => (/\b(date|dt)\b/.test(normalizeHeader(c.text)) ? i : -1))
    .filter((i) => i >= 0)
  const startColumns = dateColumns.length ? dateColumns : [0]

  const column = (c: Cell) => {
    if (looksLikeAmount(c.text) && !looksLikeDate(c.text)) {
      // Right-aligned: the header whose right edge is nearest.
      let best = 0
      for (let i = 1; i < columns.length; i++)
        if (Math.abs(columns[i]!.x1 - c.x1) < Math.abs(columns[best]!.x1 - c.x1)) best = i
      return best
    }
    // Left-aligned: the last column starting at or before it (with a little slack).
    let at = 0
    for (let i = 0; i < columns.length; i++) if (columns[i]!.x0 - 2 <= c.x0) at = i
    return at
  }

  const rows: string[][] = [columns.map((c) => c.text)]
  const lineNumbers: number[] = [headerIndex + 1]
  let inTable = true
  let last: { cells: string[]; page: number; y: number } | null = null
  let lineHeight = 12
  for (let n = headerIndex + 1; n < all.length; n++) {
    const l = all[n]!
    const text = lineText(l)
    if (text === headerKey) {
      // The header repeated on a new page: the table goes on.
      inTable = true
      last = null
      continue
    }
    const raw = l.cells.map((c) => c.text).join(' ')
    if (END.test(raw.trim())) {
      inTable = false
      continue
    }
    if (!inTable) {
      // After a summary or footer, a dated line on a later page means the table continues.
      if (!l.cells.some((c) => looksLikeDate(c.text))) continue
      inTable = true
    }
    const cells: string[] = columns.map(() => '')
    for (const c of l.cells) {
      const i = column(c)
      cells[i] = cells[i] ? `${cells[i]} ${c.text}` : c.text
    }
    const starts = startColumns.some((i) => looksLikeDate(cells[i] ?? ''))
    if (starts) {
      if (last)
        lineHeight = Math.max(6, Math.min(lineHeight, last.page === l.page ? last.y - l.y : lineHeight))
      rows.push(cells)
      lineNumbers.push(n + 1)
      last = { cells, page: l.page, y: l.y }
      continue
    }
    // A continuation: on the same page, close below the row, and only text (a wrapped narration).
    const close = last && last.page === l.page && last.y - l.y <= lineHeight * 2.2
    const textOnly = cells.every((v) => !v || !looksLikeAmount(v))
    if (last && close && textOnly) {
      cells.forEach((v, i) => {
        if (v) last!.cells[i] = last!.cells[i] ? `${last!.cells[i]} ${v}` : v
      })
      last.y = l.y
    }
  }
  return { rows, lineNumbers, delimiter: '', scanned: false }
}
