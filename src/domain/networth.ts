/**
 * Net worth over time (FR-028). Each account is worth its ledger balance on a date, except that
 * investments, loans and other assets or liabilities use the latest valuation on or before that
 * date when there is one (data model: Valuation). Liabilities are counted as amounts owed.
 */
import { addMonths, compareDates, endOfMonth, startOfMonth, type CalendarDate } from './dates'
import { accountNature, displayBalance, type AccountType } from './ledger'

/** Account types whose value is entered by hand rather than tracked transaction by transaction. */
export const VALUED_TYPES: ReadonlySet<AccountType> = new Set([
  'investment',
  'loan',
  'other_asset',
  'other_liability',
])
export const canBeValued = (type: AccountType) => VALUED_TYPES.has(type)

export type NetWorthAccount = {
  id: string
  type: AccountType
  /** Stored (ledger-signed) opening balance; counts from the opening date. */
  openingMinor: number
  openingDate: CalendarDate
  /** Net ledger change per day, any order. */
  daily: readonly { date: CalendarDate; amountMinor: number }[]
  /** Values as shown to the user (amount owed for liabilities), any order. */
  valuations: readonly { date: CalendarDate; valueMinor: number }[]
}

export type AccountValue = {
  /** Shown value: positive for an asset's worth or an amount owed. */
  valueMinor: number
  source: 'ledger' | 'valuation'
  valuationDate: CalendarDate | null
}

export type NetWorthPoint = {
  date: CalendarDate
  assetsMinor: number
  liabilitiesMinor: number
  netMinor: number
}

/** Prepared account: sorted, with running totals, for repeated lookups. */
type Prepared = {
  a: NetWorthAccount
  dates: CalendarDate[]
  running: number[]
  vals: { date: CalendarDate; valueMinor: number }[]
  valDates: CalendarDate[]
}

function prepare(a: NetWorthAccount): Prepared {
  const byDate = new Map<CalendarDate, number>()
  for (const d of a.daily) byDate.set(d.date, (byDate.get(d.date) ?? 0) + d.amountMinor)
  const dates = [...byDate.keys()].sort(compareDates)
  let t = 0
  const running = dates.map((d) => (t += byDate.get(d)!))
  const vals = [...a.valuations].sort((x, y) => compareDates(x.date, y.date))
  return { a, dates, running, vals, valDates: vals.map((v) => v.date) }
}

/** Index of the last element ≤ date, or -1. */
function lastAtOrBefore(sorted: readonly CalendarDate[], date: CalendarDate): number {
  let lo = 0
  let hi = sorted.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (compareDates(sorted[mid]!, date) <= 0) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

function valueOf(p: Prepared, date: CalendarDate): AccountValue {
  if (canBeValued(p.a.type)) {
    const i = lastAtOrBefore(p.valDates, date)
    if (i >= 0)
      return { valueMinor: p.vals[i]!.valueMinor, source: 'valuation', valuationDate: p.vals[i]!.date }
  }
  const i = lastAtOrBefore(p.dates, date)
  const opening = compareDates(p.a.openingDate, date) <= 0 ? p.a.openingMinor : 0
  const ledger = opening + (i >= 0 ? p.running[i]! : 0)
  return { valueMinor: displayBalance(p.a.type, ledger), source: 'ledger', valuationDate: null }
}

/** One account's value on a date. */
export function accountValueAt(a: NetWorthAccount, date: CalendarDate): AccountValue {
  return valueOf(prepare(a), date)
}

function pointFor(prepared: readonly Prepared[], date: CalendarDate): NetWorthPoint {
  let assets = 0
  let liabilities = 0
  for (const p of prepared) {
    const v = valueOf(p, date).valueMinor
    if (accountNature(p.a.type) === 'asset') assets += v
    else liabilities += v
  }
  return { date, assetsMinor: assets, liabilitiesMinor: liabilities, netMinor: assets - liabilities }
}

export function netWorthAt(accounts: readonly NetWorthAccount[], date: CalendarDate): NetWorthPoint {
  return pointFor(accounts.map(prepare), date)
}

/** Month-end dates from `from`'s month to `to`'s month; the last one is `to` itself when it falls mid-month. */
export function monthEnds(from: CalendarDate, to: CalendarDate): CalendarDate[] {
  const out: CalendarDate[] = []
  for (let m = startOfMonth(from); compareDates(m, to) <= 0; m = addMonths(m, 1)) {
    const e = endOfMonth(m)
    out.push(compareDates(e, to) > 0 ? to : e)
  }
  return out
}

/** Net worth at each month end in [from, to]. */
export function netWorthHistory(
  accounts: readonly NetWorthAccount[],
  from: CalendarDate,
  to: CalendarDate,
): NetWorthPoint[] {
  const prepared = accounts.map(prepare)
  return monthEnds(from, to).map((d) => pointFor(prepared, d))
}
