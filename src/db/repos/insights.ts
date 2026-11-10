import { addDays, addMonths, compareDates, startOfMonth, type CalendarDate } from '@domain/dates'
import { BASELINE_DAYS, OVERDUE_GRACE_DAYS, runForecast, type ForecastEvent, type ForecastInput } from '@domain/forecast'
import { runScenario, type ScenarioChange } from '@domain/scenarios'
import { isLiquid, type AccountType } from '@domain/ledger'
import { canBeValued, netWorthHistory, type NetWorthAccount } from '@domain/networth'
import { invariant, notFound } from '@shared/errors'
import type { ValuationInput } from '@shared/schemas'
import type { AccountDto, ForecastAssumption, ForecastDto, Mutation, NetWorthDto, ScenarioDto, ValuationDto } from '@shared/types'
import { withAudit } from '../audit'
import { all, get, newId, nowIso, type Db } from '../connection'
import { getSettings } from './settings'
import { listAccounts } from './accounts'
import { goalBases, listOccurrences, listRecurring } from './planning'

// ---- Forecast (FR-027) ---------------------------------------------------------------------------

const DAY_MONTH = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const shortDate = (d: CalendarDate) => DAY_MONTH.format(new Date(`${d}T00:00:00Z`))

/**
 * The 30/60/90-day projection of cash and bank balances. Uses the same recurring matching as the
 * Recurring page, so an item shown as paid there is never counted again here.
 */
export function forecast(db: Db, days: number, today: CalendarDate): ForecastDto {
  const { input, liquid, notCounted } = forecastBase(db, days, today)
  const f = runForecast(input)
  return { ...f, assumptions: assumptions(f, liquid, notCounted), hasCashAccounts: liquid.length > 0 }
}

/** Everything the projection is computed from, shared by the forecast and what-if scenarios. */
function forecastBase(db: Db, days: number, today: CalendarDate, accounts: readonly AccountDto[] = listAccounts(db)) {
  const liquid = accounts.filter((a) => a.isLiquid)
  const liquidIds = new Set(liquid.map((a) => a.id))
  const startMinor = liquid.reduce((t, a) => t + a.balanceMinor, 0)
  const items = new Map(listRecurring(db, today).map((i) => [i.id, i]))

  // Recurring items still expected, as their effect on cash and bank (a card bill paid from the bank
  // is money out; a transfer between two bank accounts nets to nothing).
  // One pass over the recurring schedule covers both the history window and the forecast.
  const historyFrom = addDays(today, -BASELINE_DAYS)
  const occurrences = listOccurrences(db, historyFrom, addDays(today, days), today)
  const graceFrom = addDays(today, -OVERDUE_GRACE_DAYS)
  const events: ForecastEvent[] = []
  const notCounted = new Set<string>()
  for (const o of occurrences) {
    if (o.state !== 'expected' && o.state !== 'overdue') continue
    if (compareDates(o.dueDate, graceFrom) < 0) continue
    const item = items.get(o.itemId)
    if (!item) continue
    const effect = (liquidIds.has(o.accountId) ? o.expectedMinor : 0) + (item.toAccountId && liquidIds.has(item.toAccountId) ? -o.expectedMinor : 0)
    if (effect === 0) {
      notCounted.add(item.name)
      continue
    }
    const overdue = o.state === 'overdue'
    events.push({ itemId: o.itemId, name: o.itemName, dueDate: o.dueDate, date: overdue ? today : o.dueDate, amountMinor: effect, overdue })
  }

  // Everyday spending: money out of cash and bank that is neither a transfer nor a recurring payment.
  const recurringTxns = new Set(occurrences.flatMap((o) => (o.matchedTxn ? [o.matchedTxn.id] : [])))
  const spending = new Map<CalendarDate, number>()
  if (liquid.length > 0) {
    const marks = liquid.map(() => '?').join(',')
    const rows = all<{ id: string; posted_date: string; amount_minor: number }>(
      db,
      `SELECT id, posted_date, amount_minor FROM transactions
       WHERE deleted_at IS NULL AND kind = 'standard' AND amount_minor < 0 AND posted_date >= ? AND posted_date < ?
         AND account_id IN (${marks})`,
      historyFrom,
      today,
      ...liquid.map((a) => a.id),
    )
    for (const r of rows) {
      if (recurringTxns.has(r.id)) continue
      spending.set(r.posted_date, (spending.get(r.posted_date) ?? 0) - r.amount_minor)
    }
  }
  const historyStart =
    liquid.length === 0
      ? null
      : (get<{ d: string | null }>(
          db,
          `SELECT MIN(posted_date) AS d FROM transactions WHERE deleted_at IS NULL AND account_id IN (${liquid.map(() => '?').join(',')})`,
          ...liquid.map((a) => a.id),
        )?.d ?? null)

  const bufferMinor = getSettings(db).bufferMinor
  const input: ForecastInput = { today, days, startMinor, bufferMinor, events, dailySpending: spending, historyStart }
  return { input, liquid, notCounted, items }
}

// ---- What-if scenarios (FR-029) ------------------------------------------------------------------

/**
 * A scenario on top of the real forecast and goals. Reads only: nothing is written, so the real
 * data is exactly as it was afterwards (US8 scenario 2).
 */
export function whatIf(db: Db, days: number, changes: readonly ScenarioChange[], today: CalendarDate): ScenarioDto {
  const accounts = listAccounts(db)
  const { input, items } = forecastBase(db, days, today, accounts)
  const liquidIds = new Set(accounts.filter((a) => a.isLiquid).map((a) => a.id))
  const loans = netWorthNow(db, today, accounts)
    .values.filter((v) => v.account.type === 'loan')
    .map((v) => ({ id: v.account.id, name: v.account.name, owedMinor: v.valueMinor }))
  for (const c of changes) {
    if (c.kind === 'loan_prepayment' && !loans.some((l) => l.id === c.loanId)) throw invariant('Choose one of your loan accounts')
  }
  const goals = goalBases(db, today).map((g) => ({ ...g, liquid: g.linkedAccountId !== null && liquidIds.has(g.linkedAccountId) }))
  for (const c of changes) {
    if (c.kind === 'savings_change' && c.goalId && !goals.some((g) => g.id === c.goalId)) throw notFound('Goal')
  }
  const incomeItemIds = [...items.values()].filter((i) => i.kind === 'income').map((i) => i.id)
  return runScenario({ forecast: input, incomeItemIds, goals, loans }, changes)
}

function assumptions(f: ReturnType<typeof runForecast>, liquid: readonly AccountDto[], notCounted: ReadonlySet<string>): ForecastAssumption[] {
  const out: ForecastAssumption[] = liquid.map((a) => ({
    kind: 'start',
    label: a.name,
    detail: a.lastTxnDate ? `Balance today; latest transaction ${shortDate(a.lastTxnDate)}` : 'Balance today (opening balance only)',
    amountMinor: a.balanceMinor,
  }))
  const byItem = new Map<string, ForecastAssumption & { dates: string[] }>()
  for (const e of f.events) {
    let row = byItem.get(e.itemId)
    if (!row) byItem.set(e.itemId, (row = { kind: 'recurring', label: e.name, detail: null, amountMinor: 0, dates: [] }))
    row.amountMinor! += e.amountMinor
    row.dates.push(e.overdue ? `${shortDate(e.dueDate)} (overdue, counted today)` : shortDate(e.date))
  }
  for (const { dates, ...row } of byItem.values()) {
    out.push({ ...row, detail: `${dates.length === 1 ? 'Once' : `${dates.length} times`}: ${dates.join(', ')}` })
  }
  out.push({
    kind: 'baseline',
    label: 'Everyday spending',
    detail:
      f.baselineDays === 0
        ? 'No spending history yet, so none is assumed.'
        : `The usual spending for each day of the week (the median over the last ${f.baselineDays} days), not counting recurring payments or transfers between your accounts.`,
    amountMinor: -f.baselineOutMinor,
  })
  const note = (label: string, detail: string | null = null) => out.push({ kind: 'note', label, detail, amountMinor: null })
  note('Only cash and bank accounts are projected', 'Credit-card spending counts on the day the card bill is paid, when that bill is set up as a recurring transfer.')
  if (notCounted.size > 0) note('Not counted: paid from a card or another non-cash account', [...notCounted].sort().join(', '))
  note(`Unpaid items more than ${OVERDUE_GRACE_DAYS} days overdue are left out`, 'Skip them or link their payment on the Recurring page.')
  return out
}

// ---- Net worth and valuations (FR-028) -----------------------------------------------------------

type ValuationRow = { id: string; account_id: string; date: string; value_minor: number; note: string | null }
const toValuation = (r: ValuationRow): ValuationDto => ({ id: r.id, accountId: r.account_id, date: r.date, valueMinor: r.value_minor, note: r.note })

function netWorthAccounts(db: Db, accounts: readonly AccountDto[]): NetWorthAccount[] {
  const daily = new Map<string, { date: string; amountMinor: number }[]>()
  for (const r of all<{ account_id: string; d: string; total: number }>(
    db,
    `SELECT account_id, posted_date AS d, SUM(amount_minor) AS total FROM transactions
     WHERE deleted_at IS NULL GROUP BY account_id, posted_date`,
  )) {
    const list = daily.get(r.account_id) ?? []
    list.push({ date: r.d, amountMinor: r.total })
    daily.set(r.account_id, list)
  }
  const vals = new Map<string, { date: string; valueMinor: number }[]>()
  for (const r of all<ValuationRow>(db, 'SELECT account_id, date, value_minor FROM valuations')) {
    const list = vals.get(r.account_id) ?? []
    list.push({ date: r.date, valueMinor: r.value_minor })
    vals.set(r.account_id, list)
  }
  const stored = new Map(
    all<{ id: string; opening_balance_minor: number }>(db, 'SELECT id, opening_balance_minor FROM accounts').map((a) => [a.id, a.opening_balance_minor]),
  )
  return accounts.map((a) => ({
    id: a.id,
    type: a.type,
    openingMinor: stored.get(a.id) ?? 0,
    openingDate: a.openingDate,
    daily: daily.get(a.id) ?? [],
    valuations: vals.get(a.id) ?? [],
  }))
}

/**
 * Net worth now, from account balances (which already count every transaction) and the latest
 * valuation of each valued account. Cheap: no per-day history is read. The dashboard card and the
 * Net worth page both use it, so they always agree.
 */
export function netWorthNow(db: Db, today: CalendarDate, accounts: readonly AccountDto[] = listAccounts(db)) {
  const latest = new Map(
    all<{ account_id: string; date: string; value_minor: number }>(
      db,
      `SELECT v.account_id, v.date, v.value_minor FROM valuations v
       WHERE v.date = (SELECT MAX(date) FROM valuations x WHERE x.account_id = v.account_id)`,
    ).map((r) => [r.account_id, r]),
  )
  let assets = 0
  let liabilities = 0
  const values = accounts.map((a) => {
    const v = canBeValued(a.type) ? latest.get(a.id) : undefined
    const value = { valueMinor: v ? v.value_minor : a.balanceMinor, source: v ? ('valuation' as const) : ('ledger' as const), valuationDate: v?.date ?? null }
    if (a.nature === 'asset') assets += value.valueMinor
    else liabilities += value.valueMinor
    return { account: a, ...value }
  })
  return { date: today, assetsMinor: assets, liabilitiesMinor: liabilities, netMinor: assets - liabilities, values }
}

/** Month-end net worth from `from` (default: 11 months ago, or the first account's opening) to today. */
export function netWorthHistoryFor(db: Db, today: CalendarDate, from?: CalendarDate, to?: CalendarDate): NetWorthDto {
  const accounts = listAccounts(db)
  const nw = netWorthAccounts(db, accounts)
  const earliest = accounts.reduce<CalendarDate | null>((m, a) => (!m || compareDates(a.openingDate, m) < 0 ? a.openingDate : m), null) ?? today
  const defaultFrom = addMonths(startOfMonth(today), -11)
  let start = from ?? (compareDates(earliest, defaultFrom) > 0 ? earliest : defaultFrom)
  if (compareDates(start, earliest) < 0) start = earliest
  const end = to && compareDates(to, today) < 0 ? to : today
  if (compareDates(start, end) > 0) start = end
  const { values, ...current } = netWorthNow(db, today, accounts)
  const points = netWorthHistory(nw, start, end)
  if (end === today) points[points.length - 1] = current
  return {
    today,
    current,
    points,
    accounts: values.map(({ account: a, valueMinor, source, valuationDate }) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      nature: a.nature,
      valueMinor,
      source,
      valuationDate,
      ledgerMinor: a.balanceMinor,
      canValue: canBeValued(a.type),
    })),
  }
}

export function listValuations(db: Db, accountId: string): ValuationDto[] {
  return all<ValuationRow>(db, 'SELECT * FROM valuations WHERE account_id = ? ORDER BY date DESC', accountId).map(toValuation)
}

function valuableAccount(db: Db, accountId: string) {
  const a = get<{ name: string; type: AccountType; archived_at: string | null }>(db, 'SELECT name, type, archived_at FROM accounts WHERE id = ?', accountId)
  if (!a) throw notFound('Account')
  if (!canBeValued(a.type)) {
    throw invariant(isLiquid(a.type) || a.type === 'credit_card' ? 'This account’s balance comes from its transactions' : 'This account cannot be valued')
  }
  return a
}

/** Record what an investment, loan or other asset/liability is worth on a date (one value per day). */
export function upsertValuation(db: Db, input: ValuationInput, today: CalendarDate): Mutation<{ valuation: ValuationDto }> {
  const account = valuableAccount(db, input.accountId)
  if (account.archived_at) throw invariant('This account is archived. Restore it before recording a value.')
  if (compareDates(input.date, today) > 0) throw invariant('A value can only be recorded for today or earlier')
  const existing = get<ValuationRow>(db, 'SELECT * FROM valuations WHERE account_id = ? AND date = ?', input.accountId, input.date)
  const { result, auditGroupId } = withAudit(db, `Record value of ${account.name}`, (a) => {
    const fields = { value_minor: input.valueMinor, note: input.note ?? null, updated_at: nowIso() }
    if (existing) {
      a.update('valuations', existing.id, fields)
      return existing.id
    }
    const id = newId('val')
    a.insert('valuations', { id, account_id: input.accountId, date: input.date, ...fields, created_at: nowIso() })
    return id
  })
  return { valuation: toValuation(get<ValuationRow>(db, 'SELECT * FROM valuations WHERE id = ?', result)!), auditGroupId }
}

export function deleteValuation(db: Db, id: string): Mutation<object> {
  const v = get<ValuationRow & { name: string }>(
    db,
    'SELECT v.*, a.name FROM valuations v JOIN accounts a ON a.id = v.account_id WHERE v.id = ?',
    id,
  )
  if (!v) throw notFound('Valuation')
  const { auditGroupId } = withAudit(db, `Delete value of ${v.name}`, (a) => a.remove('valuations', id))
  return { auditGroupId }
}
