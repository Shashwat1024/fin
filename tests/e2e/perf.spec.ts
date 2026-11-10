import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { openDatabase } from '../../src/db/connection'
import { migrate } from '../../src/db/migrate'
import { seedDefaultCategories } from '../../src/db/seed/categories'
import { seedPerfData } from '../../src/db/seed/perf'
import { todayIn } from '../../src/domain/dates'
import { launchFin, type FinApp } from './app'

/**
 * NFR performance in the real app with 50,000 transactions (plan.md): cold start to a usable
 * Overview under 2 s, and the transaction list updating within 150 ms of a filter being applied
 * (measured after the search box's own 200 ms typing pause). Query-level budgets are in
 * tests/integration/perf.test.ts.
 */
let fin: FinApp
let page: Page
let coldStartMs = 0
const LAUNCHES = 3

test.beforeAll(async () => {
  test.setTimeout(120_000)
  const dir = mkdtempSync(join(tmpdir(), 'fin-perf-e2e-'))
  const db = openDatabase(join(dir, 'fin.db'))
  migrate(db)
  seedDefaultCategories(db)
  seedPerfData(db, todayIn('Asia/Kolkata'))
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  db.close()
  // Electron's own launch time varies by a few hundred ms, so take the median of a few launches.
  const starts: number[] = []
  for (let i = 0; i < LAUNCHES; i++) {
    if (fin) await fin.app.close()
    const start = performance.now()
    fin = await launchFin(dir)
    page = fin.page
    await expect(page.locator('[data-slot="card"]', { hasText: 'Cash position' })).toContainText('₹', {
      timeout: 10_000,
    })
    starts.push(performance.now() - start)
  }
  console.log(`cold starts: ${starts.map(Math.round).join(', ')} ms`)
  coldStartMs = starts.sort((a, b) => a - b)[Math.floor(LAUNCHES / 2)]!
})
test.afterAll(async () => fin?.close())

test('cold start to a usable Overview in under 2 s', async () => {
  console.log(`cold start: ${Math.round(coldStartMs)} ms`)
  expect(coldStartMs).toBeLessThan(2000)
  await expect(page.locator('[data-slot="card"]', { hasText: 'Lowest in 30 days' })).toContainText('₹')
})

test('filtering 50,000 transactions updates the list in under 150 ms', async () => {
  await page.keyboard.press('Control+2')
  await expect(page.getByRole('row').nth(2)).toBeVisible()
  const search = page.getByPlaceholder(/Search/).first()
  const timings: number[] = []
  for (const term of ['swiggy', 'uber', 'pharmacy']) {
    await search.fill(term)
    // The box waits 200 ms after typing stops before filtering; measure from then until the rows show.
    // (A string, because this runs in the page, not in the test's Node process.)
    const t = await page.evaluate<number>(`new Promise((resolve) => {
      const from = performance.now() + 200
      const check = () => {
        const rows = [...document.querySelectorAll('[role="row"]')].slice(1, 4)
        if (rows.length && rows.every((r) => r.textContent.toLowerCase().includes(${JSON.stringify(term)}))) resolve(performance.now() - from)
        else requestAnimationFrame(check)
      }
      check()
    })`)
    timings.push(t)
  }
  console.log(`filter: ${timings.map(Math.round).join(', ')} ms`)
  expect(Math.max(...timings)).toBeLessThan(150)
})
