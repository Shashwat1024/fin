import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { externalRequests, launchFin, onboard, toast, type FinApp } from './app'

let fin: FinApp
let page: Page
test.beforeAll(async () => {
  fin = await launchFin()
  page = fin.page
})
test.afterAll(async () => fin?.close())

async function addExpense(amount: string, payee: string, category: string) {
  await page.keyboard.press('Control+n')
  await page.getByLabel('Amount', { exact: true }).fill(amount)
  await page.getByLabel('Payee').fill(payee)
  await page.getByRole('combobox', { name: 'Category' }).click()
  await page.getByPlaceholder('Search categories…').fill(category)
  await page.keyboard.press('Enter')
  await page.getByLabel('Payee').press('Control+Enter')
  await expect(toast(page, 'Transaction added')).toBeVisible()
}

async function count(section: ReturnType<Page['getByRole']>, code: string, category: string) {
  await section.getByRole('combobox', { name: 'Category' }).click()
  await page.getByPlaceholder('Search categories…').fill(category)
  await page.keyboard.press('Enter')
  await section.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(toast(page, `Counted under ${code}`)).toBeVisible()
}

test('US19: categories counted under a section, limits, removing, and the export for a CA', async () => {
  await onboard(page, 'HDFC Savings', '5,00,000')
  await addExpense('120000', 'DPS school fees', 'Fees')
  await addExpense('50000', 'LIC premium', 'Insurance')

  await page.keyboard.press('Control+k')
  await page.getByPlaceholder('Type a command or search…').fill('Tax deductions')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: /^Tax: FY \d{4}-\d{2} · AY/ })).toBeVisible()
  await expect(page.getByText('Old tax regime deductions')).toBeVisible()

  const s80c = page.getByRole('region', { name: 'Section 80C', exact: true })
  await count(s80c, '80C', 'Fees')
  await count(s80c, '80C', 'Insurance')
  const total = s80c.getByTestId('tax-total-80C')
  await expect(total).toContainText('₹1,50,000.00 of ₹1,50,000.00 · ₹1,70,000.00 in all')

  // The limit can be changed.
  await s80c.getByRole('button', { name: 'Edit the 80C limit' }).click()
  await page.getByLabel('Limit for the year').fill('2,00,000')
  await page.getByRole('button', { name: 'Save limit' }).click()
  await expect(total).toContainText('₹1,70,000.00 of ₹2,00,000.00')

  // Each line opens its transactions; removing one updates the total.
  await s80c.getByRole('link', { name: 'Education › Fees' }).click()
  await expect(page.getByRole('row').filter({ hasText: 'DPS school fees' })).toHaveCount(1)
  await page.goBack()
  await s80c.getByRole('button', { name: 'Stop counting Bills › Insurance under 80C' }).click()
  await expect(total).toContainText('₹1,20,000.00 of ₹2,00,000.00')

  // Export for a chartered accountant.
  const file = join(fin.dataDir, 'tax.csv')
  await fin.answerDialogs(file)
  await page.getByRole('button', { name: 'Export for my CA' }).click()
  await expect(toast(page, 'Saved')).toBeVisible()
  const csv = readFileSync(file, 'utf8')
  expect(csv).toContain('80C,120000.00,200000.00,120000.00')
  expect(csv).toContain('DPS school fees,120000.00')

  expect(externalRequests(fin.requests)).toEqual([])
})
