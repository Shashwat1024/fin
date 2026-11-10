import { sumMinor } from './money'

export const ACCOUNT_TYPES = [
  'cash',
  'bank',
  'credit_card',
  'investment',
  'loan',
  'other_asset',
  'other_liability',
] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]
export type AccountNature = 'asset' | 'liability'

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  cash: 'Cash',
  bank: 'Bank',
  credit_card: 'Credit card',
  investment: 'Investment',
  loan: 'Loan',
  other_asset: 'Other asset',
  other_liability: 'Other liability',
}

export function accountNature(type: AccountType): AccountNature {
  return type === 'credit_card' || type === 'loan' || type === 'other_liability' ? 'liability' : 'asset'
}

/** Liquid accounts make up "cash position" (spec Clarification 1: cash + bank only). */
export function isLiquid(type: AccountType): boolean {
  return type === 'cash' || type === 'bank'
}

/**
 * Stored sign convention for every account: inflow positive, outflow negative.
 * Balance = opening + Σ transaction amounts.
 */
export function computeBalance(openingMinor: number, amounts: readonly number[]): number {
  return sumMinor([openingMinor, ...amounts])
}

/**
 * Value shown to the user. Liabilities are shown as an amount owed (positive when money is owed).
 * Opening balance for a liability is entered as "amount owed" and stored negated.
 */
export function displayBalance(type: AccountType, balanceMinor: number): number {
  const v = accountNature(type) === 'liability' ? -balanceMinor : balanceMinor
  return v === 0 ? 0 : v
}

/** Convert a user-entered opening balance (owed amount for liabilities) to the stored value. */
export function storedOpeningBalance(type: AccountType, enteredMinor: number): number {
  const v = accountNature(type) === 'liability' ? -enteredMinor : enteredMinor
  return v === 0 ? 0 : v
}

export type SplitPart = { categoryId: string; amountMinor: number }

export type SplitValidation =
  | { ok: true }
  | { ok: false; reason: 'TOO_FEW_PARTS' | 'ZERO_PART' | 'SIGN_MISMATCH' | 'SUM_MISMATCH'; remainingMinor: number }

/** Splits need ≥ 2 non-zero parts with the parent's sign that sum exactly to the parent amount. */
export function validateSplits(totalMinor: number, parts: readonly SplitPart[]): SplitValidation {
  const allocated = sumMinor(parts.map((p) => p.amountMinor))
  const remainingMinor = totalMinor - allocated
  if (parts.length < 2) return { ok: false, reason: 'TOO_FEW_PARTS', remainingMinor }
  if (parts.some((p) => p.amountMinor === 0)) return { ok: false, reason: 'ZERO_PART', remainingMinor }
  if (parts.some((p) => Math.sign(p.amountMinor) !== Math.sign(totalMinor)))
    return { ok: false, reason: 'SIGN_MISMATCH', remainingMinor }
  if (remainingMinor !== 0) return { ok: false, reason: 'SUM_MISMATCH', remainingMinor }
  return { ok: true }
}

/** A transfer of a positive amount produces exactly opposite legs. */
export function transferLegs(amountMinor: number): { fromMinor: number; toMinor: number } {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new RangeError('Transfer amount must be a positive integer of minor units')
  }
  return { fromMinor: -amountMinor, toMinor: amountMinor }
}

/** Account groups used by dashboard balance metrics and the Accounts page filter (they must agree, SC-005). */
export const ACCOUNT_GROUPS = ['cash', 'cards', 'owed', 'all'] as const
export type AccountGroup = (typeof ACCOUNT_GROUPS)[number]

export const ACCOUNT_GROUP_LABELS: Record<AccountGroup, string> = {
  cash: 'Cash and bank accounts',
  cards: 'Credit cards',
  owed: 'Credit cards and loans',
  all: 'All accounts',
}

export function inAccountGroup(group: AccountGroup, type: AccountType): boolean {
  switch (group) {
    case 'cash':
      return isLiquid(type)
    case 'cards':
      return type === 'credit_card'
    case 'owed':
      return accountNature(type) === 'liability'
    case 'all':
      return true
  }
}
