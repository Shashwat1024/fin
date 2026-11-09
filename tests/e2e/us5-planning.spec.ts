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

async function pickCategory(name: string) {
  await page.getByRole('combobox', { name: 'Category' }).click()
  await page.getByPlaceholder('Search categories…').fill(name)
  await page.keyboard.press('Enter')
}

async function addTxn(shortcut: string, amount: string, payee: string, category: string) {
  await page.keyboard.press(shortcut)
  await page.getByLabel('Amount').fill(amount)
  await page.getByLabel('Payee').fill(payee)
  await pickCategory(category)
  await page.getByLabel('Payee').press('Control+Enter')
  await expect(toast(page, 'Transaction added')).toBeVisible()
}

async function addRecurring(name: string, amount: string, firstDate: string) {
  await page.getByRole('button', { name: 'New recurring item' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New recurring item' })
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('Expected amount').fill(amount)
  await dialog.getByLabel('Paid from').click()
  await page.getByRole('option', { name: /^HDFC Savings/ }).click()
  await dialog.getByLabel('First date').fill(firstDate)
  await dialog.getByRole('button', { name: 'Add recurring item' }).click()
  await expect(toast(page, `Added ${name}`)).toBeVisible()
}

const occurrence = (name: string) => page.getByRole('listitem').filter({ hasText: name })

test('US5: recurring items match payments, the budget reaches ₹0, and goals project', async () => {
  await onboard(page, 'HDFC Savings', '50,000', addMonths(today, -2))

  // Recurring: due today, due yesterday (not paid), and due in 5 days
  await page.keyboard.press('Control+5')
  await expect(page.getByText('Nothing recurring yet')).toBeVisible()
  await addRecurring('Rent', '18000', today)
  await addRecurring('Netflix', '649', addDays(today, -1))
  await addRecurring('Airtel fibre', '999', addDays(today, 5))
  await expect(occurrence('Rent').getByText('Expected')).toBeVisible()

  // The missed one is flagged; skipping it clears the flag
  const attention = page.getByRole('region', { name: 'Needs a look' })
  await expect(attention.getByText('Overdue')).toBeVisible()
  await attention.getByRole('button', { name: /^Actions for Netflix/ }).click()
  await page.getByRole('menuitem', { name: 'Skip this one' }).click()
  await expect(attention).toHaveCount(0)

  // Paying the rent marks it paid automatically
  await addTxn('Control+i', '95000', 'ACME Payroll', 'Salary')
  await addTxn('Control+n', '18000', 'Rent', 'Rent')
  await expect(occurrence('Rent').getByText('Paid')).toBeVisible()
  await expect(page.getByTestId('pending-summary')).toContainText('₹999.00 going out')

  // The overview's 14-day commitments equal the Recurring page's "Next 14 days"
  await page.keyboard.press('Control+1')
  const due = page.getByRole('link', { name: /^Due in the next 14 days/ })
  await expect(due.locator('[data-slot="card-title"]')).toHaveText('₹999.00')

  // Budget: give every rupee a job, with keyboard entry
  await page.keyboard.press('Control+6')
  await expect(page.getByTestId('to-assign')).toHaveText('₹95,000.00')
  const rent = page.getByLabel('Assigned to Rent')
  await rent.fill('18000')
  await rent.press('Enter')
  await expect(page.getByTestId('to-assign')).toHaveText('₹77,000.00')
  await expect(page.getByLabel('Assigned to Maintenance')).toBeFocused()
  await page.getByLabel('Assigned to Emergency fund').fill('77000')
  await page.getByLabel('Assigned to Emergency fund').press('Enter')
  await expect(page.getByTestId('to-assign')).toHaveText('₹0.00')
  await expect(page.getByText('Every rupee has a job.')).toBeVisible()

  // Overspend groceries; next month's To assign is reduced by exactly that amount
  await addTxn('Control+n', '2000', 'DMart', 'Groceries')
  const groceries = page.getByRole('row', { name: /^Groceries/ })
  await expect(groceries).toContainText('Overspent by')
  await expect(groceries).toContainText('-₹2,000.00')
  await page.keyboard.press('Alt+ArrowRight')
  await expect(page.getByTestId('to-assign')).toHaveText('-₹2,000.00')
  await expect(page.getByText('Overspent last month')).toBeVisible()
  await expect(page.getByRole('row', { name: /^Emergency fund/ })).toContainText('₹77,000.00 from last month')

  // Spent drills to the same total on the ledger
  await page.keyboard.press('Alt+ArrowLeft')
  await page.getByRole('link', { name: 'Spent on Rent: view transactions' }).click()
  await expect(page.getByRole('heading', { name: 'Transactions' }).locator('..')).toContainText('Out ₹18,000.00')

  // Goals: progress, monthly amount needed and projection
  await page.keyboard.press('Control+7')
  await page.getByRole('button', { name: 'New goal' }).first().click()
  const goalDialog = page.getByRole('dialog', { name: 'New goal' })
  await goalDialog.getByLabel('Name').fill('Emergency fund')
  await goalDialog.getByLabel('Target amount').fill('300000')
  await goalDialog.getByLabel('Target date (optional)').fill(addMonths(today, 12))
  await goalDialog.getByRole('button', { name: 'Add goal' }).click()
  await expect(toast(page, 'Added goal Emergency fund')).toBeVisible()
  const goal = page.getByRole('region', { name: 'Emergency fund' })
  await expect(goal.getByTestId('goal-status')).toHaveText(/₹25,000\.00 a month reaches it by/)
  await goal.getByRole('button', { name: 'Add money' }).click()
  await page.getByLabel('Amount').fill('60000')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(toast(page, 'Emergency fund: 20% saved')).toBeVisible()
  await expect(goal.getByRole('progressbar', { name: 'Emergency fund: 20% of target saved' })).toBeVisible()
  await expect(goal.getByTestId('goal-status')).toHaveText(/^On track/)

  await page.keyboard.press('Control+1')
  await expect(page.getByRole('progressbar', { name: 'Emergency fund: 20% of target saved' })).toBeVisible()
})

test('offline throughout planning', async () => {
  expect(externalRequests(fin.requests)).toEqual([])
})
