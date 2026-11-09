import { undoGroup } from '@db/audit'
import { all, type Db } from '@db/connection'
import { todayIn } from '@domain/dates'
import { createAccount, listAccounts, setAccountArchived, updateAccount } from '@db/repos/accounts'
import {
  applyRule,
  categoryUsage,
  createCategory,
  createRule,
  deleteCategory,
  deleteRule,
  draftRule,
  listRules,
  previewRule,
  previewSavedRule,
  suggestForTxns,
  updateCategory,
  updateRule,
} from '@db/repos/categorization'
import { dashboardSummary } from '@db/repos/dashboard'
import { listCategories, listTags } from '@db/repos/categories'
import { batchRows, commitImport, listBatches, listPresets, previewImport, reconcile, savePreset, undoImport } from '@db/repos/imports'
import {
  assignBudget,
  budgetMonth,
  contribute,
  createGoal,
  createRecurring,
  deleteContribution,
  deleteGoal,
  deleteRecurring,
  listGoals,
  listOccurrences,
  listRecurring,
  occurrenceCandidates,
  setOccurrence,
  updateGoal,
  updateRecurring,
} from '@db/repos/planning'
import { getSettings, updateSettings } from '@db/repos/settings'
import {
  bulkUpdate,
  createTransaction,
  createTransfer,
  deleteTransactions,
  getTransaction,
  queryTransactions,
  suggestPayees,
  updateTransaction,
  updateTransfer,
} from '@db/repos/transactions'
import { invariant } from '@shared/errors'
import type { Channel, Output, ParsedInput } from '@shared/contract'
import type { ActivityEntry } from '@shared/types'
import { backupHandlers } from './backupHandlers'
import type { HandlerContext } from './env'

export type Handler<C extends Channel> = (ctx: HandlerContext, input: ParsedInput<C>) => Output<C> | Promise<Output<C>>
export type Handlers = { [C in Channel]: Handler<C> }

function activity(db: Db, limit: number): ActivityEntry[] {
  return all<{ id: string; at: string; label: string; undone_at: string | null; undo_of: string | null }>(
    db,
    `SELECT g.id, g.at, g.label, g.undone_at, g.undo_of FROM audit_groups g ORDER BY g.id DESC LIMIT ?`,
    limit,
  ).map((g, i) => ({
    id: g.id,
    at: g.at,
    label: g.label,
    undone: g.undone_at !== null,
    isUndo: g.undo_of !== null,
    // Only the most recent change is offered for one-click undo; older ones may conflict.
    canUndo: i === 0 && g.undone_at === null,
  }))
}

/** Today in the user's time zone. */
const today = (db: Db) => todayIn(getSettings(db).timezone)

export const handlers: Handlers = {
  ...backupHandlers,
  'settings.get': ({ db }) => getSettings(db),
  'settings.update': ({ db }, input) => updateSettings(db, input),
  'accounts.list': ({ db }, input) => listAccounts(db, input?.includeArchived ?? false),
  'accounts.create': ({ db }, input) => createAccount(db, input),
  'accounts.update': ({ db }, input) => updateAccount(db, input.id, input.patch),
  'accounts.archive': ({ db }, input) => setAccountArchived(db, input.id, input.archived),
  'categories.list': ({ db }) => listCategories(db),
  'tags.list': ({ db }) => listTags(db),
  'txns.query': ({ db }, input) => queryTransactions(db, input),
  'txns.get': ({ db }, input) => getTransaction(db, input.id),
  'txns.create': ({ db }, input) => createTransaction(db, input),
  'txns.update': ({ db }, input) => updateTransaction(db, input.id, input.patch),
  'txns.delete': ({ db }, input) => deleteTransactions(db, input.ids),
  'txns.bulkUpdate': ({ db }, input) => bulkUpdate(db, input),
  'transfers.create': ({ db }, input) => createTransfer(db, input),
  'transfers.update': ({ db }, input) => updateTransfer(db, input.transferId, input.patch),
  'payees.suggest': ({ db }, input) => suggestPayees(db, input.prefix, input.limit),
  'activity.list': ({ db }, input) => activity(db, input?.limit ?? 50),
  'accounts.reconcile': ({ db }, input) => reconcile(db, input.id, input.statementDate, input.statementBalanceMinor),
  'import.presets': ({ db }) => listPresets(db),
  'import.savePreset': ({ db }, input) => savePreset(db, input.name, input.mapping),
  'import.preview': ({ db }, input) => previewImport(db, input),
  'import.commit': ({ db }, input) => commitImport(db, input),
  'import.batches': ({ db }) => listBatches(db),
  'import.batchRows': ({ db }, input) => batchRows(db, input.id),
  'import.undo': ({ db }, input) => undoImport(db, input.batchId, input.includeEdited),
  'dashboard.summary': ({ db }, input) => dashboardSummary(db, input?.asOf ?? today(db)),
  'recurring.list': ({ db }) => listRecurring(db, today(db)),
  'recurring.create': ({ db }, input) => createRecurring(db, input, today(db)),
  'recurring.update': ({ db }, input) => updateRecurring(db, input.id, input.input, today(db)),
  'recurring.delete': ({ db }, input) => deleteRecurring(db, input.id),
  'recurring.occurrences': ({ db }, input) => listOccurrences(db, input.from, input.to, today(db)),
  'recurring.candidates': ({ db }, input) => occurrenceCandidates(db, input.itemId, input.dueDate),
  'recurring.setOccurrence': ({ db }, input) => setOccurrence(db, input),
  'budget.month': ({ db }, input) => budgetMonth(db, input.month),
  'budget.assign': ({ db }, input) => assignBudget(db, input.month, input.categoryId, input.assignedMinor),
  'goals.list': ({ db }) => listGoals(db, today(db)),
  'goals.create': ({ db }, input) => createGoal(db, input, today(db)),
  'goals.update': ({ db }, input) => updateGoal(db, input.id, input.input, today(db)),
  'goals.delete': ({ db }, input) => deleteGoal(db, input.id),
  'goals.contribute': ({ db }, input) => contribute(db, input, today(db)),
  'goals.deleteContribution': ({ db }, input) => deleteContribution(db, input.id),
  'categories.create': ({ db }, input) => createCategory(db, input),
  'categories.update': ({ db }, input) => updateCategory(db, input),
  'categories.usage': ({ db }, input) => categoryUsage(db, input.id),
  'categories.delete': ({ db }, input) => deleteCategory(db, input.id, input.replacementId),
  'rules.list': ({ db }) => listRules(db),
  'rules.create': ({ db }, input) => createRule(db, input),
  'rules.update': ({ db }, input) => updateRule(db, input.id, input.input),
  'rules.delete': ({ db }, input) => deleteRule(db, input.id),
  'rules.preview': ({ db }, input) => {
    const only = input.onlyUncategorized ?? true
    if (input.ruleId) return previewSavedRule(db, input.ruleId, only)
    if (input.rule) return previewRule(db, draftRule(input.rule), only)
    throw invariant('Choose a rule to preview')
  },
  'rules.apply': ({ db }, input) => applyRule(db, input.ruleId, input.txnIds),
  'suggestions.forTxns': ({ db }, input) => suggestForTxns(db, input.txnIds),
  'undo.apply': ({ db }, input) => {
    const r = undoGroup(db, input.auditGroupId)
    return { reverted: r.result.reverted, auditGroupId: r.auditGroupId }
  },
}
