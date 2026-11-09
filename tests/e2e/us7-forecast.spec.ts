import { expect, test, type Page } from '@playwright/test'
import { addDays, todayIn } from '../../src/domain/dates'
import { externalRequests, launchFin, onboard, toast, type FinApp } from './app'

let fin: FinApp
let page: Page
test.beforeAll(async () => {
  fin = await launchFin()
  page = fin.page
})
test.afterAll(async () => fin?.close())

const today = todayIn('Asia/Kolkata')

test('US7: forecast with buffer warning and assumptions, and net worth with a recorded value', async () => {
  await onboard(page, 'HDFC Savings', '1,00,000', addDays(today, -10))

  // A large bill in five days
  await page.keyboard.press('Control+5')
  await page.getByRole('button', { name: 'New recurring item' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New recurring item' })
  await dialog.getByLabel('Name').fill('Rent')
  await dialog.getByLabel('Expected amount').fill('90000')
  await dialog.getByLabel('Paid from').click()
  await page.getByRole('option', { name: /^HDFC Savings/ }).click()
  await dialog.getByLabel('First date').fill(addDays(today, 5))
  await dialog.getByRole('button', { name: 'Add recurring item' }).click()
  await expect(toast(page, 'Added Rent')).toBeVisible()

  // Forecast: the lowest point, an honest Low confidence label with little history
  await page.keyboard.press('Control+9')
  await expect(page.getByRole('heading', { name: 'Forecast' })).toBeVisible()
  await expect(page.getByText('Lowest point').locator('xpath=ancestor::*[@data-slot="card"]')).toContainText('₹10,000.00')
  await expect(page.getByText('Low confidence', { exact: true })).toBeVisible()
  await expect(page.getByText(/An estimate, not a guaranteed balance/)).toBeVisible()

  // A buffer: the days below it are flagged with the payment that causes it
  await page.getByLabel('Minimum buffer').fill('20000')
  await page.getByRole('button', { name: 'Save buffer' }).click()
  await expect(toast(page, 'Buffer set to ₹20,000.00')).toBeVisible()
  const alert = page.getByRole('alert').filter({ hasText: 'Below your buffer' })
  await expect(alert).toContainText('Rent')
  await expect(alert).toContainText('₹10,000.00 under your ₹20,000.00 buffer')

  // Assumptions list every input
  const assumptions = page.getByRole('region', { name: 'Assumptions' })
  await expect(assumptions).toContainText('HDFC Savings')
  await expect(assumptions).toContainText('Rent')
  await expect(assumptions).toContainText('Everyday spending')

  // 60 days, read as a table
  await page.getByRole('radio', { name: '60 days' }).click()
  await page.getByRole('radio', { name: 'Table' }).click()
  await expect(page.getByRole('table', { name: 'Projected balance by day' }).locator('tbody tr')).toHaveCount(61)

  // The dashboard shows the same low point
  await page.keyboard.press('Control+1')
  const card = page.getByRole('link', { name: /Lowest in 30 days/ })
  await expect(card).toContainText('₹10,000.00')
  await expect(card).toContainText('Below your ₹20,000.00 buffer')

  // Net worth: an investment valued by hand
  await page.keyboard.press('Control+3')
  await page.getByRole('button', { name: 'New account' }).click()
  await page.getByLabel('Name').fill('Index fund')
  await page.getByLabel('Type').click()
  await page.getByRole('option', { name: 'Investment' }).click()
  await page.getByLabel(/on start date/).fill('50000')
  await page.getByRole('button', { name: 'Add account' }).click()
  await expect(toast(page, 'Added Index fund')).toBeVisible()

  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/Search|Type a command/).fill('Net worth')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Net worth' })).toBeVisible()
  const assets = page.getByRole('region', { name: 'Assets' })
  await expect(assets.getByRole('listitem', { name: 'Index fund' })).toContainText('from transactions')
  await assets.getByRole('button', { name: 'Update value of Index fund' }).click()
  await page.getByRole('dialog').getByLabel('Value').fill('56000')
  await page.getByRole('button', { name: 'Save value' }).click()
  const saved = toast(page, 'Recorded the value of Index fund')
  await expect(saved).toBeVisible()
  await expect(assets.getByRole('listitem', { name: 'Index fund' })).toContainText('₹56,000.00')
  await expect(page.getByText('Net worth today').locator('xpath=ancestor::*[@data-slot="card"]')).toContainText('₹1,56,000.00')

  // One undo puts the ledger value back
  await saved.getByRole('button', { name: 'Undo' }).click()
  await expect(toast(page, 'Undone')).toBeVisible()
  await expect(assets.getByRole('listitem', { name: 'Index fund' })).toContainText('₹50,000.00')
})

test('offline throughout forecasting', async () => {
  expect(externalRequests(fin.requests)).toEqual([])
})
