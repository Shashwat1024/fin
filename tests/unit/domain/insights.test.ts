import { describe, expect, it } from 'vitest'
import { addDays, addMonths, weekday } from '@domain/dates'
import {
  categoryChanges,
  comparisonMonths,
  detectInsights,
  merchantChanges,
  monthlyEquivalent,
  subscriptionChanges,
  unusualPurchases,
  weekendSpending,
  type SpendLine,
  type SubscriptionItem,
  type SubscriptionPayment,
} from '@domain/insights'

const TODAY = '2026-11-09' // Monday
let n = 0
const line = (date: string, amountMinor: number, over: Partial<SpendLine> = {}): SpendLine => ({
  txnId: `t${++n}`,
  date,
  amountMinor,
  categoryId: 'food',
  categoryName: 'Food',
  merchantKey: 'swiggy',
  merchantName: 'Swiggy',
  recurring: false,
  ...over,
})

/** `perMonth` of spending on the 10th of each month from Jul to Sep, then `october` on 10 Oct. */
function months(perMonth: number, october: number, over: Partial<SpendLine> = {}): SpendLine[] {
  return [
    line('2026-07-10', perMonth, over),
    line('2026-08-10', perMonth, over),
    line('2026-09-10', perMonth, over),
    ...(october ? [line('2026-10-10', october, over)] : []),
  ]
}

describe('comparison periods', () => {
  it('compares the last complete month with the three before it', () => {
    const p = comparisonMonths(TODAY, '2026-06-01')!
    expect(p.recent).toEqual({ label: 'October', from: '2026-10-01', to: '2026-10-31' })
    expect(p.usual).toEqual({ label: 'Jul–Sept average', from: '2026-07-01', to: '2026-09-30' })
    expect(p.months).toBe(3)
  })

  it('uses two months when that is all the history there is, and none with less', () => {
    expect(comparisonMonths(TODAY, '2026-08-01')).toMatchObject({ months: 2, usual: { label: 'Aug–Sept average', from: '2026-08-01' } })
    expect(comparisonMonths(TODAY, '2026-08-02')).toBeNull()
    expect(comparisonMonths(TODAY, null)).toBeNull()
  })
})

describe('category and merchant changes', () => {
  it('reports a material rise with the comparison basis and the transactions behind it', () => {
    const [i] = categoryChanges(months(1_000_000, 1_500_000), TODAY, '2026-06-01')
    expect(i).toMatchObject({
      kind: 'category_change',
      key: 'category:food:2026-10',
      title: 'Food up 50% in October',
      direction: 'up',
      currentMinor: 1_500_000,
      comparisonMinor: 1_000_000,
      comparison: { label: 'Jul–Sept average', from: '2026-07-01', to: '2026-09-30' },
      filter: { from: '2026-10-01', to: '2026-10-31', categoryId: 'food' },
      sourceCount: 1,
    })
    expect(i!.detail).toContain('₹15,000 in October, compared with your usual ₹10,000 a month (Jul–Sept average)')
    expect(i!.sources[0]).toMatchObject({ date: '2026-10-10', amountMinor: 1_500_000 })
  })

  it('reports a fall too, in the same neutral terms', () => {
    const [i] = categoryChanges(months(1_000_000, 400_000), TODAY, '2026-06-01')
    expect(i).toMatchObject({ title: 'Food down 60% in October', direction: 'down', currentMinor: 400_000 })
    expect(i!.detail).toContain('down from your usual ₹10,000')
  })

  it('stays quiet for small changes, in share or in rupees', () => {
    expect(categoryChanges(months(1_000_000, 1_200_000), TODAY, '2026-06-01')).toEqual([]) // +20%
    expect(categoryChanges(months(200_000, 290_000), TODAY, '2026-06-01')).toEqual([]) // +45% but ₹900
  })

  it('needs history covering the whole comparison', () => {
    expect(categoryChanges(months(1_000_000, 2_000_000), TODAY, '2026-08-15')).toEqual([])
    // Two months of usual: Aug and Sep average ₹10,000 against ₹20,000 in October.
    expect(categoryChanges(months(1_000_000, 2_000_000), TODAY, '2026-08-01')[0]).toMatchObject({ title: 'Food up 100% in October', comparisonMinor: 1_000_000 })
    expect(categoryChanges(months(1_000_000, 2_000_000), TODAY, null)).toEqual([])
  })

  it('nets refunds and ignores uncategorised spending', () => {
    const lines = [...months(1_000_000, 1_500_000), line('2026-10-20', -500_000)]
    expect(categoryChanges(lines, TODAY, '2026-06-01')).toEqual([])
    expect(categoryChanges(months(1_000_000, 2_000_000, { categoryId: null, categoryName: null }), TODAY, '2026-06-01')).toEqual([])
  })

  it('needs a bigger change for a merchant than for a category', () => {
    expect(merchantChanges(months(1_000_000, 1_400_000), TODAY, '2026-06-01')).toEqual([]) // +40%
    const [m] = merchantChanges(months(1_000_000, 1_600_000), TODAY, '2026-06-01')
    expect(m).toMatchObject({ kind: 'merchant_change', title: 'Spending at Swiggy up 60% in October', filter: { text: 'Swiggy' } })
  })
})

describe('weekend spending', () => {
  /** Everyday spending for the 90 days before today: `weekend` per weekend day, `weekday` per weekday. */
  function daily(weekendMinor: number, weekdayMinor: number, over: Partial<SpendLine> = {}): SpendLine[] {
    const out: SpendLine[] = []
    for (let i = 1; i <= 90; i++) {
      const d = addDays(TODAY, -i)
      const w = weekday(d)
      out.push(line(d, w === 0 || w === 6 ? weekendMinor : weekdayMinor, over))
    }
    return out
  }

  it('compares spending per weekend day with per weekday', () => {
    const [i] = weekendSpending(daily(300_000, 100_000), TODAY, '2026-01-01')
    expect(i).toMatchObject({ kind: 'weekend_spending', currentMinor: 300_000, comparisonMinor: 100_000, title: 'Weekends cost about 3.0× a weekday' })
    expect(i!.detail).toContain('About ₹3,000 a day on Saturdays and Sundays, compared with ₹1,000 on weekdays, over the last 90 days')
    expect(i!.detail).toContain('Food (₹')
    expect(i!.sources).toHaveLength(5)
  })

  it('leaves out recurring payments and stays quiet when weekends are similar', () => {
    expect(weekendSpending(daily(140_000, 100_000), TODAY, '2026-01-01')).toEqual([])
    expect(weekendSpending(daily(300_000, 100_000, { recurring: true }), TODAY, '2026-01-01')).toEqual([])
  })

  it('needs enough days of history', () => {
    expect(weekendSpending(daily(300_000, 100_000), TODAY, addDays(TODAY, -20))).toEqual([])
  })
})

describe('unusual purchases', () => {
  const history = Array.from({ length: 8 }, (_, i) => line(addDays(TODAY, -60 - i * 20), 150_000 + i * 1000, { categoryId: 'shop', categoryName: 'Shopping', merchantName: 'Amazon' }))

  it('flags a recent purchase several times the usual size for its category', () => {
    const big = line(addDays(TODAY, -3), 2_500_000, { categoryId: 'shop', categoryName: 'Shopping', merchantName: 'Croma' })
    const [i] = unusualPurchases([...history, big], TODAY)
    expect(i).toMatchObject({ kind: 'unusual_purchase', key: `unusual:${big.txnId}:shop`, title: '₹25,000 at Croma on 6 Nov', sourceCount: 1 })
    expect(i!.detail).toMatch(/About 16× your typical Shopping payment of ₹1,535 \(the middle of 8 payments/)
  })

  it('ignores small, old, recurring or poorly-known purchases', () => {
    const shop = { categoryId: 'shop', categoryName: 'Shopping' }
    expect(unusualPurchases([...history, line(addDays(TODAY, -3), 190_000, shop)], TODAY)).toEqual([]) // under ₹2,000
    expect(unusualPurchases([...history, line(addDays(TODAY, -45), 2_500_000, shop)], TODAY)).toEqual([]) // not recent
    expect(unusualPurchases([...history, line(addDays(TODAY, -3), 2_500_000, { ...shop, recurring: true })], TODAY)).toEqual([])
    expect(unusualPurchases([...history.slice(0, 4), line(addDays(TODAY, -3), 2_500_000, shop)], TODAY)).toEqual([]) // 4 earlier payments
  })
})

describe('subscriptions', () => {
  const sub = (itemId: string, name: string, amountMinor: number, startDate: string, over: Partial<SubscriptionItem> = {}): SubscriptionItem => ({
    itemId,
    name,
    amountMinor,
    frequency: 'monthly',
    interval: 1,
    startDate,
    endDate: null,
    active: true,
    ...over,
  })
  const paid = (itemId: string, date: string, amountMinor: number): SubscriptionPayment => ({ itemId, txnId: `${itemId}-${date}`, date, amountMinor })

  it('converts any schedule to a monthly cost', () => {
    expect(monthlyEquivalent(120_000, 'yearly', 1)).toBe(10_000)
    expect(monthlyEquivalent(10_000, 'weekly', 1)).toBe(43_333)
    expect(monthlyEquivalent(30_000, 'monthly', 3)).toBe(10_000)
  })

  it('reports a price rise between the first and latest payment this year', () => {
    const items = [sub('nf', 'Netflix', 64_900, '2025-01-05')]
    const payments = [paid('nf', '2026-03-05', 49_900), paid('nf', '2026-04-05', 49_900), paid('nf', '2026-10-05', 64_900)]
    const [i] = subscriptionChanges(items, payments, TODAY, '2025-01-01')
    expect(i).toMatchObject({ kind: 'subscription_price', key: 'sub_price:nf:nf-2026-10-05', title: 'Netflix now costs ₹649', currentMinor: 64_900, comparisonMinor: 49_900, sourceCount: 3 })
    expect(i!.detail).toBe('Up 30% from ₹499 in March — about ₹1,800 more a year.')
  })

  it('reports more subscriptions than six months ago, naming the new ones', () => {
    const items = [sub('nf', 'Netflix', 64_900, '2025-01-05'), sub('sp', 'Spotify', 11_900, '2026-07-01'), sub('ic', 'iCloud', 7_500, '2026-08-15')]
    expect(subscriptionChanges(items, [], TODAY, '2026-07-01')).toEqual([]) // under six months of history
    const [i] = subscriptionChanges(items, [paid('sp', '2026-11-01', 11_900)], TODAY, '2025-01-01')
    expect(i).toMatchObject({ kind: 'subscription_creep', currentMinor: 84_300, comparisonMinor: 64_900, title: 'Subscriptions: ₹843 a month, up from ₹649' })
    expect(i!.detail).toContain('3 subscriptions now, against 1 in May. New since then: Spotify, iCloud.')
  })

  it('ignores ended, paused and tiny changes', () => {
    const ended = [sub('nf', 'Netflix', 64_900, '2025-01-05'), sub('sp', 'Spotify', 11_900, '2026-07-01', { active: false })]
    expect(subscriptionChanges(ended, [], TODAY, '2025-01-01')).toEqual([])
    const tiny = [sub('nf', 'Netflix', 64_900, '2026-01-05')]
    expect(subscriptionChanges(tiny, [paid('nf', '2026-05-05', 64_900), paid('nf', '2026-10-05', 65_400)], TODAY, '2025-01-01')).toEqual([])
  })
})

describe('the insight feed', () => {
  it('runs every detector over the same input and gives each a stable key', () => {
    const lines = months(1_000_000, 2_000_000)
    const input = { today: TODAY, historyStart: '2026-06-01', lines, subscriptions: [], subscriptionPayments: [] }
    const a = detectInsights(input)
    const b = detectInsights(input)
    // Swiggy is all Food, so its merchant change would only repeat the Food one.
    expect(a.map((i) => i.key)).toEqual(['category:food:2026-10'])
    expect(b).toEqual(a)
  })

  it('keeps a merchant change its category does not already explain', () => {
    const lines = months(1_000_000, 2_000_000, { categoryId: null, categoryName: null })
    const keys = detectInsights({ today: TODAY, historyStart: '2026-06-01', lines, subscriptions: [], subscriptionPayments: [] }).map((i) => i.key)
    expect(keys).toEqual(['merchant:swiggy:2026-10'])
  })

  it('finds nothing without history', () => {
    expect(detectInsights({ today: TODAY, historyStart: null, lines: [], subscriptions: [], subscriptionPayments: [] })).toEqual([])
    expect(addMonths(TODAY, 0)).toBe(TODAY)
  })
})
