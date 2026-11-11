import { expect, test, type Page } from '@playwright/test'
import { addMonths, formatDate, startOfMonth, todayIn } from '../../src/domain/dates'
import { externalRequests, launchFin, onboard, toast, type FinApp } from './app'

let fin: FinApp
let page: Page
test.beforeAll(async () => {
  fin = await launchFin()
  page = fin.page
})
test.afterAll(async () => fin?.close())

const today = todayIn('Asia/Kolkata')
// Three EMIs before today; the fourth is due today.
const firstEmi = addMonths(today, -3)

test('US16: loan terms give the EMI split and schedule, and What if shows a prepayment both ways', async () => {
  await onboard(page, 'HDFC Savings', '5,00,000', addMonths(startOfMonth(today), -6))

  await page.keyboard.press('Control+3')
  await page.getByRole('button', { name: 'New account' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill('Car loan')
  await dialog.getByLabel('Type').click()
  await page.getByRole('option', { name: 'Loan', exact: true }).click()
  await dialog.getByLabel('Amount owed on start date').fill('10,00,000')
  await dialog.getByLabel('Interest rate (% a year)').fill('9')
  await dialog.getByRole('button', { name: 'Add account' }).click()
  await expect(dialog.getByText('Enter all four loan terms, or none')).toBeVisible()
  await dialog.getByLabel('Amount borrowed').fill('10,00,000')
  await dialog.getByLabel('Tenure (months)').fill('60')
  await dialog.getByLabel('First EMI date').fill(firstEmi)
  await dialog.getByRole('button', { name: 'Add account' }).click()
  await expect(toast(page, 'Added Car loan')).toBeVisible()

  const panel = page.getByRole('region', { name: 'Car loan schedule' })
  await expect(panel).toContainText('EMI ₹20,758.00 · 9%')
  await expect(panel).toContainText('EMIs paid3 of 60')
  await expect(panel).toContainText(`Next on ${formatDate(today)}`)

  await panel.getByRole('button', { name: 'Full schedule' }).click()
  const schedule = page.getByRole('dialog', { name: 'Car loan: schedule' })
  const first = schedule.getByRole('row').nth(1)
  await expect(first).toContainText('₹7,500.00')
  await expect(first).toContainText('₹13,258.00')
  await expect(schedule.getByRole('row')).toHaveCount(61)
  await page.keyboard.press('Escape')

  // What if: ₹2,00,000 prepaid today, both outcomes.
  await page.evaluate('location.hash = "/insights?tab=what-if"')
  const form = page.getByRole('form', { name: 'Add a change' })
  await form.getByLabel('Change').click()
  await page.getByRole('option', { name: 'Loan prepayment' }).click()
  await form.getByLabel('Loan').click()
  await page.getByRole('option', { name: 'Car loan' }).click()
  await form.getByLabel('Amount').fill('2,00,000')
  await form.getByRole('button', { name: 'Add to scenario' }).click()
  const outcome = page.getByTestId('prepayment')
  await expect(outcome).toContainText('Same EMI: ends')
  await expect(outcome).toContainText('instead of ₹20,758.00')

  expect(externalRequests(fin.requests)).toEqual([])
})
