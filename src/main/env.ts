import type { Db } from '@db/connection'
import type { BackupInfo, DataCounts } from '@shared/types'

/**
 * What handlers need beyond the database: where files live, OS dialogs, and swapping the open
 * database (restore, demo mode). The Electron implementation is in services/system.ts; tests use
 * a fake with temporary folders.
 */
export interface AppEnv {
  readonly dataDir: string
  readonly defaultBackupDir: string
  /** Scratch space on the same drive as the data, for decrypting and checking backups. */
  readonly workDir: string
  isDemo(): boolean
  /** Replace the live database with a checked backup, after backing up the current data. */
  restore(db: Db, path: string, passphrase: string | undefined): Promise<{ preRestoreBackup: BackupInfo; counts: DataCounts }>
  /** Switch to a fresh demo database (or back to the real one); returns the database now open. */
  enterDemo(): Db
  exitDemo(): Db
  chooseFile(title: string): Promise<string | null>
  chooseSavePath(title: string, defaultName: string, ext: 'json' | 'csv'): Promise<string | null>
  chooseFolder(title: string): Promise<string | null>
  openFolder(path: string): Promise<void>
}

export type HandlerContext = { db: Db; env: AppEnv }
