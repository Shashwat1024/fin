import { expect, test, type Page } from '@playwright/test'
import { addMonths, formatDate, monthKey, startOfMonth, todayIn } from '../../src/domain/dates'
import { externalRequests, launchFin, onboard, toast, type FinApp } from './app'

let fin: FinApp
let page: Page
test.beforeAll(async () => {
  fin = await launchFin()
  page = fin.page
})
test.afterAll(async () => fin?.close())

const today = todayIn('Asia/Kolkata')
// Due on the 15th four months from now: this month and the four after it = five months to set aside.
const due = `${monthKey(addMonths(startOfMonth(today), 4))}-15`

test('US18: a yearly bill set aside monthly is suggested in its budget category, assigned on request', async () => {
  await onboard(page, 'HDFC Savings', '50,000', addMonths(startOfMonth(today), -2))

  await page.keyboard.press('Control+5')
  await page.getByRole('button', { name: 'New recurring item' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New recurring item' })
  await dialog.getByLabel('Name').fill('Car insurance')
  await dialog.getByLabel('Expected amount').fill('21000')
  await dialog.getByLabel('Paid from').click()
  await page.getByRole('option', { name: /^HDFC Savings/ }).click()
  await dialog.getByRole('combobox', { name: 'Category' }).click()
  await page.getByPlaceholder('Search categories…').fill('Insurance')
  await page.keyboard.press('Enter')
  // Only bills that come round every three months or more can be set aside.
  await expect(dialog.getByLabel(/Set aside monthly/)).toHaveCount(0)
  await dialog.getByLabel('Unit').click()
  await page.getByRole('option', { name: 'year' }).click()
  await dialog.getByLabel('First date').fill(due)
  await dialog.getByLabel(/Set aside monthly/).click()
  await dialog.getByRole('button', { name: 'Add recurring item' }).click()
  await expect(toast(page, 'Added Car insurance')).toBeVisible()

  await page.keyboard.press('Control+6')
  const hint = page.getByTestId('set-aside')
  await expect(hint).toContainText(`Suggested ₹4,200.00 for Car insurance, due ${formatDate(due)}`)
  await hint.getByRole('button', { name: 'Assign' }).click()
  await expect(toast(page, 'Assigned to Insurance')).toBeVisible()
  await expect(hint.getByRole('button', { name: 'Assign' })).toHaveCount(0)

  expect(externalRequests(fin.requests)).toEqual([])
})
