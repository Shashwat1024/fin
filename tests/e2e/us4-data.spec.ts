import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { externalRequests, fixture, launchFin, onboard, toast, type FinApp } from './app'

let fin: FinApp
let page: Page
let outDir: string
test.beforeAll(async () => {
  fin = await launchFin()
  page = fin.page
  outDir = mkdtempSync(join(tmpdir(), 'fin-e2e-out-'))
})
test.afterAll(async () => {
  await fin?.close()
  rmSync(outDir, { recursive: true, force: true })
})

/** Answer the next native open/save dialog in the main process (Playwright cannot click OS dialogs). */
async function answerDialogs(file: string) {
  await fin.app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [path],
    })) as typeof dialog.showOpenDialog
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: path,
    })) as typeof dialog.showSaveDialog
  }, file)
}

async function addExpense(amount: string, payee: string) {
  await page.keyboard.press('Control+n')
  await page.getByLabel('Amount').fill(amount)
  await page.getByLabel('Payee').fill(payee)
  await page.getByLabel('Payee').press('Control+Enter')
  await expect(toast(page, 'Transaction added')).toBeVisible()
}

const cash = () => page.getByRole('link', { name: /^Cash position/ }).locator('[data-slot="card-title"]')
const backupsCard = () =>
  page.locator('[data-slot="card"]', { has: page.getByText('Backups', { exact: true }) })
const restoreDialog = () => page.getByRole('dialog', { name: 'Restore a backup' })

async function backUp(passphrase?: string) {
  await backupsCard().getByRole('button', { name: 'Back up now' }).click()
  if (passphrase) {
    await page.getByLabel('Protect with a passphrase').click()
    await page.getByLabel('Passphrase', { exact: true }).fill(passphrase)
    await page.getByLabel('Type it again').fill(passphrase)
  }
  await page.getByRole('button', { name: 'Back up', exact: true }).click()
  await expect(toast(page, 'Backed up to')).toBeVisible()
}

test('US4: back up, restore exactly, refuse bad files, export, and demo mode', async () => {
  await onboard(page, 'HDFC Savings', '50,000')
  await addExpense('450', 'Swiggy')

  // Plain and passphrase-protected backups
  await page.keyboard.press('Control+,')
  await backUp()
  await backUp('correct horse battery')
  const rows = backupsCard().getByRole('row')
  await expect(rows.filter({ hasText: 'Manual' })).toHaveCount(2)
  await expect(rows.filter({ has: page.getByLabel('Protected with a passphrase') })).toHaveCount(1)

  // Change the data after the backups
  await addExpense('18000', 'Rent')
  await page.keyboard.press('Control+1')
  await expect(cash()).toHaveText('₹31,550.00')

  // A protected backup asks for its passphrase; a wrong one changes nothing
  await page.keyboard.press('Control+,')
  const encryptedRow = rows.filter({ has: page.getByLabel('Protected with a passphrase') })
  await encryptedRow.getByRole('button', { name: /^Restore backup/ }).click()
  await restoreDialog().getByLabel('Backup passphrase').fill('wrong passphrase')
  await restoreDialog().getByRole('button', { name: 'Unlock' }).click()
  await expect(restoreDialog().getByText('That passphrase did not open this backup')).toBeVisible()
  await restoreDialog().getByLabel('Backup passphrase').fill('correct horse battery')
  await restoreDialog().getByRole('button', { name: 'Unlock' }).click()
  // Shows what will replace what before anything changes
  const transactionsRow = restoreDialog().getByRole('row', { name: /Transactions/ })
  await expect(transactionsRow).toContainText('1')
  await expect(transactionsRow).toContainText('2')
  await restoreDialog().getByRole('button', { name: 'Replace my data' }).click()
  await expect(toast(page, 'Restored. Your previous data was saved as')).toBeVisible()
  await expect(cash()).toHaveText('₹49,550.00')

  // The data replaced by the restore was backed up first, and can itself be restored
  await page.keyboard.press('Control+,')
  const preRestore = backupsCard().getByRole('row').filter({ hasText: 'Before a restore' })
  await expect(preRestore).toHaveCount(1)
  await preRestore.getByRole('button', { name: /^Restore backup/ }).click()
  await restoreDialog().getByRole('button', { name: 'Replace my data' }).click()
  await expect(toast(page, 'Restored.')).toBeVisible()
  await expect(cash()).toHaveText('₹31,550.00')

  // A file that is not a Fin backup is refused without touching anything
  await page.keyboard.press('Control+,')
  await answerDialogs(resolve(fixture('hdfc_savings.csv')))
  await backupsCard().getByRole('button', { name: 'Restore from file…' }).click()
  await expect(restoreDialog().getByRole('alert')).toContainText(
    'This file is not a Fin backup. Your data was not changed.',
  )
  await restoreDialog().getByRole('button', { name: 'Close' }).first().click()

  // Export transactions to CSV
  const csvPath = join(outDir, 'transactions.csv')
  await answerDialogs(csvPath)
  await page.getByRole('button', { name: 'Transactions (CSV)' }).click()
  await expect(toast(page, `Saved to ${csvPath}`)).toBeVisible()
  const csv = readFileSync(csvPath, 'utf8')
  expect(csv).toContain('date,account,amount,currency,payee')
  expect(csv).toContain('HDFC Savings,-18000.00,INR,Rent')
  const jsonPath = join(outDir, 'all.json')
  await answerDialogs(jsonPath)
  await page.getByRole('button', { name: 'Everything (JSON)' }).click()
  await expect(toast(page, `Saved to ${jsonPath}`)).toBeVisible()
  expect(JSON.parse(readFileSync(jsonPath, 'utf8'))).toMatchObject({ format: 'fin-export', version: 1 })

  // Demo mode: clearly labelled, separate from your data, and thrown away on leaving
  await page.getByRole('button', { name: 'Explore demo data' }).click()
  const banner = page.getByRole('status').filter({ hasText: 'Demo data.' })
  await expect(banner).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await expect(page.getByText('Demo Savings Bank').first()).toBeVisible()
  await banner.getByRole('button', { name: 'Leave demo' }).click()
  await expect(toast(page, 'Back to your own data')).toBeVisible()
  await expect(banner).toHaveCount(0)
  await expect(cash()).toHaveText('₹31,550.00')
})

test('offline throughout backup, restore, export and demo', async () => {
  expect(externalRequests(fin.requests)).toEqual([])
})
