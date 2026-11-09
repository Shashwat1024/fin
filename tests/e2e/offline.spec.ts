import { expect, test } from '@playwright/test'
import { externalRequests, fixture, launchFin, onboard, toast, type FinApp } from './app'

let fin: FinApp
test.beforeAll(async () => {
  fin = await launchFin()
})
test.afterAll(async () => fin?.close())

/** Constitution I / SC: core flows make zero outbound requests, and the app cannot reach the network. */
test('every core flow works with no network requests', async () => {
  const { page } = fin

  // Demo straight from first run, visiting every screen
  await expect(page.getByText('Welcome to Fin')).toBeVisible()
  await page.getByRole('button', { name: 'Explore with demo data first' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Demo data.' })).toBeVisible()
  for (const [key, heading] of [
    ['Control+1', 'Overview'],
    ['Control+2', 'Transactions'],
    ['Control+3', 'Accounts'],
    ['Control+4', 'Import'],
    ['Control+5', 'Recurring'],
    ['Control+6', 'Budget'],
    ['Control+7', 'Goals'],
    ['Control+,', 'Settings'],
  ] as const) {
    await page.keyboard.press(key)
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  }
  await page.keyboard.press('Control+k')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Leave demo' }).first().click()

  // Leaving the demo returns to a fresh first run: the demo never touched real data
  await onboard(page, 'HDFC Savings', '50,000', '2026-09-30')
  await page.keyboard.press('Control+4')
  await page.getByLabel('Statement file').setInputFiles(fixture('hdfc_savings.csv'))
  await page.getByRole('button', { name: 'Check for duplicates' }).click()
  await page.getByRole('button', { name: 'Import 5 transactions' }).click()
  await expect(toast(page, 'Imported 5 transactions')).toBeVisible()
  await page.keyboard.press('Control+,')
  await page.getByRole('button', { name: 'Back up now' }).click()
  await page.getByRole('button', { name: 'Back up', exact: true }).click()
  await expect(toast(page, 'Backed up to')).toBeVisible()

  expect(externalRequests(fin.requests)).toEqual([])

  // Even a deliberate attempt from the page is blocked
  const result = await page.evaluate(() =>
    fetch('https://example.com/ping').then(
      () => 'reached',
      () => 'blocked',
    ),
  )
  expect(result).toBe('blocked')
})
