import { app, BrowserWindow, dialog, ipcMain, Menu, session, type WebContents } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IPC_CHANNEL } from '@shared/contract'
import { dispatch } from './dispatch'
import { createFileLogger } from './logging'
import { resolvePaths } from './paths'
import { createSystem } from './services/system'

const isDev = !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL)
const paths = resolvePaths(app.getPath('appData'))
mkdirSync(paths.dataDir, { recursive: true })
app.setPath('userData', paths.dataDir)
const log = createFileLogger(paths.logFile, isDev ? 'debug' : 'info')

let mainWindow: BrowserWindow | undefined
const system = createSystem(paths, log, () => mainWindow)

const devOrigin = process.env.ELECTRON_RENDERER_URL ? new URL(process.env.ELECTRON_RENDERER_URL).origin : null

function isAppUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol === 'file:') return true
    return isDev && devOrigin !== null && url.origin === devOrigin
  } catch {
    return false
  }
}

/** Constitution I: the app works offline and never talks to the network. */
function hardenSession(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.webRequest.onBeforeRequest((details, callback) => {
    const ok = isAppUrl(details.url) || details.url.startsWith('devtools://') || details.url.startsWith('data:')
    const wsDev = isDev && devOrigin !== null && details.url.replace(/^ws/, 'http').startsWith(devOrigin)
    if (!ok && !wsDev) log.warn('net.blocked')
    callback({ cancel: !ok && !wsDev })
  })
}

function hardenContents(contents: WebContents): void {
  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault()
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Fin',
    backgroundColor: '#0b0d10',
    autoHideMenuBar: true,
    // The packaged app takes its icon from Fin.exe; in development, show the same one.
    ...(app.isPackaged ? {} : { icon: join(app.getAppPath(), 'build', 'icon.ico') }),
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: isDev,
    },
  })
  hardenContents(mainWindow.webContents)
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  if (isDev && process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.focus()
  })

  app.whenReady().then(() => {
    try {
      system.start()
    } catch (err) {
      log.error('db.open_failed', { kind: err instanceof Error ? err.name : 'unknown' })
      dialog.showErrorBox(
        'Fin could not open your data',
        `${err instanceof Error ? err.message : 'Unknown error'}\n\nYour data file was not modified. Data folder:\n${paths.dataDir}`,
      )
      app.quit()
      return
    }
    if (!isDev) Menu.setApplicationMenu(null)
    hardenSession()
    ipcMain.handle(IPC_CHANNEL, (event, channel: unknown, payload: unknown) => {
      if (!event.senderFrame || !isAppUrl(event.senderFrame.url)) {
        log.warn('ipc.untrusted_sender')
        return { ok: false, error: { code: 'VALIDATION', message: 'Untrusted sender' } }
      }
      return dispatch({ db: system.db, env: system.env }, channel, payload, log)
    })
    log.info('app.ready', { version: app.getVersion() })
    createWindow()
    // The daily backup copies the whole database on the main thread; start it once the first
    // screen has had time to load so it never competes with startup queries (NFR cold start).
    setTimeout(() => void system.dailyBackup(), 5_000)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => system.close())
}
