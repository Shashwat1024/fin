import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
/** Only primitive, non-financial context is allowed: channel names, codes, durations, counts. */
export type LogContext = Record<string, string | number | boolean>
export type Logger = Record<LogLevel, (event: string, ctx?: LogContext) => void>

const ALLOWED_KEYS = new Set(['channel', 'code', 'ms', 'kind', 'count', 'version', 'from', 'to', 'phase'])

/**
 * Redact anything that could be financial data (Constitution I): digits become '#',
 * quoted text is dropped, and only allow-listed context keys survive.
 */
export function redact(value: string): string {
  return value
    .replace(/(["'“”‘’]).*?\1/g, '"…"')
    .replace(/\d/g, '#')
    .slice(0, 200)
}

export function formatLine(level: LogLevel, event: string, ctx: LogContext = {}, at = new Date()): string {
  const safe: string[] = []
  for (const [k, v] of Object.entries(ctx)) {
    if (!ALLOWED_KEYS.has(k)) continue
    // Durations and counts are numbers we generate, not user data.
    safe.push(
      `${k}=${typeof v === 'number' && (k === 'ms' || k === 'count' || k === 'version') ? v : redact(String(v))}`,
    )
  }
  return `${at.toISOString()} ${level.toUpperCase()} ${redact(event)}${safe.length ? ' ' + safe.join(' ') : ''}`
}

const MAX_BYTES = 1_000_000

export function createFileLogger(file: string, minLevel: LogLevel = 'info'): Logger {
  const order: LogLevel[] = ['debug', 'info', 'warn', 'error']
  mkdirSync(dirname(file), { recursive: true })
  const write = (level: LogLevel, event: string, ctx?: LogContext) => {
    if (order.indexOf(level) < order.indexOf(minLevel)) return
    try {
      if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > MAX_BYTES) renameSync(file, `${file}.1`)
      appendFileSync(file, formatLine(level, event, ctx) + '\n')
    } catch {
      // Logging must never break the app.
    }
  }
  return {
    debug: (e, c) => write('debug', e, c),
    info: (e, c) => write('info', e, c),
    warn: (e, c) => write('warn', e, c),
    error: (e, c) => write('error', e, c),
  }
}
