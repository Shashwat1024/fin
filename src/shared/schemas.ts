import { z } from 'zod'
import { isCalendarDate } from '@domain/dates'
import { ACCOUNT_TYPES } from '@domain/ledger'
import { FREQUENCIES } from '@domain/recurrence'

/** Integer minor units within the safe-integer range. */
export const minor = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)
export const calendarDate = z.string().refine(isCalendarDate, 'Invalid date (expected YYYY-MM-DD)')
export const id = z.string().min(1).max(64)
const name = z.string().trim().min(1, 'Required').max(120)
const notes = z.string().max(2000).nullable()

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export const empty = z.object({}).optional()

export const settingsPatch = z.object({
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  timezone: z.string().refine(isTimeZone, 'Unknown time zone').optional(),
  fyStartMonth: z.number().int().min(1).max(12).optional(),
  weekStart: z.number().int().min(0).max(6).optional(),
  locale: z.string().min(2).max(20).optional(),
  theme: z.enum(['system', 'light', 'dark']).optional(),
  bufferMinor: minor.min(0).optional(),
  onboarded: z.boolean().optional(),
  backupDir: z.string().max(1000).nullable().optional(),
})

export const accountsListInput = z.object({ includeArchived: z.boolean().optional() }).optional()

export const accountInput = z.object({
  name,
  type: z.enum(ACCOUNT_TYPES),
  /** Amount owed for liabilities, balance for assets. */
  openingBalanceMinor: minor.optional(),
  openingDate: calendarDate,
  notes: notes.optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
})

export const accountUpdate = z.object({ id, patch: accountInput.partial() })
export const archiveInput = z.object({ id, archived: z.boolean() })

const splitPart = z.object({
  categoryId: id,
  amountMinor: minor,
  memo: z.string().max(500).nullable().optional(),
})
const tagNames = z.array(z.string().trim().min(1).max(40)).max(20)

export const txnInput = z.object({
  accountId: id,
  postedDate: calendarDate,
  amountMinor: minor.refine((v) => v !== 0, 'Amount cannot be zero'),
  payee: z.string().trim().max(300).optional(),
  notes: notes.optional(),
  categoryId: id.nullable().optional(),
  splits: z.array(splitPart).max(50).optional(),
  tags: tagNames.optional(),
  status: z.enum(['cleared', 'pending']).optional(),
})

export const txnUpdate = z.object({ id, patch: txnInput.partial() })
export const idInput = z.object({ id })
export const idsInput = z.object({ ids: z.array(id).min(1).max(5000) })

export const bulkUpdateInput = z.object({
  ids: z.array(id).min(1).max(5000),
  categoryId: id.nullable().optional(),
  addTags: tagNames.optional(),
  removeTagIds: z.array(id).max(50).optional(),
})

export const transferInput = z.object({
  fromAccountId: id,
  toAccountId: id,
  postedDate: calendarDate,
  amountMinor: minor.min(1, 'Amount must be greater than zero'),
  notes: notes.optional(),
})
export const transferUpdate = z.object({ transferId: id, patch: transferInput.partial() })

export const txnFilter = z.object({
  text: z.string().max(200).optional(),
  from: calendarDate.optional(),
  to: calendarDate.optional(),
  accountIds: z.array(id).max(200).optional(),
  /** May include the pseudo-id "uncategorized". Parent ids include their children. */
  categoryIds: z.array(id).max(500).optional(),
  tagIds: z.array(id).max(200).optional(),
  minAmountMinor: minor.min(0).optional(),
  maxAmountMinor: minor.min(0).optional(),
  direction: z.enum(['in', 'out']).optional(),
  kind: z.enum(['standard', 'transfer']).optional(),
  importBatchId: id.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(500).optional(),
})

export const payeeSuggestInput = z.object({
  prefix: z.string().max(100),
  limit: z.number().int().min(1).max(20).optional(),
})
export const undoInput = z.object({ auditGroupId: id })
export const activityInput = z.object({ limit: z.number().int().min(1).max(200).optional() }).optional()

export type SettingsPatch = z.output<typeof settingsPatch>
export type AccountInput = z.output<typeof accountInput>
export type TxnInput = z.output<typeof txnInput>
export type TxnFilter = z.output<typeof txnFilter>
export type TransferInput = z.output<typeof transferInput>
export type BulkUpdateInput = z.output<typeof bulkUpdateInput>

// ---- CSV import -------------------------------------------------------------------------------

export const mappingSchema = z.object({
  headerRow: z.number().int().min(0).max(1000),
  dateOrder: z.enum(['dmy', 'mdy', 'ymd']),
  amountMode: z.enum(['single', 'debit_credit', 'indicator']),
  columns: z.object({
    date: z.string().max(200),
    description: z.string().max(200),
    amount: z.string().max(200).optional(),
    debit: z.string().max(200).optional(),
    credit: z.string().max(200).optional(),
    indicator: z.string().max(200).optional(),
    balance: z.string().max(200).optional(),
    reference: z.string().max(200).optional(),
  }),
  signInverted: z.boolean().optional(),
})

const rawCells = z.array(z.string().max(2000)).max(100)
const MAX_IMPORT_ROWS = 20_000

const importedLine = z.object({
  rowNumber: z.number().int().min(1),
  raw: rawCells,
  date: calendarDate,
  amountMinor: minor.refine((v) => v !== 0, 'Amount cannot be zero'),
  description: z.string().max(1000),
  reference: z.string().max(200).nullable().optional(),
  balanceMinor: minor.nullable().optional(),
})

export const importPreviewInput = z.object({
  accountId: id,
  fileHash: z.string().max(128).nullable().optional(),
  rows: z
    .array(importedLine.pick({ rowNumber: true, date: true, amountMinor: true, description: true }))
    .max(MAX_IMPORT_ROWS),
})

export const importCommitInput = z.object({
  accountId: id,
  fileName: z.string().trim().min(1).max(260),
  fileHash: z.string().max(128).nullable().optional(),
  mapping: mappingSchema,
  rows: z.array(importedLine).max(MAX_IMPORT_ROWS),
  rejected: z
    .array(
      z.object({
        rowNumber: z.number().int().min(1),
        raw: rawCells,
        status: z.enum(['error', 'ignored']),
        message: z.string().max(500),
      }),
    )
    .max(MAX_IMPORT_ROWS),
  /** Choices for possible duplicates; anything not listed is skipped. */
  importPossibleDuplicates: z.array(z.number().int().min(1)).max(MAX_IMPORT_ROWS),
  statementClosing: z.object({ date: calendarDate, balanceMinor: minor }).nullable().optional(),
  /** Suggested categories the user accepted, by source line (FR-020). */
  categories: z
    .array(z.object({ rowNumber: z.number().int().min(1), categoryId: id }))
    .max(MAX_IMPORT_ROWS)
    .optional(),
  savePresetAs: z.string().trim().min(1).max(80).nullable().optional(),
})

export const importUndoInput = z.object({ batchId: id, includeEdited: z.boolean() })
export const savePresetInput = z.object({
  name: z.string().trim().min(1).max(80),
  mapping: mappingSchema.omit({ headerRow: true }),
})
export const reconcileInput = z.object({ id, statementDate: calendarDate, statementBalanceMinor: minor })

export type ImportPreviewInput = z.output<typeof importPreviewInput>
export type ImportCommitInput = z.output<typeof importCommitInput>

// ---- Dashboard ----------------------------------------------------------------------------------

export const dashboardInput = z.object({ asOf: calendarDate.optional() }).optional()

// ---- Backups, export, demo ---------------------------------------------------------------------

export const passphrase = z.string().min(8, 'Use at least 8 characters').max(200)
export const backupCreateInput = z.object({ passphrase: passphrase.optional() }).optional()
const backupPath = z.string().min(1).max(4000)
export const backupInspectInput = z.object({ path: backupPath, passphrase: z.string().max(200).optional() })
export const backupRestoreInput = backupInspectInput.extend({ confirm: z.literal(true) })

// ---- Planning (US5) ------------------------------------------------------------------------------

export const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Invalid month (expected YYYY-MM)')

export const recurringInput = z
  .object({
    name,
    kind: z.enum(['income', 'bill', 'subscription', 'emi', 'transfer', 'savings']),
    accountId: id,
    toAccountId: id.nullable().optional(),
    categoryId: id.nullable().optional(),
    /** Positive; the kind sets the direction (income in, everything else out). */
    amountMinor: minor.min(1, 'Amount must be greater than zero'),
    toleranceBp: z.number().int().min(0).max(5000).optional(),
    frequency: z.enum(['weekly', 'monthly', 'yearly']),
    interval: z.number().int().min(1, 'At least 1').max(52).optional(),
    anchorDate: calendarDate,
    endDate: calendarDate.nullable().optional(),
    count: z.number().int().min(1).max(1000).nullable().optional(),
    notes: notes.optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => !v.endDate || v.endDate >= v.anchorDate, {
    message: 'The end date is before the first date',
    path: ['endDate'],
  })
  .refine((v) => !v.toAccountId || v.toAccountId !== v.accountId, {
    message: 'Choose a different account',
    path: ['toAccountId'],
  })

export const recurringUpdate = z.object({ id, input: recurringInput })
export const occurrencesInput = z
  .object({ from: calendarDate, to: calendarDate })
  .refine((v) => v.from <= v.to, 'from must not be after to')
export const occurrenceRef = z.object({ itemId: id, dueDate: calendarDate })
export const occurrenceAction = occurrenceRef.extend({
  action: z.enum(['skip', 'match', 'reset']),
  txnId: id.optional(),
})

export const budgetMonthInput = z.object({ month: monthKey })
export const budgetAssignInput = z.object({
  month: monthKey,
  categoryId: id,
  assignedMinor: minor.min(0, 'Assign zero or more'),
})

export const goalInput = z.object({
  name,
  targetMinor: minor.min(1, 'Target must be greater than zero'),
  targetDate: calendarDate.nullable().optional(),
  linkedAccountId: id.nullable().optional(),
  notes: notes.optional(),
})
export const goalUpdate = z.object({ id, input: goalInput })
export const contributeInput = z.object({
  goalId: id,
  date: calendarDate,
  amountMinor: minor.refine((v) => v !== 0, 'Amount cannot be zero'),
  note: z.string().trim().max(300).nullable().optional(),
})

export type RecurringInput = z.output<typeof recurringInput>
export type GoalInput = z.output<typeof goalInput>

// ---- Categorisation (US6) -----------------------------------------------------------------------

const categoryGroup = z.enum(['needs', 'wants', 'goals', 'buffer', 'income', 'transfer'])
export const categoryCreateInput = z.object({
  name,
  parentId: id.nullable().optional(),
  group: categoryGroup.optional(),
})
export const categoryUpdateInput = z.object({
  id,
  name: name.optional(),
  parentId: id.nullable().optional(),
  group: categoryGroup.optional(),
})
export const categoryDeleteInput = z.object({ id, replacementId: id.nullable().optional() })

const ruleText = z.string().trim().min(1, 'Enter some text').max(200)
export const ruleCondition = z.discriminatedUnion('field', [
  z.object({
    field: z.literal('description'),
    op: z.enum(['contains', 'equals', 'startsWith', 'regex']),
    value: ruleText,
  }),
  z.object({ field: z.literal('merchant'), op: z.enum(['equals', 'contains']), value: ruleText }),
  z.object({
    field: z.literal('amount'),
    op: z.literal('between'),
    min: minor.min(0).nullable().optional(),
    max: minor.min(0).nullable().optional(),
  }),
  z.object({ field: z.literal('direction'), op: z.literal('equals'), value: z.enum(['in', 'out']) }),
  z.object({ field: z.literal('account'), op: z.literal('equals'), value: id }),
])
export const ruleInput = z.object({
  name,
  priority: z.number().int().min(0).max(10_000).optional(),
  enabled: z.boolean().optional(),
  conditions: z.array(ruleCondition).min(1, 'Add at least one condition').max(10),
  categoryId: id,
})
export const ruleUpdate = z.object({ id, input: ruleInput })
export const rulePreviewInput = z.object({
  ruleId: id.optional(),
  rule: ruleInput.optional(),
  /** Leave transactions that already have a category alone (default). */
  onlyUncategorized: z.boolean().optional(),
})
export const ruleApplyInput = z.object({ ruleId: id, txnIds: z.array(id).min(1).max(5000) })
export const suggestionsInput = z.object({ txnIds: z.array(id).max(1000) })

export type RuleInput = z.output<typeof ruleInput>

// ---- Forecast and net worth (US7) ---------------------------------------------------------------

export const forecastInput = z.object({ days: z.union([z.literal(30), z.literal(60), z.literal(90)]) })
export const networthInput = z
  .object({ from: calendarDate.optional(), to: calendarDate.optional() })
  .optional()
export const valuationsListInput = z.object({ accountId: id })
export const valuationInput = z.object({
  accountId: id,
  date: calendarDate,
  /** The asset's worth, or the amount owed on a liability. */
  valueMinor: minor.min(0, 'Enter the value as a positive amount'),
  note: z.string().trim().max(500).nullable().optional(),
})
export type ValuationInput = z.output<typeof valuationInput>

// ---- Insights and what-if (US8) ------------------------------------------------------------------

export const insightsListInput = z.object({ includeDismissed: z.boolean().optional() }).optional()
export const insightKeyInput = z.object({ key: z.string().min(1).max(300) })

const positiveAmount = minor.min(1, 'Enter an amount')
const nonZeroAmount = minor.refine((v) => v !== 0, 'Enter an amount')
export const scenarioChange = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('new_bill'),
    name,
    amountMinor: positiveAmount,
    frequency: z.enum(FREQUENCIES),
    startDate: calendarDate,
  }),
  z.object({ kind: z.literal('income_change'), amountMinor: nonZeroAmount, fromDate: calendarDate }),
  z.object({ kind: z.literal('large_purchase'), name, amountMinor: positiveAmount, date: calendarDate }),
  z.object({
    kind: z.literal('loan_prepayment'),
    loanId: id,
    amountMinor: positiveAmount,
    date: calendarDate,
  }),
  z.object({
    kind: z.literal('savings_change'),
    goalId: id.nullable(),
    amountMinor: nonZeroAmount,
    fromDate: calendarDate,
  }),
])
export const scenarioInput = z.object({
  days: z.union([z.literal(30), z.literal(60), z.literal(90)]),
  changes: z.array(scenarioChange).max(20),
})
