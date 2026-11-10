import { normalizeHeader } from './csv'
import { requiredColumns, type Mapping } from './mapping'

export type Preset = { id: string; name: string; builtin: boolean; mapping: Omit<Mapping, 'headerRow'> }

/**
 * Built-in layouts for common Indian bank CSV exports. Matched by header names, so the header row
 * position (bank preamble length) does not matter. Users can save their own presets too.
 */
export const BUILTIN_PRESETS: readonly Preset[] = [
  {
    id: 'builtin:hdfc',
    name: 'HDFC Bank — savings/current',
    builtin: true,
    mapping: {
      dateOrder: 'dmy',
      amountMode: 'debit_credit',
      columns: {
        date: 'Date',
        description: 'Narration',
        debit: 'Withdrawal Amt.',
        credit: 'Deposit Amt.',
        balance: 'Closing Balance',
        reference: 'Chq./Ref.No.',
      },
    },
  },
  {
    id: 'builtin:icici',
    name: 'ICICI Bank — savings/current',
    builtin: true,
    mapping: {
      dateOrder: 'dmy',
      amountMode: 'debit_credit',
      columns: {
        date: 'Transaction Date',
        description: 'Transaction Remarks',
        debit: 'Withdrawal Amount (INR )',
        credit: 'Deposit Amount (INR )',
        balance: 'Balance (INR )',
        reference: 'Cheque Number',
      },
    },
  },
  {
    id: 'builtin:sbi',
    name: 'State Bank of India — savings',
    builtin: true,
    mapping: {
      dateOrder: 'dmy',
      amountMode: 'debit_credit',
      columns: {
        date: 'Txn Date',
        description: 'Description',
        debit: 'Debit',
        credit: 'Credit',
        balance: 'Balance',
        reference: 'Ref No./Cheque No.',
      },
    },
  },
  {
    id: 'builtin:axis',
    name: 'Axis Bank — savings',
    builtin: true,
    mapping: {
      dateOrder: 'dmy',
      amountMode: 'debit_credit',
      columns: {
        date: 'Tran Date',
        description: 'PARTICULARS',
        debit: 'DR',
        credit: 'CR',
        balance: 'BAL',
        reference: 'CHQNO',
      },
    },
  },
  {
    id: 'builtin:kotak',
    name: 'Kotak Mahindra Bank — savings',
    builtin: true,
    mapping: {
      dateOrder: 'dmy',
      amountMode: 'indicator',
      columns: {
        date: 'Date',
        description: 'Description',
        amount: 'Amount',
        indicator: 'Dr / Cr',
        balance: 'Balance',
        reference: 'Chq / Ref number',
      },
    },
  },
  {
    id: 'builtin:card',
    name: 'Credit card — purchases positive',
    builtin: true,
    mapping: {
      dateOrder: 'dmy',
      amountMode: 'single',
      signInverted: true,
      columns: { date: 'Date', description: 'Description', amount: 'Amount' },
    },
  },
]

/** Columns a preset relies on (required ones plus any optional ones it names). */
function presetColumns(p: Preset): string[] {
  const m = p.mapping
  return Object.values(m.columns).filter((c): c is string => Boolean(c))
}

/** First preset whose columns all appear in the header row. User presets are checked first. */
export function matchPreset(headers: readonly string[], presets: readonly Preset[]): Preset | null {
  const have = new Set(headers.map(normalizeHeader))
  const ordered = [...presets].sort((a, b) => Number(a.builtin) - Number(b.builtin))
  for (const p of ordered) {
    const required = requiredColumns({ ...p.mapping, headerRow: 0 }).map((k) => p.mapping.columns[k])
    if (required.some((c) => !c)) continue
    if (presetColumns(p).every((c) => have.has(normalizeHeader(c)))) return p
  }
  return null
}
