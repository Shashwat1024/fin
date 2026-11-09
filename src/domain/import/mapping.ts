import type { CalendarDate } from '../dates'
import { parseAmount } from '../money'
import { normalizeHeader } from './csv'
import { detectDateOrder, parseDateText, type DateOrder } from './dates'

export type AmountMode = 'single' | 'debit_credit' | 'indicator'

/** How to read a statement. Columns are referenced by header text so mappings can be saved as presets. */
export type Mapping = {
  headerRow: number
  dateOrder: DateOrder
  amountMode: AmountMode
  columns: {
    date: string
    description: string
    amount?: string | undefined
    debit?: string | undefined
    credit?: string | undefined
    /** For amountMode 'indicator': a column holding "Dr"/"Cr". */
    indicator?: string | undefined
    balance?: string | undefined
    reference?: string | undefined
  }
  /** Flip signs, e.g. card exports where purchases are positive. */
  signInverted?: boolean | undefined
}

export type ParsedValues = {
  date: CalendarDate
  amountMinor: number
  description: string
  reference: string | null
  balanceMinor: number | null
}

export type RowErrorCode = 'DATE_INVALID' | 'AMOUNT_INVALID' | 'AMOUNT_MISSING' | 'INDICATOR_INVALID'

export type ParsedRow =
  | { rowNumber: number; raw: string[]; status: 'ok'; values: ParsedValues }
  | { rowNumber: number; raw: string[]; status: 'error'; code: RowErrorCode; message: string }
  /** Lines that carry no transaction (totals, notes, blank amounts). Reported, never imported. */
  | { rowNumber: number; raw: string[]; status: 'ignored'; message: string }

export type MappingResult = { headers: string[]; rows: ParsedRow[]; missingColumns: (keyof Mapping['columns'])[] }

export function requiredColumns(m: Mapping): (keyof Mapping['columns'])[] {
  const amount: (keyof Mapping['columns'])[] =
    m.amountMode === 'single' ? ['amount'] : m.amountMode === 'debit_credit' ? ['debit', 'credit'] : ['amount', 'indicator']
  return ['date', 'description', ...amount]
}

function findColumn(headers: readonly string[], name: string | undefined): number {
  if (!name) return -1
  const target = normalizeHeader(name)
  return headers.findIndex((h) => normalizeHeader(h) === target)
}

function cellAmount(cell: string): number | null | 'invalid' {
  if (!cell.trim() || /^[-–—]$/.test(cell.trim())) return null
  const r = parseAmount(cell)
  return r.ok ? r.minor : 'invalid'
}

/** Apply a mapping to a parsed table. Pure and fast enough to run on every keystroke of the mapper. */
export function applyMapping(table: readonly string[][], m: Mapping, lineNumbers?: readonly number[]): MappingResult {
  const headers = table[m.headerRow] ?? []
  const idx = {
    date: findColumn(headers, m.columns.date),
    description: findColumn(headers, m.columns.description),
    amount: findColumn(headers, m.columns.amount),
    debit: findColumn(headers, m.columns.debit),
    credit: findColumn(headers, m.columns.credit),
    indicator: findColumn(headers, m.columns.indicator),
    balance: findColumn(headers, m.columns.balance),
    reference: findColumn(headers, m.columns.reference),
  }
  const missingColumns = requiredColumns(m).filter((k) => idx[k] < 0)
  if (missingColumns.length) return { headers, rows: [], missingColumns }

  const cell = (raw: string[], i: number) => (i >= 0 ? (raw[i] ?? '') : '')
  const rows: ParsedRow[] = []
  for (let r = m.headerRow + 1; r < table.length; r++) {
    const raw = table[r]!
    const rowNumber = lineNumbers?.[r] ?? r + 1
    const dateCell = cell(raw, idx.date)

    let amount: number | null | 'invalid'
    let error: { code: RowErrorCode; message: string } | null = null
    if (m.amountMode === 'single') {
      amount = cellAmount(cell(raw, idx.amount))
    } else if (m.amountMode === 'debit_credit') {
      const debit = cellAmount(cell(raw, idx.debit))
      const credit = cellAmount(cell(raw, idx.credit))
      if (debit === 'invalid' || credit === 'invalid') amount = 'invalid'
      else if (debit === null && credit === null) amount = null
      else amount = Math.abs(credit ?? 0) - Math.abs(debit ?? 0)
    } else {
      const base = cellAmount(cell(raw, idx.amount))
      const ind = cell(raw, idx.indicator).trim().toLowerCase()
      if (base === null || base === 'invalid') amount = base
      else if (/^(dr|d|debit|withdrawal)\.?$/.test(ind)) amount = -Math.abs(base)
      else if (/^(cr|c|credit|deposit)\.?$/.test(ind)) amount = Math.abs(base)
      else {
        amount = 'invalid'
        error = { code: 'INDICATOR_INVALID', message: `Expected Dr or Cr in "${m.columns.indicator}"` }
      }
    }

    const date = parseDateText(dateCell, m.dateOrder)
    // Totals, notes and trailers have neither a date nor an amount.
    if (date === null && (amount === null || amount === 0)) {
      rows.push({ rowNumber, raw, status: 'ignored', message: 'Not a transaction line' })
      continue
    }
    if (date === null) {
      rows.push({ rowNumber, raw, status: 'error', code: 'DATE_INVALID', message: dateCell ? `"${dateCell}" is not a valid date` : 'Date is missing' })
      continue
    }
    if (error) {
      rows.push({ rowNumber, raw, status: 'error', ...error })
      continue
    }
    if (amount === 'invalid') {
      rows.push({ rowNumber, raw, status: 'error', code: 'AMOUNT_INVALID', message: 'Amount is not a valid number' })
      continue
    }
    if (amount === null) {
      rows.push({ rowNumber, raw, status: 'error', code: 'AMOUNT_MISSING', message: 'No amount in this row' })
      continue
    }
    if (amount === 0) {
      rows.push({ rowNumber, raw, status: 'ignored', message: 'Zero amount' })
      continue
    }
    const balance = cellAmount(cell(raw, idx.balance))
    rows.push({
      rowNumber,
      raw,
      status: 'ok',
      values: {
        date,
        amountMinor: m.signInverted ? -amount : amount,
        description: cell(raw, idx.description).replace(/\s+/g, ' ').trim(),
        reference: cell(raw, idx.reference).trim() || null,
        balanceMinor: typeof balance === 'number' ? balance : null,
      },
    })
  }
  return { headers, rows, missingColumns }
}

const has = (h: string, ...words: string[]) => {
  const w = normalizeHeader(h).split(' ')
  return words.some((x) => (x.includes(' ') ? normalizeHeader(h).includes(x) : w.includes(x)))
}

/** Best-effort mapping from header names when no preset matches. */
export function suggestMapping(table: readonly string[][], headerRow: number): Mapping {
  const headers = table[headerRow] ?? []
  const pick = (pred: (h: string) => boolean) => headers.find(pred)
  const date =
    pick((h) => has(h, 'txn date', 'transaction date', 'tran date', 'posting date')) ??
    pick((h) => normalizeHeader(h) === 'date') ??
    pick((h) => has(h, 'date', 'dt') && !has(h, 'value'))
  const description = pick((h) => has(h, 'narration', 'description', 'particulars', 'remarks', 'details', 'merchant'))
  const debit = pick((h) => has(h, 'withdrawal', 'debit', 'dr') && !has(h, 'cr'))
  const credit = pick((h) => has(h, 'deposit', 'credit', 'cr') && !has(h, 'dr'))
  const indicator = pick((h) => (has(h, 'dr') && has(h, 'cr')) || normalizeHeader(h) === 'type')
  const amount = pick((h) => has(h, 'amount', 'amt') && !has(h, 'withdrawal', 'deposit', 'debit', 'credit'))
  const balance = pick((h) => has(h, 'balance', 'bal'))
  const reference = pick((h) => has(h, 'ref', 'chq', 'cheque', 'chqno', 'utr'))
  const amountMode: AmountMode = debit && credit ? 'debit_credit' : amount && indicator ? 'indicator' : 'single'
  const dateSamples = table.slice(headerRow + 1, headerRow + 40).map((r) => r[headers.indexOf(date ?? '')] ?? '')
  return {
    headerRow,
    dateOrder: detectDateOrder(dateSamples),
    amountMode,
    columns: {
      date: date ?? '',
      description: description ?? '',
      amount: amountMode === 'debit_credit' ? undefined : amount,
      debit: amountMode === 'debit_credit' ? debit : undefined,
      credit: amountMode === 'debit_credit' ? credit : undefined,
      indicator: amountMode === 'indicator' ? indicator : undefined,
      balance,
      reference,
    },
  }
}

/**
 * Statement closing balance: the balance on the latest-dated row — the last such row for
 * oldest-first statements, the first for newest-first ones.
 */
export function closingBalance(rows: readonly ParsedRow[]): { date: CalendarDate; balanceMinor: number } | null {
  const ok = rows.filter((r): r is Extract<ParsedRow, { status: 'ok' }> => r.status === 'ok')
  const withBalance = ok.filter((r) => r.values.balanceMinor !== null)
  if (withBalance.length === 0) return null
  const latest = withBalance.reduce((d, r) => (r.values.date > d ? r.values.date : d), withBalance[0]!.values.date)
  const onLatest = withBalance.filter((r) => r.values.date === latest)
  const oldestFirst = ok[0]!.values.date <= ok[ok.length - 1]!.values.date
  const chosen = oldestFirst ? onLatest[onLatest.length - 1]! : onLatest[0]!
  return { date: latest, balanceMinor: chosen.values.balanceMinor! }
}
