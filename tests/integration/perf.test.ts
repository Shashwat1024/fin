import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '@db/connection'
import { migrate } from '@db/migrate'
import { suggestForTxns } from '@db/repos/categorization'
import { dashboardSummary } from '@db/repos/dashboard'
import { previewImport } from '@db/repos/imports'
import { forecast, netWorthHistoryFor, whatIf } from '@db/repos/insights'
import { listInsights, recurringSuggestions } from '@db/repos/patterns'
import { budgetMonth, listGoals, listOccurrences, listRecurring } from '@db/repos/planning'
import { listAccounts } from '@db/repos/accounts'
import { listCategories } from '@db/repos/categories'
import { queryTransactions } from '@db/repos/transactions'
import { seedDefaultCategories } from '@db/seed/categories'
import { seedPerfData } from '@db/seed/perf'
import { addDays, monthKey } from '@domain/dates'
import { parseTable } from '@domain/import/csv'
import { applyMapping } from '@domain/import/mapping'
import { BUILTIN_PRESETS } from '@domain/import/presets'

/**
 * NFR performance targets with 50,000 transactions (plan.md): list filtering < 150 ms, the
 * Overview < 300 ms, a 1,000-row CSV preview < 1 s. Run on a real file database, warmed once,
 * reporting the median of several runs so a single GC pause does not fail the build.
 */
const TODAY = '2026-11-09'
let dir: string
let db: Db
let bank: string
const timings: Record<string, number> = {}

function measure(name: string, fn: () => unknown, runs = 5): number {
  fn()
  const t: number[] = []
  for (let i = 0; i < runs; i++) {
    const s = performance.now()
    fn()
    t.push(performance.now() - s)
  }
  t.sort((a, b) => a - b)
  return (timings[name] = Math.round(t[Math.floor(runs / 2)]!))
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'fin-perf-'))
  db = openDatabase(join(dir, 'fin.db'))
  migrate(db)
  seedDefaultCategories(db)
  const r = seedPerfData(db, TODAY)
  expect(r.transactions).toBeGreaterThanOrEqual(50_000)
  db.exec('PRAGMA optimize')
  bank = listAccounts(db).find((a) => a.name === 'Perf Bank')!.id
}, 120_000)

afterAll(() => {
  console.table(timings)
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('performance with 50,000 transactions', () => {
  it('filters the transaction list in under 150 ms', () => {
    const food = listCategories(db).find((c) => c.path === 'Food')!.id
    expect(measure('txns: first page', () => queryTransactions(db, { limit: 100 }))).toBeLessThan(150)
    expect(
      measure('txns: text search', () => queryTransactions(db, { text: 'swiggy', limit: 100 })),
    ).toBeLessThan(150)
    expect(
      measure('txns: category + year', () =>
        queryTransactions(db, { categoryIds: [food], from: '2025-11-01', to: TODAY, limit: 100 }),
      ),
    ).toBeLessThan(150)
    expect(
      measure('txns: amount + account', () =>
        queryTransactions(db, { accountIds: [bank], minAmountMinor: 100_000, direction: 'out', limit: 100 }),
      ),
    ).toBeLessThan(150)
    expect(
      measure('txns: uncategorised', () =>
        queryTransactions(db, { categoryIds: ['uncategorized'], limit: 100 }),
      ),
    ).toBeLessThan(150)
  })

  it('loads everything the Overview needs in under 300 ms', () => {
    const overview = () => {
      dashboardSummary(db, TODAY)
      forecast(db, 30, TODAY)
      listRecurring(db, TODAY)
      listOccurrences(db, addDays(TODAY, -60), addDays(TODAY, 59), TODAY)
      budgetMonth(db, monthKey(TODAY))
      listGoals(db, TODAY)
      listAccounts(db)
      queryTransactions(db, { limit: 10 })
    }
    measure('dashboard.summary', () => dashboardSummary(db, TODAY))
    measure('forecast 30', () => forecast(db, 30, TODAY))
    measure('budget month', () => budgetMonth(db, monthKey(TODAY)))
    expect(measure('overview (all queries)', overview)).toBeLessThan(300)
  })

  it('opens the other heavy pages quickly', () => {
    expect(measure('forecast 90', () => forecast(db, 90, TODAY))).toBeLessThan(300)
    expect(measure('net worth (all)', () => netWorthHistoryFor(db, TODAY, '1900-01-01'))).toBeLessThan(300)
    const ids = queryTransactions(db, { categoryIds: ['uncategorized'], limit: 100 }).rows.map((t) => t.id)
    expect(measure('suggestions (100 rows)', () => suggestForTxns(db, ids))).toBeLessThan(150)
  })

  it('computes insights, recurring suggestions and a what-if quickly (US8)', () => {
    expect(measure('insights', () => listInsights(db, TODAY), 3)).toBeLessThan(500)
    expect(measure('looks recurring', () => recurringSuggestions(db, TODAY), 3)).toBeLessThan(500)
    const changes = [
      { kind: 'large_purchase' as const, name: 'Laptop', amountMinor: 15_000_000, date: TODAY },
    ]
    expect(measure('what-if 90', () => whatIf(db, 90, changes, TODAY))).toBeLessThan(300)
  })

  it('previews a 1,000-row CSV in under 1 s', () => {
    const lines = ['Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance']
    for (let i = 0; i < 1000; i++) {
      const d = addDays('2026-08-01', i % 90)
      const [y, m, day] = d.split('-')
      lines.push(
        `${day}/${m}/${y!.slice(2)},UPI-SWIGGY-SWIGGY@ICICI-ICIC0DC0099-4288${100000 + i}-ORDER,4288${100000 + i},${day}/${m}/${y!.slice(2)},${(i % 900) + 10}.00,,1000.00`,
      )
    }
    const text = lines.join('\n')
    const preset = BUILTIN_PRESETS.find((p) => p.id === 'builtin:hdfc')!
    const ms = measure(
      'csv preview (1,000 rows)',
      () => {
        const table = parseTable(text)
        const parsed = applyMapping(table.rows, { ...preset.mapping, headerRow: 0 })
        const rows = parsed.rows.flatMap((r) =>
          r.status === 'ok'
            ? [
                {
                  rowNumber: r.rowNumber,
                  date: r.values.date,
                  amountMinor: r.values.amountMinor,
                  description: r.values.description,
                },
              ]
            : [],
        )
        expect(rows).toHaveLength(1000)
        previewImport(db, { accountId: bank, rows })
      },
      3,
    )
    expect(ms).toBeLessThan(1000)
  })
})
