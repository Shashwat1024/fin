import Papa from 'papaparse'

/** Non-blank rows plus each row's 1-based line number in the file (for error messages). */
export type Table = { rows: string[][]; lineNumbers: number[]; delimiter: string }

/** Parse CSV/TSV text into trimmed cells, guessing the delimiter. Blank lines are dropped. */
export function parseTable(text: string): Table {
  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: false,
    delimitersToGuess: [',', ';', '\t', '|'],
  })
  const rows: string[][] = []
  const lineNumbers: number[] = []
  result.data.forEach((row, i) => {
    const cells = row.map((cell) => (cell ?? '').replace(/\s+/g, ' ').trim())
    if (cells.some((c) => c !== '')) {
      rows.push(cells)
      lineNumbers.push(i + 1)
    }
  })
  return { rows, lineNumbers, delimiter: result.meta.delimiter || ',' }
}

/** Lower-case, alphanumeric-only words, so "Withdrawal Amt." ≈ "withdrawal amt". */
export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const HEADER_WORDS = new Set([
  'date',
  'dt',
  'narration',
  'description',
  'particulars',
  'remarks',
  'details',
  'withdrawal',
  'deposit',
  'debit',
  'credit',
  'amount',
  'amt',
  'balance',
  'bal',
  'dr',
  'cr',
  'chq',
  'cheque',
  'ref',
  'value',
  'transaction',
  'txn',
  'tran',
])

/**
 * Banks put account details above the real header. Pick the first of the first 30 rows that looks
 * like a header: at least three cells containing known header words.
 */
export function detectHeaderRow(rows: readonly string[][]): number {
  const limit = Math.min(rows.length, 30)
  for (let i = 0; i < limit; i++) {
    const hits = rows[i]!.filter((cell) =>
      normalizeHeader(cell)
        .split(' ')
        .some((w) => HEADER_WORDS.has(w)),
    ).length
    if (hits >= 3) return i
  }
  return 0
}
