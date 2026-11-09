import type { AccountDto } from '@shared/types'

/** Headline totals derived from account balances (spec Clarification 1: cash = cash + bank). */
export function summarizeAccounts(accounts: readonly AccountDto[]) {
  let cashMinor = 0
  let assetsMinor = 0
  let owedMinor = 0
  for (const a of accounts) {
    if (a.archived) continue
    if (a.isLiquid) cashMinor += a.balanceMinor
    if (a.nature === 'asset') assetsMinor += a.balanceMinor
    else owedMinor += a.balanceMinor
  }
  return { cashMinor, assetsMinor, owedMinor, netWorthMinor: assetsMinor - owedMinor }
}
