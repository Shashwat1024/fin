/**
 * Cash-flow forecast (FR-027, research R13). A deterministic daily projection of cash and bank
 * balances: the starting balance, plus recurring items still expected, minus an everyday-spending
 * baseline (the median non-recurring spending for each weekday over the last 90 days).
 *
 * Every input is reported back as an assumption, so the user can see exactly what the line is made of.
 */
import { addDays, compareDates, diffDays, weekday, type CalendarDate } from './dates'

export const FORECAST_DAYS = [30, 60, 90] as const
export type ForecastDays = (typeof FORECAST_DAYS)[number]

/** How far back everyday spending is measured. */
export const BASELINE_DAYS = 90
/** Below this much history the forecast is Low confidence. */
export const LOW_HISTORY_DAYS = 60
/** High confidence needs this share of projected outflow to come from known recurring items. */
export const HIGH_RECURRING_SHARE = 0.8
/** An unpaid item this many days overdue (or fewer) is assumed to go out today; older ones are left out. */
export const OVERDUE_GRACE_DAYS = 7

export type Confidence = 'high' | 'medium' | 'low'

/** One expected recurring payment, as its effect on cash (negative = money leaves cash and bank). */
export type ForecastEvent = {
  itemId: string
  name: string
  dueDate: CalendarDate
  /** Date it is counted on: the due date, or today for a recent overdue item. */
  date: CalendarDate
  amountMinor: number
  overdue: boolean
}

export type ForecastPoint = {
  date: CalendarDate
  balanceMinor: number
  /** Recurring items counted on this day (net). */
  recurringMinor: number
  /** Everyday spending assumed on this day (positive number, subtracted). */
  baselineMinor: number
}

export type BufferRange = {
  from: CalendarDate
  to: CalendarDate
  lowestMinor: number
  lowestDate: CalendarDate
  /** The largest recurring payments from the start of the forecast up to the day it dips below. */
  causes: ForecastEvent[]
}

export type ForecastInput = {
  today: CalendarDate
  days: number
  startMinor: number
  bufferMinor: number
  /** Expected recurring items with their effect on cash; paid or skipped ones are already left out. */
  events: readonly ForecastEvent[]
  /** Non-recurring spending from cash and bank by day (positive amounts). Days without spending may be omitted. */
  dailySpending: ReadonlyMap<CalendarDate, number>
  /** The first day with any cash or bank transaction, or null when there is none. */
  historyStart: CalendarDate | null
}

export type Forecast = {
  today: CalendarDate
  days: number
  startMinor: number
  bufferMinor: number
  points: ForecastPoint[]
  low: { date: CalendarDate; balanceMinor: number }
  endMinor: number
  belowBuffer: BufferRange[]
  confidence: Confidence
  confidenceReason: string
  historyDays: number
  /** Days of spending the baseline was measured over (≤ 90). */
  baselineDays: number
  /** Median everyday spending by weekday, Sunday first. */
  baselineByWeekday: number[]
  recurringOutMinor: number
  recurringInMinor: number
  baselineOutMinor: number
  events: ForecastEvent[]
}

/** Median of integers, rounded to whole minor units (mean of the two middles for an even count). */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2)
}

/**
 * Median spending for each weekday over the `BASELINE_DAYS` before today, counting days with no
 * spending as zero. Days before the history starts are not counted.
 */
export function weekdayBaseline(
  today: CalendarDate,
  dailySpending: ReadonlyMap<CalendarDate, number>,
  historyStart: CalendarDate | null,
): { byWeekday: number[]; days: number } {
  const buckets: number[][] = Array.from({ length: 7 }, () => [])
  if (!historyStart) return { byWeekday: buckets.map(() => 0), days: 0 }
  let days = 0
  for (let i = 1; i <= BASELINE_DAYS; i++) {
    const d = addDays(today, -i)
    if (compareDates(d, historyStart) < 0) break
    buckets[weekday(d)]!.push(dailySpending.get(d) ?? 0)
    days++
  }
  return { byWeekday: buckets.map(median), days }
}

export function confidenceFor(historyDays: number, recurringShare: number): { confidence: Confidence; reason: string } {
  if (historyDays < LOW_HISTORY_DAYS) {
    return {
      confidence: 'low',
      reason:
        historyDays === 0
          ? 'There is no spending history yet, so everyday spending is not included.'
          : `Only ${historyDays} days of history; ${LOW_HISTORY_DAYS} or more give a steadier estimate.`,
    }
  }
  const pct = Math.round(recurringShare * 100)
  if (historyDays >= BASELINE_DAYS && recurringShare >= HIGH_RECURRING_SHARE) {
    return { confidence: 'high', reason: `${pct}% of the money going out is from recurring items you set up, and there are at least ${BASELINE_DAYS} days of history.` }
  }
  return {
    confidence: 'medium',
    reason:
      historyDays < BASELINE_DAYS
        ? `${historyDays} days of history; ${BASELINE_DAYS} or more, with most spending set up as recurring items, gives High confidence.`
        : `${pct}% of the money going out is from recurring items; the rest is an estimate of everyday spending.`,
  }
}

/** Run the projection. Points cover today and each of the next `days` days. */
export function runForecast(input: ForecastInput): Forecast {
  const { today, days, startMinor, bufferMinor } = input
  const end = addDays(today, days)
  const events = input.events
    .filter((e) => compareDates(e.date, today) >= 0 && compareDates(e.date, end) <= 0)
    .sort((a, b) => compareDates(a.date, b.date) || a.amountMinor - b.amountMinor || a.name.localeCompare(b.name))
  const byDate = new Map<CalendarDate, number>()
  for (const e of events) byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.amountMinor)

  const baseline = weekdayBaseline(today, input.dailySpending, input.historyStart)
  const points: ForecastPoint[] = []
  let balance = startMinor
  let baselineOut = 0
  for (let i = 0; i <= days; i++) {
    const date = addDays(today, i)
    const recurringMinor = byDate.get(date) ?? 0
    // Today's spending is already in the balance (or still to be recorded), so the baseline starts tomorrow.
    const baselineMinor = i === 0 ? 0 : baseline.byWeekday[weekday(date)]!
    balance += recurringMinor - baselineMinor
    baselineOut += baselineMinor
    points.push({ date, balanceMinor: balance, recurringMinor, baselineMinor })
  }

  const low = points.reduce((m, p) => (p.balanceMinor < m.balanceMinor ? p : m), points[0]!)
  const recurringOut = events.reduce((t, e) => t + (e.amountMinor < 0 ? -e.amountMinor : 0), 0)
  const recurringIn = events.reduce((t, e) => t + (e.amountMinor > 0 ? e.amountMinor : 0), 0)
  const totalOut = recurringOut + baselineOut
  const share = totalOut === 0 ? 1 : recurringOut / totalOut
  const historyDays = input.historyStart ? Math.max(0, diffDays(today, input.historyStart)) : 0
  const { confidence, reason } = confidenceFor(historyDays, share)

  return {
    today,
    days,
    startMinor,
    bufferMinor,
    points,
    low: { date: low.date, balanceMinor: low.balanceMinor },
    endMinor: points.at(-1)!.balanceMinor,
    belowBuffer: bufferRanges(points, bufferMinor, events),
    confidence,
    confidenceReason: reason,
    historyDays,
    baselineDays: baseline.days,
    baselineByWeekday: baseline.byWeekday,
    recurringOutMinor: recurringOut,
    recurringInMinor: recurringIn,
    baselineOutMinor: baselineOut,
    events,
  }
}

const MAX_CAUSES = 5

/** Runs of days where the projected balance is below the buffer, with the payments that lead there. */
export function bufferRanges(points: readonly ForecastPoint[], bufferMinor: number, events: readonly ForecastEvent[]): BufferRange[] {
  const ranges: BufferRange[] = []
  let open: BufferRange | null = null
  for (const p of points) {
    if (p.balanceMinor < bufferMinor) {
      if (!open) {
        open = { from: p.date, to: p.date, lowestMinor: p.balanceMinor, lowestDate: p.date, causes: [] }
        ranges.push(open)
      }
      open.to = p.date
      if (p.balanceMinor < open.lowestMinor) {
        open.lowestMinor = p.balanceMinor
        open.lowestDate = p.date
      }
    } else open = null
  }
  for (const r of ranges) {
    r.causes = events
      .filter((e) => e.amountMinor < 0 && compareDates(e.date, r.lowestDate) <= 0)
      .sort((a, b) => a.amountMinor - b.amountMinor || compareDates(a.date, b.date))
      .slice(0, MAX_CAUSES)
  }
  return ranges
}
