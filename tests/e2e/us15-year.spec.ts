import { expect, test, type Page } from '@playwright/test'
import { todayIn } from '../../src/domain/dates'
import { externalRequests, launchFin, onboard, toast, type FinApp } from './app'

let fin: FinApp
let page: Page
test.beforeAll(async () => {
  fin = await launchFin()
  page = fin.page
})
test.afterAll(async () => fin?.close())

// Calendar years keep the dates simple: last year is complete, the one before is for comparison.
const thisYear = Number(todayIn('Asia/Kolkata').slice(0, 4))
const last = thisYear - 1
const before = thisYear - 2

async function add(
  key: 'Control+n' | 'Control+i',
  amount: string,
  payee: string,
  date: string,
  category: string,
) {
  await page.keyboard.press(key)
  await page.getByLabel('Amount', { exact: true }).fill(amount)
  await page.getByLabel('Date').fill(date)
  await page.getByLabel('Payee').fill(payee)
  await page.getByRole('combobox', { name: 'Category' }).click()
  await page.getByPlaceholder('Search categories…').fill(category)
  await page.keyboard.press('Enter')
  await page.getByLabel('Payee').press('Control+Enter')
  await expect(toast(page, 'Transaction added')).toBeVisible()
}

test('US15: a year in review with totals, top categories, changes, links and printing', async () => {
  await onboard(page, 'HDFC Savings', '50,000', `${before}-12-01`)
  await add('Control+n', '8000', 'IndiGo', `${before}-12-20`, 'Flights')
  await add('Control+i', '100000', 'ACME Payroll', `${last}-03-10`, 'Salary')
  await add('Control+n', '25000', 'Landlord', `${last}-03-12`, 'Rent')
  await add('Control+n', '5000', 'DMart', `${last}-07-02`, 'Groceries')

  await page.keyboard.press('Control+k')
  await page.getByPlaceholder('Type a command or search…').fill('Year in review')
  await page.keyboard.press('Enter')
  await page.getByRole('radio', { name: 'Calendar year' }).click()
  await expect(page.getByRole('heading', { name: `Year in review: ${last}` })).toBeVisible()

  const totals = page.getByTestId('year-totals')
  await expect(totals).toContainText('₹1,00,000.00')
  await expect(totals).toContainText('₹30,000.00')
  await expect(totals).toContainText('Saved (70% of income)')
  const topCategories = page.getByRole('region', { name: 'Top categories' })
  await expect(topCategories.getByRole('listitem').first()).toContainText('Housing')
  await expect(topCategories.getByRole('listitem').nth(1)).toContainText('₹5,000.00')
  const changes = page.getByRole('region', { name: 'Biggest changes' })
  await expect(changes.getByRole('row').filter({ hasText: 'Travel' })).toContainText('₹8,000.00')

  // Every figure opens its records.
  await topCategories.getByRole('link', { name: 'Housing' }).click()
  await expect(page.getByRole('row').filter({ hasText: 'Landlord' })).toHaveCount(1)
  await expect(page.getByRole('row').filter({ hasText: 'DMart' })).toHaveCount(0)
  await page.goBack()

  // Printing uses Windows' own dialog (not opened in the test).
  await page.evaluate('window.__printed = 0; window.print = () => { window.__printed++ }')
  await page.getByRole('button', { name: 'Print or save as PDF' }).click()
  expect(await page.evaluate('window.__printed')).toBe(1)

  // This year is shown so far.
  await page.getByRole('combobox', { name: 'Year' }).click()
  await page.getByRole('option', { name: String(thisYear) }).click()
  await expect(page.getByRole('note')).toContainText('So far: up to')

  expect(externalRequests(fin.requests)).toEqual([])
})
