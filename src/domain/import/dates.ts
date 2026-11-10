import { makeDate, type CalendarDate } from '../dates'

/** Order of day, month and year in a date cell. Separators and 2/4-digit years are handled automatically. */
export type DateOrder = 'dmy' | 'mdy' | 'ymd'

export const DATE_ORDER_LABELS: Record<DateOrder, string> = {
  dmy: 'Day / Month / Year (e.g. 31/10/2026)',
  mdy: 'Month / Day / Year (e.g. 10/31/2026)',
  ymd: 'Year-Month-Day (e.g. 2026-10-31)',
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function monthFrom(token: string): number | null {
  if (/^\d{1,2}$/.test(token)) return Number(token)
  const i = MONTHS.indexOf(token.slice(0, 3).toLowerCase())
  return i >= 0 ? i + 1 : null
}

function yearFrom(token: string): number | null {
  if (/^\d{4}$/.test(token)) return Number(token)
  if (/^\d{2}$/.test(token)) {
    const yy = Number(token)
    return yy < 70 ? 2000 + yy : 1900 + yy
  }
  return null
}

/** Parse a bank date such as "31/10/26", "31-Oct-2026", "2026-10-31 10:22:01". Returns null if invalid. */
export function parseDateText(text: string, order: DateOrder): CalendarDate | null {
  // Drop a trailing time ("10:22", "10:22:01 AM").
  const cleaned = text.trim().replace(/[ T]\d{1,2}:\d{2}(:\d{2})?(\s?[AP]M)?$/i, '')
  const tokens = cleaned.split(/[\s/.,-]+/).filter(Boolean)
  if (tokens.length !== 3) return null
  const [a, b, c] = tokens as [string, string, string]
  // A month written as a word fixes its own position.
  const alphaIndex = tokens.findIndex((t) => /^[a-z]+$/i.test(t))
  let day: string, month: string, year: string
  if (alphaIndex === 1) [day, month, year] = /^\d{4}$/.test(a) ? [c, b, a] : [a, b, c]
  else if (alphaIndex === 0) [month, day, year] = [a, b, c]
  else if (order === 'dmy') [day, month, year] = [a, b, c]
  else if (order === 'mdy') [month, day, year] = [a, b, c]
  else [year, month, day] = [a, b, c]
  const d = /^\d{1,2}$/.test(day) ? Number(day) : null
  const m = monthFrom(month)
  const y = yearFrom(year)
  if (d === null || m === null || y === null) return null
  try {
    return makeDate(y, m, d)
  } catch {
    return null
  }
}

/** Choose the order that parses the most sample cells (Indian D/M/Y preferred on ties). */
export function detectDateOrder(samples: readonly string[]): DateOrder {
  const orders: DateOrder[] = ['dmy', 'ymd', 'mdy']
  let best: DateOrder = 'dmy'
  let bestCount = -1
  for (const o of orders) {
    const count = samples.filter((s) => parseDateText(s, o) !== null).length
    if (count > bestCount) {
      best = o
      bestCount = count
    }
  }
  return best
}
