import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  chromium,
  expect,
  test,
  type Browser,
  type ElectronApplication,
  type Page,
} from '@playwright/test'

export type FinApp = {
  /** The Electron application; not available when running against the Tauri build. */
  app: ElectronApplication
  page: Page
  requests: string[]
  dataDir: string
  /** Answer the next native open/save/folder dialogs with this path (Playwright cannot click OS dialogs). */
  answerDialogs: (path: string) => Promise<void>
  /** Quit the app but keep its data folder (to launch again on the same data). */
  stop: () => Promise<void>
  /** Quit the app and remove its data folder. */
  close: () => Promise<void>
}

/** FIN_E2E_SHELL=tauri runs the suite against the Rust/Tauri build (specs/002-rust-tauri-port). */
export const isTauri = process.env.FIN_E2E_SHELL === 'tauri'

let nextPort = 9400 + Math.floor(Math.random() * 400)
let lastTauriPage: Page | undefined

// Diagnostics: when a test fails on the Tauri build, record what dialogs and fields looked like.
// Playwright needs the fixtures argument destructured even when no fixture is used.
// eslint-disable-next-line no-empty-pattern
test.afterEach(async ({}, info) => {
  if (!isTauri || info.status === info.expectedStatus || !lastTauriPage || lastTauriPage.isClosed()) return
  const state = await lastTauriPage
    .evaluate(
      `(() => ({
        dialogs: [...document.querySelectorAll('[role=dialog],[role=alertdialog],[role=listbox]')].map((d) => ({
          role: d.getAttribute('role'), state: d.getAttribute('data-state'), text: d.textContent.slice(0, 90),
          opacity: getComputedStyle(d).opacity, animation: getComputedStyle(d).animationName,
        })),
        fields: [...document.querySelectorAll('input,button')].filter((e) => /amount|to account/i.test(e.getAttribute('aria-label') || (e.labels && e.labels[0] && e.labels[0].textContent) || '')).map((e) => ({
          label: e.getAttribute('aria-label') || e.labels[0].textContent, disabled: e.disabled,
          rect: [...Object.values(e.getBoundingClientRect().toJSON())].map(Math.round),
        })),
        active: document.activeElement && document.activeElement.outerHTML.slice(0, 140),
        bodyPointer: getComputedStyle(document.body).pointerEvents,
      }))()`,
    )
    .catch((e: Error) => ({ error: e.message }))
  console.log(`[fin] state at failure: ${JSON.stringify(state)}`)
})

async function launchTauri(dataDir: string): Promise<FinApp> {
  const exe = process.env.FIN_TAURI_EXE ?? resolve('target', 'debug', 'fin.exe')
  const port = nextPort++
  const webviewDir = mkdtempSync(join(tmpdir(), 'fin-e2e-webview-'))
  const answersDir = mkdtempSync(join(tmpdir(), 'fin-e2e-dialogs-'))
  const answersFile = join(answersDir, 'answers.json')
  const proc: ChildProcess = spawn(exe, [], {
    env: {
      ...process.env,
      FIN_DATA_DIR: dataDir,
      // Test-only: lets Playwright drive WebView2, with a throwaway browser profile.
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: webviewDir,
      // Test-only: the shell answers file dialogs from this file instead of showing them.
      FIN_E2E_DIALOG_ANSWERS: answersFile,
    },
    stdio: 'ignore',
  })
  let browser: Browser | undefined
  for (let i = 0; i < 120 && !browser; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    } catch {
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  if (!browser) throw new Error('Could not attach to the Tauri app')
  const context = browser.contexts()[0]!
  const page = context.pages()[0] ?? (await context.waitForEvent('page'))
  await page.waitForLoadState('domcontentloaded')
  const requests: string[] = []
  page.on('request', (r) => requests.push(r.url()))
  // Diagnostics for a run that hangs: did the app exit, or the page crash?
  proc.on('exit', (code, signal) => {
    if (!quitting) console.log(`[fin] app exited unexpectedly: code=${code} signal=${signal}`)
  })
  page.on('crash', () => console.log('[fin] page crashed'))
  page.on('pageerror', (e) => console.log(`[fin] page error: ${e.message}`))
  let quitting = false
  const connected = browser
  lastTauriPage = page
  const quit = async () => {
    quitting = true
    await connected.close().catch(() => undefined)
    proc.kill()
    await new Promise((r) => setTimeout(r, 300))
  }
  // WebView2 can hold its profile for a moment after exit; leftovers sit in the temp folder.
  const remove = (dir: string) => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch {
      // best effort
    }
  }
  return {
    app: undefined as unknown as ElectronApplication,
    page,
    requests,
    dataDir,
    answerDialogs: async (path) => writeFileSync(answersFile, JSON.stringify({ path })),
    stop: async () => {
      await quit()
      for (const dir of [webviewDir, answersDir]) remove(dir)
    },
    close: async () => {
      await quit()
      for (const dir of [dataDir, webviewDir, answersDir]) remove(dir)
    },
  }
}

/** Launch the built app against a throwaway data folder (or a prepared one, removed on close). */
export async function launchFin(prepared?: string): Promise<FinApp> {
  const dataDir = prepared ?? mkdtempSync(join(tmpdir(), 'fin-e2e-'))
  if (isTauri) return launchTauri(dataDir)
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
    answerDialogs: (path) =>
      app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = (async () => ({
          canceled: false,
          filePaths: [file],
        })) as typeof dialog.showOpenDialog
        dialog.showSaveDialog = (async () => ({
          canceled: false,
          filePath: file,
        })) as typeof dialog.showSaveDialog
      }, path),
    stop: () => app.close(),
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

/** Requests that left the app (anything other than Fin's own content, data URLs and devtools). */
export const externalRequests = (requests: readonly string[]) =>
  requests.filter((u) => !/^(file|data|devtools):/.test(u) && !/^https?:\/\/(tauri|ipc)\.localhost\//.test(u))
