import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { countData, createBackup, inspectBackup, listBackups, localDate, newestFirst } from '@db/backup'
import type { Db } from '@db/connection'
import { exportJson, exportTransactionsCsv } from '@db/export'
import { getSettings, updateSettings } from '@db/repos/settings'
import { AppError, invariant } from '@shared/errors'
import type { AppStatus, BackupInfo } from '@shared/types'
import type { AppEnv } from './env'
import type { Handlers } from './handlers'

/** Where new backups go: the folder chosen in Settings, or the default inside the data folder. */
export const backupDirFor = (db: Db, env: AppEnv) => getSettings(db).backupDir || env.defaultBackupDir

function status(db: Db, env: AppEnv): AppStatus {
  return { demo: env.isDemo(), dataDir: env.dataDir, backupDir: backupDirFor(db, env), defaultBackupDir: env.defaultBackupDir, counts: countData(db) }
}

function noDemo(env: AppEnv, what: string) {
  if (env.isDemo()) throw invariant(`${what} is not available with demo data. Exit the demo first.`)
}

function writable(dir: string) {
  try {
    mkdirSync(dir, { recursive: true })
    const probe = join(dir, `.fin-write-test-${process.pid}`)
    writeFileSync(probe, '')
    rmSync(probe)
  } catch {
    throw new AppError('IO', 'Fin cannot write to that folder. Choose another one.')
  }
}

type BackupChannels =
  | 'app.status'
  | 'backup.list'
  | 'backup.create'
  | 'backup.pickFile'
  | 'backup.inspect'
  | 'backup.restore'
  | 'backup.chooseFolder'
  | 'backup.openFolder'
  | 'export.json'
  | 'export.csv'
  | 'demo.enter'
  | 'demo.exit'

export const backupHandlers: Pick<Handlers, BackupChannels> = {
  'app.status': ({ db, env }) => status(db, env),
  'backup.list': ({ db, env }) => {
    // Safety copies made before upgrades always go to the default folder, so list both.
    const seen = new Map<string, BackupInfo>()
    for (const b of [...listBackups(backupDirFor(db, env)), ...listBackups(env.defaultBackupDir)]) seen.set(b.path, b)
    return [...seen.values()].sort(newestFirst)
  },
  'backup.create': async ({ db, env }, input) => {
    noDemo(env, 'Backing up')
    const dir = backupDirFor(db, env)
    writable(dir)
    return createBackup(db, dir, 'manual', { passphrase: input?.passphrase })
  },
  'backup.pickFile': async ({ env }) => {
    const path = await env.chooseFile('Choose a Fin backup')
    return path ? { path } : null
  },
  'backup.inspect': ({ env }, input) => inspectBackup(input.path, input.passphrase || undefined, env.workDir),
  'backup.restore': async ({ db, env }, input) => {
    noDemo(env, 'Restoring')
    return env.restore(db, input.path, input.passphrase || undefined)
  },
  'backup.chooseFolder': async ({ db, env }) => {
    noDemo(env, 'Changing the backup folder')
    const dir = await env.chooseFolder('Choose where to keep backups')
    if (!dir) return null
    writable(dir)
    return updateSettings(db, { backupDir: dir })
  },
  'backup.openFolder': async ({ db, env }) => {
    const dir = backupDirFor(db, env)
    mkdirSync(dir, { recursive: true })
    await env.openFolder(dir)
    return null
  },
  'export.json': async ({ db, env }) => {
    const path = await env.chooseSavePath('Export all data', `fin-export-${localDate(new Date())}.json`, 'json')
    if (!path) return null
    writeFileSync(path, `${JSON.stringify(exportJson(db), null, 2)}\n`)
    return { path }
  },
  'export.csv': async ({ db, env }) => {
    const path = await env.chooseSavePath('Export transactions', `fin-transactions-${localDate(new Date())}.csv`, 'csv')
    if (!path) return null
    writeFileSync(path, exportTransactionsCsv(db))
    return { path }
  },
  'demo.enter': ({ env }) => status(env.enterDemo(), env),
  'demo.exit': ({ env }) => status(env.exitDemo(), env),
}
