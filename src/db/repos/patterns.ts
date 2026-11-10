/**
 * Behaviour insights and "looks recurring" suggestions (FR-029, FR-022 P1). Both are computed from
 * the ledger every time; only the keys of dismissed ones are stored.
 */
import { addDays, compareDates, type CalendarDate } from '@domain/dates'
import {
  detectInsights,
  type SpendLine,
  type SubscriptionItem,
  type SubscriptionPayment,
} from '@domain/insights'
import { detectRecurring, type PastPayment } from '@domain/recurrence'
import { invariant, notFound } from '@shared/errors'
import type { InsightsDto, Mutation, RecurringKind, RecurringSuggestionDto } from '@shared/types'
import { withAudit } from '../audit'
import { all, get, newId, nowIso, type Db } from '../connection'
import { listAccounts } from './accounts'
import { listCategories } from './categories'
import { listOccurrences, listRecurring } from './planning'

/** A year of history is enough for every detector (the longest looks back 12 months from a recent date). */
const LOOKBACK_DAYS = 400

type LineRow = {
  id: string
  account_id: string
  posted_date: string
  payee: string
  mkey: string | null
  mname: string | null
  category_id: string | null
  amount_minor: number
}

/** Standard (non-transfer) transactions with splits expanded: one row per category. */
function ledgerLines(db: Db, from: CalendarDate, to: CalendarDate): LineRow[] {
  return all<LineRow>(
    db,
    `SELECT t.id, t.account_id, t.posted_date, t.payee, m.normalized_key AS mkey, m.display_name AS mname,
            COALESCE(s.category_id, t.category_id) AS category_id, COALESCE(s.amount_minor, t.amount_minor) AS amount_minor
     FROM transactions t
     LEFT JOIN splits s ON s.transaction_id = t.id
     LEFT JOIN merchants m ON m.id = t.merchant_id
     WHERE t.deleted_at IS NULL AND t.kind = 'standard' AND t.posted_date >= ? AND t.posted_date <= ?`,
    from,
    to,
  )
}

/** Payees without a recognised merchant: lower case, digits (reference numbers) removed. */
export const payeeKey = (payee: string) =>
  payee
    .toLowerCase()
    .replace(/\d+/g, ' ')
    .replace(/[^\p{L}\s&]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** A name fit to show: reference numbers (four or more digits) removed. */
export const cleanName = (name: string) =>
  name
    .replace(/\S*\d{4,}\S*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || name.trim()

/** Transactions matched to a recurring item (automatically or by hand) in [from, to]. */
function recurringMatches(db: Db, from: CalendarDate, to: CalendarDate, today: CalendarDate) {
  const occurrences = listOccurrences(db, from, to, today)
  return {
    occurrences,
    txnIds: new Set(occurrences.flatMap((o) => (o.matchedTxn ? [o.matchedTxn.id] : []))),
  }
}

function dismissedKeys(db: Db): Set<string> {
  return new Set(all<{ key: string }>(db, 'SELECT key FROM dismissed_insights').map((r) => r.key))
}

// ---- Insights feed ---------------------------------------------------------------------------------

export function listInsights(db: Db, today: CalendarDate, includeDismissed = false): InsightsDto {
  const from = addDays(today, -LOOKBACK_DAYS)
  const categories = new Map(listCategories(db).map((c) => [c.id, c]))
  const { occurrences, txnIds: recurringTxns } = recurringMatches(db, from, today, today)

  // Spending: money out (and refunds back) in spending categories, on any account including cards.
  const rows = ledgerLines(db, from, today)
  const lines: SpendLine[] = []
  for (const r of rows) {
    const c = r.category_id ? categories.get(r.category_id) : undefined
    if (c && (c.group === 'income' || c.group === 'transfer')) continue
    if (!c && r.amount_minor > 0) continue // uncategorised money in is not a refund we can place
    lines.push({
      txnId: r.id,
      date: r.posted_date,
      amountMinor: -r.amount_minor,
      categoryId: c?.id ?? null,
      categoryName: c?.path ?? null,
      merchantKey: r.mkey,
      merchantName: r.mname ?? r.payee,
      recurring: recurringTxns.has(r.id),
    })
  }
  const historyStart =
    get<{ d: string | null }>(
      db,
      `SELECT MIN(posted_date) AS d FROM transactions WHERE deleted_at IS NULL AND kind = 'standard'`,
    )?.d ?? null
  const asOf =
    get<{ d: string | null }>(
      db,
      'SELECT MAX(posted_date) AS d FROM transactions WHERE deleted_at IS NULL AND posted_date <= ?',
      today,
    )?.d ?? null

  // Subscriptions: what each one charged, from its matched payments and any other payments to the
  // same merchant from the same account (a price rise can fall outside the matching tolerance).
  const items = listRecurring(db, today).filter((i) => i.kind === 'subscription')
  const subscriptions: SubscriptionItem[] = []
  const subscriptionPayments: SubscriptionPayment[] = []
  if (items.length > 0) {
    const byId = new Map(lines.map((l) => [l.txnId, l]))
    for (const item of items) {
      const matched = occurrences
        .filter((o) => o.itemId === item.id && o.matchedTxn)
        .map((o) => o.matchedTxn!)
      const merchants = new Set(matched.flatMap((m) => byId.get(m.id)?.merchantKey ?? []))
      const payees = new Set(matched.map((m) => payeeKey(m.payee)))
      const seen = new Set<string>()
      const add = (txnId: string, date: string, amountMinor: number) => {
        if (seen.has(txnId) || amountMinor <= 0) return
        seen.add(txnId)
        subscriptionPayments.push({ itemId: item.id, txnId, date, amountMinor })
      }
      for (const m of matched) add(m.id, m.postedDate, -m.amountMinor)
      for (const r of rows) {
        if (r.account_id !== item.accountId || r.amount_minor >= 0) continue
        if ((r.mkey && merchants.has(r.mkey)) || payees.has(payeeKey(r.payee)))
          add(r.id, r.posted_date, -r.amount_minor)
      }
      const first = subscriptionPayments
        .filter((p) => p.itemId === item.id)
        .reduce<string>((m, p) => (compareDates(p.date, m) < 0 ? p.date : m), item.anchorDate)
      subscriptions.push({
        itemId: item.id,
        name: item.name,
        amountMinor: item.amountMinor,
        frequency: item.frequency,
        interval: item.interval,
        startDate: first,
        endDate: item.endDate,
        active: item.active,
      })
    }
  }

  const dismissed = dismissedKeys(db)
  const all_ = detectInsights({ today, historyStart, lines, subscriptions, subscriptionPayments }).map(
    (i) => ({ ...i, dismissed: dismissed.has(i.key) }),
  )
  return {
    today,
    asOf,
    historyStart,
    insights: includeDismissed ? all_ : all_.filter((i) => !i.dismissed),
    dismissedCount: all_.filter((i) => i.dismissed).length,
  }
}

export function dismissInsight(db: Db, key: string): Mutation<object> {
  if (get(db, 'SELECT 1 AS x FROM dismissed_insights WHERE key = ?', key))
    throw invariant('This is already dismissed')
  const { auditGroupId } = withAudit(db, 'Dismiss insight', (a) => {
    a.insert('dismissed_insights', { id: newId('dis'), key, dismissed_at: nowIso() })
  })
  return { auditGroupId }
}

export function restoreInsight(db: Db, key: string): Mutation<object> {
  const row = get<{ id: string }>(db, 'SELECT id FROM dismissed_insights WHERE key = ?', key)
  if (!row) throw notFound('Dismissed insight')
  const { auditGroupId } = withAudit(db, 'Show insight again', (a) => a.remove('dismissed_insights', row.id))
  return { auditGroupId }
}

// ---- Likely recurring payments (FR-022, P1) --------------------------------------------------------

const SUGGESTION_PREFIX = 'recurring:'
export const suggestionDismissKey = (key: string) => `${SUGGESTION_PREFIX}${key}`

function guessKind(
  direction: 'in' | 'out',
  categoryPath: string | null,
  categoryGroup: string | null,
): RecurringKind {
  if (direction === 'in') return 'income'
  if (categoryPath && /subscri/i.test(categoryPath)) return 'subscription'
  if (categoryPath && /loan|emi/i.test(categoryPath)) return 'emi'
  if (categoryGroup === 'goals') return 'savings'
  return 'bill'
}

/**
 * Series of payments that look like a bill, subscription or income not yet set up as recurring.
 * Payments already matched to a recurring item, and series the user dismissed, are left out.
 */
export function recurringSuggestions(db: Db, today: CalendarDate): RecurringSuggestionDto[] {
  const from = addDays(today, -LOOKBACK_DAYS)
  const { txnIds: matched } = recurringMatches(db, from, today, today)
  const existing = new Set(
    listRecurring(db, today).map((i) => `${i.accountId}:${i.name.trim().toLowerCase()}`),
  )
  const accounts = new Map(listAccounts(db).map((a) => [a.id, a]))
  const categories = new Map(listCategories(db).map((c) => [c.id, c]))
  // Splits are one payment: take each transaction once, with its own category (null when split).
  const rows = all<LineRow>(
    db,
    `SELECT t.id, t.account_id, t.posted_date, t.payee, m.normalized_key AS mkey, m.display_name AS mname, t.category_id, t.amount_minor
     FROM transactions t LEFT JOIN merchants m ON m.id = t.merchant_id
     WHERE t.deleted_at IS NULL AND t.kind = 'standard' AND t.posted_date >= ? AND t.posted_date <= ?`,
    from,
    today,
  )
  const payments: PastPayment[] = []
  for (const r of rows) {
    if (matched.has(r.id) || !accounts.has(r.account_id)) continue
    payments.push({
      txnId: r.id,
      date: r.posted_date,
      amountMinor: r.amount_minor,
      accountId: r.account_id,
      groupKey: r.mkey ?? payeeKey(r.payee),
      name: cleanName(r.mname ?? r.payee),
      categoryId: r.category_id,
    })
  }
  const dismissed = dismissedKeys(db)
  return detectRecurring(payments, today)
    .filter(
      (s) =>
        !dismissed.has(suggestionDismissKey(s.key)) &&
        !existing.has(`${s.accountId}:${s.name.trim().toLowerCase()}`),
    )
    .map((s) => {
      const c = s.categoryId ? categories.get(s.categoryId) : undefined
      return {
        ...s,
        dismissKey: suggestionDismissKey(s.key),
        accountName: accounts.get(s.accountId)!.name,
        categoryPath: c?.path ?? null,
        suggestedKind: guessKind(s.direction, c?.path ?? null, c?.group ?? null),
      }
    })
}
