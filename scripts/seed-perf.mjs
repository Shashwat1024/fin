// Writes a synthetic 50,000-transaction profile for manual performance checks (quickstart §7).
// Usage: npm run seed:perf [-- <folder>]   then   $env:FIN_DATA_DIR='<folder>'; npm run dev
// The seed lives in the Rust backend (crates/fin-core/src/db/seed_perf.rs); this builds and runs
// `fin-cli --seed-perf` against the folder.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dir = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), 'fin-perf-'))
mkdirSync(dir, { recursive: true })
if (existsSync(join(dir, 'fin.db'))) {
  console.error(`${join(dir, 'fin.db')} already exists; choose an empty folder.`)
  process.exit(1)
}
const sep = process.platform === 'win32' ? ';' : ':'
const env = { ...process.env, PATH: `${join(homedir(), '.cargo', 'bin')}${sep}${process.env.PATH}` }
const build = spawnSync('cargo', ['build', '-q', '--release', '-p', 'fin-core', '--bin', 'fin-cli'], {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (build.status !== 0) process.exit(build.status ?? 1)
const exe = join(root, 'target', 'release', process.platform === 'win32' ? 'fin-cli.exe' : 'fin-cli')
const run = spawnSync(exe, ['--seed-perf'], { env: { ...env, FIN_DATA_DIR: dir }, stdio: 'inherit' })
if (run.status !== 0) process.exit(run.status ?? 1)
console.log(`Open it with:  $env:FIN_DATA_DIR='${dir}'; npm run dev`)
