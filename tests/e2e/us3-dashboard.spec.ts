import { expect, test, type Page } from '@playwright/test'
import { externalRequests, launchFin, onboard, toast, type FinApp } from './app'

let fin: FinApp
let page: Page
test.beforeAll(async () => {
  fin = await launchFin()
  page = fin.page
})
test.afterAll(async () => fin?.close())

// Cards live in the main area; the sidebar has links with some of the same names.
const card = (label: string) => page.getByRole('main').getByRole('link', { name: new RegExp(`^${label}`) })
const cardValue = (label: string) => card(label).locator('[data-slot="card-title"]')

async function addTxn(shortcut: string, amount: string, payee: string) {
  await page.keyboard.press(shortcut)
  await page.getByLabel('Amount').fill(amount)
  await page.getByLabel('Payee').fill(payee)
  await page.getByLabel('Payee').press('Control+Enter')
  await expect(toast(page, 'Transaction added')).toBeVisible()
}

test('US3: every dashboard card equals the total of its drill-down', async () => {
  await onboard(page, 'HDFC Savings', '50,000')

  // A credit card with ₹12,000 owed
  await page.keyboard.press('Control+3')
  await page.getByRole('button', { name: 'New account' }).click()
  await page.getByLabel('Name').fill('Amex')
  await page.getByLabel('Type').click()
  await page.getByRole('option', { name: 'Credit card' }).click()
  await page.getByLabel('Amount owed on start date').fill('12000')
  await page.getByRole('button', { name: 'Add account' }).click()
  await expect(toast(page, 'Added Amex')).toBeVisible()

  await addTxn('Control+i', '85000', 'ACME Payroll')
  await addTxn('Control+n', '450', 'Swiggy')
  // Paying the card is a transfer: it changes balances but is neither spending nor income.
  await page.keyboard.press('Control+t')
  await page.getByLabel('Amount').fill('5000')
  await page.getByLabel('To account').click()
  await page.getByRole('option', { name: /^Amex/ }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(toast(page, 'Transfer added')).toBeVisible()

  await page.keyboard.press('Control+1')
  const expected = {
    'Cash position': '₹1,29,550.00', // 50,000 + 85,000 − 450 − 5,000
    'Spent this month': '₹450.00',
    'Income this month': '₹85,000.00',
    'Savings rate': '99%',
    'Card dues': '₹7,000.00',
    'Net worth': '₹1,22,550.00',
  }
  for (const [label, value] of Object.entries(expected)) await expect(cardValue(label)).toHaveText(value)

  // Spending and income drill to this month's transactions, transfers excluded
  await card('Spent this month').click()
  await expect(page.getByRole('button', { name: 'Include transfers' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Transactions' }).locator('..')).toContainText(`Out ${expected['Spent this month']}`)
  await expect(page.getByRole('row', { name: /Swiggy/ })).toHaveCount(1)
  await page.keyboard.press('Control+1')
  await card('Income this month').click()
  await expect(page.getByRole('heading', { name: 'Transactions' }).locator('..')).toContainText(`In ${expected['Income this month']}`)

  // Balance cards drill to the matching group of accounts
  for (const label of ['Cash position', 'Card dues'] as const) {
    await page.keyboard.press('Control+1')
    await card(label).click()
    await expect(page.getByRole('status').filter({ hasText: 'Showing' })).toContainText(`Total ${expected[label]}`)
  }
  await page.keyboard.press('Control+1')
  await card('Net worth').click()
  await expect(page.getByRole('heading', { name: 'Net worth' })).toBeVisible()
  await expect(page.locator('[data-slot="card"]', { hasText: 'Net worth today' })).toContainText(expected['Net worth'])

  // Freshness: each card says how current its data is and where it came from
  await page.keyboard.press('Control+1')
  await page.getByRole('button', { name: /^Cash position: data as of/ }).click()
  await expect(page.getByRole('dialog')).toContainText('HDFC Savings')
  await expect(page.getByRole('dialog')).toContainText('Entered by hand')
  await page.keyboard.press('Escape')

  // The chart can be read as a table, and this month matches the cards
  await page.getByRole('radio', { name: 'Table' }).click()
  const thisMonth = page.getByRole('table', { name: 'Money in and out by month' }).getByRole('row').last()
  await expect(thisMonth).toContainText(expected['Income this month'])
  await expect(thisMonth).toContainText(expected['Spent this month'])
})

test('offline on the dashboard', async () => {
  expect(externalRequests(fin.requests)).toEqual([])
})
