import { expect, test, type Page } from '@playwright/test'
import { addMonths, startOfMonth, todayIn } from '../../src/domain/dates'
import { externalRequests, launchFin, onboard, toast, type FinApp } from './app'

let fin: FinApp
let page: Page
test.beforeAll(async () => {
  fin = await launchFin()
  page = fin.page
})
test.afterAll(async () => fin?.close())

const thisMonth = startOfMonth(todayIn('Asia/Kolkata'))
const monthsAgo = (n: number) => addMonths(thisMonth, -n).slice(0, 7)

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

test('US13: the health summary states facts from complete months, each linked to its records', async () => {
  await onboard(page, 'HDFC Savings', '50,000', addMonths(thisMonth, -4))
  for (const n of [3, 2, 1]) {
    const m = monthsAgo(n)
    await add('Control+i', '100000', 'ACME Payroll', `${m}-05`, 'Salary')
    await add('Control+n', '25000', 'Landlord', `${m}-06`, 'Rent')
    // Dining out sits under Food (needs) but is itself "wants": not essential.
    await add('Control+n', '15000', 'Toit', `${m}-07`, 'Dining out')
  }

  await page.keyboard.press('Control+1')
  const summary = page.getByRole('region', { name: 'Where you stand' })
  await expect(summary.getByTestId('health-emergency_cover')).toContainText(
    'Your cash and bank balances (₹2,30,000) would cover about 9.2 months of essential spending (₹25,000 a month on average over the last 3 months).',
  )
  await expect(summary.getByTestId('health-savings_rate')).toContainText(
    'Over the last 3 months you saved 60% of your income.',
  )
  await expect(summary.getByTestId('health-emi_share')).toContainText(
    'No EMIs are set up as recurring payments.',
  )
  await expect(summary.getByTestId('health-card_share')).toContainText('No credit cards added.')

  // The essential spending behind it: exactly the rent, with the group filter shown.
  await summary.getByRole('link', { name: 'Essential spending' }).click()
  await expect(page.getByRole('button', { name: 'Remove the Needs categories filter' })).toBeVisible()
  await expect(page.getByText(/Out ₹75,000\.00/)).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: 'Toit' })).toHaveCount(0)

  // The same summary leads Insights.
  await page.evaluate('location.hash = "/insights"')
  await expect(page.getByRole('region', { name: 'Where you stand' })).toContainText('9.2 months')

  expect(externalRequests(fin.requests)).toEqual([])
})
