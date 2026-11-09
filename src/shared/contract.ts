import type { z } from 'zod'
import type { Preset } from '@domain/import/presets'
import type { ErrorCode } from './errors'
import * as s from './schemas'
import type * as t from './types'

/** Every renderer → main request channel and the schema its payload must satisfy. */
export const inputSchemas = {
  'settings.get': s.empty,
  'settings.update': s.settingsPatch,
  'accounts.list': s.accountsListInput,
  'accounts.create': s.accountInput,
  'accounts.update': s.accountUpdate,
  'accounts.archive': s.archiveInput,
  'categories.list': s.empty,
  'tags.list': s.empty,
  'txns.query': s.txnFilter,
  'txns.get': s.idInput,
  'txns.create': s.txnInput,
  'txns.update': s.txnUpdate,
  'txns.delete': s.idsInput,
  'txns.bulkUpdate': s.bulkUpdateInput,
  'transfers.create': s.transferInput,
  'transfers.update': s.transferUpdate,
  'payees.suggest': s.payeeSuggestInput,
  'activity.list': s.activityInput,
  'undo.apply': s.undoInput,
  'accounts.reconcile': s.reconcileInput,
  'import.presets': s.empty,
  'import.savePreset': s.savePresetInput,
  'import.preview': s.importPreviewInput,
  'import.commit': s.importCommitInput,
  'import.batches': s.empty,
  'import.batchRows': s.idInput,
  'import.undo': s.importUndoInput,
  'dashboard.summary': s.dashboardInput,
} as const

export type Channel = keyof typeof inputSchemas
export type Input<C extends Channel> = z.input<(typeof inputSchemas)[C]>
export type ParsedInput<C extends Channel> = z.output<(typeof inputSchemas)[C]>

type TransferResult = t.Mutation<{ transferId: string; txnIds: string[] }>

export interface Outputs {
  'settings.get': t.Settings
  'settings.update': t.Settings
  'accounts.list': t.AccountDto[]
  'accounts.create': t.Mutation<{ account: t.AccountDto }>
  'accounts.update': t.Mutation<{ account: t.AccountDto }>
  'accounts.archive': t.Mutation<{ account: t.AccountDto }>
  'categories.list': t.CategoryDto[]
  'tags.list': t.TagDto[]
  'txns.query': t.TxnPage
  'txns.get': t.TxnDetail
  'txns.create': t.Mutation<{ txn: t.TxnDetail }>
  'txns.update': t.Mutation<{ txn: t.TxnDetail }>
  'txns.delete': t.Mutation<{ count: number }>
  'txns.bulkUpdate': t.Mutation<{ count: number; skipped: number }>
  'transfers.create': TransferResult
  'transfers.update': TransferResult
  'payees.suggest': t.PayeeSuggestion[]
  'activity.list': t.ActivityEntry[]
  'undo.apply': t.Mutation<{ reverted: number }>
  'accounts.reconcile': t.ReconcileResult
  'import.presets': Preset[]
  'import.savePreset': t.Mutation<{ preset: Preset }>
  'import.preview': t.ImportPreview
  'import.commit': t.Mutation<{ batchId: string; counts: t.ImportCounts }>
  'import.batches': t.ImportBatchDto[]
  'import.batchRows': t.ImportRowDto[]
  'import.undo': t.Mutation<{ removed: number; kept: number }>
  'dashboard.summary': t.DashboardSummary
}

export type Output<C extends Channel> = Outputs[C]

export type IpcError = { code: ErrorCode; message: string; issues?: unknown }
export type Result<T> = { ok: true; data: T } | { ok: false; error: IpcError }

/** The single IPC channel name used by the preload bridge. */
export const IPC_CHANNEL = 'fin:invoke'

export type FinBridge = {
  invoke<C extends Channel>(channel: C, input: Input<C>): Promise<Result<Output<C>>>
}
