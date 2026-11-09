/**
 * Behaviour insights (FR-029, US8). Pure detectors over spending lines: each insight states what
 * changed, the period it compares against, and the transactions behind it. Wording is descriptive,
 * never judgemental ("up 40% on your usual", not "overspending").
 *
 * Statements give a posting date but no time of day, so time-of-day patterns (late-night spending)
 * cannot be detected honestly and are not attempted.
 */
import { median } from './forecast'
import { addDays, addMonths, compareDates, diffDays, endOfMonth, monthKey, startOfMonth, weekday, type CalendarDate } from './dates'
import type { Frequency } from './recurrence'

/** One piece of spending: a transaction, or one split of it. */
export type SpendLine = {
  txnId: string
  date: CalendarDate
  /** Positive = money spent; negative = a refund. */
  amountMinor: number
  categoryId: string | null
  categoryName: string | null
  merchantKey: string | null
  /** Merchant display name, or the payee. */
  merchantName: string
  /** Matched to a recurring item (rent, EMIs, subscriptions): left out of "everyday" patterns. */
  recurring: boolean
}

export type SubscriptionItem = {
  itemId: string
  name: string
  /** Expected amount per payment (positive). */
  amountMinor: number
  frequency: Frequency
  interval: number
  /** First payment. */
  startDate: CalendarDate
  endDate: CalendarDate | null
  active: boolean
}

/** A real payment matched to a subscription item. */
export type SubscriptionPayment = { itemId: string; txnId: string; date: CalendarDate; amountMinor: number }

export type InsightKind = 'category_change' | 'merchant_change' | 'subscription_price' | 'subscription_creep' | 'weekend_spending' | 'unusual_purchase'

export type InsightSource = { txnId: string; date: CalendarDate; label: string; amountMinor: number }
export type InsightPeriod = { label: string; from: CalendarDate; to: CalendarDate }

export type Insight = {
  /** Stable while the facts are the same; dismissing stores this key. */
  key: string
  kind: InsightKind
  title: string
  detail: string
  direction: 'up' | 'down'
  period: InsightPeriod
  comparison: InsightPeriod | null
  currentMinor: number
  comparisonMinor: number | null
  /** The largest supporting transactions (at most MAX_SOURCES). */
  sources: InsightSource[]
  sourceCount: number
  /** Transactions to open for the full picture. */
  filter: { from: CalendarDate; to: CalendarDate; categoryId?: string; text?: string }
  /** Size of the change in rupees, used to order the feed. */
  weightMinor: number
}

export const MAX_SOURCES = 5
/** Months averaged as "usual" for category and merchant changes (at least MIN_COMPARE_MONTHS). */
export const COMPARE_MONTHS = 3
export const MIN_COMPARE_MONTHS = 2
/** A change must be at least this share of the usual amount… */
export const CHANGE_SHARE = 0.25
/** …and at least this much money (₹1,000). */
export const CHANGE_MIN_MINOR = 100_000
export const WEEKEND_DAYS = 90
export const WEEKEND_RATIO = 1.5
/** Weekend days need to differ by at least ₹300 a day. */
export const WEEKEND_MIN_MINOR = 30_000
export const UNUSUAL_RECENT_DAYS = 30
export const UNUSUAL_RATIO = 3
export const UNUSUAL_MIN_MINOR = 200_000
export const UNUSUAL_MIN_HISTORY = 5
/** A subscription price rise is reported from 5% (and at least ₹10). */
export const PRICE_RISE_SHARE = 0.05
export const CREEP_MONTHS = 6

const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'long', timeZone: 'UTC' })
const MONTH_SHORT = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' })
const DAY_MONTH = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const asDate = (d: CalendarDate) => new Date(`${d}T00:00:00Z`)
export const monthName = (d: CalendarDate) => MONTH.format(asDate(d))
const shortMonth = (d: CalendarDate) => MONTH_SHORT.format(asDate(d))
const dayMonth = (d: CalendarDate) => DAY_MONTH.format(asDate(d))
const rupees = (minor: number) => `₹${Math.round(Math.abs(minor) / 100).toLocaleString('en-IN')}`
const pct = (share: number) => `${Math.round(Math.abs(share) * 100)}%`

const inRange = (d: CalendarDate, from: CalendarDate, to: CalendarDate) => compareDates(d, from) >= 0 && compareDates(d, to) <= 0

function topSources(lines: readonly SpendLine[], label: (l: SpendLine) => string = (l) => l.merchantName || 'Unnamed'): InsightSource[] {
  return [...lines]
    .sort((a, b) => b.amountMinor - a.amountMinor || compareDates(b.date, a.date))
    .slice(0, MAX_SOURCES)
    .map((l) => ({ txnId: l.txnId, date: l.date, label: label(l), amountMinor: l.amountMinor }))
}

/**
 * The last complete month, and the months before it to average as "usual": three when the history
 * covers them, otherwise two. Null with less history than that.
 */
export function comparisonMonths(
  today: CalendarDate,
  historyStart: CalendarDate | null,
): { recent: InsightPeriod; usual: InsightPeriod; months: number } | null {
  if (!historyStart) return null
  const recentFrom = addMonths(startOfMonth(today), -1)
  let months = COMPARE_MONTHS
  while (months >= MIN_COMPARE_MONTHS && compareDates(historyStart, addMonths(recentFrom, -months)) > 0) months--
  if (months < MIN_COMPARE_MONTHS) return null
  const usualFrom = addMonths(recentFrom, -months)
  const usualTo = addDays(recentFrom, -1)
  return {
    recent: { label: monthName(recentFrom), from: recentFrom, to: endOfMonth(recentFrom) },
    usual: { label: `${shortMonth(usualFrom)}–${shortMonth(usualTo)} average`, from: usualFrom, to: usualTo },
    months,
  }
}

type Group = { id: string; name: string; recent: SpendLine[]; usualTotal: number; recentTotal: number }

/**
 * Category or merchant spending last month against the average of the three months before
 * (US8 scenario 1). Needs history covering the whole comparison.
 */
function periodChanges(
  lines: readonly SpendLine[],
  today: CalendarDate,
  historyStart: CalendarDate | null,
  by: 'category' | 'merchant',
): Insight[] {
  const periods = comparisonMonths(today, historyStart)
  if (!periods) return []
  const { recent, usual, months } = periods
  const groups = new Map<string, Group>()
  for (const l of lines) {
    const id = by === 'category' ? l.categoryId : l.merchantKey
    if (!id) continue
    const isRecent = inRange(l.date, recent.from, recent.to)
    if (!isRecent && !inRange(l.date, usual.from, usual.to)) continue
    let g = groups.get(id)
    if (!g) groups.set(id, (g = { id, name: (by === 'category' ? l.categoryName : l.merchantName) ?? 'Unnamed', recent: [], usualTotal: 0, recentTotal: 0 }))
    if (isRecent) {
      g.recentTotal += l.amountMinor
      if (l.amountMinor > 0) g.recent.push(l)
    } else g.usualTotal += l.amountMinor
  }
  // Merchants are noisier than categories, so they need a bigger change to be worth mentioning.
  const minShare = by === 'category' ? CHANGE_SHARE : CHANGE_SHARE * 2
  const minMinor = by === 'category' ? CHANGE_MIN_MINOR : CHANGE_MIN_MINOR * 1.5
  const out: Insight[] = []
  for (const g of groups.values()) {
    const avg = Math.round(g.usualTotal / months)
    const now = Math.max(0, g.recentTotal)
    const diff = now - Math.max(0, avg)
    if (avg <= 0 || Math.abs(diff) < minMinor || Math.abs(diff) / avg < minShare) continue
    const up = diff > 0
    const where = by === 'category' ? `in ${g.name}` : `at ${g.name}`
    out.push({
      key: `${by}:${g.id}:${monthKey(recent.from)}`,
      kind: by === 'category' ? 'category_change' : 'merchant_change',
      title: `${by === 'category' ? g.name : `Spending at ${g.name}`} ${up ? 'up' : 'down'} ${pct(diff / avg)} in ${recent.label}`,
      detail: `${rupees(now)} in ${recent.label}, ${up ? 'compared with' : 'down from'} your usual ${rupees(avg)} a month (${usual.label}). ${
        g.recent.length ? `${g.recent.length} payment${g.recent.length === 1 ? '' : 's'} ${where} last month.` : `No spending ${where} last month.`
      }`,
      direction: up ? 'up' : 'down',
      period: recent,
      comparison: usual,
      currentMinor: now,
      comparisonMinor: avg,
      sources: topSources(g.recent, by === 'category' ? undefined : (l) => l.categoryName ?? l.merchantName),
      sourceCount: g.recent.length,
      filter: by === 'category' ? { from: recent.from, to: recent.to, categoryId: g.id } : { from: recent.from, to: recent.to, text: g.name },
      weightMinor: Math.abs(diff),
    })
  }
  return out.sort((a, b) => b.weightMinor - a.weightMinor).slice(0, by === 'category' ? 4 : 3)
}

export const categoryChanges = (lines: readonly SpendLine[], today: CalendarDate, historyStart: CalendarDate | null) =>
  periodChanges(lines, today, historyStart, 'category')
export const merchantChanges = (lines: readonly SpendLine[], today: CalendarDate, historyStart: CalendarDate | null) =>
  periodChanges(lines, today, historyStart, 'merchant')

/** Everyday spending per weekend day against per weekday, over the last 90 days. */
export function weekendSpending(lines: readonly SpendLine[], today: CalendarDate, historyStart: CalendarDate | null): Insight[] {
  if (!historyStart) return []
  const to = addDays(today, -1)
  const windowFrom = addDays(today, -WEEKEND_DAYS)
  const from = compareDates(historyStart, windowFrom) > 0 ? historyStart : windowFrom
  let weekendDays = 0
  let weekdays = 0
  for (let d = from; compareDates(d, to) <= 0; d = addDays(d, 1)) {
    const w = weekday(d)
    if (w === 0 || w === 6) weekendDays++
    else weekdays++
  }
  if (weekendDays < 8 || weekdays < 20) return []
  let weekendTotal = 0
  let weekdayTotal = 0
  const weekendLines: SpendLine[] = []
  for (const l of lines) {
    if (l.recurring || !inRange(l.date, from, to)) continue
    const w = weekday(l.date)
    if (w === 0 || w === 6) {
      weekendTotal += l.amountMinor
      if (l.amountMinor > 0) weekendLines.push(l)
    } else weekdayTotal += l.amountMinor
  }
  const perWeekend = Math.round(weekendTotal / weekendDays)
  const perWeekday = Math.round(weekdayTotal / weekdays)
  // A habit, not one big Saturday: spending on several weekend days, and some on weekdays to compare with.
  if (perWeekday <= 0 || new Set(weekendLines.map((l) => l.date)).size < 4) return []
  if (perWeekend - perWeekday < WEEKEND_MIN_MINOR || perWeekend < perWeekday * WEEKEND_RATIO) return []
  const byCategory = new Map<string, number>()
  for (const l of weekendLines) byCategory.set(l.categoryName ?? 'Uncategorised', (byCategory.get(l.categoryName ?? 'Uncategorised') ?? 0) + l.amountMinor)
  const top = [...byCategory].sort((a, b) => b[1] - a[1]).slice(0, 2)
  const days = diffDays(addDays(to, 1), from)
  const period = { label: `A weekend day, last ${days} days`, from, to }
  return [
    {
      key: `weekend:${monthKey(today)}`,
      kind: 'weekend_spending',
      title: `Weekends cost about ${(perWeekend / Math.max(perWeekday, 1)).toFixed(1)}× a weekday`,
      detail: `About ${rupees(perWeekend)} a day on Saturdays and Sundays, compared with ${rupees(perWeekday)} on weekdays, over the last ${days} days (recurring payments not counted). Most weekend spending went to ${top
        .map(([name, v]) => `${name} (${rupees(v)})`)
        .join(' and ')}.`,
      direction: 'up',
      period,
      comparison: { label: 'A weekday, same period', from, to },
      currentMinor: perWeekend,
      comparisonMinor: perWeekday,
      sources: topSources(weekendLines),
      sourceCount: weekendLines.length,
      filter: { from, to },
      weightMinor: (perWeekend - perWeekday) * weekendDays,
    },
  ]
}

/** A recent purchase several times the usual size for its category over the past year. */
export function unusualPurchases(lines: readonly SpendLine[], today: CalendarDate): Insight[] {
  const recentFrom = addDays(today, -UNUSUAL_RECENT_DAYS)
  const byCategory = new Map<string, SpendLine[]>()
  for (const l of lines) {
    if (!l.categoryId || l.recurring || l.amountMinor <= 0) continue
    const list = byCategory.get(l.categoryId) ?? []
    list.push(l)
    byCategory.set(l.categoryId, list)
  }
  const out: Insight[] = []
  for (const list of byCategory.values()) {
    for (const l of list) {
      if (!inRange(l.date, recentFrom, today) || l.amountMinor < UNUSUAL_MIN_MINOR) continue
      const yearFrom = addDays(l.date, -365)
      const before = list.filter((p) => p !== l && compareDates(p.date, l.date) < 0 && compareDates(p.date, yearFrom) >= 0).map((p) => p.amountMinor)
      if (before.length < UNUSUAL_MIN_HISTORY) continue
      const usual = median(before)
      if (l.amountMinor < usual * UNUSUAL_RATIO) continue
      out.push({
        key: `unusual:${l.txnId}:${l.categoryId}`,
        kind: 'unusual_purchase',
        title: `${rupees(l.amountMinor)} at ${l.merchantName || 'an unnamed payee'} on ${dayMonth(l.date)}`,
        detail: `About ${Math.round(l.amountMinor / Math.max(usual, 1))}× your typical ${l.categoryName} payment of ${rupees(usual)} (the middle of ${before.length} payments in the year before).`,
        direction: 'up',
        period: { label: dayMonth(l.date), from: l.date, to: l.date },
        comparison: { label: `${l.categoryName}, previous 12 months`, from: yearFrom, to: addDays(l.date, -1) },
        currentMinor: l.amountMinor,
        comparisonMinor: usual,
        sources: topSources([l]),
        sourceCount: 1,
        filter: { from: l.date, to: l.date, categoryId: l.categoryId! },
        weightMinor: l.amountMinor - usual,
      })
    }
  }
  return out.sort((a, b) => b.weightMinor - a.weightMinor).slice(0, 3)
}

/** What one payment of a schedule costs per month on average. */
export function monthlyEquivalent(amountMinor: number, frequency: Frequency, interval: number): number {
  const perYear = frequency === 'weekly' ? 52 / interval : frequency === 'monthly' ? 12 / interval : 1 / interval
  return Math.round((amountMinor * perYear) / 12)
}

const activeOn = (s: SubscriptionItem, date: CalendarDate) =>
  compareDates(s.startDate, date) <= 0 && (!s.endDate || compareDates(s.endDate, date) >= 0)

/**
 * Subscription prices that went up, and more (or pricier) subscriptions than six months ago. The
 * second needs six months of history, so items set up recently are not mistaken for new ones.
 */
export function subscriptionChanges(
  items: readonly SubscriptionItem[],
  payments: readonly SubscriptionPayment[],
  today: CalendarDate,
  historyStart: CalendarDate | null,
): Insight[] {
  const out: Insight[] = []
  const yearAgo = addDays(today, -365)
  for (const s of items) {
    if (!s.active) continue
    const paid = payments
      .filter((p) => p.itemId === s.itemId && inRange(p.date, yearAgo, today))
      .sort((a, b) => compareDates(a.date, b.date))
    if (paid.length < 2) continue
    const first = paid[0]!
    const last = paid.at(-1)!
    const rise = last.amountMinor - first.amountMinor
    if (rise < 1000 || rise < first.amountMinor * PRICE_RISE_SHARE) continue
    out.push({
      key: `sub_price:${s.itemId}:${last.txnId}`,
      kind: 'subscription_price',
      title: `${s.name} now costs ${rupees(last.amountMinor)}`,
      detail: `Up ${pct(rise / first.amountMinor)} from ${rupees(first.amountMinor)} in ${monthName(first.date)} — about ${rupees(
        monthlyEquivalent(rise, s.frequency, s.interval) * 12,
      )} more a year.`,
      direction: 'up',
      period: { label: dayMonth(last.date), from: last.date, to: last.date },
      comparison: { label: dayMonth(first.date), from: first.date, to: first.date },
      currentMinor: last.amountMinor,
      comparisonMinor: first.amountMinor,
      sources: [...paid].reverse().slice(0, MAX_SOURCES).map((p) => ({ txnId: p.txnId, date: p.date, label: s.name, amountMinor: p.amountMinor })),
      sourceCount: paid.length,
      filter: { from: first.date, to: last.date, text: s.name },
      weightMinor: monthlyEquivalent(rise, s.frequency, s.interval) * 12,
    })
  }

  const then = addMonths(today, -CREEP_MONTHS)
  const nowItems = items.filter((s) => s.active && activeOn(s, today))
  const thenItems = items.filter((s) => activeOn(s, then))
  const total = (list: readonly SubscriptionItem[]) => list.reduce((t, s) => t + monthlyEquivalent(s.amountMinor, s.frequency, s.interval), 0)
  const nowTotal = total(nowItems)
  const thenTotal = total(thenItems)
  const added = nowItems.filter((s) => !thenItems.includes(s))
  const enoughHistory = historyStart !== null && compareDates(historyStart, then) <= 0
  if (enoughHistory && added.length > 0 && nowTotal - thenTotal >= Math.max(10_000, thenTotal * 0.1)) {
    const addedIds = new Set(added.map((s) => s.itemId))
    const names = new Map(items.map((s) => [s.itemId, s.name]))
    const recentPaid = payments.filter((p) => addedIds.has(p.itemId)).sort((a, b) => compareDates(b.date, a.date))
    out.push({
      key: `subs:${monthKey(today)}`,
      kind: 'subscription_creep',
      title: `Subscriptions: ${rupees(nowTotal)} a month, up from ${rupees(thenTotal)}`,
      detail: `${nowItems.length} subscription${nowItems.length === 1 ? '' : 's'} now, against ${thenItems.length} in ${monthName(then)}. New since then: ${added
        .map((s) => s.name)
        .join(', ')}. That is about ${rupees((nowTotal - thenTotal) * 12)} more a year.`,
      direction: 'up',
      period: { label: 'Now', from: then, to: today },
      comparison: { label: monthName(then), from: then, to: then },
      currentMinor: nowTotal,
      comparisonMinor: thenTotal,
      sources: recentPaid.slice(0, MAX_SOURCES).map((p) => ({ txnId: p.txnId, date: p.date, label: names.get(p.itemId) ?? '', amountMinor: p.amountMinor })),
      sourceCount: recentPaid.length,
      filter: { from: then, to: today },
      weightMinor: (nowTotal - thenTotal) * 12,
    })
  }
  return out
}

export type InsightInput = {
  today: CalendarDate
  /** First day with any spending recorded, or null. */
  historyStart: CalendarDate | null
  lines: readonly SpendLine[]
  subscriptions: readonly SubscriptionItem[]
  subscriptionPayments: readonly SubscriptionPayment[]
}

/**
 * Every detector, in feed order: subscriptions, changes, one-offs, habits. A merchant change is left
 * out when its category change already tells the same story (most of its spending is in a category
 * that is reported).
 */
export function detectInsights(input: InsightInput): Insight[] {
  const { today, historyStart, lines } = input
  const categories = categoryChanges(lines, today, historyStart)
  const reported = new Set(categories.map((c) => c.filter.categoryId))
  const merchants = merchantChanges(lines, today, historyStart).filter((m) => {
    const recent = lines.filter((l) => l.merchantName === m.filter.text && inRange(l.date, m.period.from, m.period.to) && l.amountMinor > 0)
    const total = recent.reduce((t, l) => t + l.amountMinor, 0)
    const covered = recent.filter((l) => l.categoryId && reported.has(l.categoryId)).reduce((t, l) => t + l.amountMinor, 0)
    return total === 0 || covered * 2 < total
  })
  return [
    ...subscriptionChanges(input.subscriptions, input.subscriptionPayments, today, historyStart),
    ...categories,
    ...merchants,
    ...unusualPurchases(lines, today),
    ...weekendSpending(lines, today, historyStart),
  ]
}
