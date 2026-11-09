import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  autoBackupIfDue,
  countData,
  createBackup,
  inspectBackup,
  listBackups,
  parseBackupName,
  prepareBackup,
  pruneAutoBackups,
  swapDatabaseFile,
} from '@db/backup'
import { openDatabase, type Db } from '@db/connection'
import { currentSchemaVersion, LATEST_SCHEMA_VERSION, migrate, MIGRATIONS } from '@db/migrate'
import { createAccount, listAccounts } from '@db/repos/accounts'
import { createTransaction, queryTransactions } from '@db/repos/transactions'
import { seedDefaultCategories } from '@db/seed/categories'
import { snapshotDatabase } from '@db/snapshot'

const FAST = { logN: 10, r: 8, p: 1 }
let dir: string
let dbFile: string
let backups: string
let work: string
let db: Db

function openFin(file = dbFile): Db {
  const d = openDatabase(file)
  migrate(d)
  seedDefaultCategories(d)
  return d
}

function fingerprint(d: Db) {
  return {
    counts: countData(d),
    balances: listAccounts(d).map((a) => [a.name, a.balanceMinor]),
    totals: queryTransactions(d, {}).totals,
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fin-backup-'))
  dbFile = join(dir, 'fin.db')
  backups = join(dir, 'backups')
  work = join(dir, 'tmp')
  db = openFin()
  const bank = createAccount(db, { name: 'HDFC', type: 'bank', openingBalanceMinor: 5_000_000, openingDate: '2026-10-01' }).account.id
  createTransaction(db, { accountId: bank, postedDate: '2026-10-02', amountMinor: -45_000, payee: 'Swiggy' })
  createTransaction(db, { accountId: bank, postedDate: '2026-10-05', amountMinor: 8_500_000, payee: 'Salary' })
})

afterEach(() => {
  try {
    db.close()
  } catch {
    // already closed by the test
  }
  rmSync(dir, { recursive: true, force: true })
})

/** What the app does on restore: back up, close, swap the file in, reopen (migrating up). */
async function restore(path: string, passphrase?: string) {
  const prepared = await prepareBackup(path, passphrase, work)
  if (!prepared.file) throw new Error(prepared.inspection.valid ? 'no file' : prepared.inspection.message)
  await createBackup(db, backups, 'pre-restore')
  db.close()
  swapDatabaseFile(dbFile, prepared.file)
  db = openFin()
}

describe('backups', () => {
  it('names, lists and parses backups newest first, ignoring other files', async () => {
    await createBackup(db, backups, 'manual', { now: new Date(2026, 10, 8, 9, 30, 0) })
    await createBackup(db, backups, 'auto', { now: new Date(2026, 10, 9, 7, 0, 5) })
    await createBackup(db, backups, 'auto', { now: new Date(2026, 10, 9, 7, 0, 5) }) // same second
    writeFileSync(join(backups, 'notes.txt'), 'hello')
    const list = listBackups(backups)
    expect(list.map((b) => b.fileName)).toEqual([
      'fin-20261109-070005-auto_2.db',
      'fin-20261109-070005-auto.db',
      'fin-20261108-093000-manual.db',
    ])
    expect(list[2]).toMatchObject({ kind: 'manual', createdAt: '2026-11-08T09:30:00', encrypted: false })
    expect(list[0]!.sizeBytes).toBeGreaterThan(0)
    expect(parseBackupName('fin-20261101-120000-pre-upgrade-v1.db')).toMatchObject({ kind: 'pre-upgrade' })
    expect(readdirSync(backups).some((f) => f.endsWith('.tmp'))).toBe(false)
  })

  it('makes one automatic backup per day and keeps the latest 14', async () => {
    for (let day = 1; day <= 16; day++) {
      expect(await autoBackupIfDue(db, backups, new Date(2026, 9, day, 8))).not.toBeNull()
      expect(await autoBackupIfDue(db, backups, new Date(2026, 9, day, 20))).toBeNull()
    }
    await createBackup(db, backups, 'manual')
    const autos = listBackups(backups).filter((b) => b.kind === 'auto')
    expect(autos).toHaveLength(14)
    expect(autos.at(-1)!.createdAt.slice(0, 10)).toBe('2026-10-03')
    expect(pruneAutoBackups(backups, 14)).toEqual([])
    expect(listBackups(backups).filter((b) => b.kind === 'manual')).toHaveLength(1)
  })

  it('round-trips: backup → change → restore gives back exactly the backed-up data', async () => {
    const before = fingerprint(db)
    const backup = await createBackup(db, backups, 'manual')
    const bank = listAccounts(db)[0]!.id
    createTransaction(db, { accountId: bank, postedDate: '2026-10-09', amountMinor: -1_800_000, payee: 'Rent' })
    createAccount(db, { name: 'Wallet', type: 'cash', openingBalanceMinor: 100, openingDate: '2026-10-01' })
    const changed = fingerprint(db)
    expect(changed).not.toEqual(before)

    await restore(backup.path)
    expect(fingerprint(db)).toEqual(before)
    // The data replaced by the restore was itself backed up first.
    const pre = listBackups(backups).find((b) => b.kind === 'pre-restore')!
    const inspected = await inspectBackup(pre.path, undefined, work)
    expect(inspected).toMatchObject({ valid: true, counts: changed.counts })
  })

  it('restores an encrypted backup only with the right passphrase', async () => {
    const before = fingerprint(db)
    const enc = await createBackup(db, backups, 'manual', { passphrase: 'long enough', kdf: FAST })
    expect(enc).toMatchObject({ encrypted: true })
    expect(enc.fileName.endsWith('.finbackup')).toBe(true)
    expect(await inspectBackup(enc.path, undefined, work)).toMatchObject({ valid: false, reason: 'NEEDS_PASSPHRASE' })
    expect(await inspectBackup(enc.path, 'wrong one!', work)).toMatchObject({ valid: false, reason: 'WRONG_PASSPHRASE' })
    expect(await inspectBackup(enc.path, 'long enough', work)).toMatchObject({ valid: true, encrypted: true, counts: before.counts })

    createAccount(db, { name: 'Wallet', type: 'cash', openingBalanceMinor: 100, openingDate: '2026-10-01' })
    await restore(enc.path, 'long enough')
    expect(fingerprint(db)).toEqual(before)
    // No decrypted copy is left lying around.
    expect(existsSync(work) ? readdirSync(work) : []).toEqual([])
  })

  it('refuses files that are not Fin backups, are damaged or missing, leaving data unchanged', async () => {
    const before = fingerprint(db)
    const text = join(dir, 'statement.csv')
    writeFileSync(text, 'Date,Narration,Amount\n01/10/26,UPI,100\n')
    const other = join(dir, 'other.db')
    const o = openDatabase(other)
    o.exec('CREATE TABLE t (x)')
    o.close()
    const good = await createBackup(db, backups, 'manual')
    const truncated = join(dir, 'truncated.db')
    writeFileSync(truncated, (await import('node:fs')).readFileSync(good.path).subarray(0, 2048))

    expect(await inspectBackup(text, undefined, work)).toMatchObject({ valid: false, reason: 'NOT_FIN' })
    expect(await inspectBackup(other, undefined, work)).toMatchObject({ valid: false, reason: 'NOT_FIN' })
    expect((await inspectBackup(truncated, undefined, work)).valid).toBe(false)
    expect(await inspectBackup(join(dir, 'nope.db'), undefined, work)).toMatchObject({ valid: false, reason: 'NOT_FOUND' })
    await expect(restore(text)).rejects.toThrow('not a Fin backup')
    expect(fingerprint(db)).toEqual(before)
  })

  it('restores a backup from an older schema and upgrades it', async () => {
    const oldFile = join(dir, 'old.db')
    const old = openDatabase(oldFile)
    migrate(old, { migrations: MIGRATIONS.slice(0, 1) })
    seedDefaultCategories(old)
    createAccount(old, { name: 'Old bank', type: 'bank', openingBalanceMinor: 123_400, openingDate: '2025-04-01' })
    const oldBackup = snapshotDatabase(old, backups, 'manual')
    old.close()

    const inspected = await inspectBackup(oldBackup, undefined, work)
    expect(inspected).toMatchObject({ valid: true, schemaVersion: 1, needsUpgrade: true })
    await restore(oldBackup)
    expect(currentSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION)
    expect(listAccounts(db).map((a) => [a.name, a.balanceMinor])).toEqual([['Old bank', 123_400]])
  })

  it('refuses a backup from a newer version of the app', async () => {
    const newer = await createBackup(db, backups, 'manual')
    const d = openDatabase(newer.path)
    d.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(LATEST_SCHEMA_VERSION + 1, 'future', 'x')
    d.close()
    expect(await inspectBackup(newer.path, undefined, work)).toMatchObject({ valid: false, reason: 'TOO_NEW' })
  })
})
