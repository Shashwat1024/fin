import type { AccountGroup, AccountNature, AccountType } from '@domain/ledger'

export type { AccountGroup }

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

// ---- Dashboard (US3) --------------------------------------------------------------------------

/** Where a metric's records live. Each metric equals the total shown at its drill-down (SC-005). */
export type DrillTarget =
  | { page: 'transactions'; from: string; to: string; direction?: 'in' | 'out'; kind?: 'standard' }
  | { page: 'accounts'; group: AccountGroup }

export type MetricSource = {
  accountId: string
  accountName: string
  /** Latest date this account's data covers: its last transaction, or its start date. */
  lastDataDate: string
  lastImport: { at: string; fileName: string } | null
}

export type Metric = {
  valueMinor: number
  /** The oldest "data covers up to" date among the sources: everything is known at least up to here. */
  asOf: string | null
  sources: MetricSource[]
  drill: DrillTarget
}

export type MonthFlow = { month: string; from: string; to: string; inMinor: number; outMinor: number }

export type DashboardSummary = {
  today: string
  cash: Metric
  spent: Metric & { previousMinor: number; previousFrom: string; previousTo: string }
  income: Metric
  /** Whole percent of this month's income not spent (null without income); drills to this month's transactions. */
  savingsRate: { percent: number | null; drill: DrillTarget }
  cardDues: Metric & { cardCount: number }
  netWorth: Metric & { assetsMinor: number; owedMinor: number }
  /** Money in and out for the last six months, oldest first (spending as positive numbers). */
  months: MonthFlow[]
}

// ---- Backups, export, demo (US4) --------------------------------------------------------------

export type BackupKind = 'auto' | 'manual' | 'pre-restore' | 'pre-upgrade'

export type BackupInfo = {
  fileName: string
  path: string
  /** Local time the backup was made, 'YYYY-MM-DDTHH:mm:ss'. */
  createdAt: string
  kind: BackupKind
  encrypted: boolean
  sizeBytes: number
}

export type DataCounts = { accounts: number; transactions: number; importBatches: number; latestTxnDate: string | null }

export type BackupProblem = 'NOT_FOUND' | 'NEEDS_PASSPHRASE' | 'WRONG_PASSPHRASE' | 'NOT_FIN' | 'DAMAGED' | 'TOO_NEW'

export type BackupInspection =
  | { valid: true; encrypted: boolean; schemaVersion: number; needsUpgrade: boolean; counts: DataCounts }
  | { valid: false; reason: BackupProblem; message: string }

export type AppStatus = {
  demo: boolean
  dataDir: string
  backupDir: string
  defaultBackupDir: string
  counts: DataCounts
}
