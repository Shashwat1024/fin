import { undoGroup } from '@db/audit'
import { all, type Db } from '@db/connection'
import { todayIn } from '@domain/dates'
import { createAccount, listAccounts, setAccountArchived, updateAccount } from '@db/repos/accounts'
import { dashboardSummary } from '@db/repos/dashboard'
import { listCategories, listTags } from '@db/repos/categories'
import { batchRows, commitImport, listBatches, listPresets, previewImport, reconcile, savePreset, undoImport } from '@db/repos/imports'
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
  'dashboard.summary': ({ db }, input) => dashboardSummary(db, input?.asOf ?? todayIn(getSettings(db).timezone)),
  'undo.apply': ({ db }, input) => {
    const r = undoGroup(db, input.auditGroupId)
    return { reverted: r.result.reverted, auditGroupId: r.auditGroupId }
  },
}
