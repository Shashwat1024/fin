import type { AccountNature, AccountType } from '@domain/ledger'

export type Theme = 'system' | 'light' | 'dark'

export type Settings = {
  currency: string
  timezone: string
  /** 1–12; India default 4 (April). */
  fyStartMonth: number
  /** 0 = Sunday … 6 = Saturday */
  weekStart: number
  locale: string
  theme: Theme
  /** Forecast warning threshold, minor units. */
  bufferMinor: number
  onboarded: boolean
  backupDir: string | null
}

export const DEFAULT_SETTINGS: Settings = {
  currency: 'INR',
  timezone: 'Asia/Kolkata',
  fyStartMonth: 4,
  weekStart: 1,
  locale: 'en-IN',
  theme: 'system',
  bufferMinor: 0,
  onboarded: false,
  backupDir: null,
}

export type AccountDto = {
  id: string
  name: string
  type: AccountType
  nature: AccountNature
  isLiquid: boolean
  currency: string
  /** As the user enters it: amount owed for liabilities. */
  openingBalanceMinor: number
  openingDate: string
  notes: string | null
  archived: boolean
  /** As displayed: amount owed for liabilities. */
  balanceMinor: number
  /** Signed ledger balance (inflow positive). */
  ledgerBalanceMinor: number
  txnCount: number
  lastTxnDate: string | null
  sortOrder: number
}

export type CategoryGroup = 'needs' | 'wants' | 'goals' | 'buffer' | 'income' | 'transfer'

export type CategoryDto = {
  id: string
  name: string
  parentId: string | null
  group: CategoryGroup
  isSystem: boolean
  archived: boolean
  /** "Parent › Child" or just "Name" */
  path: string
}

export type TagDto = { id: string; name: string; usage: number }

export type TxnKind = 'standard' | 'transfer'
export type TxnStatus = 'cleared' | 'pending'

export type TxnRow = {
  id: string
  accountId: string
  accountName: string
  accountType: AccountType
  currency: string
  postedDate: string
  amountMinor: number
  payee: string
  notes: string | null
  categoryId: string | null
  categoryPath: string | null
  splitCount: number
  tags: string[]
  kind: TxnKind
  transferId: string | null
  counterAccountId: string | null
  counterAccountName: string | null
  status: TxnStatus
  importBatchId: string | null
}

export type SplitDto = {
  id: string
  categoryId: string
  categoryPath: string
  amountMinor: number
  memo: string | null
}

export type TxnDetail = TxnRow & {
  splits: SplitDto[]
  tagIds: string[]
  createdAt: string
  updatedAt: string
}

export type TxnTotals = { count: number; inMinor: number; outMinor: number; netMinor: number }

export type TxnPage = { rows: TxnRow[]; nextCursor: string | null; totals: TxnTotals }

export type PayeeSuggestion = { payee: string; categoryId: string | null; accountId: string; count: number }

export type ActivityEntry = { id: string; at: string; label: string; undone: boolean; isUndo: boolean; canUndo: boolean }

/** Every mutation returns the audit group id so the UI can offer a one-step undo. */
export type Mutation<T> = T & { auditGroupId: string }

// ---- CSV import -------------------------------------------------------------------------------

export type ImportRowStatus = 'new' | 'duplicate' | 'possible_duplicate'

export type ImportMatch = { id: string; postedDate: string; amountMinor: number; payee: string }

export type ImportPreview = {
  rows: { rowNumber: number; status: ImportRowStatus; match: ImportMatch | null }[]
  /** Set when a file with the same contents was imported before. */
  sameFile: { batchId: string; importedAt: string; undone: boolean } | null
  account: { ledgerBalanceMinor: number; balanceMinor: number; lastTxnDate: string | null }
}

export type ImportCounts = {
  total: number
  imported: number
  duplicate: number
  skipped: number
  failed: number
  ignored: number
}

export type ImportBatchDto = {
  id: string
  accountId: string
  accountName: string
  fileName: string
  importedAt: string
  counts: ImportCounts
  statementClosing: { date: string; balanceMinor: number } | null
  undone: boolean
  /** Transactions from this batch still in the ledger. */
  liveCount: number
  /** Of those, how many were changed after import (e.g. recategorized). */
  editedCount: number
}

export type ImportRowDto = { rowNumber: number; raw: string[]; outcome: string; message: string | null; transactionId: string | null }

export type ReconcileResult = { statementBalanceMinor: number; computedBalanceMinor: number; differenceMinor: number; asOf: string }
