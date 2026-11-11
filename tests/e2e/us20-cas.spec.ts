import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { endOfMonth, addMonths, formatDate, startOfMonth, todayIn } from '../../src/domain/dates'
import { externalRequests, launchFin, onboard, toast, type FinApp } from './app'
import { makePdf } from './pdf'

let fin: FinApp
let page: Page
test.beforeAll(async () => {
  fin = await launchFin()
  page = fin.page
})
test.afterAll(async () => fin?.close())

const today = todayIn('Asia/Kolkata')
// The statement runs to the end of last month.
const end = endOfMonth(addMonths(startOfMonth(today), -1))
const casDate = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
  .format(new Date(`${end}T00:00:00Z`))
  .replace(/ /g, '-')

// Synthetic statement text in the shape of a CAMS CAS. Not real data.
const LINES = [
  'Consolidated Account Statement',
  `Statement Period : 01-Apr-2026 To ${casDate}`,
  'HDFC Mutual Fund',
  'Folio No: 1234567 / 89   PAN: ABCDE1234F',
  'B92Z-HDFC Flexi Cap Fund - Direct Plan - Growth (Advisor: DIRECT)',
  `Closing Unit Balance: 10.000 NAV on ${casDate}: INR 2,000.00 Market Value on ${casDate}: INR 20,000.00`,
  'Axis Mutual Fund',
  'Folio No: 555',
  'Axis ELSS Tax Saver Fund - Direct Growth',
  `Closing Unit Balance: 100.000 NAV on ${casDate}: INR 90.00 Market Value on ${casDate}: INR 9,000.00`,
]

async function choose(file: string) {
  await page.getByLabel('Statement (PDF)').setInputFiles(file)
}

test('US20: a password-protected CAS is read in Fin and values each folio on the statement date', async () => {
  await onboard(page, 'HDFC Savings', '50,000', addMonths(startOfMonth(today), -3))
  // An investment account already named with the first folio's number.
  await page.keyboard.press('Control+3')
  await page.getByRole('button', { name: 'New account' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill('HDFC MF 1234567')
  await dialog.getByLabel('Type').click()
  await page.getByRole('option', { name: 'Investment' }).click()
  await dialog.getByRole('button', { name: 'Add account' }).click()
  await expect(toast(page, 'Added HDFC MF 1234567')).toBeVisible()

  const protectedPdf = join(fin.dataDir, 'cas.pdf')
  writeFileSync(protectedPdf, makePdf(LINES, 'ABCDE1234F'))
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder('Type a command or search…').fill('mutual fund statement')
  await page.keyboard.press('Enter')
  await choose(protectedPdf)

  // The password is asked for, and asked again when wrong.
  await page.getByLabel('Statement password').fill('wrong')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByText('That password did not open it. Try again.')).toBeVisible()
  await page.getByLabel('Statement password').fill('ABCDE1234F')
  await page.getByRole('button', { name: 'Open', exact: true }).click()

  const contents = page.getByRole('region', { name: 'Statement contents' })
  await expect(contents).toContainText(`Values on ${formatDate(end)}: ₹29,000.00`)
  await expect(contents.getByRole('combobox', { name: 'Account for folio 1234567/89' })).toContainText(
    'HDFC MF 1234567',
  )
  await expect(contents.getByRole('combobox', { name: 'Account for folio 555' })).toContainText(
    'New account: Axis MF 555',
  )
  await contents.getByRole('button', { name: 'Record 2 values' }).click()
  await expect(toast(page, 'Recorded 2 values from the statement')).toBeVisible()
  await expect(page.getByText('Recorded 2 values and added 1 account.')).toBeVisible()

  // Net worth now uses the statement's values.
  await page.keyboard.press('Control+0')
  await expect(page.getByRole('listitem', { name: 'Axis MF 555' })).toContainText('₹9,000.00')
  await expect(page.getByRole('listitem', { name: 'HDFC MF 1234567' })).toContainText('₹20,000.00')

  // A PDF that is not a statement imports nothing.
  const other = join(fin.dataDir, 'other.pdf')
  writeFileSync(other, makePdf(['Electricity bill', 'Amount due: 1,234.00']))
  await page.evaluate('location.hash = "/import?tab=cas"')
  await choose(other)
  await expect(page.getByText('Nothing was imported')).toBeVisible()

  expect(externalRequests(fin.requests)).toEqual([])
})
