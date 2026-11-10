import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { randomBytes } from 'node:crypto'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { BackupInfo, BackupInspection, BackupKind, DataCounts } from '@shared/types'
import {
  decryptBackup,
  encryptBackup,
  BackupCryptoError,
  isEncryptedBackup,
  type KdfParams,
} from './backupCrypto'
import { APP_ID, get, type Db } from './connection'
import { currentSchemaVersion, LATEST_SCHEMA_VERSION } from './migrate'

/** Automatic daily backups kept; manual and safety backups are never pruned automatically. */
export const AUTO_BACKUP_KEEP = 14

const FILE_RE = /^fin-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-([a-z0-9-]+?)(?:_\d+)?\.(db|finbackup)$/

const pad = (n: number) => String(n).padStart(2, '0')
export const localStamp = (d: Date) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
export const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function kindOf(token: string): BackupKind {
  if (token.startsWith('pre-upgrade')) return 'pre-upgrade'
  return token === 'auto' || token === 'pre-restore' ? token : 'manual'
}

export function parseBackupName(
  fileName: string,
): Pick<BackupInfo, 'createdAt' | 'kind' | 'encrypted'> | null {
  const m = FILE_RE.exec(fileName)
  if (!m) return null
  const [, y, mo, d, h, mi, s, kind, ext] = m
  return { createdAt: `${y}-${mo}-${d}T${h}:${mi}:${s}`, kind: kindOf(kind!), encrypted: ext === 'finbackup' }
}

function info(path: string): BackupInfo | null {
  const parsed = parseBackupName(basename(path))
  if (!parsed) return null
  return { fileName: basename(path), path, sizeBytes: statSync(path).size, ...parsed }
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
export const newestFirst = (a: BackupInfo, b: BackupInfo) =>
  cmp(b.createdAt, a.createdAt) || cmp(b.fileName, a.fileName)

/** Backups in a folder, newest first. Unrelated files are ignored. */
export function listBackups(dir: string): BackupInfo[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map((f) => info(join(dir, f)))
    .filter((b): b is BackupInfo => b !== null)
    .sort(newestFirst)
}

function freeName(dir: string, stamp: string, kind: string, ext: string): string {
  for (let i = 1; ; i++) {
    const p = join(dir, `fin-${stamp}-${kind}${i === 1 ? '' : `_${i}`}.${ext}`)
    if (!existsSync(p) && !existsSync(`${p}.tmp`)) return p
  }
}

export type BackupOptions = { passphrase?: string; now?: Date; kdf?: KdfParams }

/**
 * A consistent copy of the live database (VACUUM INTO is transactional), optionally encrypted.
 * Written to a temporary name and renamed, so a half-written file never looks like a backup.
 */
export async function createBackup(
  db: Db,
  dir: string,
  kind: BackupKind,
  opts: BackupOptions = {},
): Promise<BackupInfo> {
  mkdirSync(dir, { recursive: true })
  const final = freeName(dir, localStamp(opts.now ?? new Date()), kind, opts.passphrase ? 'finbackup' : 'db')
  const tmp = `${final}.tmp`
  try {
    if (opts.passphrase) {
      const plain = `${final}.plain.tmp`
      db.prepare('VACUUM INTO ?').run(plain)
      try {
        writeFileSync(tmp, await encryptBackup(readFileSync(plain), opts.passphrase, opts.kdf))
      } finally {
        rmSync(plain, { force: true })
      }
    } else {
      db.prepare('VACUUM INTO ?').run(tmp)
    }
    renameSync(tmp, final)
  } finally {
    rmSync(tmp, { force: true })
  }
  return info(final)!
}

/** Delete the oldest automatic backups beyond `keep`. Returns the removed file names. */
export function pruneAutoBackups(dir: string, keep = AUTO_BACKUP_KEEP): string[] {
  const old = listBackups(dir)
    .filter((b) => b.kind === 'auto')
    .slice(keep)
  for (const b of old) rmSync(b.path, { force: true })
  return old.map((b) => b.fileName)
}

/** Once per local day: make an automatic backup and prune old ones. Returns null when one exists today. */
export async function autoBackupIfDue(db: Db, dir: string, now = new Date()): Promise<BackupInfo | null> {
  const today = localDate(now)
  if (listBackups(dir).some((b) => b.kind === 'auto' && b.createdAt.startsWith(today))) return null
  const made = await createBackup(db, dir, 'auto', { now })
  pruneAutoBackups(dir)
  return made
}

export function countData(db: Db): DataCounts {
  const n = (sql: string) => get<{ n: number }>(db, sql)?.n ?? 0
  return {
    accounts: n('SELECT COUNT(*) AS n FROM accounts WHERE archived_at IS NULL'),
    transactions: n('SELECT COUNT(*) AS n FROM transactions WHERE deleted_at IS NULL'),
    // Backups from before imports existed (schema v1) have no import tables.
    importBatches: get(db, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'import_batches'")
      ? n('SELECT COUNT(*) AS n FROM import_batches WHERE undone_at IS NULL')
      : 0,
    latestTxnDate:
      get<{ d: string | null }>(db, 'SELECT MAX(posted_date) AS d FROM transactions WHERE deleted_at IS NULL')
        ?.d ?? null,
  }
}

type Prepared = { inspection: BackupInspection; file: string | null }

const fail = (reason: Extract<BackupInspection, { valid: false }>['reason'], message: string): Prepared => ({
  inspection: { valid: false, reason, message },
  file: null,
})

/**
 * Copy (or decrypt) a backup into `workDir` and check it is a healthy Fin database this app can open.
 * The returned working file is what a restore puts in place; callers delete it when done.
 */
export async function prepareBackup(
  path: string,
  passphrase: string | undefined,
  workDir: string,
): Promise<Prepared> {
  if (!existsSync(path) || !statSync(path).isFile())
    return fail('NOT_FOUND', 'The backup file could not be found.')
  mkdirSync(workDir, { recursive: true })
  const file = join(workDir, `candidate-${randomBytes(6).toString('hex')}.db`)
  const raw = readFileSync(path)
  const encrypted = isEncryptedBackup(raw)
  if (encrypted) {
    if (!passphrase) return fail('NEEDS_PASSPHRASE', 'This backup is protected. Enter its passphrase.')
    try {
      writeFileSync(file, await decryptBackup(raw, passphrase))
    } catch (err) {
      if (err instanceof BackupCryptoError && err.reason === 'WRONG_PASSPHRASE')
        return fail('WRONG_PASSPHRASE', `${err.message}.`)
      return fail('DAMAGED', 'The backup file is damaged.')
    }
  } else {
    copyFileSync(path, file)
  }

  const result = checkCandidate(file, encrypted)
  if (!result.inspection.valid) rmSync(file, { force: true })
  return result
}

function checkCandidate(file: string, encrypted: boolean): Prepared {
  let probe: DatabaseSync | undefined
  try {
    probe = new DatabaseSync(file)
    const appId = get<{ application_id: number }>(probe, 'PRAGMA application_id')?.application_id
    if (appId !== APP_ID) return fail('NOT_FIN', 'This file is not a Fin backup.')
    const check = get<{ quick_check: string }>(probe, 'PRAGMA quick_check')?.quick_check
    if (check !== 'ok') return fail('DAMAGED', 'The backup file is damaged.')
    const schemaVersion = currentSchemaVersion(probe)
    if (schemaVersion > LATEST_SCHEMA_VERSION) {
      return fail('TOO_NEW', 'This backup was made by a newer version of Fin. Update the app to restore it.')
    }
    // Restore expects a self-contained file.
    probe.exec('PRAGMA journal_mode = DELETE')
    const counts = countData(probe)
    return {
      inspection: {
        valid: true,
        encrypted,
        schemaVersion,
        needsUpgrade: schemaVersion < LATEST_SCHEMA_VERSION,
        counts,
      },
      file,
    }
  } catch {
    return fail('NOT_FIN', 'This file is not a Fin backup.')
  } finally {
    probe?.close()
  }
}

/** Check a backup without changing anything. */
export async function inspectBackup(
  path: string,
  passphrase: string | undefined,
  workDir: string,
): Promise<BackupInspection> {
  const { inspection, file } = await prepareBackup(path, passphrase, workDir)
  if (file) rmSync(file, { force: true })
  return inspection
}

/**
 * Put a prepared database file in place of the (closed) live database. The old file is kept aside
 * until the new one is in place, and put back if anything fails.
 */
export function swapDatabaseFile(dbFile: string, candidate: string): void {
  const aside = `${dbFile}.replaced`
  rmSync(aside, { force: true })
  for (const ext of ['-wal', '-shm']) rmSync(dbFile + ext, { force: true })
  const hadDb = existsSync(dbFile)
  if (hadDb) renameSync(dbFile, aside)
  try {
    renameSync(candidate, dbFile)
  } catch (err) {
    if (hadDb) renameSync(aside, dbFile)
    throw err
  }
  rmSync(aside, { force: true })
}
