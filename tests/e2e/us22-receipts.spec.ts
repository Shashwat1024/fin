import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { addDays, todayIn } from '../../src/domain/dates'
import { externalRequests, launchFin, onboard, toast, type FinApp } from './app'

let fin: FinApp
let page: Page
test.beforeAll(async () => {
  fin = await launchFin()
  page = fin.page
})
test.afterAll(async () => fin?.close())

// A real one-pixel PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)
const warrantyEnds = addDays(todayIn('Asia/Kolkata'), 20)

async function openTransaction(payee: string) {
  await page.keyboard.press('Control+2')
  await page.getByRole('row').filter({ hasText: payee }).click()
  return page.getByRole('dialog').getByRole('region', { name: 'Receipts' })
}

test('US22: attach a receipt, view it, give it a warranty, save a copy, remove with undo', async () => {
  await onboard(page, 'HDFC Savings', '1,00,000')
  await page.keyboard.press('Control+n')
  await page.getByLabel('Amount', { exact: true }).fill('45000')
  await page.getByLabel('Payee').fill('Croma laptop')
  await page.getByLabel('Payee').press('Control+Enter')
  await expect(toast(page, 'Transaction added')).toBeVisible()

  let receipts = await openTransaction('Croma laptop')
  const picker = receipts.getByLabel(/Attach a receipt or bill/)
  // Too big: refused before anything is sent.
  await picker.setInputFiles({
    name: 'huge.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.alloc(11 * 1024 * 1024),
  })
  await expect(receipts.getByRole('alert')).toHaveText('Files can be up to 10 MB')
  await picker.setInputFiles({ name: 'bill.png', mimeType: 'image/png', buffer: PNG })
  await expect(toast(page, 'Attached bill.png')).toBeVisible()
  await expect(receipts).toContainText('bill.png')

  await receipts.getByRole('button', { name: 'View bill.png' }).click()
  await expect(page.getByRole('img', { name: 'Receipt: bill.png' })).toBeVisible()
  await page.keyboard.press('Escape')

  await receipts.getByLabel('Warranty until').fill(warrantyEnds)
  await expect(toast(page, 'Warranty date saved')).toBeVisible()

  const copy = join(fin.dataDir, 'copy.png')
  await fin.answerDialogs(copy)
  await receipts.getByRole('button', { name: 'Save a copy of bill.png' }).click()
  // ("Saved" alone would also match the earlier "Warranty date saved" toast.)
  await expect(toast(page, `Saved ${copy}`)).toBeVisible()
  await expect.poll(() => existsSync(copy) && readFileSync(copy).equals(PNG)).toBe(true)
  await page.keyboard.press('Escape')

  await page.keyboard.press('Control+k')
  await page.getByPlaceholder('Type a command or search…').fill('Warranties')
  await page.keyboard.press('Enter')
  const row = page
    .getByRole('table', { name: 'Warranties' })
    .getByRole('row')
    .filter({ hasText: 'Croma laptop' })
  await expect(row).toContainText('20 days left')
  await expect(row).toContainText('₹45,000.00')

  await page.keyboard.press('Control+,')
  await expect(page.getByTestId('attachments-usage')).toContainText('Receipts: 1 file')

  // Removing can be undone.
  receipts = await openTransaction('Croma laptop')
  await receipts.getByRole('button', { name: 'Remove bill.png' }).click()
  const removed = toast(page, 'Removed bill.png')
  await expect(removed).toBeVisible()
  await expect(receipts).not.toContainText('bill.png')
  await removed.getByRole('button', { name: 'Undo' }).click()
  await expect(toast(page, 'Undone')).toBeVisible()
  // Clicking the toast closes the dialog; the file is back when it is opened again.
  receipts = await openTransaction('Croma laptop')
  await expect(receipts).toContainText('bill.png')

  expect(externalRequests(fin.requests)).toEqual([])
})
