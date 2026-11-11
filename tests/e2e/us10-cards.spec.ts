import { expect, test, type Page } from '@playwright/test'
import { addDays, addMonths, formatDate, startOfMonth, todayIn } from '../../src/domain/dates'
import { externalRequests, launchFin, onboard, toast, type FinApp } from './app'

let fin: FinApp
let page: Page
test.beforeAll(async () => {
  fin = await launchFin()
  page = fin.page
})
test.afterAll(async () => fin?.close())

const today = todayIn('Asia/Kolkata')
// The statement was made five days ago and is due in five days.
const statement = addDays(today, -5)
const due = addDays(statement, 10)
const short = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${d}T00:00:00Z`),
  )

async function addCardExpense(amount: string, payee: string, date: string) {
  await page.getByRole('button', { name: 'Add transaction' }).last().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Amount').fill(amount)
  await dialog.getByLabel('Date').fill(date)
  await dialog.getByLabel('Payee').fill(payee)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(toast(page, 'Transaction added')).toBeVisible()
}

const panel = () => page.getByRole('region', { name: 'HDFC Card billing cycle' })

test('US10: a card cycle shows the statement, what is due and when, and feeds the Overview and forecast', async () => {
  await onboard(page, 'HDFC Savings', '50,000', addMonths(startOfMonth(today), -2))

  // A credit card with a billing cycle; the cycle fields only appear for credit cards.
  await page.keyboard.press('Control+3')
  await page.getByRole('button', { name: 'New account' }).click()
  await page.getByLabel('Name').fill('HDFC Card')
  await expect(page.getByLabel('Statement day')).toHaveCount(0)
  await page.getByLabel('Type').click()
  await page.getByRole('option', { name: 'Credit card' }).click()
  await page.getByLabel('Start date', { exact: true }).fill(addMonths(startOfMonth(today), -2))
  await page.getByLabel('Statement day').fill(String(Number(statement.slice(8))))
  await page.getByRole('button', { name: 'Add account' }).click()
  await expect(
    page.getByText('Enter both the statement day and the days until due, or neither'),
  ).toBeVisible()
  await page.getByLabel('Days until payment is due').fill('10')
  await page.getByRole('button', { name: 'Add account' }).click()
  await expect(toast(page, 'Added HDFC Card')).toBeVisible()

  // Spending before and after the statement
  await page.getByRole('button', { name: 'Actions for HDFC Card' }).click()
  await page.getByRole('menuitem', { name: 'View transactions' }).click()
  await addCardExpense('2000', 'Croma', addDays(statement, -3))
  await addCardExpense('500', 'Cafe Coffee Day', addDays(today, -1))

  await page.keyboard.press('Control+3')
  await expect(panel()).toContainText(`₹2,000.00 due on ${short(due)} (in 5 days)`)
  await expect(panel()).toContainText(`Statement ${short(statement)}`)
  await expect(panel().getByRole('link', { name: '₹500.00' })).toBeVisible()

  // The Overview names the next bill; the forecast counts it.
  await page.keyboard.press('Control+1')
  await expect(page.getByText(`₹2,000.00 due on ${formatDate(due)}`)).toBeVisible()
  await page.keyboard.press('Control+9')
  const assumptions = page.getByRole('region', { name: 'Assumptions' })
  await expect(assumptions.getByText('HDFC Card bill (estimated from statement)')).toBeVisible()

  // A part payment leaves the rest due; paying it all marks the statement paid.
  for (const amount of ['1200', '800']) {
    await page.keyboard.press('Control+t')
    await page.getByLabel('Amount').fill(amount)
    await page.getByLabel('To account').click()
    await page.getByRole('option', { name: /^HDFC Card/ }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(toast(page, 'Transfer added')).toBeVisible()
    if (amount === '1200') {
      await page.keyboard.press('Control+3')
      await expect(panel()).toContainText(`₹800.00 due on ${short(due)}`)
    }
  }
  await page.keyboard.press('Control+3')
  await expect(panel()).toContainText('Last statement paid')
  await page.keyboard.press('Control+1')
  await expect(page.getByText(/Latest bills paid/)).toBeVisible()

  // Clicking "spent since" opens exactly the transactions behind it.
  await page.keyboard.press('Control+3')
  await panel().getByRole('link', { name: '₹500.00' }).click()
  await expect(page.getByRole('row').filter({ hasText: 'Cafe Coffee Day' })).toHaveCount(1)
  await expect(page.getByRole('row').filter({ hasText: 'Croma' })).toHaveCount(0)

  expect(externalRequests(fin.requests)).toEqual([])
})
