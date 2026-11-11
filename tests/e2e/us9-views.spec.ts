import { expect, test, type Page } from '@playwright/test'
import { externalRequests, launchFin, onboard, toast, type FinApp } from './app'

let fin: FinApp
let page: Page
test.beforeAll(async () => {
  fin = await launchFin()
  page = fin.page
})
test.afterAll(async () => fin?.close())

async function addExpense(amount: string, payee: string) {
  await page.keyboard.press('Control+n')
  await page.getByLabel('Amount').fill(amount)
  await page.getByLabel('Payee').fill(payee)
  await page.getByLabel('Payee').press('Control+Enter')
  await expect(toast(page, 'Transaction added')).toBeVisible()
}

const sidebarViews = () => page.getByRole('navigation', { name: 'Saved views' })
const search = () => page.getByLabel('Search transactions')
const rows = () => page.getByRole('row')

async function openPaletteItem(name: string) {
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder('Type a command or search…').fill(name)
  await page.keyboard.press('Enter')
}

test('US9: save a filtered view, open it from the sidebar and palette, edit, unpin and delete with undo', async () => {
  await onboard(page, 'HDFC Savings', '50,000')
  await addExpense('450', 'Swiggy order')
  await addExpense('210', 'Zomato order')
  await addExpense('300', 'Uber trip')

  // Filter and save
  await page.keyboard.press('Control+2')
  await search().fill('swiggy')
  await expect(rows().filter({ hasText: 'Zomato' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Save view' }).click()
  const dialog = page.getByRole('dialog', { name: 'Save view' })
  await expect(dialog.getByLabel('Show in the sidebar')).toBeChecked()
  await dialog.getByLabel('Name').fill('Food delivery')
  await dialog.getByRole('button', { name: 'Save view' }).click()
  await expect(toast(page, 'Saved view Food delivery')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Food delivery' })).toBeVisible()
  // Nothing new to save while the filters match the view
  await expect(page.getByRole('button', { name: 'Save view' })).toHaveCount(0)

  // Open it from the sidebar on another page
  await page.keyboard.press('Control+1')
  await sidebarViews().getByRole('link', { name: 'Food delivery' }).click()
  await expect(page.getByRole('heading', { name: 'Food delivery' })).toBeVisible()
  await expect(search()).toHaveValue('swiggy')
  await expect(rows().filter({ hasText: 'Swiggy order' })).toHaveCount(1)
  await expect(rows().filter({ hasText: 'Uber' })).toHaveCount(0)
  await expect(sidebarViews().getByRole('link', { name: 'Food delivery' })).toHaveAttribute(
    'aria-current',
    'page',
  )

  // Replace its filters with the current ones
  await search().fill('zomato')
  await expect(rows().filter({ hasText: 'Zomato order' })).toHaveCount(1)
  await page.getByRole('button', { name: 'View options' }).click()
  await page.getByRole('menuitem', { name: 'Save current filters to this view' }).click()
  await expect(toast(page, 'Saved the current filters to Food delivery')).toBeVisible()
  await page.keyboard.press('Control+1')
  await openPaletteItem('Food delivery')
  await expect(search()).toHaveValue('zomato')

  // Rename, then remove from the sidebar (still in the palette)
  await page.getByRole('button', { name: 'View options' }).click()
  await page.getByRole('menuitem', { name: 'Rename…' }).click()
  await page.getByRole('dialog', { name: 'Rename view' }).getByLabel('Name').fill('Takeaway')
  await page.getByRole('button', { name: 'Rename', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Takeaway' })).toBeVisible()
  await expect(sidebarViews().getByRole('link', { name: 'Takeaway' })).toBeVisible()
  await page.getByRole('button', { name: 'View options' }).click()
  await page.getByRole('menuitem', { name: 'Remove from sidebar' }).click()
  await expect(toast(page, 'Removed Takeaway from the sidebar')).toBeVisible()
  await expect(sidebarViews()).toHaveCount(0)

  // Delete keeps the filters on screen, and Undo brings the view back
  await page.getByRole('button', { name: 'View options' }).click()
  await page.getByRole('menuitem', { name: 'Delete view' }).click()
  const deleted = toast(page, 'Deleted view Takeaway')
  await expect(deleted).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible()
  await expect(search()).toHaveValue('zomato')
  await deleted.getByRole('button', { name: 'Undo' }).click()
  await expect(toast(page, 'Undone')).toBeVisible()
  await openPaletteItem('Takeaway')
  await expect(page.getByRole('heading', { name: 'Takeaway' })).toBeVisible()

  expect(externalRequests(fin.requests)).toEqual([])
})
