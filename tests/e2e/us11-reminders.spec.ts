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

const tomorrow = addDays(todayIn('Asia/Kolkata'), 1)
const short = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${d}T00:00:00Z`),
  )
const rent = {
  title: 'Payment due tomorrow',
  body: `Rent: ₹25,000 on ${short(tomorrow)}`,
  route: '/recurring',
}

async function relaunch() {
  const dir = fin.dataDir
  await fin.stop()
  fin = await launchFin(dir)
  page = fin.page
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
}

test('US11: reminders are off until turned on, shown once as notifications, and the tray options', async () => {
  test.setTimeout(120_000)
  await onboard(page, 'HDFC Savings', '50,000')
  await page.keyboard.press('Control+5')
  await page.getByRole('button', { name: 'New recurring item' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New recurring item' })
  await dialog.getByLabel('Name').fill('Rent')
  await dialog.getByLabel('Expected amount').fill('25000')
  await dialog.getByLabel('Paid from').click()
  await page.getByRole('option', { name: /^HDFC Savings/ }).click()
  await dialog.getByLabel('First date').fill(tomorrow)
  await dialog.getByRole('button', { name: 'Add recurring item' }).click()
  await expect(toast(page, 'Added Rent')).toBeVisible()

  // Off by default: nothing is shown, though Settings says what is due.
  await relaunch()
  await page.waitForTimeout(3000)
  expect(fin.notifications()).toEqual([])
  await page.keyboard.press('Control+,')
  const dueNow = page.getByRole('region', { name: 'Due now' })
  await expect(dueNow).toContainText(rent.body)
  const main = page.getByLabel('Show reminders as Windows notifications')
  await expect(main).not.toBeChecked()
  await expect(page.getByLabel('Recurring payments due tomorrow or overdue')).toBeDisabled()

  // Turn on, with no quiet hours so the test does not depend on the time of day.
  await main.click()
  await expect(main).toBeChecked()
  await page.getByLabel('From', { exact: true }).fill('00:00')
  await page.getByLabel('Until', { exact: true }).fill('00:00')
  await expect(page.getByLabel('Until', { exact: true })).toHaveValue('00:00')
  await page.getByRole('button', { name: 'Show a test notification' }).click()
  await expect(toast(page, 'Test notification shown')).toBeVisible()
  await expect.poll(() => fin.notifications().map((n) => n.title)).toEqual(['Fin reminders are on'])

  // On the next start the reminder is shown, once.
  await relaunch()
  await expect.poll(() => fin.notifications(), { timeout: 15_000 }).toEqual([rent])
  await page.keyboard.press('Control+,')
  await expect(page.getByRole('region', { name: 'Due now' }).getByText('Shown')).toBeVisible()
  await relaunch()
  await page.waitForTimeout(3000)
  expect(fin.notifications()).toEqual([])

  // Starting at sign-in needs the tray option; turning the tray off turns both off.
  await page.keyboard.press('Control+,')
  const tray = page.getByLabel('Keep Fin running in the tray when the window is closed')
  const login = page.getByLabel('Start Fin when I sign in to Windows')
  await expect(login).toBeDisabled()
  await tray.click()
  await expect(login).toBeEnabled()
  await login.click()
  await expect(login).toBeChecked()
  await tray.click()
  await expect(login).not.toBeChecked()
  await expect(login).toBeDisabled()

  expect(externalRequests(fin.requests)).toEqual([])
})
