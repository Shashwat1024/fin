import { app, dialog, shell, type BrowserWindow } from 'electron'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { autoBackupIfDue, countData, createBackup, prepareBackup, swapDatabaseFile } from '@db/backup'
import { openDatabase, type Db } from '@db/connection'
import { migrate } from '@db/migrate'
import { getSettings } from '@db/repos/settings'
import { seedDefaultCategories } from '@db/seed/categories'
import { seedDemoData } from '@db/seed/demo'
import { snapshotDatabase } from '@db/snapshot'
import { todayIn } from '@domain/dates'
import { AppError } from '@shared/errors'
import { backupDirFor } from '../backupHandlers'
import type { AppEnv } from '../env'
import type { Logger } from '../logging'
import type { AppPaths } from '../paths'

const removeDbFiles = (file: string) => {
  for (const ext of ['', '-wal', '-shm', '-journal']) rmSync(file + ext, { force: true })
}

/**
 * Owns the open database and everything that swaps it: restore, demo mode and daily backups.
 * Handlers always receive the database that is open at the moment of the request.
 */
export function createSystem(paths: AppPaths, log: Logger, window: () => BrowserWindow | undefined) {
  const demoFile = join(paths.dataDir, 'demo.db')
  const workDir = join(paths.dataDir, 'tmp')
  let db: Db | undefined
  let demo = false

  function openReal(): Db {
    const d = openDatabase(paths.dbFile)
    try {
      const r = migrate(d, {
        beforeMigrate: (_pending, from) => {
          snapshotDatabase(d, paths.backupDir, `pre-upgrade-v${from}`)
          log.info('db.pre_migration_backup', { version: from })
        },
      })
      if (r.applied.length) log.info('db.migrated', { from: r.from, to: r.to })
      seedDefaultCategories(d)
      return d
    } catch (err) {
      d.close()
      throw err
    }
  }

  function openDemo(timezone: string): Db {
    removeDbFiles(demoFile)
    const d = openDatabase(demoFile)
    migrate(d)
    seedDefaultCategories(d)
    seedDemoData(d, todayIn(timezone))
    return d
  }

  const current = (): Db => {
    if (!db) throw new AppError('INTERNAL', 'Your data is not open')
    return db
  }

  function close() {
    try {
      db?.exec('PRAGMA optimize')
      db?.close()
    } catch {
      // Closing is best-effort; WAL keeps committed data durable.
    }
    db = undefined
  }

  const parent = () => window() ?? undefined

  const env: AppEnv = {
    dataDir: paths.dataDir,
    defaultBackupDir: paths.backupDir,
    workDir,
    isDemo: () => demo,

    async restore(live, path, passphrase) {
      const prepared = await prepareBackup(path, passphrase, workDir)
      if (!prepared.file || !prepared.inspection.valid) {
        throw new AppError('VALIDATION', prepared.inspection.valid ? 'The backup could not be read' : prepared.inspection.message)
      }
      const preRestoreBackup = await createBackup(live, backupDirFor(live, env), 'pre-restore')
      close()
      try {
        swapDatabaseFile(paths.dbFile, prepared.file)
      } catch {
        rmSync(prepared.file, { force: true })
        db = openReal()
        throw new AppError('IO', 'Fin could not replace your data file. Nothing was changed.')
      }
      try {
        db = openReal() // upgrades an older backup to the current schema
      } catch {
        // Put the data back exactly as it was before the restore.
        close()
        const back = join(workDir, 'put-back.db')
        copyFileSync(preRestoreBackup.path, back)
        swapDatabaseFile(paths.dbFile, back)
        db = openReal()
        throw new AppError('INVARIANT', 'That backup could not be opened, so your data was left as it was.')
      }
      log.info('backup.restored')
      return { preRestoreBackup, counts: countData(db) }
    },

    enterDemo() {
      if (demo) return current()
      const timezone = getSettings(current()).timezone
      close()
      try {
        db = openDemo(timezone)
        demo = true
      } catch (err) {
        db = openReal()
        throw err
      }
      log.info('demo.entered')
      return db
    },

    exitDemo() {
      if (!demo) return current()
      close()
      removeDbFiles(demoFile)
      demo = false
      db = openReal()
      log.info('demo.exited')
      return db
    },

    async chooseFile(title) {
      const win = parent()
      const opts = {
        title,
        properties: ['openFile' as const],
        filters: [
          { name: 'Fin backups', extensions: ['db', 'finbackup'] },
          { name: 'All files', extensions: ['*'] },
        ],
      }
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      return r.canceled ? null : (r.filePaths[0] ?? null)
    },

    async chooseSavePath(title, defaultName, ext) {
      const win = parent()
      const opts = {
        title,
        defaultPath: join(app.getPath('documents'), defaultName),
        filters: [{ name: ext === 'json' ? 'JSON' : 'CSV (spreadsheets)', extensions: [ext] }],
      }
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      return r.canceled || !r.filePath ? null : r.filePath
    },

    async chooseFolder(title) {
      const win = parent()
      const opts = { title, properties: ['openDirectory' as const, 'createDirectory' as const] }
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      return r.canceled ? null : (r.filePaths[0] ?? null)
    },

    async openFolder(path) {
      await shell.openPath(path)
    },
  }

  return {
    env,
    /** Open the real database; a leftover demo file or scratch files from a crash are removed first. */
    start(): Db {
      removeDbFiles(demoFile)
      rmSync(workDir, { recursive: true, force: true })
      mkdirSync(workDir, { recursive: true })
      db = openReal()
      return db
    },
    get db(): Db {
      return current()
    },
    /** Once per day on launch (FR-031), never blocking startup; falls back to the default folder. */
    async dailyBackup(): Promise<void> {
      if (demo || !db) return
      const live = db
      const dirs = [...new Set([backupDirFor(live, env), paths.backupDir])]
      for (const dir of dirs) {
        try {
          const made = await autoBackupIfDue(live, dir)
          if (made) log.info('backup.auto')
          return
        } catch {
          log.warn('backup.auto_failed')
        }
      }
    },
    close,
  }
}
