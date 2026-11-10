import { describe, expect, it } from 'vitest'
import {
  add,
  allocate,
  formatMoney,
  money,
  MoneyError,
  negate,
  parseAmount,
  subtract,
  sumMinor,
  toMajorString,
} from '@domain/money'

describe('money arithmetic', () => {
  it('adds and subtracts exactly', () => {
    expect(add(money(10), money(20))).toEqual(money(30))
    expect(subtract(money(10), money(25)).minor).toBe(-15)
    expect(negate(money(0)).minor).toBe(0)
    expect(Object.is(negate(money(0)).minor, -0)).toBe(false)
  })

  it('rejects currency mismatch and non-integers', () => {
    expect(() => add(money(1, 'INR'), money(1, 'USD'))).toThrow(MoneyError)
    expect(() => money(1.5)).toThrow(MoneyError)
    expect(() => sumMinor([Number.MAX_SAFE_INTEGER, 1])).toThrow(MoneyError)
  })

  it('sums', () => {
    expect(sumMinor([])).toBe(0)
    expect(sumMinor([100, -40, 5])).toBe(65)
  })
})

describe('allocate', () => {
  it('always sums to the total', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33])
    expect(allocate(1000, [3, 1])).toEqual([750, 250])
    const parts = allocate(99_999, [7, 11, 13])
    expect(parts.reduce((s, p) => s + p, 0)).toBe(99_999)
  })

  it('validates weights', () => {
    expect(() => allocate(10, [])).toThrow(MoneyError)
    expect(() => allocate(10, [0, 0])).toThrow(MoneyError)
    expect(() => allocate(10, [-1, 2])).toThrow(MoneyError)
  })
})

describe('formatting', () => {
  it('uses Indian digit grouping', () => {
    expect(formatMoney(money(12_500_000))).toBe('₹1,25,000.00')
    expect(formatMoney(money(-45_050))).toBe('-₹450.50')
    expect(formatMoney(money(-45_050), { signDisplay: 'never' })).toBe('₹450.50')
  })

  it('writes major-unit strings', () => {
    expect(toMajorString(-45_000)).toBe('-450.00')
    expect(toMajorString(5)).toBe('0.05')
    expect(toMajorString(0)).toBe('0.00')
    expect(toMajorString(123, 'JPY')).toBe('123')
  })
})

describe('parseAmount', () => {
  const ok = (s: string) => {
    const r = parseAmount(s)
    if (!r.ok) throw new Error(r.reason)
    return r.minor
  }

  it.each([
    ['1,25,000.50', 12_500_050],
    ['₹ 450', 45_000],
    ['Rs. 99.9', 9_990],
    ['INR 10', 1_000],
    ['450.00 Dr', -45_000],
    ['1,000 CR', 100_000],
    ['(500.00)', -50_000],
    ['-12', -1_200],
    ['+3', 300],
    ['-₹5', -500],
    ['.5', 50],
    ['0', 0],
    ['0.00 Dr', 0],
  ])('parses %s', (input, expected) => {
    expect(ok(input)).toBe(expected)
  })

  it.each(['', 'abc', '1.234', '12-3', '1e5', '--5'])('rejects %s', (input) => {
    expect(parseAmount(input).ok).toBe(false)
  })

  it('respects zero-decimal currencies', () => {
    expect(parseAmount('1,200', 'JPY')).toEqual({ ok: true, minor: 1200 })
    expect(parseAmount('1.5', 'JPY').ok).toBe(false)
  })

  it('rejects unsafe magnitudes', () => {
    expect(parseAmount('99999999999999999999').ok).toBe(false)
  })
})
