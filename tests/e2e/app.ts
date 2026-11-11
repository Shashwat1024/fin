import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium, expect, test, type Browser, type Page } from '@playwright/test'

export type FinApp = {
  page: Page
  requests: string[]
  dataDir: string
  /** Answer the next native open/save/folder dialogs with this path (Playwright cannot click OS dialogs). */
  answerDialogs: (path: string) => Promise<void>
  /** Notifications this launch would have shown (the shell writes them to a file instead). */
  notifications: () => { title: string; body: string; route: string }[]
  /** Quit the app but keep its data folder (to launch again on the same data). */
  stop: () => Promise<void>
  /** Quit the app and remove its data folder. */
  close: () => Promise<void>
}

let nextPort = 9400 + Math.floor(Math.random() * 400)
let lastPage: Page | undefined

// Diagnostics: when a test fails, record what dialogs and fields looked like.
// Playwright needs the fixtures argument destructured even when no fixture is used.
// eslint-disable-next-line no-empty-pattern
test.afterEach(async ({}, info) => {
  if (info.status === info.expectedStatus || !lastPage || lastPage.isClosed()) return
  const state = await lastPage
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

/**
 * Launch the built app against a throwaway data folder (or a prepared one, removed on close).
 * FIN_TAURI_EXE picks the build; the default is the debug build that `npm run test:e2e` makes
 * (use target/release/fin.exe for the release build).
 */
export async function launchFin(
  prepared?: string,
  opts: { realNotifications?: boolean } = {},
): Promise<FinApp> {
  const dataDir = prepared ?? mkdtempSync(join(tmpdir(), 'fin-e2e-'))
  const exe = process.env.FIN_TAURI_EXE ?? resolve('target', 'debug', 'fin.exe')
  const port = nextPort++
  // One WebView2 profile per data folder, kept across launches like a real user's (stop() keeps
  // it; close() removes it), so a relaunch does not pay WebView2's first-run setup again.
  const webviewDir = `${dataDir}-webview`
  mkdirSync(webviewDir, { recursive: true })
  const answersDir = mkdtempSync(join(tmpdir(), 'fin-e2e-dialogs-'))
  const answersFile = join(answersDir, 'answers.json')
  const notificationsFile = join(answersDir, 'notifications.jsonl')
  const proc: ChildProcess = spawn(exe, [], {
    env: {
      ...process.env,
      FIN_DATA_DIR: dataDir,
      // Test-only: lets Playwright drive WebView2, with a throwaway browser profile.
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: webviewDir,
      // Test-only: the shell answers file dialogs from this file instead of showing them.
      FIN_E2E_DIALOG_ANSWERS: answersFile,
      // Test-only: notifications are written here instead of shown.
      ...(opts.realNotifications ? {} : { FIN_E2E_NOTIFICATIONS: notificationsFile }),
    },
    stdio: 'ignore',
  })
  let browser: Browser | undefined
  for (let i = 0; i < 600 && !browser; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    } catch {
      await new Promise((r) => setTimeout(r, 50))
    }
  }
  if (!browser) throw new Error('Could not attach to the Fin window')
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
  lastPage = page
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
    page,
    requests,
    dataDir,
    answerDialogs: async (path) => writeFileSync(answersFile, JSON.stringify({ path })),
    notifications: () =>
      existsSync(notificationsFile)
        ? readFileSync(notificationsFile, 'utf8')
            .split(String.fromCharCode(10))
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => JSON.parse(l) as { title: string; body: string; route: string })
        : [],
    stop: async () => {
      await quit()
      remove(answersDir)
    },
    close: async () => {
      await quit()
      for (const dir of [dataDir, webviewDir, answersDir]) remove(dir)
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
