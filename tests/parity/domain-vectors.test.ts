/**
 * Parity vectors for the Rust port (specs/002-rust-tauri-port): the TypeScript domain is the
 * oracle. This test computes answers for thousands of inputs and checks they match the committed
 * file that `crates/fin-core/tests/domain_vectors.rs` replays against the Rust code.
 * Regenerate with FIN_UPDATE_VECTORS=1 npm test -- tests/parity.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import * as d from '@domain/dates'
import { allocate, parseAmount, toMajorString } from '@domain/money'

const FILE = join('tests', 'parity', 'vectors', 'domain.json')
const NBSP = String.fromCharCode(0xa0)
const BOM = String.fromCharCode(0xfeff)

/** Small deterministic PRNG (mulberry32) so the vectors never change between runs. */
function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const tryOr = <T>(f: () => T): T | { error: true } => {
  try {
    return f()
  } catch {
    return { error: true }
  }
}

function build() {
  const r = rng(20261110)
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))

  const amountInputs = [
    '1,25,000.50',
    '₹ 450',
    'Rs. 99.9',
    'rs 5',
    'INR 1,234.5',
    '450.00 Dr',
    '450.00 dr.',
    '1,000 CR',
    '(500.00)',
    '(500.00) Dr',
    '-12',
    '+3',
    '- ₹ 40',
    '₹-40',
    '.5',
    '0',
    '-0',
    '0.00',
    '00012.10',
    '1.',
    '.',
    '',
    '   ',
    '12.345',
    'abc',
    '1 2 3',
    '1,2,3',
    '99999999999999.99',
    '90071992547409.91',
    '90071992547409.92',
    '99999999999999999',
    `${NBSP} 7.5${NBSP}`,
    `${BOM}10`,
    '10 Cr.',
    'Dr',
    '(  )',
    '((5))',
    '5-',
    '₹₹5',
    '1e5',
  ]
  const parse = amountInputs.flatMap((input) =>
    ['INR', 'JPY'].map((currency) => ({ input, currency, out: parseAmount(input, currency) })),
  )
  for (let i = 0; i < 300; i++) {
    const v = int(-1e9, 1e9)
    const s = toMajorString(v)
    parse.push({ input: s, currency: 'INR', out: parseAmount(s, 'INR') })
  }

  const major = [0, 1, -1, 5, -5, 99, 100, -100, 12345678, -45000, 9007199254740991, -9007199254740991].map(
    (minor) => ({ minor, currency: 'INR', out: toMajorString(minor) }),
  )
  major.push({ minor: 12, currency: 'JPY', out: toMajorString(12, 'JPY') })
  major.push({ minor: -1234, currency: 'KWD', out: toMajorString(-1234, 'KWD') })

  const alloc: { total: number; weights: number[]; out: number[] | { error: true } }[] = []
  for (let i = 0; i < 400; i++) {
    const n = int(1, 6)
    const weights = Array.from({ length: n }, () => (r() < 0.2 ? 0 : r() < 0.5 ? int(1, 100) : r() * 1000))
    const total = int(-5_000_000, 5_000_000)
    alloc.push({ total, weights, out: tryOr(() => allocate(total, weights)) })
  }

  const rupeesOf = (minor: number) => `₹${Math.round(Math.abs(minor) / 100).toLocaleString('en-IN')}`
  const rupees = [0, 49, 50, 99, 149, 150, 13949, 13950, -13950, 12345678901, 100000000].map((minor) => ({
    minor,
    out: rupeesOf(minor),
  }))
  for (let i = 0; i < 100; i++) {
    const minor = int(-1e12, 1e12)
    rupees.push({ minor, out: rupeesOf(minor) })
  }

  // Dates
  const randomDate = () => d.makeDate(int(1999, 2101), int(1, 12), int(1, 28))
  const edgeDates = [
    '2024-02-29',
    '2023-02-28',
    '2024-01-31',
    '2024-03-31',
    '2100-02-28',
    '2000-02-29',
    '2026-12-31',
  ]
  const dates = [...edgeDates, ...Array.from({ length: 300 }, randomDate)].map((x, i) =>
    i % 3 === 0
      ? `${x.slice(0, 8)}${String(d.daysInMonth(+x.slice(0, 4), +x.slice(5, 7))).padStart(2, '0')}`
      : x,
  )
  const dateOps = dates.map((date) => {
    const months = int(-40, 40)
    const days = int(-800, 800)
    const anchor = r() < 0.3 ? int(28, 31) : undefined
    const other = dates[int(0, dates.length - 1)]!
    const fyStart = int(1, 12)
    return {
      date,
      months,
      anchor: anchor ?? null,
      days,
      other,
      fyStart,
      addMonths: d.addMonths(date, months, anchor),
      addDays: d.addDays(date, days),
      diffDays: d.diffDays(date, other),
      weekday: d.weekday(date),
      endOfMonth: d.endOfMonth(date),
      fy: d.financialYear(date, fyStart),
      presets: Object.fromEntries(
        (['this-month', 'last-month', 'this-fy', 'last-30-days', 'last-90-days'] as const).map((p) => [
          p,
          d.presetRange(p, date, fyStart),
        ]),
      ),
      formatDate: d.formatDate(date),
      dayMonth: new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
        new Date(`${date}T00:00:00Z`),
      ),
    }
  })

  const validity = [
    '2024-02-29',
    '2023-02-29',
    '2024-13-01',
    '2024-00-10',
    '2024-1-01',
    '2024-01-00',
    '2024-04-31',
    '1900-02-29',
    '2000-02-29',
    '20240101',
    '2024-01-01T00:00',
    ' 2024-01-01',
    '0000-01-01',
    '9999-12-31',
    'abcd-ef-gh',
  ].map((s) => ({ s, out: d.isCalendarDate(s) }))

  const instants = [
    '2026-11-09T18:29:59Z',
    '2026-11-09T18:30:00Z',
    '2026-03-08T07:30:00Z',
    '2026-12-31T23:59:59Z',
  ]
  const zones = [
    'Asia/Kolkata',
    'Asia/Calcutta',
    'UTC',
    'America/New_York',
    'Pacific/Kiritimati',
    'Pacific/Pago_Pago',
    'Asia/Kathmandu',
  ]
  const today = instants.flatMap((at) =>
    zones.map((zone) => ({ at, zone, out: d.todayIn(zone, new Date(at)) })),
  )

  const names = {
    monthLong: Array.from({ length: 12 }, (_, i) =>
      new Intl.DateTimeFormat('en-IN', { month: 'long', timeZone: 'UTC' }).format(
        new Date(Date.UTC(2026, i, 1)),
      ),
    ),
    monthShort: Array.from({ length: 12 }, (_, i) =>
      new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' }).format(
        new Date(Date.UTC(2026, i, 1)),
      ),
    ),
    weekdayLong: Array.from({ length: 7 }, (_, i) =>
      new Intl.DateTimeFormat('en-IN', { weekday: 'long', timeZone: 'UTC' }).format(
        new Date(Date.UTC(2026, 10, 8 + i)),
      ),
    ),
  }

  return { parse, major, alloc, rupees, dateOps, validity, today, names }
}

test('domain parity vectors are up to date', () => {
  const json = `${JSON.stringify(build(), null, 1)}\n`
  if (process.env.FIN_UPDATE_VECTORS) writeFileSync(FILE, json)
  expect(readFileSync(FILE, 'utf8')).toBe(json)
})
