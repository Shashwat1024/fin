import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { externalRequests, launchFin, onboard, toast, type FinApp } from './app'

// Test seams (throwaway data folder only): a fixed data key instead of one protected by Windows,
// and Windows Hello that confirms without a real prompt.
const ENV = { FIN_E2E_KEY: 'a1'.repeat(32), FIN_E2E_HELLO: 'ok' }

let fin: FinApp
let page: Page
test.beforeAll(async () => {
  fin = await launchFin(undefined, { env: ENV })
  page = fin.page
})
test.afterAll(async () => fin?.close())

const cash = () => page.getByRole('link', { name: /^Cash position/ }).locator('[data-slot="card-title"]')
const backupsCard = () =>
  page.locator('[data-slot="card"]', { has: page.getByText('Backups', { exact: true }) })
const lockScreen = () => page.getByRole('heading', { name: 'Fin is locked' })
const plainHeader = () =>
  readFileSync(join(fin.dataDir, 'fin.db')).subarray(0, 15).toString('latin1') === 'SQLite format 3'

async function unlockWithPin(pin: string) {
  await page.getByLabel('PIN', { exact: true }).fill(pin)
  await page.getByRole('button', { name: 'Unlock' }).click()
}

test('US24: encrypt the data file, lock with a PIN or Windows Hello, and lock when idle', async () => {
  test.setTimeout(120_000)
  await onboard(page, 'HDFC Savings', '50,000')
  await expect(cash()).toHaveText('₹50,000.00')
  expect(plainHeader()).toBe(true)

  // Encrypt: the file no longer reads as SQLite, and backups are marked as this computer's.
  await page.keyboard.press('Control+,')
  await page.getByRole('switch', { name: 'Encrypt my data' }).click()
  await expect(toast(page, 'Your data is encrypted')).toBeVisible()
  expect(plainHeader()).toBe(false)
  await backupsCard().getByRole('button', { name: 'Back up now' }).click()
  await page.getByRole('button', { name: 'Back up', exact: true }).click()
  await expect(toast(page, 'Backed up to')).toBeVisible()
  await expect(backupsCard().getByText('This computer only').first()).toBeVisible()

  // Turn on the lock with a PIN, then lock with Ctrl+L.
  await page.getByLabel('New PIN (4 to 8 digits)').fill('4821')
  await page.getByLabel('Type the PIN again').fill('4821')
  await page.getByRole('button', { name: 'Save PIN' }).click()
  await expect(toast(page, 'Fin will ask for your PIN from now on')).toBeVisible()
  await page.keyboard.press('Control+l')
  await expect(lockScreen()).toBeVisible()
  await expect(page.getByRole('navigation')).toHaveCount(0)

  // The backend refuses requests while locked, whatever the window does.
  type Bridge = { fin: { invoke: (channel: string, input: unknown) => Promise<unknown> } }
  const refused = await page.evaluate(() => (globalThis as unknown as Bridge).fin.invoke('accounts.list', {}))
  expect(refused).toMatchObject({ ok: false, error: { code: 'LOCKED' } })

  await unlockWithPin('1111')
  await expect(page.getByText('That PIN is not right.')).toBeVisible()
  await unlockWithPin('4821')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

  // Fin opens locked; Windows Hello unlocks it, and the encrypted data is all there.
  const dir = fin.dataDir
  await fin.stop()
  fin = await launchFin(dir, { env: ENV })
  page = fin.page
  await expect(lockScreen()).toBeVisible()
  await page.getByRole('button', { name: 'Use Windows Hello' }).click()
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await expect(cash()).toHaveText('₹50,000.00')

  // Idle: the test shortens the idle time; choosing a time applies it.
  await page.keyboard.press('Control+,')
  await page.evaluate(() => sessionStorage.setItem('fin:idle-ms', '1500'))
  await page.getByLabel('Lock when idle').click()
  await page.getByRole('option', { name: 'After 5 minutes' }).click()
  await expect(lockScreen()).toBeVisible({ timeout: 15_000 })
  await page.evaluate(() => sessionStorage.removeItem('fin:idle-ms'))
  await unlockWithPin('4821')

  // Turn both off again: no PIN, and a plain file.
  await page.getByRole('button', { name: 'Turn off the lock' }).click()
  await expect(toast(page, 'Fin no longer asks for a PIN')).toBeVisible()
  await page.getByRole('switch', { name: 'Encrypt my data' }).click()
  await expect(toast(page, 'Your data is no longer encrypted')).toBeVisible()
  expect(plainHeader()).toBe(true)
  await page.keyboard.press('Control+l')
  await expect(lockScreen()).toHaveCount(0)
  await page.keyboard.press('Control+1')
  await expect(cash()).toHaveText('₹50,000.00')
})

test('offline throughout locking and encryption', async () => {
  expect(externalRequests(fin.requests)).toEqual([])
})
