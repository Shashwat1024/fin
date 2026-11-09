import { expect, test } from '@playwright/test'
import { externalRequests, fixture, launchFin, onboard, toast, type FinApp } from './app'

let fin: FinApp
test.beforeAll(async () => {
  fin = await launchFin()
})
test.afterAll(async () => fin?.close())

test('US2: import a statement, catch re-import duplicates, undo the batch', async () => {
  const { page } = fin
  await onboard(page, 'HDFC Savings', '50,000', '2026-09-30')

  // Choose file → layout detected from the built-in HDFC preset
  await page.keyboard.press('Control+4')
  await expect(page.getByRole('heading', { name: 'Import' })).toBeVisible()
  await page.getByLabel('Statement file').setInputFiles(fixture('hdfc_savings.csv'))
  await expect(page.getByLabel('Bank layout')).toContainText('HDFC Bank')
  await expect(page.getByText('5 transactions')).toBeVisible()
  await expect(page.getByText('1 line with problems')).toBeVisible()
  await expect(page.getByText('"32/10/26" is not a valid date')).toBeVisible()
  await page.getByRole('button', { name: 'Check for duplicates' }).click()

  // Review: all new; statement closing balance equals Fin's balance after import
  await expect(page.getByText('5 new')).toBeVisible()
  const balanceCheck = page.locator('[data-slot="card"]', { hasText: 'Balance check' })
  await expect(balanceCheck).toContainText('₹1,16,470.00')
  await expect(balanceCheck).toContainText('₹0.00')
  await page.getByRole('button', { name: 'Import 5 transactions' }).click()
  await expect(toast(page, 'Imported 5 transactions')).toBeVisible()
  await page.getByRole('link', { name: 'Review imported transactions' }).click()
  await expect(page.getByRole('button', { name: 'Remove import filter' })).toBeVisible()
  await expect(page.getByRole('row', { name: /CHAI POINT/ })).toHaveCount(2)

  // Re-importing the same file finds nothing new
  await page.keyboard.press('Control+4')
  await page.getByLabel('Statement file').setInputFiles(fixture('hdfc_savings.csv'))
  await page.getByRole('button', { name: 'Check for duplicates' }).click()
  await expect(page.getByText('You imported this exact file')).toBeVisible()
  await expect(page.getByText('5 already in Fin (skipped)')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nothing new to import' })).toBeDisabled()

  // Undo from history restores the balance exactly
  await page.getByRole('tab', { name: 'History' }).click()
  await page.getByRole('tabpanel', { name: 'History' }).getByRole('button', { name: 'Undo' }).click()
  await page.getByRole('button', { name: 'Undo import' }).click()
  await expect(toast(page, 'Removed 5 imported transactions')).toBeVisible()
  await page.keyboard.press('Control+3')
  await expect(page.getByRole('button', { name: /₹50,000\.00/ })).toBeVisible()
})

test('offline during import', async () => {
  expect(externalRequests(fin.requests)).toEqual([])
})
