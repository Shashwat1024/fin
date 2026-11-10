import { expect, test } from '@playwright/test'
import { launchFin, type FinApp } from './app'

let fin: FinApp
test.beforeAll(async () => {
  fin = await launchFin()
})
test.afterAll(async () => fin?.close())

test('first-run setup previews the chosen appearance straight away and keeps it', async () => {
  const { page } = fin
  const html = page.locator('html')
  await expect(page.getByText('Welcome to Fin')).toBeVisible()

  await page.getByRole('radio', { name: 'Dark' }).click()
  await expect(html).toHaveClass(/\bdark\b/)
  await page.getByRole('radio', { name: 'Light' }).click()
  await expect(html).not.toHaveClass(/\bdark\b/)
  await page.getByRole('radio', { name: 'Dark' }).click()
  await expect(html).toHaveClass(/\bdark\b/)

  // Saved on Continue, so it stays after setup finishes
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await expect(html).toHaveClass(/\bdark\b/)
})

test('the sidebar has its own Settings button and a quick appearance switch', async () => {
  const { page } = fin
  const html = page.locator('html')
  const sidebarTheme = page.getByRole('radiogroup', { name: 'Appearance' })
  await sidebarTheme.getByRole('radio', { name: 'Light theme' }).click()
  await expect(html).not.toHaveClass(/\bdark\b/)

  await page.getByRole('navigation', { name: 'App' }).getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  // The Settings page shows the same choice, and changing it there updates the sidebar
  await expect(page.getByRole('main').getByRole('radio', { name: 'Light' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await page.getByRole('main').getByRole('radio', { name: 'Dark' }).click()
  await expect(html).toHaveClass(/\bdark\b/)
  await expect(sidebarTheme.getByRole('radio', { name: 'Dark theme' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
})
