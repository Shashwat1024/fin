import { expect, test, type Page } from '@playwright/test'
import { externalRequests, launchFin, toast, type FinApp } from './app'

let fin: FinApp
let page: Page
test.beforeAll(async () => {
  fin = await launchFin()
  page = fin.page
  await expect(page.getByText('Welcome to Fin')).toBeVisible()
  await page.getByRole('button', { name: 'Explore with demo data first' }).click()
  await expect(page.getByText('Demo Savings Bank').first()).toBeVisible()
})
test.afterAll(async () => fin?.close())

async function palette(p: Page, command: string) {
  await p.keyboard.press('Control+k')
  await p.getByPlaceholder('Type a command or search…').fill(command)
  await p.keyboard.press('Enter')
}

test('US8: insights cite their basis and transactions, and can be dismissed and brought back', async () => {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Insights' }).click()
  await expect(page.getByRole('heading', { name: 'Insights', level: 1 })).toBeVisible()
  await expect(page.getByTestId('insights-as-of')).toContainText('Based on your transactions up to')

  const spotify = page.getByRole('article', { name: 'Spotify now costs ₹139' })
  await expect(spotify).toContainText('Up 17% from ₹119')
  await expect(spotify.getByRole('region', { name: 'Transactions behind this' })).toContainText('₹139.00')
  const clothing = page.getByRole('article', { name: /^Shopping › Clothing up \d+% in / })
  await expect(clothing).toContainText('Compared with:')
  await expect(page.getByRole('article', { name: /^Weekends cost about/ })).toBeVisible()

  // Dismiss, undo, dismiss again, then bring it back from the dismissed list
  await spotify.getByRole('button', { name: 'Dismiss: Spotify now costs ₹139' }).click()
  await expect(spotify).toBeHidden()
  await toast(page, 'Insight dismissed').getByRole('button', { name: 'Undo' }).click()
  await expect(spotify).toBeVisible()
  await spotify.getByRole('button', { name: /^Dismiss/ }).click()
  await expect(spotify).toBeHidden()
  await page.getByLabel(/Show dismissed \(1\)/).click()
  await expect(spotify).toContainText('Dismissed')
  await spotify.getByRole('button', { name: /^Show again/ }).click()
  await expect(toast(page, 'Insight shown again')).toBeVisible()
  await expect(spotify).not.toContainText('Dismissed')

  // Every insight drills down to its transactions
  await clothing.getByRole('link', { name: /See all|Open in Transactions/ }).click()
  await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: 'Myntra' }).first()).toBeVisible()
  expect(externalRequests(fin.requests)).toEqual([])
})

test('US8: a what-if scenario shows its effect on the forecast and goals without changing data', async () => {
  await palette(page, 'What if')
  await expect(page.getByRole('tab', { name: 'What if', selected: true })).toBeVisible()
  const result = page.getByRole('region', { name: 'Scenario result' })
  await expect(result.getByText('Lowest balance')).toBeVisible()
  await expect(result).toContainText('No change from the forecast')

  // A large purchase
  const form = page.getByRole('form', { name: 'Add a change' })
  await form.getByLabel('Name').fill('New laptop')
  await form.getByLabel('Amount').fill('1,50,000')
  await form.getByRole('button', { name: 'Add to scenario' }).click()
  await expect(page.getByRole('region', { name: 'Changes in this scenario' })).toContainText(
    'New laptop: ₹1,50,000.00',
  )
  await expect(result).toContainText('₹1,50,000.00 lower than the')

  // Saving more for a goal brings its date forward
  await form.getByLabel('Change').click()
  await page.getByRole('option', { name: 'Save more each month' }).click()
  await form.getByLabel('Towards').click()
  await page.getByRole('option', { name: 'Emergency fund' }).click()
  await form.getByLabel('Amount a month').fill('10000')
  await form.getByRole('button', { name: 'Add to scenario' }).click()
  const goalRow = result.getByRole('row').filter({ hasText: 'Emergency fund' })
  await expect(goalRow.getByRole('cell').nth(2)).toContainText('a month')
  // The scenario reruns after the change is added; wait for the "after" column to move.
  await expect
    .poll(
      async () =>
        (await goalRow.getByRole('cell').nth(1).textContent()) !==
        (await goalRow.getByRole('cell').nth(2).textContent()),
    )
    .toBe(true)
  await expect(page.getByRole('region', { name: 'How this was worked out' })).toContainText(
    'Save for Emergency fund',
  )

  // Nothing was stored: the real forecast and goals are as they were
  await page.keyboard.press('Control+7')
  await expect(page.getByRole('heading', { name: 'Goals' })).toBeVisible()
  await expect(page.getByText('New laptop')).toHaveCount(0)
  await page.keyboard.press('Control+9')
  await expect(page.getByRole('region', { name: 'Assumptions' })).not.toContainText('New laptop')
  expect(externalRequests(fin.requests)).toEqual([])
})

test('FR-022: a payment that looks recurring can be set up in one step', async () => {
  await page.keyboard.press('Control+5')
  const suggestions = page.getByRole('region', { name: 'Looks recurring' })
  const help = suggestions.getByRole('listitem', { name: 'Domestic help' })
  await expect(help).toContainText('Every month')
  await help.getByRole('button', { name: 'Set up Domestic help as recurring' }).click()
  const dialog = page.getByRole('dialog', { name: 'New recurring item' })
  await expect(dialog.getByLabel('Name')).toHaveValue('Domestic help')
  await expect(dialog.getByLabel('Expected amount')).toHaveValue('3500.00')
  await dialog.getByRole('button', { name: 'Add recurring item' }).click()
  await expect(toast(page, 'Added Domestic help')).toBeVisible()
  await expect(suggestions.getByRole('listitem', { name: 'Domestic help' })).toHaveCount(0)
  await expect(page.getByRole('row').filter({ hasText: 'Domestic help' })).toBeVisible()
})
