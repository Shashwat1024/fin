import { addDays, addMonths, compareDates, diffDays, parts, type CalendarDate } from './dates'

/**
 * Recurring schedules (research R12). An occurrence is computed from the anchor each time
 * (anchor + n × interval), never from the previous occurrence, so a schedule anchored on the 31st
 * lands on 30 Apr and 28/29 Feb and then returns to the 31st.
 */
export const FREQUENCIES = ['weekly', 'monthly', 'yearly'] as const
export type Frequency = (typeof FREQUENCIES)[number]

export type Schedule = {
  frequency: Frequency
  /** Every N weeks / months / years (≥ 1). */
  interval: number
  /** The first occurrence. Its day of month (or weekday) repeats. */
  anchorDate: CalendarDate
  /** No occurrences after this date. */
  endDate?: CalendarDate | null
  /** At most this many occurrences in total. */
  count?: number | null
}

/** The n-th occurrence (0-based), with month-end clamping. */
export function nthOccurrence(s: Schedule, n: number): CalendarDate {
  switch (s.frequency) {
    case 'weekly':
      return addDays(s.anchorDate, 7 * s.interval * n)
    case 'monthly':
      return addMonths(s.anchorDate, s.interval * n)
    case 'yearly':
      return addMonths(s.anchorDate, 12 * s.interval * n)
  }
}

/** Index of the first occurrence on or after `date` (a lower bound; may be a little early). */
function firstIndexFrom(s: Schedule, date: CalendarDate): number {
  if (compareDates(date, s.anchorDate) <= 0) return 0
  const a = parts(s.anchorDate)
  const d = parts(date)
  const months = (d.year - a.year) * 12 + (d.month - a.month)
  const raw =
    s.frequency === 'weekly'
      ? Math.floor(diffDays(date, s.anchorDate) / (7 * s.interval))
      : Math.floor(months / (s.frequency === 'yearly' ? 12 * s.interval : s.interval))
  return Math.max(0, raw - 1)
}

/** Occurrence dates within [from, to], in order. */
export function occurrencesBetween(s: Schedule, from: CalendarDate, to: CalendarDate): CalendarDate[] {
  if (s.interval < 1 || !Number.isInteger(s.interval)) throw new RangeError('interval must be a positive integer')
  const out: CalendarDate[] = []
  const last = s.endDate && compareDates(s.endDate, to) < 0 ? s.endDate : to
  for (let n = firstIndexFrom(s, from); ; n++) {
    if (s.count != null && n >= s.count) break
    const date = nthOccurrence(s, n)
    if (compareDates(date, last) > 0) break
    if (compareDates(date, from) >= 0) out.push(date)
  }
  return out
}

/** The first occurrence on or after `date`, or null when the schedule has ended. */
export function nextOccurrence(s: Schedule, date: CalendarDate): CalendarDate | null {
  // Yearly schedules can be up to interval years apart.
  const horizon = s.frequency === 'yearly' ? 366 * s.interval + 1 : s.frequency === 'monthly' ? 31 * s.interval + 1 : 7 * s.interval
  return occurrencesBetween(s, date, addDays(date, horizon))[0] ?? null
}

export function describeSchedule(s: Schedule): string {
  const { day } = parts(s.anchorDate)
  const every = (unit: string) => (s.interval === 1 ? `Every ${unit}` : `Every ${s.interval} ${unit}s`)
  const weekday = new Intl.DateTimeFormat('en-IN', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${s.anchorDate}T00:00:00Z`))
  const dayText = day >= 29 ? `${ordinal(day)} (or the last day)` : ordinal(day)
  switch (s.frequency) {
    case 'weekly':
      return `${every('week')} on ${weekday}`
    case 'monthly':
      return `${every('month')} on the ${dayText}`
    case 'yearly': {
      const month = new Intl.DateTimeFormat('en-IN', { month: 'long', timeZone: 'UTC' }).format(new Date(`${s.anchorDate}T00:00:00Z`))
      return `${every('year')} on ${day} ${month}`
    }
  }
}

function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  const rem10 = n % 10
  return `${n}${rem10 === 1 ? 'st' : rem10 === 2 ? 'nd' : rem10 === 3 ? 'rd' : 'th'}`
}

// ---- Matching (FR-022) ---------------------------------------------------------------------------

/** Default amount tolerance: ±10%, in basis points. */
export const DEFAULT_TOLERANCE_BP = 1000
/** A payment counts if it lands within this many days of the due date. */
export const MATCH_WINDOW_DAYS = 3

/** Same direction, and |actual − expected| ≤ tolerance × |expected| (integer maths, no floats). */
export function withinTolerance(expectedMinor: number, actualMinor: number, toleranceBp: number): boolean {
  if (expectedMinor === 0 || Math.sign(expectedMinor) !== Math.sign(actualMinor)) return false
  return Math.abs(actualMinor - expectedMinor) * 10_000 <= Math.abs(expectedMinor) * toleranceBp
}

export type MatchCandidate = { id: string; postedDate: CalendarDate; amountMinor: number }

/**
 * The best transaction for an occurrence: within the date window and tolerance, nearest date
 * first, then nearest amount, then earliest id (deterministic). Ids in `used` are skipped.
 */
export function bestMatch(
  dueDate: CalendarDate,
  expectedMinor: number,
  toleranceBp: number,
  candidates: readonly MatchCandidate[],
  used: ReadonlySet<string> = new Set(),
): MatchCandidate | null {
  let best: { c: MatchCandidate; days: number; diff: number } | null = null
  for (const c of candidates) {
    if (used.has(c.id)) continue
    const days = Math.abs(diffDays(c.postedDate, dueDate))
    if (days > MATCH_WINDOW_DAYS || !withinTolerance(expectedMinor, c.amountMinor, toleranceBp)) continue
    const diff = Math.abs(c.amountMinor - expectedMinor)
    if (!best || days < best.days || (days === best.days && (diff < best.diff || (diff === best.diff && c.id < best.c.id)))) {
      best = { c, days, diff }
    }
  }
  return best?.c ?? null
}

export type OccurrenceState = 'expected' | 'paid' | 'overdue' | 'skipped'

/** expected → paid (matched) · expected → overdue (due date passed) · any → skipped (user). */
export function occurrenceState(dueDate: CalendarDate, today: CalendarDate, matched: boolean, skipped: boolean): OccurrenceState {
  if (skipped) return 'skipped'
  if (matched) return 'paid'
  return compareDates(dueDate, today) < 0 ? 'overdue' : 'expected'
}
