import type { Forecast } from '@domain/forecast'
import type { Insight } from '@domain/insights'
import type { ScenarioChange, ScenarioResult } from '@domain/scenarios'
import type { GoalStatus } from '@domain/goals'
import type { AccountGroup, AccountNature, AccountType } from '@domain/ledger'
import type { NetWorthPoint } from '@domain/networth'
import type { Frequency, OccurrenceState, RecurringSuggestion } from '@domain/recurrence'
import type { RuleCondition } from '@domain/rules'

export type { AccountGroup, Frequency, GoalStatus, OccurrenceState, RuleCondition, ScenarioChange }

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
  /** Windows notifications (US11); off until the user turns them on. */
  notifyEnabled: boolean
  notifyRecurring: boolean
  notifyCardDue: boolean
  notifyLowCash: boolean
  /** Warranties ending within 30 days (US22). */
  notifyWarranty: boolean
  /** Remind about a card bill this many days before it is due (1–10). */
  cardDueNoticeDays: number
  /** HH:MM, local time; reminders wait until quiet hours end. */
  quietHoursStart: string
  quietHoursEnd: string
  /** Include amounts and names in notification text. */
  notifyShowAmounts: boolean
  /** Closing the window keeps Fin running in the tray. */
  keepInTray: boolean
  /** Start Fin in the tray when the user signs in to Windows. */
  startAtLogin: boolean
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
  notifyEnabled: false,
  notifyRecurring: true,
  notifyCardDue: true,
  notifyLowCash: true,
  notifyWarranty: true,
  cardDueNoticeDays: 3,
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
  notifyShowAmounts: true,
  keepInTray: false,
  startAtLogin: false,
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
  /** Credit cards with a billing cycle (US10); null otherwise. */
  statementDay: number | null
  dueDaysAfter: number | null
  /** Loans and deposits (US16, US17): annual rate in basis points. */
  rateBp: number | null
  loanPrincipalMinor: number | null
  tenureMonths: number | null
  firstEmiDate: string | null
  depositKind: 'fd' | 'rd' | null
  maturityDate: string | null
  installmentMinor: number | null
  payoutAccountId: string | null
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
  /** Learned from the narration or payee; null when unknown. */
  merchantName: string | null
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

export type ActivityEntry = {
  id: string
  at: string
  label: string
  undone: boolean
  isUndo: boolean
  canUndo: boolean
}

/** Every mutation returns the audit group id so the UI can offer a one-step undo. */
export type Mutation<T> = T & { auditGroupId: string }

// ---- CSV import -------------------------------------------------------------------------------

export type ImportRowStatus = 'new' | 'duplicate' | 'possible_duplicate'

export type ImportMatch = { id: string; postedDate: string; amountMinor: number; payee: string }

export type ImportPreview = {
  rows: {
    rowNumber: number
    status: ImportRowStatus
    match: ImportMatch | null
    /** Counterparty read from the narration, when recognisable (FR-017). */
    merchant: string | null
    suggestion: Suggestion | null
  }[]
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

export type ImportRowDto = {
  rowNumber: number
  raw: string[]
  outcome: string
  message: string | null
  transactionId: string | null
}

export type ReconcileResult = {
  statementBalanceMinor: number
  computedBalanceMinor: number
  differenceMinor: number
  asOf: string
}

// ---- Dashboard (US3) --------------------------------------------------------------------------

/** Where a metric's records live. Each metric equals the total shown at its drill-down (SC-005). */
export type DrillTarget =
  | { page: 'transactions'; from: string; to: string; direction?: 'in' | 'out'; kind?: 'standard' }
  | { page: 'accounts'; group: AccountGroup }
  | { page: 'networth' }
  | { page: 'forecast' }

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
  cardDues: Metric & {
    cardCount: number
    /** The earliest unpaid statement among cards with a cycle, or null. */
    nextDue: { accountId: string; accountName: string; amountMinor: number; dueDate: string } | null
    /** Cards with a cycle whose latest statements are all paid (and at least one has a cycle). */
    allPaid: boolean
  }
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

export type DataCounts = {
  accounts: number
  transactions: number
  importBatches: number
  latestTxnDate: string | null
}

export type BackupProblem =
  'NOT_FOUND' | 'NEEDS_PASSPHRASE' | 'WRONG_PASSPHRASE' | 'NOT_FIN' | 'DAMAGED' | 'TOO_NEW'

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

// ---- Planning: recurring items, budgets, goals (US5) ------------------------------------------

export type RecurringKind = 'income' | 'bill' | 'subscription' | 'emi' | 'transfer' | 'savings'

export type RecurringItemDto = {
  id: string
  name: string
  kind: RecurringKind
  accountId: string
  accountName: string
  toAccountId: string | null
  toAccountName: string | null
  categoryId: string | null
  categoryPath: string | null
  /** Expected amount as a positive number; `direction` says which way it moves. */
  amountMinor: number
  direction: 'in' | 'out'
  toleranceBp: number
  frequency: Frequency
  interval: number
  anchorDate: string
  endDate: string | null
  count: number | null
  notes: string | null
  active: boolean
  /** A yearly or quarterly bill whose amount is suggested monthly in the budget (US18). */
  setAside: boolean
  /** "Every month on the 1st" */
  scheduleText: string
  /** Next occurrence on or after today, null once the schedule has ended. */
  nextDue: string | null
}

export type OccurrenceDto = {
  /** `${itemId}:${dueDate}` */
  id: string
  itemId: string
  itemName: string
  kind: RecurringKind
  accountId: string
  accountName: string
  dueDate: string
  /** Signed from the account's side: income positive, payments negative. */
  expectedMinor: number
  state: OccurrenceState
  matchedTxn: { id: string; postedDate: string; amountMinor: number; payee: string } | null
  /** Set by the user (a skip or a hand-linked payment) rather than matched automatically. */
  manual: boolean
}

export type OccurrenceCandidate = {
  id: string
  postedDate: string
  amountMinor: number
  payee: string
  accountName: string
}

export type BudgetRowDto = {
  categoryId: string
  name: string
  group: CategoryGroup
  carryMinor: number
  assignedMinor: number
  spentMinor: number
  availableMinor: number
  /** A yearly or quarterly bill set aside monthly (US18): this month's suggested amount. */
  suggestion: { itemName: string; dueDate: string; amountMinor: number } | null
}

export type BudgetGroupDto = {
  /** The parent category. */
  id: string
  name: string
  rows: BudgetRowDto[]
  assignedMinor: number
  spentMinor: number
  availableMinor: number
}

export type BudgetMonthDto = {
  month: string
  from: string
  to: string
  incomeMinor: number
  /** Last month's unassigned money brought forward (negative when it was over-assigned). */
  leftoverMinor: number
  /** Last month's overspending, taken from this month's To assign. */
  overspentMinor: number
  assignedMinor: number
  toAssignMinor: number
  spentMinor: number
  availableMinor: number
  /** Spending this month with no category, so not in any budget line. */
  uncategorizedMinor: number
  groups: BudgetGroupDto[]
}

export type GoalContributionDto = { id: string; date: string; amountMinor: number; note: string | null }

export type GoalDto = {
  id: string
  name: string
  targetMinor: number
  targetDate: string | null
  linkedAccountId: string | null
  linkedAccountName: string | null
  notes: string | null
  savedMinor: number
  remainingMinor: number
  percent: number
  monthsLeft: number | null
  requiredMonthlyMinor: number | null
  paceMonthlyMinor: number
  projectedDate: string | null
  status: GoalStatus
  /** Newest first, at most 20. */
  contributions: GoalContributionDto[]
}

// ---- Categorisation: categories, rules, suggestions (US6) -------------------------------------

export type CategoryUsage = {
  transactions: number
  splits: number
  budgets: number
  recurring: number
  rules: number
  children: number
}

export type RuleDto = {
  id: string
  name: string
  priority: number
  enabled: boolean
  conditions: RuleCondition[]
  categoryId: string
  categoryPath: string
}

/** A category Fin proposes. Never applied until the user accepts it (FR-020). */
export type Suggestion = {
  categoryId: string
  categoryPath: string
  source: 'rule' | 'merchant'
  /** "Rule: Food delivery" or "You chose this for Swiggy 4 times" */
  reason: string
  ruleId: string | null
}

export type TxnSuggestion = Suggestion & { txnId: string }

export type RuleMatch = {
  id: string
  postedDate: string
  amountMinor: number
  payee: string
  accountName: string
  categoryPath: string | null
}

export type RulePreview = { count: number; matches: RuleMatch[] }

// ---- Forecast and net worth (US7) ---------------------------------------------------------------

export type { BufferRange, Confidence, ForecastEvent, ForecastPoint } from '@domain/forecast'
export type { NetWorthPoint }

/** One input the forecast used, listed so every number on the line can be explained (FR-027). */
export type ForecastAssumption = {
  kind: 'start' | 'recurring' | 'card' | 'deposit' | 'baseline' | 'note'
  label: string
  detail: string | null
  amountMinor: number | null
}

export type ForecastDto = Forecast & { assumptions: ForecastAssumption[]; hasCashAccounts: boolean }

export type ValuationDto = {
  id: string
  accountId: string
  date: string
  valueMinor: number
  note: string | null
}

export type NetWorthAccountRow = {
  id: string
  name: string
  type: AccountType
  nature: 'asset' | 'liability'
  /** Value used for net worth today: positive worth, or positive amount owed. */
  valueMinor: number
  /** 'deposit': worked out from the deposit's rate (US17). */
  source: 'ledger' | 'valuation' | 'deposit'
  valuationDate: string | null
  /** Balance from transactions, for comparison when a valuation is used. */
  ledgerMinor: number
  canValue: boolean
}

export type NetWorthDto = {
  today: string
  current: NetWorthPoint
  /** Month ends, oldest first; the last point is today. */
  points: NetWorthPoint[]
  accounts: NetWorthAccountRow[]
}

// ---- Behaviour insights and what-if (US8, v1.1) -----------------------------------------------

export type InsightDto = Insight & { dismissed: boolean }

export type InsightsDto = {
  today: string
  /** Latest transaction date: insights cover data up to here (FR-026). */
  asOf: string | null
  historyStart: string | null
  insights: InsightDto[]
  dismissedCount: number
}

export type RecurringSuggestionDto = RecurringSuggestion & {
  /** Pass to insights.dismiss to stop suggesting this series. */
  dismissKey: string
  accountName: string
  categoryPath: string | null
  suggestedKind: RecurringKind
}

export type ScenarioDto = ScenarioResult

// ---- Daily use (US9-US12) ------------------------------------------------------------------------

export type SavedViewDto = {
  id: string
  name: string
  /** Transactions filters as URL search parameters, e.g. `q=swiggy&range=this-month`. */
  query: string
  pinned: boolean
  sortOrder: number
}

export type CardCycleStatus = 'no_statement' | 'nothing_due' | 'paid' | 'due' | 'overdue'

export type CardCycleDto = {
  accountId: string
  accountName: string
  statementDay: number
  dueDaysAfter: number
  /** Null until the first statement date after the card's start date. */
  statementDate: string | null
  /** Owed at the end of the statement day (0 when in credit). */
  statementMinor: number
  dueDate: string | null
  /** Payments and refunds since the statement. */
  creditsSinceMinor: number
  remainingMinor: number
  /** New spending since the statement (due with the next statement). */
  spentSinceMinor: number
  /** Owed now, as on the Accounts page. */
  owedNowMinor: number
  nextStatementDate: string
  nextDueDate: string
  status: CardCycleStatus
  /** Days until the due date (negative when overdue); null without a statement. */
  daysUntilDue: number | null
}

export type SpendingDay = { date: string; spentMinor: number; count: number }

export type SpendingCalendarDto = {
  month: string
  from: string
  to: string
  /** Every day of the month, in order (future days have zero). */
  days: SpendingDay[]
  totalMinor: number
  noSpendDays: number
  /** Days up to today (or the whole month in the past), for the no-spend count. */
  elapsedDays: number
  highest: SpendingDay | null
  weekStart: number
  today: string
}

export type ReminderKind =
  'recurring_due' | 'recurring_overdue' | 'card_due' | 'low_cash' | 'warranty' | 'test'

export type ReminderDto = {
  key: string
  kind: ReminderKind
  title: string
  body: string
  /** Where clicking the notification takes the user. */
  route: string
  /** Already shown as a notification (previews only). */
  sent: boolean
}

// ---- Making sense of it (US13-US15) --------------------------------------------------------------

export type HealthMeasureKey = 'emergency_cover' | 'emi_share' | 'savings_rate' | 'card_share'

export type HealthMeasure = {
  key: HealthMeasureKey
  label: string
  /** Months (emergency cover) or percent; null when it cannot be worked out. */
  value: number | null
  /** The sentence shown, or why there is no value. */
  text: string
  available: boolean
}

export type HealthDto = {
  today: string
  /** The complete months the "recent" figures cover (up to three), for links to their records. */
  recent: { from: string; to: string } | null
  measures: HealthMeasure[]
}

export type MonthReviewState = { month: string; state: 'reviewed' | 'dismissed'; at: string }

export type MonthReviewAccount = {
  accountId: string
  name: string
  type: AccountType
  /** As displayed (owed for cards), at the end of the month. */
  monthEndBalanceMinor: number
  txnCount: number
}

export type MonthReviewDto = {
  month: string
  from: string
  to: string
  nextMonth: string
  state: MonthReviewState | null
  transactionCount: number
  uncategorizedCount: number
  accounts: MonthReviewAccount[]
  budget: {
    assignedMinor: number
    spentMinor: number
    overspent: { categoryId: string; path: string; overMinor: number }[]
  }
  next: {
    assignedMinor: number
    /** Categories with an amount this month and none yet next month. */
    copyableCount: number
  }
}

export type YearMonth = { month: string; from: string; to: string; inMinor: number; outMinor: number }

export type YearReviewDto = {
  basis: 'fy' | 'calendar'
  year: number
  label: string
  from: string
  /** The last day counted: the year's end, or today for the current year. */
  to: string
  /** The year is still going. */
  partial: boolean
  /** First transaction date, when the year starts before any data. */
  dataFrom: string | null
  inMinor: number
  outMinor: number
  savedMinor: number
  savingsRate: number | null
  months: YearMonth[]
  topCategories: { categoryId: string | null; name: string; amountMinor: number }[]
  topMerchants: { name: string; amountMinor: number }[]
  /** Biggest changes against the year before; null without data for that year. */
  changes: { categoryId: string; name: string; thisMinor: number; lastMinor: number }[] | null
  goalsReached: { id: string; name: string; targetMinor: number; reachedOn: string }[]
  netWorth: { startMinor: number; endMinor: number }
  /** Years with data, newest first, for the picker. */
  years: number[]
}

// ---- Loans and deposits (US16-US18) --------------------------------------------------------------

export type LoanRow = {
  n: number
  date: string
  emiMinor: number
  interestMinor: number
  principalMinor: number
  /** Outstanding after this instalment. */
  balanceMinor: number
}

export type LoanDto = {
  accountId: string
  accountName: string
  principalMinor: number
  rateBp: number
  months: number
  firstDate: string
  emiMinor: number
  totalInterestMinor: number
  /** Instalments dated before today. */
  paidCount: number
  interestPaidMinor: number
  principalPaidMinor: number
  /** Per the schedule. */
  outstandingMinor: number
  interestRemainingMinor: number
  next: LoanRow | null
  endDate: string | null
  /** What the ledger says is owed, to compare with the schedule. */
  ledgerOwedMinor: number
}

export type DepositDto = {
  accountId: string
  accountName: string
  kind: 'fd' | 'rd'
  rateBp: number
  startDate: string
  maturityDate: string
  /** Money put in so far. */
  depositedMinor: number
  valueTodayMinor: number
  maturityMinor: number
  matured: boolean
  payoutAccountId: string | null
  payoutAccountName: string | null
  /** A value recorded by hand is used for net worth instead. */
  hasRecordedValue: boolean
}

export type LoanPrepaymentDto = {
  currentEmiMinor: number
  tenureMonthsSaved: number
  tenureInterestSavedMinor: number
  newEmiMinor: number
  emiInterestSavedMinor: number
}

// ---- Tax and investments (US19, US20) ------------------------------------------------------------

export type TaxLineDto = {
  mappingId: string
  kind: 'category' | 'loan'
  name: string
  categoryId: string | null
  loanAccountId: string | null
  loanPart: 'interest' | 'principal' | null
  amountMinor: number
}

export type TaxSectionDto = {
  id: string
  code: string
  label: string
  /** null: no limit. */
  limitMinor: number | null
  /** 'in' for income sections (savings interest). */
  direction: 'out' | 'in'
  note: string | null
  totalMinor: number
  /** Within the limit. */
  countedMinor: number
  lines: TaxLineDto[]
}

export type TaxSuggestionDto = {
  loanAccountId: string
  name: string
  part: 'interest' | 'principal'
  sectionId: string
  amountMinor: number
}

export type TaxYearDto = {
  /** The year the financial year starts in (2026 for FY 2026-27). */
  year: number
  label: string
  from: string
  to: string
  sections: TaxSectionDto[]
  suggestions: TaxSuggestionDto[]
  years: number[]
}

export type CasSchemeDto = {
  name: string
  units: string
  nav: string
  navDate: string
  costMinor: number | null
  valueMinor: number
}

export type CasFolioDto = {
  key: string
  amc: string
  folio: string
  valueMinor: number
  schemes: CasSchemeDto[]
  suggestedAccountId: string | null
  suggestedName: string
}

export type CasPreviewDto = { statementDate: string; totalMinor: number; folios: CasFolioDto[] }

// ---- Shared life (US21) --------------------------------------------------------------------------

export type PersonDto = {
  id: string
  name: string
  archived: boolean
  /** Positive: they owe you; negative: you owe them. */
  balanceMinor: number
  /** "Rahul owes you ₹1,200", "You owe Priya ₹300" or "Settled up". */
  text: string
  lastDate: string | null
}

export type PersonEntryDto = {
  id: string
  date: string
  amountMinor: number
  kind: 'share' | 'repayment' | 'manual'
  note: string | null
  transactionId: string | null
  payee: string | null
  transactionMinor: number | null
}

export type TxnShareDto = {
  id: string
  personId: string
  personName: string
  amountMinor: number
  kind: 'share' | 'repayment' | 'manual'
}

export type RepaymentCandidateDto = {
  transactionId: string
  date: string
  payee: string
  amountMinor: number
}

// ---- Receipts and warranties (US22) --------------------------------------------------------------

export type AttachmentDto = {
  id: string
  transactionId: string
  fileName: string
  mime: string
  /** Bytes. */
  size: number
  warrantyUntil: string | null
  createdAt: string
}

export type WarrantyDto = {
  attachmentId: string
  fileName: string
  warrantyUntil: string
  /** Negative once it has ended. */
  daysLeft: number
  transactionId: string
  payee: string
  date: string
  amountMinor: number
}
