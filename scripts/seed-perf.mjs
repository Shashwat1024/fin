// Writes a synthetic 50,000-transaction profile for manual performance checks (quickstart §7).
// Usage: npm run seed:perf [-- <folder>]   then   $env:FIN_DATA_DIR='<folder>'; npm run dev
// Loads the TypeScript seed through Vite so the project's path aliases resolve.
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'

const dir = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), 'fin-perf-'))
mkdirSync(dir, { recursive: true })
const file = join(dir, 'fin.db')
if (existsSync(file)) {
  console.error(`${file} already exists; choose an empty folder.`)
  process.exit(1)
}
const root = resolve(import.meta.dirname, '..')
const alias = Object.fromEntries(['domain', 'shared', 'db'].map((d) => [`@${d}`, join(root, 'src', d)]))
const vite = await createServer({ root, configFile: false, logLevel: 'error', resolve: { alias }, server: { middlewareMode: true, hmr: false } })
try {
  const load = (p) => vite.ssrLoadModule(join(root, p))
  const { openDatabase } = await load('src/db/connection.ts')
  const { migrate } = await load('src/db/migrate.ts')
  const { seedDefaultCategories } = await load('src/db/seed/categories.ts')
  const { seedPerfData } = await load('src/db/seed/perf.ts')
  const { todayIn } = await load('src/domain/dates.ts')
  const started = performance.now()
  const db = openDatabase(file)
  migrate(db)
  seedDefaultCategories(db)
  const r = seedPerfData(db, todayIn('Asia/Kolkata'))
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  db.close()
  console.log(`Wrote ${r.transactions.toLocaleString('en-IN')} transactions in ${Math.round(performance.now() - started)} ms to ${dir}`)
  console.log(`Open it with:  $env:FIN_DATA_DIR='${dir}'; npm run dev`)
} finally {
  await vite.close()
}
