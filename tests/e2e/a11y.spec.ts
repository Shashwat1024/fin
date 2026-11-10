import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'
import { launchFin, type FinApp } from './app'

/**
 * Accessibility pass (NFR, T106): every screen, light and dark, with the demo data loaded, checked
 * against WCAG 2.2 A/AA rules by axe — contrast, names, roles, labels and landmarks. Also checks
 * that keyboard focus is always visible and that dialogs trap and return focus.
 */
// axe runs inside the app window (Electron cannot open the extra page @axe-core/playwright needs).
const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
type AxeViolation = { id: string; impact: string | null; help: string; nodes: { target: string[] }[] }

let fin: FinApp
let page: Page
test.beforeAll(async () => {
  fin = await launchFin()
  page = fin.page
  await expect(page.getByText('Welcome to Fin')).toBeVisible()
  await page.getByRole('button', { name: 'Explore with demo data first' }).click()
  await expect(page.getByText('Demo Savings Bank').first()).toBeVisible()
})
test.afterAll(async () => fin?.close())

const SCREENS: {
  name: string
  key?: string
  hash?: string
  ready: (p: Page) => ReturnType<Page['getByRole']>
}[] = [
  { name: 'Overview', key: 'Control+1', ready: (p) => p.getByRole('heading', { name: 'Overview' }) },
  { name: 'Transactions', key: 'Control+2', ready: (p) => p.getByRole('row').nth(2) },
  { name: 'Accounts', key: 'Control+3', ready: (p) => p.getByRole('heading', { name: 'Accounts' }) },
  { name: 'Import', key: 'Control+4', ready: (p) => p.getByRole('heading', { name: 'Import' }) },
  { name: 'Recurring', key: 'Control+5', ready: (p) => p.getByText('All recurring items') },
  { name: 'Budget', key: 'Control+6', ready: (p) => p.getByTestId('to-assign') },
  { name: 'Goals', key: 'Control+7', ready: (p) => p.getByTestId('goal-status').first() },
  {
    name: 'Categories',
    key: 'Control+8',
    ready: (p) => p.getByRole('region', { name: 'Food', exact: true }),
  },
  { name: 'Forecast', key: 'Control+9', ready: (p) => p.getByRole('region', { name: 'Assumptions' }) },
  { name: 'Net worth', key: 'Control+0', ready: (p) => p.getByRole('region', { name: 'Assets' }) },
  { name: 'Settings', key: 'Control+,', ready: (p) => p.getByRole('heading', { name: 'Settings' }) },
  { name: 'Insights', hash: '/insights', ready: (p) => p.getByRole('article').first() },
  {
    name: 'What if',
    hash: '/insights?tab=what-if',
    ready: (p) => p.getByRole('region', { name: 'Scenario result' }),
  },
]

async function audit(label: string) {
  // Measure colours at rest: entrance animations finished and no toast fading in or out.
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10_000 })
  await page.waitForTimeout(350)
  if (!(await page.evaluate<boolean>('typeof window.axe === "object"'))) await page.evaluate(AXE_SOURCE)
  const violations = await page.evaluate<AxeViolation[]>(
    `axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }).then((r) => r.violations)`,
  )
  const problems = violations.map((v) => ({
    screen: label,
    rule: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
  }))
  expect(problems, JSON.stringify(problems, null, 2)).toEqual([])
}

for (const theme of ['light', 'dark'] as const) {
  test(`every screen passes axe (WCAG 2.2 AA) in ${theme} mode`, async () => {
    await page.evaluate(`document.documentElement.classList.toggle('dark', ${theme === 'dark'})`)
    for (const s of SCREENS) {
      if (s.key) await page.keyboard.press(s.key)
      else await page.evaluate(`location.hash = ${JSON.stringify(s.hash)}`)
      await expect(s.ready(page)).toBeVisible()
      await audit(`${s.name} (${theme})`)
    }
  })
}

test('dialogs and the shortcuts sheet pass axe, trap focus and give it back', async () => {
  await page.evaluate(`document.documentElement.classList.remove('dark')`)
  await page.keyboard.press('Control+1')
  const opener = page.getByRole('button', { name: /Add transaction/ }).first()
  await opener.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await audit('Transaction dialog')
  // Tabbing never leaves the dialog
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(`!!document.activeElement.closest('[role="dialog"]')`)).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()

  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Shift+?')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  await audit('Shortcuts sheet')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+k')
  await expect(page.getByPlaceholder('Type a command or search…')).toBeFocused()
  await audit('Command palette')
  await page.keyboard.press('Escape')
})

test('keyboard focus is always visible', async () => {
  await page.keyboard.press('Control+1')
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  const missing: string[] = []
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab')
    // A visible focus indicator: an outline, a ring (box-shadow) or a changed border.
    const r = await page.evaluate<{ name: string; visible: boolean }>(`(() => {
      const el = document.activeElement
      if (!el || el === document.body) return { name: 'body', visible: true }
      const s = getComputedStyle(el)
      const visible = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none')
      return { name: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40), visible: !!visible }
    })()`)
    if (!r.visible) missing.push(r.name)
  }
  expect(missing).toEqual([])
})
