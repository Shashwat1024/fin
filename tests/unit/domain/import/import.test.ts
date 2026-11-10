import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectHeaderRow, normalizeHeader, parseTable } from '@domain/import/csv'
import { decodeBytes } from '@domain/import/decode'
import { detectDateOrder, parseDateText } from '@domain/import/dates'
import {
  fingerprintKey,
  isPossibleDuplicate,
  normalizeDescription,
  occurrenceIndexes,
} from '@domain/import/fingerprint'
import {
  applyMapping,
  closingBalance,
  suggestMapping,
  type Mapping,
  type ParsedRow,
} from '@domain/import/mapping'
import { BUILTIN_PRESETS, matchPreset } from '@domain/import/presets'

const fixture = (name: string) =>
  decodeBytes(new Uint8Array(readFileSync(join('tests/fixtures/csv', name)))).text

/** Full pipeline the wizard runs: parse → header → preset (or suggestion) → mapping. */
function importFile(name: string) {
  const table = parseTable(fixture(name))
  const headerRow = detectHeaderRow(table.rows)
  const preset = matchPreset(table.rows[headerRow]!, BUILTIN_PRESETS)
  const mapping: Mapping = preset ? { ...preset.mapping, headerRow } : suggestMapping(table.rows, headerRow)
  return { table, headerRow, preset, mapping, result: applyMapping(table.rows, mapping, table.lineNumbers) }
}

const ok = (rows: ParsedRow[]) =>
  rows.filter((r): r is Extract<ParsedRow, { status: 'ok' }> => r.status === 'ok').map((r) => r.values)

describe('decode', () => {
  it('handles BOMs, UTF-8 and Windows-1252', () => {
    expect(decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toEqual({ text: 'A', encoding: 'utf-8' })
    expect(decodeBytes(new Uint8Array([0xff, 0xfe, 0x41, 0x00]))).toEqual({ text: 'A', encoding: 'utf-16le' })
    expect(decodeBytes(new Uint8Array([0xfe, 0xff, 0x00, 0x41]))).toEqual({ text: 'A', encoding: 'utf-16be' })
    expect(decodeBytes(new TextEncoder().encode('₹ 10'))).toEqual({ text: '₹ 10', encoding: 'utf-8' })
    expect(decodeBytes(new Uint8Array([0x43, 0x61, 0x66, 0xe9]))).toEqual({
      text: 'Café',
      encoding: 'windows-1252',
    })
  })
})

describe('csv', () => {
  it('guesses delimiters and finds the header below a bank preamble', () => {
    const hdfc = parseTable(fixture('hdfc_savings.csv'))
    expect(hdfc.delimiter).toBe(',')
    expect(detectHeaderRow(hdfc.rows)).toBe(3)
    expect(hdfc.lineNumbers.slice(0, 5)).toEqual([1, 2, 3, 5, 6])
    const sbi = parseTable(fixture('sbi_savings.tsv'))
    expect(sbi.delimiter).toBe('\t')
    expect(detectHeaderRow(sbi.rows)).toBe(0)
    expect(normalizeHeader(' Withdrawal Amt. ')).toBe('withdrawal amt')
  })
})

describe('dates', () => {
  it.each([
    ['31/10/26', 'dmy', '2026-10-31'],
    ['31-10-2026', 'dmy', '2026-10-31'],
    ['1 Oct 2026', 'dmy', '2026-10-01'],
    ['01-Oct-26', 'dmy', '2026-10-01'],
    ['Oct 5, 2026', 'dmy', '2026-10-05'],
    ['2026-10-31', 'ymd', '2026-10-31'],
    ['10/31/2026', 'mdy', '2026-10-31'],
    ['31/10/2026 10:22:01', 'dmy', '2026-10-31'],
    ['29/02/2024', 'dmy', '2024-02-29'],
  ] as const)('parses %s as %s', (text, order, expected) => {
    expect(parseDateText(text, order)).toBe(expected)
  })

  it.each(['32/10/26', '29/02/2023', '', 'Opening balance', '10/2026'])('rejects %s', (text) => {
    expect(parseDateText(text, 'dmy')).toBeNull()
  })

  it('detects the date order from samples', () => {
    expect(detectDateOrder(['31/10/2026', '01/11/2026'])).toBe('dmy')
    expect(detectDateOrder(['10/31/2026', '11/01/2026'])).toBe('mdy')
    expect(detectDateOrder(['2026-10-31'])).toBe('ymd')
    expect(detectDateOrder(['01/02/2026'])).toBe('dmy')
  })
})

describe('mapping with built-in presets', () => {
  it('HDFC: debit/credit columns, preamble, malformed row, repeats and footer', () => {
    const { preset, result } = importFile('hdfc_savings.csv')
    expect(preset?.id).toBe('builtin:hdfc')
    const values = ok(result.rows)
    expect(values.map((v) => v.amountMinor)).toEqual([-45_000, 8_500_000, -4_000, -4_000, -1_800_000])
    expect(values[0]).toMatchObject({
      date: '2026-10-01',
      reference: '0000428812345678',
      balanceMinor: 4_955_000,
    })
    const errors = result.rows.filter((r) => r.status === 'error')
    expect(errors).toEqual([expect.objectContaining({ rowNumber: 10, code: 'DATE_INVALID' })])
    expect(result.rows.filter((r) => r.status === 'ignored')).toHaveLength(1)
    expect(closingBalance(result.rows)).toEqual({ date: '2026-10-05', balanceMinor: 11_647_000 })
  })

  it('ICICI: newest-first with zero-filled columns', () => {
    const { preset, result } = importFile('icici_savings.csv')
    expect(preset?.id).toBe('builtin:icici')
    expect(ok(result.rows).map((v) => [v.date, v.amountMinor])).toEqual([
      ['2026-10-08', -129_900],
      ['2026-10-06', -59_900],
      ['2026-10-02', 59_900],
    ])
    expect(closingBalance(result.rows)?.balanceMinor).toBe(4_870_100)
  })

  it('SBI: tab separated with month names', () => {
    const { preset, result } = importFile('sbi_savings.tsv')
    expect(preset?.id).toBe('builtin:sbi')
    expect(ok(result.rows).map((v) => [v.date, v.amountMinor])).toEqual([
      ['2026-10-01', -32_000],
      ['2026-10-02', 100_000],
    ])
  })

  it('Axis and Kotak (Dr/Cr indicator column)', () => {
    expect(ok(importFile('axis_savings.csv').result.rows).map((v) => v.amountMinor)).toEqual([
      -215_075, 50_000,
    ])
    const kotak = importFile('kotak_savings.csv')
    expect(kotak.preset?.id).toBe('builtin:kotak')
    expect(ok(kotak.result.rows).map((v) => v.amountMinor)).toEqual([-105_000, 2_500])
  })

  it('credit card: purchases positive are inverted', () => {
    const card = importFile('card_statement.csv')
    expect(card.preset?.id).toBe('builtin:card')
    expect(ok(card.result.rows).map((v) => v.amountMinor)).toEqual([-1_249_900, 500_000])
  })
})

describe('mapping without a preset', () => {
  it('suggests columns from header words', () => {
    const table = [
      ['Posting Date', 'Value Date', 'Details', 'Debit', 'Credit', 'Running Balance', 'Ref'],
      ['31/10/2026', '31/10/2026', 'Shop', '100.00', '', '900.00', 'R1'],
    ]
    const m = suggestMapping(table, 0)
    expect(m).toMatchObject({
      amountMode: 'debit_credit',
      dateOrder: 'dmy',
      columns: {
        date: 'Posting Date',
        description: 'Details',
        debit: 'Debit',
        credit: 'Credit',
        balance: 'Running Balance',
        reference: 'Ref',
      },
    })
    expect(ok(applyMapping(table, m).rows)[0]?.amountMinor).toBe(-10_000)
  })

  it('reports missing columns and row-level problems', () => {
    const table = [
      ['Date', 'Description', 'Amount', 'Type'],
      ['01/10/2026', 'A', 'abc', 'DR'],
      ['01/10/2026', 'B', '', 'DR'],
      ['01/10/2026', 'C', '5', '??'],
      ['01/10/2026', 'D', '0', 'DR'],
    ]
    const indicator: Mapping = {
      headerRow: 0,
      dateOrder: 'dmy',
      amountMode: 'indicator',
      columns: { date: 'Date', description: 'Description', amount: 'Amount', indicator: 'Type' },
    }
    const rows = applyMapping(table, indicator).rows
    expect(rows.map((r) => (r.status === 'error' ? r.code : r.status))).toEqual([
      'AMOUNT_INVALID',
      'AMOUNT_MISSING',
      'INDICATOR_INVALID',
      'ignored',
    ])
    expect(
      applyMapping(table, { ...indicator, columns: { ...indicator.columns, indicator: 'Nope' } })
        .missingColumns,
    ).toEqual(['indicator'])
  })
})

describe('fingerprints', () => {
  it('normalises case and punctuation but keeps references', () => {
    expect(normalizeDescription(' upi-Swiggy / order ')).toBe('UPI SWIGGY ORDER')
    expect(fingerprintKey('2026-10-01', -45_000, 'UPI-SWIGGY-428812345678')).not.toBe(
      fingerprintKey('2026-10-01', -45_000, 'UPI-SWIGGY-428812345679'),
    )
  })

  it('numbers repeated identical lines', () => {
    expect(occurrenceIndexes(['a', 'b', 'a', 'a'])).toEqual([0, 0, 1, 2])
  })

  it('flags same amount within two days as a possible duplicate', () => {
    const a = { date: '2026-10-01', amountMinor: -500 }
    expect(isPossibleDuplicate(a, { date: '2026-10-03', amountMinor: -500 })).toBe(true)
    expect(isPossibleDuplicate(a, { date: '2026-10-04', amountMinor: -500 })).toBe(false)
    expect(isPossibleDuplicate(a, { date: '2026-10-01', amountMinor: -501 })).toBe(false)
  })
})
