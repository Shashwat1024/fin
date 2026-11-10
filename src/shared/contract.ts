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
  'app.status': s.empty,
  'backup.list': s.empty,
  'backup.create': s.backupCreateInput,
  'backup.pickFile': s.empty,
  'backup.inspect': s.backupInspectInput,
  'backup.restore': s.backupRestoreInput,
  'backup.chooseFolder': s.empty,
  'backup.openFolder': s.empty,
  'export.json': s.empty,
  'export.csv': s.empty,
  'demo.enter': s.empty,
  'demo.exit': s.empty,
  'recurring.list': s.empty,
  'recurring.create': s.recurringInput,
  'recurring.update': s.recurringUpdate,
  'recurring.delete': s.idInput,
  'recurring.occurrences': s.occurrencesInput,
  'recurring.candidates': s.occurrenceRef,
  'recurring.setOccurrence': s.occurrenceAction,
  'budget.month': s.budgetMonthInput,
  'budget.assign': s.budgetAssignInput,
  'goals.list': s.empty,
  'goals.create': s.goalInput,
  'goals.update': s.goalUpdate,
  'goals.delete': s.idInput,
  'goals.contribute': s.contributeInput,
  'goals.deleteContribution': s.idInput,
  'categories.create': s.categoryCreateInput,
  'categories.update': s.categoryUpdateInput,
  'categories.usage': s.idInput,
  'categories.delete': s.categoryDeleteInput,
  'rules.list': s.empty,
  'rules.create': s.ruleInput,
  'rules.update': s.ruleUpdate,
  'rules.delete': s.idInput,
  'rules.preview': s.rulePreviewInput,
  'rules.apply': s.ruleApplyInput,
  'suggestions.forTxns': s.suggestionsInput,
  'forecast.run': s.forecastInput,
  'networth.history': s.networthInput,
  'valuations.list': s.valuationsListInput,
  'valuations.upsert': s.valuationInput,
  'valuations.delete': s.idInput,
  'insights.list': s.insightsListInput,
  'insights.dismiss': s.insightKeyInput,
  'insights.restore': s.insightKeyInput,
  'recurring.detectCandidates': s.empty,
  'scenarios.run': s.scenarioInput,
  'views.list': s.empty,
  'views.create': s.viewInput,
  'views.update': s.viewUpdate,
  'views.delete': s.idInput,
  'cards.cycles': s.empty,
  'insights.calendar': s.calendarInput,
  'reminders.preview': s.empty,
  'reminders.test': s.empty,
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
  'app.status': t.AppStatus
  'backup.list': t.BackupInfo[]
  'backup.create': t.BackupInfo
  /** null when the file dialog is cancelled. */
  'backup.pickFile': { path: string } | null
  'backup.inspect': t.BackupInspection
  'backup.restore': { preRestoreBackup: t.BackupInfo; counts: t.DataCounts }
  'backup.chooseFolder': t.Settings | null
  'backup.openFolder': null
  'export.json': { path: string } | null
  'export.csv': { path: string } | null
  'demo.enter': t.AppStatus
  'demo.exit': t.AppStatus
  'recurring.list': t.RecurringItemDto[]
  'recurring.create': t.Mutation<{ item: t.RecurringItemDto }>
  'recurring.update': t.Mutation<{ item: t.RecurringItemDto }>
  'recurring.delete': t.Mutation<object>
  'recurring.occurrences': t.OccurrenceDto[]
  'recurring.candidates': t.OccurrenceCandidate[]
  'recurring.setOccurrence': t.Mutation<object>
  'budget.month': t.BudgetMonthDto
  'budget.assign': t.Mutation<{ month: t.BudgetMonthDto }>
  'goals.list': t.GoalDto[]
  'goals.create': t.Mutation<{ goal: t.GoalDto }>
  'goals.update': t.Mutation<{ goal: t.GoalDto }>
  'goals.delete': t.Mutation<object>
  'goals.contribute': t.Mutation<{ goal: t.GoalDto }>
  'goals.deleteContribution': t.Mutation<object>
  'categories.create': t.Mutation<{ category: t.CategoryDto }>
  'categories.update': t.Mutation<{ category: t.CategoryDto }>
  'categories.usage': t.CategoryUsage
  'categories.delete': t.Mutation<{ moved: number }>
  'rules.list': t.RuleDto[]
  'rules.create': t.Mutation<{ rule: t.RuleDto }>
  'rules.update': t.Mutation<{ rule: t.RuleDto }>
  'rules.delete': t.Mutation<object>
  'rules.preview': t.RulePreview
  'rules.apply': t.Mutation<{ count: number; skipped: number }>
  'suggestions.forTxns': t.TxnSuggestion[]
  'forecast.run': t.ForecastDto
  'networth.history': t.NetWorthDto
  'valuations.list': t.ValuationDto[]
  'valuations.upsert': t.Mutation<{ valuation: t.ValuationDto }>
  'valuations.delete': t.Mutation<object>
  'insights.list': t.InsightsDto
  'insights.dismiss': t.Mutation<object>
  'insights.restore': t.Mutation<object>
  'recurring.detectCandidates': t.RecurringSuggestionDto[]
  'scenarios.run': t.ScenarioDto
  'views.list': t.SavedViewDto[]
  'views.create': t.Mutation<{ view: t.SavedViewDto }>
  'views.update': t.Mutation<{ view: t.SavedViewDto }>
  'views.delete': t.Mutation<object>
  'cards.cycles': t.CardCycleDto[]
  'insights.calendar': t.SpendingCalendarDto
  'reminders.preview': t.ReminderDto[]
  'reminders.test': null
}

export type Output<C extends Channel> = Outputs[C]

export type IpcError = { code: ErrorCode; message: string; issues?: unknown }
export type Result<T> = { ok: true; data: T } | { ok: false; error: IpcError }

/** The single IPC channel name used by the preload bridge. */
export const IPC_CHANNEL = 'fin:invoke'

export type FinBridge = {
  invoke<C extends Channel>(channel: C, input: Input<C>): Promise<Result<Output<C>>>
}
