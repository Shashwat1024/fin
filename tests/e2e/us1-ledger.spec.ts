import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

let app: ElectronApplication
let page: Page
let dataDir: string
const requests: string[] = []

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'fin-e2e-'))
  // Editors built on Electron (e.g. VS Code) set this for child processes; it would start Electron as plain Node.
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env
  app = await electron.launch({ args: ['.'], env: { ...env, FIN_DATA_DIR: dataDir } as Record<string, string> })
  page = await app.firstWindow()
  page.on('request', (r) => requests.push(r.url()))
})

test.afterAll(async () => {
  await app?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

/** The newest toast containing `text` (older toasts may still be on screen). */
const toast = (text: string) => page.locator('[data-sonner-toast]', { hasText: text }).last()

async function pickCategory(index: number, name: string) {
  await page.getByRole('combobox', { name: 'Category' }).nth(index).click()
  await page.getByPlaceholder('Search categories…').fill(name)
  await page.keyboard.press('Enter')
}

test('US1: onboarding, accounts, quick-add, split, transfer, delete and undo', async () => {
  // Onboarding
  await expect(page.getByText('Welcome to Fin')).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Name').fill('HDFC Savings')
  await page.getByLabel('Balance on start date').fill('50,000')
  await page.getByRole('button', { name: 'Add account and finish' }).click()
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Cash position/ })).toContainText('₹50,000.00')

  // Second account via the accounts page
  await page.keyboard.press('Control+3')
  await page.getByRole('button', { name: 'New account' }).click()
  await page.getByLabel('Name').fill('Cash')
  await page.getByLabel('Type').click()
  await page.getByRole('option', { name: 'Cash' }).click()
  await page.getByLabel('Balance on start date').fill('2000')
  await page.getByRole('button', { name: 'Add account' }).click()
  await expect(toast('Added Cash')).toBeVisible()

  // Keyboard quick-add expense (defaults to the first account)
  await page.keyboard.press('Control+n')
  await page.getByLabel('Amount').fill('450')
  await page.getByLabel('Payee').fill('Cafe Coffee Day')
  await page.getByLabel('Payee').press('Control+Enter')
  await expect(toast('Transaction added')).toBeVisible()

  // Split that does not add up is blocked, then fixed
  await page.keyboard.press('Control+n')
  await page.getByLabel('Amount').fill('2400')
  await page.getByLabel('Payee').fill('DMart')
  await page.getByRole('button', { name: 'Split' }).click()
  await pickCategory(0, 'Groceries')
  await page.getByLabel('Part 1 amount').fill('1500')
  await pickCategory(1, 'Household')
  await page.getByLabel('Part 2 amount').fill('800')
  await expect(page.getByText(/Remaining ₹100\.00/)).toBeVisible()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Parts must add up to the total')).toBeVisible()
  await page.getByLabel('Part 2 amount').fill('900')
  await expect(page.getByText('Fully allocated')).toBeVisible()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(toast('Transaction added')).toBeVisible()

  // Transfer HDFC → Cash
  await page.keyboard.press('Control+t')
  await page.getByLabel('Amount').fill('10000')
  await page.getByLabel('To account').click()
  await page.getByRole('option', { name: /^Cash/ }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(toast('Transfer added')).toBeVisible()

  // Balances: HDFC 50,000 − 450 − 2,400 − 10,000 = 37,150; Cash 2,000 + 10,000 = 12,000
  await page.keyboard.press('Control+3')
  await expect(page.getByRole('button', { name: /₹37,150\.00/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /₹12,000\.00/ })).toBeVisible()

  // Search, then delete and undo from the toast
  await page.keyboard.press('Control+2')
  await page.getByLabel('Search transactions').fill('cafe')
  const row = page.getByRole('row', { name: /Cafe Coffee Day/ })
  await expect(row).toHaveCount(1)
  await row.click()
  await page.getByRole('button', { name: 'Delete' }).click()
  await toast('Transaction deleted').getByRole('button', { name: 'Undo' }).click()
  await expect(toast('Undone')).toBeVisible()
  await expect(page.getByRole('row', { name: /Cafe Coffee Day/ })).toHaveCount(1)

  await page.keyboard.press('Control+3')
  await expect(page.getByRole('button', { name: /₹37,150\.00/ })).toBeVisible()
})

test('offline: the app makes no network requests', async () => {
  const external = requests.filter((u) => !u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('devtools:'))
  expect(external).toEqual([])
})
