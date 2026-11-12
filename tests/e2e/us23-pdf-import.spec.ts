import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { externalRequests, launchFin, onboard, toast, type FinApp } from './app'
import { makePdfPages, textWidth, type Placed } from './pdf'

let fin: FinApp
let page: Page
test.beforeAll(async () => {
  fin = await launchFin()
  page = fin.page
})
test.afterAll(async () => fin?.close())

/** Left-aligned text at x, or right-aligned to end at x. */
const at = (x: number, y: number, text: string): Placed => ({ x, y, text })
const right = (x: number, y: number, text: string): Placed => ({ x: x - textWidth(text), y, text })

// Synthetic statements in the shape of HDFC and ICICI PDFs. Not real data.
const HDFC_COLUMNS: [string, number][] = [
  ['Date', 30],
  ['Narration', 75],
  ['Chq./Ref.No.', 210],
  ['Value Dt', 290],
  ['Withdrawal Amt.', 345],
  ['Deposit Amt.', 425],
  ['Closing Balance', 500],
]
const end = (name: string) => {
  const [, x] = HDFC_COLUMNS.find(([n]) => n === name)!
  return x + textWidth(name)
}
type HdfcRow = {
  date: string
  narration: string[]
  ref?: string
  debit?: string
  credit?: string
  balance: string
}

function hdfcPage(top: number, rows: HdfcRow[]): { items: Placed[]; y: number } {
  const items = HDFC_COLUMNS.map(([name, x]) => at(x, top, name))
  let y = top - 14
  for (const r of rows) {
    items.push(at(30, y, r.date), at(290, y, r.date))
    r.narration.forEach((line, i) => items.push(at(75, y - i * 10, line)))
    if (r.ref) items.push(at(210, y, r.ref))
    if (r.debit) items.push(right(end('Withdrawal Amt.'), y, r.debit))
    if (r.credit) items.push(right(end('Deposit Amt.'), y, r.credit))
    items.push(right(end('Closing Balance'), y, r.balance))
    y -= 10 * r.narration.length + 4
  }
  return { items, y }
}

function hdfcStatement(): Buffer {
  const p1 = hdfcPage(780, [
    {
      date: '01/10/26',
      narration: ['UPI-SWIGGY-ORDER', 'SWIGGY@ICICI-4288'],
      ref: '0000428812345678',
      debit: '450.00',
      balance: '49,550.00',
    },
    {
      date: '05/10/26',
      narration: ['NEFT CR-ACME TECH'],
      ref: 'N278261234',
      credit: '1,00,000.00',
      balance: '1,49,550.00',
    },
    { date: '07/10/26', narration: ['POS CHAI POINT'], debit: '80.00', balance: '1,49,470.00' },
  ])
  p1.items.push(at(280, 40, 'Page 1 of 2'))
  const p2 = hdfcPage(800, [
    { date: '12/10/26', narration: ['ATW-MUMBAI-S1ANMU12'], debit: '2,000.00', balance: '1,47,470.00' },
  ])
  p2.items.push(
    at(30, p2.y - 20, 'STATEMENT SUMMARY :-'),
    at(30, p2.y - 34, 'Opening Balance Dr Count Cr Count'),
  )
  p2.items.push(at(280, 40, 'Page 2 of 2'))
  return makePdfPages([p1.items, p2.items])
}

function iciciStatement(password: string): Buffer {
  const top = 700
  const cols: [string, number][] = [
    ['S No.', 20],
    ['Value Date', 50],
    ['Transaction Date', 110],
    ['Cheque Number', 190],
    ['Transaction Remarks', 270],
    ['Withdrawal Amount (INR )', 450],
    ['Deposit Amount (INR )', 570],
    ['Balance (INR )', 680],
  ]
  const edge = (i: number) => cols[i]![1] + textWidth(cols[i]![0])
  const row = (
    y: number,
    n: string,
    date: string,
    remarks: string[],
    debit: string,
    credit: string,
    bal: string,
  ) => [
    at(20, y, n),
    at(50, y, date),
    at(110, y, date),
    ...remarks.map((r, i) => at(270, y - i * 10, r)),
    right(edge(5), y, debit),
    right(edge(6), y, credit),
    right(edge(7), y, bal),
  ]
  return makePdfPages(
    [
      [
        ...cols.map(([name, x]) => at(x, top, name)),
        ...row(
          top - 14,
          '1',
          '20/10/2026',
          ['UPI/428811110000/Swiggy/', 'Payment'],
          '320.00',
          '0.00',
          '1,47,150.00',
        ),
        ...row(top - 38, '2', '25/10/2026', ['NEFT-RENT REFUND'], '0.00', '5,000.00', '1,52,150.00'),
      ],
    ],
    password,
  )
}

/** Opens Import afresh (leaving the page first resets the wizard) and picks the file. */
async function choose(file: string) {
  await page.keyboard.press('Control+3')
  await page.keyboard.press('Control+4')
  await expect(page.getByRole('heading', { name: 'Import' })).toBeVisible()
  await page.getByLabel('Statement file').setInputFiles(file)
}

test('US23: PDF statements from HDFC and ICICI import like CSV files', async () => {
  await onboard(page, 'Savings', '50,000', '2026-09-30')
  const hdfc = join(fin.dataDir, 'hdfc-statement.pdf')
  writeFileSync(hdfc, hdfcStatement())

  // Two pages: the wrapped narration is joined, the repeated header and footers are left out.
  await choose(hdfc)
  await expect(page.getByLabel('Bank layout')).toContainText('HDFC Bank')
  await expect(page.getByText('4 transactions')).toBeVisible()
  await page.getByRole('button', { name: 'Check for duplicates' }).click()
  await expect(page.getByText('4 new')).toBeVisible()
  const balanceCheck = page.locator('[data-slot="card"]', { hasText: 'Balance check' })
  await expect(balanceCheck).toContainText('₹1,47,470.00')
  await expect(balanceCheck).toContainText('₹0.00')
  await page.getByRole('button', { name: 'Import 4 transactions' }).click()
  await expect(toast(page, 'Imported 4 transactions')).toBeVisible()
  await page.getByRole('link', { name: 'Review imported transactions' }).click()
  await expect(page.getByRole('row', { name: /UPI-SWIGGY-ORDER SWIGGY@ICICI-4288/ })).toHaveCount(1)

  // The same PDF again finds nothing new.
  await choose(hdfc)
  await page.getByRole('button', { name: 'Check for duplicates' }).click()
  await expect(page.getByText('You imported this exact file')).toBeVisible()
  await expect(page.getByText('4 already in Fin (skipped)')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nothing new to import' })).toBeDisabled()

  // A password-protected ICICI statement: asked again when the password is wrong.
  const icici = join(fin.dataDir, 'icici-statement.pdf')
  writeFileSync(icici, iciciStatement('ABCD1234'))
  await choose(icici)
  await page.getByLabel('Statement password').fill('wrong')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByText('That password did not open it. Try again.')).toBeVisible()
  await page.getByLabel('Statement password').fill('ABCD1234')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByLabel('Bank layout')).toContainText('ICICI Bank')
  await expect(page.getByText('2 transactions')).toBeVisible()
  await page.getByRole('button', { name: 'Check for duplicates' }).click()
  await expect(balanceCheck).toContainText('₹1,52,150.00')
  await expect(balanceCheck).toContainText('₹0.00')
  await page.getByRole('button', { name: 'Import 2 transactions' }).click()
  await expect(toast(page, 'Imported 2 transactions')).toBeVisible()

  // A scanned statement (no text) is explained, not imported.
  const scanned = join(fin.dataDir, 'scanned.pdf')
  writeFileSync(scanned, makePdfPages([[]]))
  await choose(scanned)
  await expect(page.getByRole('alert')).toContainText('scanned image')

  // Undoing the ICICI import puts the balance back.
  await page.getByRole('tab', { name: 'History' }).click()
  const history = page.getByRole('tabpanel', { name: 'History' })
  await history.getByRole('button', { name: 'Undo' }).first().click()
  await page.getByRole('button', { name: 'Undo import' }).click()
  await expect(toast(page, 'Removed 2 imported transactions')).toBeVisible()
  await page.keyboard.press('Control+3')
  await expect(page.getByRole('button', { name: /₹1,47,470\.00/ })).toBeVisible()
})

test('offline during PDF import', async () => {
  expect(externalRequests(fin.requests)).toEqual([])
})
