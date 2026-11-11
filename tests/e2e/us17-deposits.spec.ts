import { expect, test, type Page } from '@playwright/test'
import { addDays, addMonths, todayIn } from '../../src/domain/dates'
import { externalRequests, launchFin, onboard, toast, type FinApp } from './app'

let fin: FinApp
let page: Page
test.beforeAll(async () => {
  fin = await launchFin()
  page = fin.page
})
test.afterAll(async () => fin?.close())

const today = todayIn('Asia/Kolkata')
// A one-year FD that matures in 20 days, so its maturity is in the 30-day forecast.
const maturity = addDays(today, 20)
const start = addMonths(maturity, -12)

test('US17: a fixed deposit is valued from its rate, counted in net worth and matures into the forecast', async () => {
  await onboard(page, 'HDFC Savings', '50,000', start)

  await page.keyboard.press('Control+3')
  await page.getByRole('button', { name: 'New account' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill('SBI FD')
  await dialog.getByLabel('Type').click()
  await page.getByRole('option', { name: 'Investment' }).click()
  await dialog.getByLabel('Balance on start date').fill('1,00,000')
  await dialog.getByLabel('Start date', { exact: true }).fill(start)
  await dialog.getByLabel('Kind').click()
  await page.getByRole('option', { name: 'Recurring deposit (RD)' }).click()
  await dialog.getByLabel('Interest rate (% a year)').fill('7')
  await dialog.getByLabel('Maturity date').fill(maturity)
  await dialog.getByRole('button', { name: 'Add account' }).click()
  await expect(dialog.getByText('Enter the monthly instalment')).toBeVisible()
  await dialog.getByLabel('Kind').click()
  await page.getByRole('option', { name: 'Fixed deposit (FD)' }).click()
  await dialog.getByLabel('Paid out to').click()
  await page.getByRole('option', { name: /^HDFC Savings/ }).click()
  await dialog.getByRole('button', { name: 'Add account' }).click()
  await expect(toast(page, 'Added SBI FD')).toBeVisible()

  const panel = page.getByRole('region', { name: 'SBI FD deposit' })
  await expect(panel).toContainText('Fixed deposit · 7%')
  await expect(panel).toContainText('At maturity₹1,07,185.91')
  await expect(panel).toContainText('Paid out toHDFC Savings')

  // Net worth uses the value worked out from the rate.
  await page.keyboard.press('Control+0')
  await expect(page.getByRole('listitem', { name: 'SBI FD' })).toContainText(
    'worked out from the deposit’s rate',
  )

  // The maturity is money in on its date.
  await page.keyboard.press('Control+9')
  const assumptions = page.getByRole('region', { name: 'Assumptions' })
  await expect(assumptions).toContainText('Deposits maturing')
  await expect(assumptions.getByRole('listitem').filter({ hasText: 'SBI FD matures' })).toContainText(
    '₹1,07,185.91',
  )

  expect(externalRequests(fin.requests)).toEqual([])
})
