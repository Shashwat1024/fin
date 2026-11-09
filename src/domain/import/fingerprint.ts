import { diffDays, type CalendarDate } from '../dates'

/** Case, spacing and punctuation never make two statement lines different. Digits (references) do. */
export function normalizeDescription(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

/**
 * Exact identity of a statement line within one account. Stored verbatim (no hashing), so two
 * different lines can never collide.
 */
export function fingerprintKey(date: CalendarDate, amountMinor: number, description: string): string {
  return `${date}|${amountMinor}|${normalizeDescription(description)}`
}

/**
 * Number repeated identical lines within one file 0, 1, 2… so two genuine ₹40 chai payments on the
 * same day stay two transactions, while re-importing the same file matches line for line.
 */
export function occurrenceIndexes(keys: readonly string[]): number[] {
  const seen = new Map<string, number>()
  return keys.map((k) => {
    const n = seen.get(k) ?? 0
    seen.set(k, n + 1)
    return n
  })
}

/** Same amount within ±2 days: worth a human look, never decided automatically. */
export function isPossibleDuplicate(
  a: { date: CalendarDate; amountMinor: number },
  b: { date: CalendarDate; amountMinor: number },
  windowDays = 2,
): boolean {
  return a.amountMinor === b.amountMinor && Math.abs(diffDays(a.date, b.date)) <= windowDays
}
