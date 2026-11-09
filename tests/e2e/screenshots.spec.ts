import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

// Visual review aid: SCREENSHOTS=1 npx playwright test screenshots
test.skip(!process.env.SCREENSHOTS, 'Set SCREENSHOTS=1 to capture screenshots')

test('capture main screens', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'fin-shots-'))
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env
  const app = await electron.launch({ args: ['.'], env: { ...env, FIN_DATA_DIR: dataDir } as Record<string, string> })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1320, height: 860 })
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack?.split('\n').slice(0, 4).join(' | ')))
  page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text().slice(0, 400)))
  const out = (name: string) => join('test-results', 'screens', `${name}.png`)
  const toast = (t: string) => page.locator('[data-sonner-toast]', { hasText: t }).last()

  await expect(page.getByText('Welcome to Fin')).toBeVisible()
  await page.screenshot({ path: out('01-onboarding') })
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Name').fill('HDFC Savings')
  await page.getByLabel('Balance on start date').fill('1,25,000')
  await page.getByRole('button', { name: 'Add account and finish' }).click()

  const add = async (amount: string, payee: string, category: string, mode = 'Control+n') => {
    await page.keyboard.press(mode)
    await page.getByLabel('Amount').fill(amount)
    await page.getByLabel('Payee').fill(payee)
    await page.getByRole('combobox', { name: 'Category' }).click()
    await page.getByPlaceholder('Search categories…').fill(category)
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(toast('Transaction added')).toBeVisible()
  }
  await add('85000', 'ACME Payroll', 'Salary', 'Control+i')
  await add('450', 'Swiggy', 'Food delivery')
  await add('2,340.50', 'DMart', 'Groceries')
  await add('18,000', 'Rent — Koramangala flat', 'Rent')
  await add('649', 'Netflix', 'Subscriptions')
  await page.keyboard.press('Escape')

  await page.keyboard.press('Control+1')
  await page.waitForTimeout(4500) // let toasts fade
  await page.screenshot({ path: out('02-overview-light') })
  await page.getByRole('button', { name: /^Cash position: data as of/ }).click()
  await page.screenshot({ path: out('10-freshness') })
  await page.keyboard.press('Escape')
  await page.getByRole('radio', { name: 'Table' }).click()
  await page.screenshot({ path: out('11-chart-table'), fullPage: true })
  await page.getByRole('link', { name: /^Spent this month/ }).click()
  await page.screenshot({ path: out('12-drill-spent') })
  await page.keyboard.press('Control+1')
  await page.getByRole('link', { name: /^Cash position/ }).click()
  await page.screenshot({ path: out('13-drill-cash') })
  await page.keyboard.press('Control+2')
  await page.screenshot({ path: out('03-transactions') })
  await page.keyboard.press('Control+n')
  await page.getByRole('button', { name: 'Split' }).click()
  await page.screenshot({ path: out('04-dialog-split') })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+3')
  await page.screenshot({ path: out('05-accounts') })
  await page.keyboard.press('Control+4')
  await page.getByLabel('Statement file').setInputFiles(join('tests', 'fixtures', 'csv', 'hdfc_savings.csv'))
  await expect(page.getByText('5 transactions')).toBeVisible()
  await page.screenshot({ path: out('08-import-mapping') })
  await page.getByRole('button', { name: 'Check for duplicates' }).click()
  await expect(page.getByText('Balance check')).toBeVisible()
  await page.screenshot({ path: out('09-import-review'), fullPage: true })
  await page.keyboard.press('Control+3')
  await page.keyboard.press('Control+k')
  await page.screenshot({ path: out('06-command-palette') })
  await page.keyboard.press('Escape')
  await page.evaluate("document.documentElement.classList.add('dark')")
  await page.keyboard.press('Control+1')
  await page.screenshot({ path: out('07-overview-dark') })

  await app.close()
  rmSync(dataDir, { recursive: true, force: true })
})
