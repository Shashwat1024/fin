/**
 * Money is always an integer count of minor units (e.g. paise) plus an ISO-4217 code.
 * Floating point is never used for amounts (Constitution II).
 */
export type Money = { readonly minor: number; readonly currency: string }

export const DEFAULT_CURRENCY = 'INR'

export class MoneyError extends Error {
  override name = 'MoneyError'
}

function assertMinor(minor: number): void {
  if (!Number.isSafeInteger(minor))
    throw new MoneyError(`Amount must be a safe integer of minor units, got ${minor}`)
}

export function money(minor: number, currency: string = DEFAULT_CURRENCY): Money {
  assertMinor(minor)
  // Normalise -0 to 0 so equality and formatting behave.
  return { minor: minor === 0 ? 0 : minor, currency }
}

function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new MoneyError(`Currency mismatch: ${a.currency} vs ${b.currency}`)
}

export function add(a: Money, b: Money): Money {
  sameCurrency(a, b)
  return money(a.minor + b.minor, a.currency)
}

export function subtract(a: Money, b: Money): Money {
  sameCurrency(a, b)
  return money(a.minor - b.minor, a.currency)
}

export function negate(a: Money): Money {
  return money(-a.minor, a.currency)
}

export function sumMinor(values: readonly number[]): number {
  let total = 0
  for (const v of values) {
    assertMinor(v)
    total += v
  }
  assertMinor(total)
  return total
}

/** Number of minor-unit digits for a currency (INR → 2, JPY → 0). */
export function minorDigits(currency: string): number {
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  )
}

/**
 * Split `totalMinor` into parts proportional to `weights` using the largest-remainder method,
 * so the parts always sum exactly to the total.
 */
export function allocate(totalMinor: number, weights: readonly number[]): number[] {
  assertMinor(totalMinor)
  if (weights.length === 0) throw new MoneyError('allocate needs at least one weight')
  if (weights.some((w) => w < 0 || !Number.isFinite(w))) throw new MoneyError('weights must be non-negative')
  const weightSum = weights.reduce((s, w) => s + w, 0)
  if (weightSum === 0) throw new MoneyError('weights must not all be zero')
  const sign = totalMinor < 0 ? -1 : 1
  const abs = Math.abs(totalMinor)
  const raw = weights.map((w) => (abs * w) / weightSum)
  const parts = raw.map(Math.floor)
  let remainder = abs - parts.reduce((s, p) => s + p, 0)
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let k = 0; remainder > 0; k = (k + 1) % order.length, remainder--) {
    parts[order[k]!.i]! += 1
  }
  return parts.map((p) => (p === 0 ? 0 : p * sign))
}

export type FormatOptions = {
  locale?: string
  /** 'auto' shows "-" for negatives; 'never' shows absolute value. */
  signDisplay?: 'auto' | 'never' | 'always' | 'exceptZero'
  compact?: boolean
}

const formatterCache = new Map<string, Intl.NumberFormat>()

function formatter(currency: string, opts: FormatOptions): Intl.NumberFormat {
  const key = `${opts.locale ?? 'en-IN'}|${currency}|${opts.signDisplay ?? 'auto'}|${opts.compact ? 1 : 0}`
  let f = formatterCache.get(key)
  if (!f) {
    const digits = minorDigits(currency)
    f = new Intl.NumberFormat(opts.locale ?? 'en-IN', {
      style: 'currency',
      currency,
      signDisplay: opts.signDisplay ?? 'auto',
      ...(opts.compact
        ? { notation: 'compact', maximumFractionDigits: 1 }
        : { minimumFractionDigits: digits, maximumFractionDigits: digits }),
    })
    formatterCache.set(key, f)
  }
  return f
}

/** Format for display, e.g. ₹1,25,000.00 with Indian digit grouping by default. */
export function formatMoney(m: Money, opts: FormatOptions = {}): string {
  const digits = minorDigits(m.currency)
  // Integer → decimal string conversion is exact for safe integers at 0–3 digits.
  return formatter(m.currency, opts).format(m.minor / 10 ** digits)
}

/** Plain decimal string in major units, e.g. -450.00 (used for CSV export). */
export function toMajorString(minor: number, currency: string = DEFAULT_CURRENCY): string {
  assertMinor(minor)
  const digits = minorDigits(currency)
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
    .toString()
    .padStart(digits + 1, '0')
  if (digits === 0) return sign + abs
  return `${sign}${abs.slice(0, -digits)}.${abs.slice(-digits)}`
}

export type ParseResult = { ok: true; minor: number } | { ok: false; reason: string }

/**
 * Parse a human/bank amount string into minor units without floating point.
 * Accepts: "1,25,000.50", "₹ 450", "Rs. 99.9", "450.00 Dr", "1,000 CR", "(500.00)", "-12", "+3".
 * Dr / parentheses / leading minus → negative. Cr → positive.
 */
export function parseAmount(input: string, currency: string = DEFAULT_CURRENCY): ParseResult {
  let s = input.trim()
  if (s === '') return { ok: false, reason: 'Amount is empty' }
  let negative = false
  const suffix = /\s*\b(dr|cr)\.?$/i.exec(s)
  if (suffix) {
    negative = suffix[1]!.toLowerCase() === 'dr'
    s = s.slice(0, suffix.index).trim()
  }
  if (/^\(.*\)$/.test(s)) {
    negative = !negative
    s = s.slice(1, -1).trim()
  }
  s = s.replace(/^(₹|rs\.?|inr)\s*/i, '').trim()
  if (s.startsWith('-')) {
    negative = !negative
    s = s.slice(1).trim()
  } else if (s.startsWith('+')) {
    s = s.slice(1).trim()
  }
  s = s.replace(/^(₹|rs\.?|inr)\s*/i, '').trim()
  s = s.replace(/[,\s]/g, '')
  const digits = minorDigits(currency)
  const re = digits === 0 ? /^\d+$/ : new RegExp(`^(\\d+)(?:\\.(\\d{1,${digits}}))?$|^\\.(\\d{1,${digits}})$`)
  const m = re.exec(s)
  if (!m) return { ok: false, reason: `"${input.trim()}" is not a valid amount` }
  const whole = digits === 0 ? m[0] : (m[1] ?? '0')
  const frac = digits === 0 ? '' : (m[2] ?? m[3] ?? '').padEnd(digits, '0')
  const minor = Number(whole + frac)
  if (!Number.isSafeInteger(minor)) return { ok: false, reason: 'Amount is too large' }
  return { ok: true, minor: negative && minor !== 0 ? -minor : minor }
}
