import { expect, test, type Page } from '@playwright/test'
import { addMonths, monthKey, startOfMonth, todayIn } from '../../src/domain/dates'
import { externalRequests, launchFin, onboard, toast, type FinApp } from './app'

const thisMonth = startOfMonth(todayIn('Asia/Kolkata'))
const last = addMonths(thisMonth, -1).slice(0, 7)
const lastName = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
  new Date(`${last}-01T00:00:00Z`),
)

let fin: FinApp
let page: Page
test.beforeAll(async () => {
  // The review prompt shows in the first week of a month: Fin's clock is set to the 3rd.
  fin = await launchFin(undefined, { env: { FIN_FAKE_NOW: `${monthKey(thisMonth)}-03T06:00:00Z` } })
  page = fin.page
})
test.afterAll(async () => fin?.close())

async function add(amount: string, payee: string, date: string, category?: string) {
  await page.keyboard.press('Control+n')
  await page.getByLabel('Amount', { exact: true }).fill(amount)
  await page.getByLabel('Date').fill(date)
  await page.getByLabel('Payee').fill(payee)
  if (category) {
    await page.getByRole('combobox', { name: 'Category' }).click()
    await page.getByPlaceholder('Search categories…').fill(category)
    await page.keyboard.press('Enter')
  }
  await page.getByLabel('Payee').press('Control+Enter')
  await expect(toast(page, 'Transaction added')).toBeVisible()
}

const step = (name: string) => page.getByRole('region', { name })

test('US14: the Overview offers last month’s review, five skippable steps, and marking it reviewed', async () => {
  await onboard(page, 'HDFC Savings', '50,000', addMonths(thisMonth, -2))
  await add('500', 'Corner shop', `${last}-03`)
  await add('3000', 'DMart', `${last}-04`, 'Groceries')

  await page.keyboard.press('Control+1')
  const prompt = page.getByRole('region', { name: 'Monthly review' })
  await expect(prompt.getByText(`Review ${lastName}`)).toBeVisible()
  await prompt.getByRole('link', { name: 'Start the review' }).click()
  await expect(page.getByRole('heading', { name: `Review ${lastName}` })).toBeVisible()

  // 1. Categorise: one without a category, opened on the ledger.
  await expect(step('Categorise')).toContainText(`1 transaction in ${lastName} has no category.`)
  await step('Categorise').getByRole('link', { name: 'Open them' }).click()
  await expect(page.getByRole('row').filter({ hasText: 'Corner shop' })).toHaveCount(1)
  await expect(page.getByRole('row').filter({ hasText: 'DMart' })).toHaveCount(0)
  await page.goBack()

  // 2–5, each skippable.
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(step('Check accounts')).toContainText('HDFC Savings')
  await expect(step('Check accounts').getByRole('button', { name: 'Check against statement' })).toBeVisible()
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(step('Budget')).toContainText('Food › Groceries')
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(step('Insights')).toBeVisible()
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(step('Next month')).toContainText('Only categories with nothing assigned yet are filled.')

  await page.getByRole('button', { name: `Mark ${lastName} as reviewed` }).click()
  await expect(toast(page, `Marked ${lastName} as reviewed`)).toBeVisible()
  await expect(page.getByText('Reviewed', { exact: true })).toBeVisible()
  await page.keyboard.press('Control+1')
  await expect(page.getByRole('region', { name: 'Monthly review' })).toHaveCount(0)

  // Reopening brings the prompt back; "Not this month" puts it away.
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder('Type a command or search…').fill('Review last month')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Reopen' }).click()
  await expect(toast(page, `Reopened ${lastName}`)).toBeVisible()
  await page.keyboard.press('Control+1')
  await page
    .getByRole('region', { name: 'Monthly review' })
    .getByRole('button', { name: 'Not this month' })
    .click()
  await expect(page.getByRole('region', { name: 'Monthly review' })).toHaveCount(0)

  expect(externalRequests(fin.requests)).toEqual([])
})
