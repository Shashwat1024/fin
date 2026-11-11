import { expect, test, type Page } from '@playwright/test'
import { addMonths, endOfMonth, startOfMonth, todayIn } from '../../src/domain/dates'
import { externalRequests, launchFin, onboard, toast, type FinApp } from './app'

let fin: FinApp
let page: Page
test.beforeAll(async () => {
  fin = await launchFin()
  page = fin.page
})
test.afterAll(async () => fin?.close())

const today = todayIn('Asia/Kolkata')
// Last month is complete, so its numbers do not depend on today's date.
const month = addMonths(startOfMonth(today), -1).slice(0, 7)
const daysInMonth = Number(endOfMonth(`${month}-01`).slice(8))
const monthName = new Intl.DateTimeFormat('en-IN', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
}).format(new Date(`${month}-01T00:00:00Z`))

async function add(mode: 'Control+n' | 'Control+i', amount: string, payee: string, date: string) {
  await page.keyboard.press(mode)
  await page.getByLabel('Amount').fill(amount)
  await page.getByLabel('Date').fill(date)
  await page.getByLabel('Payee').fill(payee)
  await page.getByLabel('Payee').press('Control+Enter')
  await expect(toast(page, 'Transaction added')).toBeVisible()
}

test('US12: the spending calendar shades days, totals the month and opens a day', async () => {
  await onboard(page, 'HDFC Savings', '50,000', addMonths(startOfMonth(today), -2))
  await add('Control+n', '500', 'Chai Point', `${month}-03`)
  await add('Control+n', '250', 'Metro card', `${month}-03`)
  await add('Control+n', '1200', 'Big Basket', `${month}-17`)
  await add('Control+i', '9000', 'Refund from friend', `${month}-20`)

  await page.keyboard.press('Control+k')
  await page.getByPlaceholder('Type a command or search…').fill('Spending calendar')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tab', { name: 'Calendar' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'Previous month' }).click()
  await expect(page.getByRole('heading', { name: monthName })).toBeVisible()

  const summary = page.getByTestId('calendar-summary')
  await expect(summary).toContainText('₹1,950.00')
  await expect(summary).toContainText(`${daysInMonth - 2} of ${daysInMonth}`)
  await expect(summary).toContainText('₹1,200.00')

  // Only days with spending are links; income is not spending.
  const table = page.getByRole('table', { name: /Spending per day/ })
  await expect(table.getByRole('link')).toHaveCount(2)
  const third = table.getByRole('link', { name: /, 3 \w+: ₹750\.00 spent, 2 transactions$/ })
  await expect(third).toBeVisible()
  await third.click()
  await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: 'Chai Point' })).toHaveCount(1)
  await expect(page.getByRole('row').filter({ hasText: 'Metro card' })).toHaveCount(1)
  await expect(page.getByRole('row').filter({ hasText: 'Big Basket' })).toHaveCount(0)

  // The month is in the address, and the table view lists every day.
  await page.goBack()
  await expect(page.getByRole('heading', { name: monthName })).toBeVisible()
  await page.getByRole('radio', { name: 'Table' }).click()
  const daysTable = page.getByRole('table', { name: `Spending per day in ${monthName}` })
  await expect(daysTable.getByRole('row')).toHaveCount(daysInMonth + 1)
  await expect(daysTable.getByRole('row').filter({ hasText: '₹1,200.00' })).toHaveCount(1)

  expect(externalRequests(fin.requests)).toEqual([])
})
