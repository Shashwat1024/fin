import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'

export type FinApp = {
  app: ElectronApplication
  page: Page
  requests: string[]
  dataDir: string
  close: () => Promise<void>
}

/** Launch the built app against a throwaway data folder (or a prepared one, removed on close). */
export async function launchFin(prepared?: string): Promise<FinApp> {
  const dataDir = prepared ?? mkdtempSync(join(tmpdir(), 'fin-e2e-'))
  // Editors built on Electron (e.g. VS Code) set this for child processes; it would start Electron as plain Node.
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env
  // FIN_E2E_EXE runs the suite against a packaged build (e.g. release/win-unpacked/Fin.exe).
  const exe = process.env.FIN_E2E_EXE
  const app = await electron.launch({
    ...(exe ? { executablePath: exe, args: [] } : { args: ['.'] }),
    env: { ...env, FIN_DATA_DIR: dataDir } as Record<string, string>,
  })
  const page = await app.firstWindow()
  const requests: string[] = []
  page.on('request', (r) => requests.push(r.url()))
  return {
    app,
    page,
    requests,
    dataDir,
    close: async () => {
      await app.close()
      rmSync(dataDir, { recursive: true, force: true })
    },
  }
}

/** Complete first-run setup with one bank account. */
export async function onboard(page: Page, name: string, opening: string, startDate?: string) {
  await expect(page.getByText('Welcome to Fin')).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Balance on start date').fill(opening)
  if (startDate) await page.getByLabel('Start date', { exact: true }).fill(startDate)
  await page.getByRole('button', { name: 'Add account and finish' }).click()
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
}

/** The newest toast containing `text` (older toasts may still be on screen). */
export const toast = (page: Page, text: string) =>
  page.locator('[data-sonner-toast]', { hasText: text }).last()

export const fixture = (name: string) => join('tests', 'fixtures', 'csv', name)

/** Requests that left the app (anything other than local files, data URLs and devtools). */
export const externalRequests = (requests: readonly string[]) =>
  requests.filter((u) => !/^(file|data|devtools):/.test(u))
