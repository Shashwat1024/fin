import { join } from 'node:path'

export type AppPaths = { dataDir: string; dbFile: string; backupDir: string; logFile: string }

/** All user data lives in one folder; FIN_DATA_DIR overrides it (used by tests and manual QA). */
export function resolvePaths(appDataDir: string, env: NodeJS.ProcessEnv = process.env): AppPaths {
  const dataDir = env.FIN_DATA_DIR?.trim() || join(appDataDir, 'Fin')
  return {
    dataDir,
    dbFile: join(dataDir, 'fin.db'),
    backupDir: join(dataDir, 'backups'),
    logFile: join(dataDir, 'logs', 'fin.log'),
  }
}
