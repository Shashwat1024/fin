import { addMonths, compareDates, parts, type CalendarDate } from './dates'

/** Contributions over this many months set the pace used for the projected date. */
export const PACE_MONTHS = 3

/** Beyond this the pace is too slow for a projected date to mean anything. */
export const MAX_PROJECTION_MONTHS = 600

export type GoalStatus = 'achieved' | 'on_track' | 'off_track' | 'no_pace' | 'past_target'

export type GoalProjection = {
  savedMinor: number
  remainingMinor: number
  /** Whole percent saved, 0–100. */
  percent: number
  /** Months from this month to the target month (at least 1); null without a target date or once it has passed. */
  monthsLeft: number | null
  /** Amount to add each month to reach the target on time, rounded up to the paisa. */
  requiredMonthlyMinor: number | null
  /** Average monthly amount added over the last PACE_MONTHS months. */
  paceMonthlyMinor: number
  /** When the target is reached at the current pace; null without a (meaningful) pace. */
  projectedDate: CalendarDate | null
  status: GoalStatus
}

/** Calendar months from `from`'s month to `to`'s month (Nov → next Nov = 12). */
export function monthsBetween(from: CalendarDate, to: CalendarDate): number {
  const a = parts(from)
  const b = parts(to)
  return (b.year - a.year) * 12 + (b.month - a.month)
}

/**
 * Progress, the monthly amount needed, and a projected date from the recent pace (FR-024).
 * `recentMinor` is the net amount added over the last PACE_MONTHS months.
 */
export function projectGoal(input: {
  targetMinor: number
  targetDate: CalendarDate | null
  savedMinor: number
  recentMinor: number
  today: CalendarDate
}): GoalProjection {
  const { targetMinor, targetDate, savedMinor, recentMinor, today } = input
  const remainingMinor = Math.max(targetMinor - savedMinor, 0)
  const percent = targetMinor <= 0 ? 100 : Math.min(100, Math.max(0, Math.floor((savedMinor * 100) / targetMinor)))
  const past = targetDate !== null && compareDates(targetDate, today) < 0
  const monthsLeft = targetDate === null || past ? null : Math.max(1, monthsBetween(today, targetDate))
  const requiredMonthlyMinor = monthsLeft === null ? null : Math.ceil(remainingMinor / monthsLeft)
  const paceMonthlyMinor = Math.max(0, Math.floor(recentMinor / PACE_MONTHS))
  const monthsAtPace = recentMinor > 0 ? Math.ceil((remainingMinor * PACE_MONTHS) / recentMinor) : Infinity
  const projectedDate = remainingMinor === 0 ? today : monthsAtPace <= MAX_PROJECTION_MONTHS ? addMonths(today, monthsAtPace) : null

  let status: GoalStatus
  if (remainingMinor === 0) status = 'achieved'
  else if (past) status = 'past_target'
  else if (projectedDate === null) status = 'no_pace'
  else if (targetDate === null || compareDates(projectedDate, targetDate) <= 0) status = 'on_track'
  else status = 'off_track'

  return { savedMinor, remainingMinor, percent, monthsLeft, requiredMonthlyMinor, paceMonthlyMinor, projectedDate, status }
}
