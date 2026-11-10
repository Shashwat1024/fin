/**
 * Calendar dates are plain 'YYYY-MM-DD' strings with no time zone (Constitution II).
 * All arithmetic is done on UTC-midnight Date values so DST never shifts a day.
 */
export type CalendarDate = string
/** 'YYYY-MM' */
export type MonthKey = string

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isCalendarDate(s: string): boolean {
  const m = DATE_RE.exec(s)
  if (!m) return false
  const y = Number(m[1]),
    mo = Number(m[2]),
    d = Number(m[3])
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo)
}

export function parts(date: CalendarDate): { year: number; month: number; day: number } {
  const m = DATE_RE.exec(date)
  if (!m || !isCalendarDate(date)) throw new RangeError(`Invalid calendar date: ${date}`)
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
}

export function makeDate(year: number, month: number, day: number): CalendarDate {
  const d = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  if (!isCalendarDate(d)) throw new RangeError(`Invalid calendar date: ${d}`)
  return d
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function toUtc(date: CalendarDate): number {
  const { year, month, day } = parts(date)
  return Date.UTC(year, month - 1, day)
}

function fromUtc(ms: number): CalendarDate {
  const d = new Date(ms)
  return makeDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

/** Today's calendar date in the given IANA time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): CalendarDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  return fromUtc(toUtc(date) + days * 86_400_000)
}

/** Add months, clamping the day to the target month's length (31 Jan + 1 → 28/29 Feb). */
export function addMonths(date: CalendarDate, months: number, anchorDay?: number): CalendarDate {
  const { year, month, day } = parts(date)
  const index = year * 12 + (month - 1) + months
  const y = Math.floor(index / 12)
  const mo = (index % 12) + 1
  return makeDate(y, mo, Math.min(anchorDay ?? day, daysInMonth(y, mo)))
}

export function diffDays(a: CalendarDate, b: CalendarDate): number {
  return Math.round((toUtc(a) - toUtc(b)) / 86_400_000)
}

export function compareDates(a: CalendarDate, b: CalendarDate): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(date: CalendarDate): number {
  return new Date(toUtc(date)).getUTCDay()
}

export function monthKey(date: CalendarDate): MonthKey {
  return date.slice(0, 7)
}

export function startOfMonth(date: CalendarDate): CalendarDate {
  return `${monthKey(date)}-01`
}

export function endOfMonth(date: CalendarDate): CalendarDate {
  const { year, month } = parts(date)
  return makeDate(year, month, daysInMonth(year, month))
}

export type DateRange = { from: CalendarDate; to: CalendarDate }

/** Financial year containing `date`, given the FY start month (India: 4 = April). */
export function financialYear(date: CalendarDate, fyStartMonth: number): DateRange & { label: string } {
  const { year, month } = parts(date)
  const startYear = month >= fyStartMonth ? year : year - 1
  const from = makeDate(startYear, fyStartMonth, 1)
  const to = addDays(addMonths(from, 12), -1)
  const label =
    fyStartMonth === 1 ? `${startYear}` : `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`
  return { from, to, label }
}

export type RangePreset = 'this-month' | 'last-month' | 'this-fy' | 'last-30-days' | 'last-90-days'

export function presetRange(preset: RangePreset, today: CalendarDate, fyStartMonth: number): DateRange {
  switch (preset) {
    case 'this-month':
      return { from: startOfMonth(today), to: endOfMonth(today) }
    case 'last-month': {
      const prev = addMonths(startOfMonth(today), -1)
      return { from: prev, to: endOfMonth(prev) }
    }
    case 'this-fy': {
      const fy = financialYear(today, fyStartMonth)
      return { from: fy.from, to: fy.to }
    }
    case 'last-30-days':
      return { from: addDays(today, -29), to: today }
    case 'last-90-days':
      return { from: addDays(today, -89), to: today }
  }
}

export function formatDate(
  date: CalendarDate,
  locale = 'en-IN',
  style: 'medium' | 'short' = 'medium',
): string {
  const { year, month, day } = parts(date)
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    day: 'numeric',
    month: style === 'medium' ? 'short' : '2-digit',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)))
}
