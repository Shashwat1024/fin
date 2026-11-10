import { describe, expect, it } from 'vitest'
import {
  accountNature,
  computeBalance,
  displayBalance,
  isLiquid,
  storedOpeningBalance,
  transferLegs,
  validateSplits,
} from '@domain/ledger'

describe('accounts', () => {
  it('classifies nature and liquidity', () => {
    expect(accountNature('bank')).toBe('asset')
    expect(accountNature('credit_card')).toBe('liability')
    expect(accountNature('loan')).toBe('liability')
    expect(isLiquid('cash')).toBe(true)
    expect(isLiquid('credit_card')).toBe(false)
    expect(isLiquid('investment')).toBe(false)
  })

  it('computes balances from opening + amounts', () => {
    expect(computeBalance(5_000_000, [-45_000, -240_000, 1_000_000])).toBe(5_715_000)
  })

  it('shows liabilities as owed', () => {
    const opening = storedOpeningBalance('credit_card', 1_200_000) // owe ₹12,000
    expect(opening).toBe(-1_200_000)
    const balance = computeBalance(opening, [-50_000, 300_000]) // purchase ₹500, payment ₹3,000
    expect(displayBalance('credit_card', balance)).toBe(950_000)
    expect(displayBalance('bank', 100)).toBe(100)
    expect(storedOpeningBalance('bank', 0)).toBe(0)
    expect(Object.is(displayBalance('loan', 0), -0)).toBe(false)
  })
})

describe('splits', () => {
  it('accepts parts that sum exactly', () => {
    expect(
      validateSplits(-240_000, [
        { categoryId: 'g', amountMinor: -150_000 },
        { categoryId: 'h', amountMinor: -90_000 },
      ]),
    ).toEqual({ ok: true })
  })

  it('reports the remaining difference', () => {
    expect(
      validateSplits(-240_000, [
        { categoryId: 'g', amountMinor: -150_000 },
        { categoryId: 'h', amountMinor: -80_000 },
      ]),
    ).toEqual({ ok: false, reason: 'SUM_MISMATCH', remainingMinor: -10_000 })
  })

  it('rejects too few, zero and wrong-sign parts', () => {
    expect(validateSplits(-100, [{ categoryId: 'a', amountMinor: -100 }])).toMatchObject({
      reason: 'TOO_FEW_PARTS',
    })
    expect(
      validateSplits(-100, [
        { categoryId: 'a', amountMinor: -100 },
        { categoryId: 'b', amountMinor: 0 },
      ]),
    ).toMatchObject({ reason: 'ZERO_PART' })
    expect(
      validateSplits(-100, [
        { categoryId: 'a', amountMinor: -200 },
        { categoryId: 'b', amountMinor: 100 },
      ]),
    ).toMatchObject({ reason: 'SIGN_MISMATCH' })
  })
})

describe('transfers', () => {
  it('produces opposite legs', () => {
    expect(transferLegs(1_000_000)).toEqual({ fromMinor: -1_000_000, toMinor: 1_000_000 })
    expect(() => transferLegs(0)).toThrow(RangeError)
    expect(() => transferLegs(-5)).toThrow(RangeError)
  })
})
