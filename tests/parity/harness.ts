/**
 * Backend parity harness for the Rust port (specs/002-rust-tauri-port). A script of calls runs
 * against both backends from an empty data folder at the same fixed moment:
 *  - TypeScript: the real dispatcher, in process, with the clock frozen by Vitest.
 *  - Rust: `fin-cli` (crates/fin-core/src/bin/fin-cli.rs) as a child process, FIN_FAKE_NOW set.
 * Inputs may depend on earlier results; each backend resolves them from its own answers. Outputs
 * are compared after generated ids are replaced by tokens in order of first appearance
 * (`acc#1`, `txn#3`), and the data folder path is masked.
 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface, type Interface } from 'node:readline'
import { vi } from 'vitest'
import { openDatabase, type Db } from '@db/connection'
import { migrate } from '@db/migrate'
import { backfillMerchants } from '@db/repos/categories'
import { seedDefaultCategories } from '@db/seed/categories'
import { dispatch } from '../../src/main/dispatch'
import { fakeEnv } from '../integration/db/helpers'

export const FIXED_NOW = '2026-11-10T06:30:00.000Z'
/** When an upgraded app first opens data written earlier (see compareOnTsData). */
export const LATER_NOW = '2026-11-11T06:30:00.000Z'

/** A result envelope as both backends return it. */
export type Reply = {
  ok: boolean
  data?: unknown
  error?: { code: string; message: string; issues?: unknown }
}
export type Step = {
  name: string
  /** A request channel, or 'clock' to move both backends' clocks to `input` (an ISO instant). */
  channel: string
  /** A value, or a function of earlier replies (by step name) from the same backend. */
  input?:
    | ((r: Record<string, Reply>) => unknown)
    | Record<string, unknown>
    | unknown[]
    | string
    | number
    | boolean
    | null
}

const exe = resolve('target', 'debug', process.platform === 'win32' ? 'fin-cli.exe' : 'fin-cli')

/** Build fin-cli if cargo is available; returns false when Rust is not installed. */
export function ensureCli(): boolean {
  const cargo = process.env.CARGO ?? 'cargo'
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
  const env = {
    ...process.env,
    PATH: `${join(home, '.cargo', 'bin')}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`,
  }
  const r = spawnSync(cargo, ['build', '-q', '-p', 'fin-core', '--bin', 'fin-cli'], {
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  return r.status === 0 && existsSync(exe)
}

class RustBackend {
  private proc: ChildProcessWithoutNullStreams
  private lines: Interface
  private pending: ((line: string) => void)[] = []
  constructor(
    readonly dir: string,
    now = FIXED_NOW,
  ) {
    this.proc = spawn(exe, [], {
      env: { ...process.env, FIN_DATA_DIR: dir, FIN_FAKE_NOW: now, TZ: 'Asia/Kolkata' },
    })
    this.lines = createInterface({ input: this.proc.stdout })
    this.lines.on('line', (line) => this.pending.shift()?.(line))
  }
  call(channel: string, input: unknown): Promise<Reply> {
    const message =
      channel === 'clock' ? { setNow: input } : input === undefined ? { channel } : { channel, input }
    return new Promise((ok) => {
      this.pending.push((line) => ok(JSON.parse(line) as Reply))
      this.proc.stdin.write(`${JSON.stringify(message)}\n`)
    })
  }
  async close() {
    this.proc.stdin.end()
    await new Promise((ok) => this.proc.once('exit', ok))
  }
}

class TsBackend {
  readonly db: Db
  constructor(readonly dir: string) {
    this.db = openDatabase(join(dir, 'fin.db'))
    migrate(this.db)
    seedDefaultCategories(this.db)
    backfillMerchants(this.db)
  }
  async call(channel: string, input: unknown): Promise<Reply> {
    if (channel === 'clock') {
      vi.setSystemTime(new Date(input as string))
      return { ok: true, data: null }
    }
    // What crosses the Tauri bridge is JSON, so the TypeScript side sees the same values.
    const sent = input === undefined ? undefined : JSON.parse(JSON.stringify(input))
    const reply = await dispatch({ db: this.db, env: fakeEnv(this.dir) }, channel, sent)
    return reply as Reply
  }
}

const ID = /\b([a-z]{3,4})_[0-9A-HJKMNP-TV-Z]{26}\b/g

/** Replace generated ids by stable tokens and mask the data folder. */
export function normalise(value: unknown, ids: Map<string, string>, dir: string): unknown {
  const text = JSON.stringify(value ?? null)
    .replaceAll(JSON.stringify(dir).slice(1, -1), '<dataDir>')
    .replace(ID, (m, prefix: string) => {
      let token = ids.get(m)
      if (!token) {
        token = `${prefix}#${[...ids.values()].filter((t) => t.startsWith(`${prefix}#`)).length + 1}`
        ids.set(m, token)
      }
      return token
    })
  return JSON.parse(text)
}

export type Comparison = { step: string; channel: string; ts: unknown; rust: unknown }

/** Run a script on both backends; returns the steps whose normalised replies differ. */
export async function compare(script: Step[]): Promise<{ differences: Comparison[]; replies: Comparison[] }> {
  const tsDir = mkdtempSync(join(tmpdir(), 'fin-parity-ts-'))
  const rsDir = mkdtempSync(join(tmpdir(), 'fin-parity-rs-'))
  vi.useFakeTimers({ now: new Date(FIXED_NOW), toFake: ['Date'] })
  const ts = new TsBackend(tsDir)
  const rust = new RustBackend(rsDir)
  const tsReplies: Record<string, Reply> = {}
  const rsReplies: Record<string, Reply> = {}
  const tsIds = new Map<string, string>()
  const rsIds = new Map<string, string>()
  const differences: Comparison[] = []
  const replies: Comparison[] = []
  try {
    for (const step of script) {
      const inputFor = (r: Record<string, Reply>) =>
        typeof step.input === 'function' ? step.input(r) : step.input
      const a = await ts.call(step.channel, inputFor(tsReplies))
      const b = await rust.call(step.channel, inputFor(rsReplies))
      tsReplies[step.name] = a
      rsReplies[step.name] = b
      const c = {
        step: step.name,
        channel: step.channel,
        ts: normalise(a, tsIds, tsDir),
        rust: normalise(b, rsIds, rsDir),
      }
      replies.push(c)
      if (JSON.stringify(c.ts) !== JSON.stringify(c.rust)) differences.push(c)
    }
  } finally {
    vi.useRealTimers()
    ts.db.close()
    await rust.close()
    rmSync(tsDir, { recursive: true, force: true })
    rmSync(rsDir, { recursive: true, force: true })
  }
  return { differences, replies }
}

/** Find an item in an earlier reply's array data. */
export function find<T = Record<string, unknown>>(reply: Reply | undefined, pred: (x: T) => boolean): T {
  const list = (reply?.data ?? []) as T[]
  const hit = list.find(pred)
  if (!hit) throw new Error('parity script: item not found')
  return hit
}

export const data = <T = Record<string, unknown>>(reply: Reply | undefined) => (reply?.data ?? {}) as T

/**
 * Upgrade path: TypeScript writes a data folder (`setup`), then the same follow-up requests
 * (`then`, which may refer to setup replies) run on TypeScript against one copy and on Rust
 * against another. Proves Rust reads, changes and undoes data written by Fin 1.x.
 */
export async function compareOnTsData(
  setup: Step[],
  then: Step[],
): Promise<{ differences: Comparison[]; replies: Comparison[] }> {
  const base = mkdtempSync(join(tmpdir(), 'fin-parity-base-'))
  const rsDir = mkdtempSync(join(tmpdir(), 'fin-parity-rs-'))
  vi.useFakeTimers({ now: new Date(FIXED_NOW), toFake: ['Date'] })
  const setupReplies: Record<string, Reply> = {}
  const differences: Comparison[] = []
  const replies: Comparison[] = []
  let ts: TsBackend | undefined
  let rust: RustBackend | undefined
  try {
    const writer = new TsBackend(base)
    for (const step of setup) {
      const input = typeof step.input === 'function' ? step.input(setupReplies) : step.input
      setupReplies[step.name] = await writer.call(step.channel, input)
    }
    writer.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    writer.db.close()
    cpSync(base, rsDir, { recursive: true })
    // A day later, as when a user upgrades: new records sort after the ones written by 1.x.
    vi.setSystemTime(new Date(LATER_NOW))
    ts = new TsBackend(base)
    rust = new RustBackend(rsDir, LATER_NOW)
    // Same file, so ids agree: one token map serves both sides.
    const tsIds = new Map<string, string>()
    const rsIds = new Map<string, string>()
    const tsReplies: Record<string, Reply> = { ...setupReplies }
    const rsReplies: Record<string, Reply> = { ...setupReplies }
    for (const step of then) {
      const inputFor = (r: Record<string, Reply>) =>
        typeof step.input === 'function' ? step.input(r) : step.input
      const a = await ts.call(step.channel, inputFor(tsReplies))
      const b = await rust.call(step.channel, inputFor(rsReplies))
      tsReplies[step.name] = a
      rsReplies[step.name] = b
      const c = {
        step: step.name,
        channel: step.channel,
        ts: normalise(a, tsIds, base),
        rust: normalise(b, rsIds, rsDir),
      }
      replies.push(c)
      if (JSON.stringify(c.ts) !== JSON.stringify(c.rust)) differences.push(c)
    }
  } finally {
    vi.useRealTimers()
    ts?.db.close()
    await rust?.close()
    rmSync(base, { recursive: true, force: true })
    rmSync(rsDir, { recursive: true, force: true })
  }
  return { differences, replies }
}
