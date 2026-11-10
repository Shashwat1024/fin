import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import { todayIn } from '@domain/dates'
import type { Channel, Input, Output } from '@shared/contract'
import type { TxnFilter } from '@shared/schemas'
import type { ScenarioChange } from '@shared/types'
import { call } from './ipc'

export const useSettings = () =>
  useQuery({ queryKey: ['settings'], queryFn: () => call('settings.get', undefined) })

/** Today's date in the user's time zone. */
export function useToday(): string {
  const { data } = useSettings()
  return todayIn(data?.timezone ?? 'Asia/Kolkata')
}

export const useAccounts = (includeArchived = false) =>
  useQuery({
    queryKey: ['accounts', includeArchived],
    queryFn: () => call('accounts.list', { includeArchived }),
  })

export const useCategories = () =>
  useQuery({
    queryKey: ['categories'],
    queryFn: () => call('categories.list', undefined),
    staleTime: Infinity,
  })

export const useTags = () => useQuery({ queryKey: ['tags'], queryFn: () => call('tags.list', undefined) })

export const useTransaction = (id: string | undefined) =>
  useQuery({ queryKey: ['txn', id], queryFn: () => call('txns.get', { id: id! }), enabled: Boolean(id) })

export const useActivity = (limit = 20) =>
  useQuery({ queryKey: ['activity', limit], queryFn: () => call('activity.list', { limit }) })

export const usePayeeSuggestions = (prefix: string) =>
  useQuery({
    queryKey: ['payees', prefix],
    queryFn: () => call('payees.suggest', { prefix, limit: 8 }),
    enabled: prefix.trim().length > 0,
    placeholderData: (prev) => prev,
  })

/** One-shot (non-paginated) query, e.g. for dashboard summaries. */
export const useTxnSummary = (filter: TxnFilter, key: string) =>
  useQuery({
    queryKey: ['txns', 'summary', key, filter],
    queryFn: () => call('txns.query', { ...filter, limit: 10 }),
  })

export const useDashboard = () =>
  useQuery({ queryKey: ['dashboard'], queryFn: () => call('dashboard.summary', undefined) })

export const useAppStatus = () =>
  useQuery({ queryKey: ['app', 'status'], queryFn: () => call('app.status', undefined) })
export const useBackups = () =>
  useQuery({ queryKey: ['backups'], queryFn: () => call('backup.list', undefined) })

export const useRecurring = () =>
  useQuery({ queryKey: ['recurring', 'items'], queryFn: () => call('recurring.list', undefined) })
export const useOccurrences = (from: string, to: string) =>
  useQuery({
    queryKey: ['recurring', 'occurrences', from, to],
    queryFn: () => call('recurring.occurrences', { from, to }),
  })
export const useBudgetMonth = (month: string) =>
  useQuery({
    queryKey: ['budget', month],
    queryFn: () => call('budget.month', { month }),
    placeholderData: (prev) => prev,
  })
export const useGoals = () => useQuery({ queryKey: ['goals'], queryFn: () => call('goals.list', undefined) })

export const useForecast = (days: 30 | 60 | 90) =>
  useQuery({
    queryKey: ['forecast', days],
    queryFn: () => call('forecast.run', { days }),
    placeholderData: (prev) => prev,
  })
export const useNetWorth = (from?: string) =>
  useQuery({
    queryKey: ['networth', from ?? null],
    queryFn: () => call('networth.history', { from }),
    placeholderData: (prev) => prev,
  })
export const useValuations = (accountId: string | null) =>
  useQuery({
    queryKey: ['valuations', accountId],
    queryFn: () => call('valuations.list', { accountId: accountId! }),
    enabled: Boolean(accountId),
  })
export const useInsights = (includeDismissed: boolean) =>
  useQuery({
    queryKey: ['insights', includeDismissed],
    queryFn: () => call('insights.list', { includeDismissed }),
    placeholderData: (prev) => prev,
  })
export const useRecurringSuggestions = () =>
  useQuery({
    queryKey: ['recurring', 'suggestions'],
    queryFn: () => call('recurring.detectCandidates', undefined),
  })
/** A what-if run. Read-only on the main side, so it is a query, not a mutation. */
export const useScenario = (days: 30 | 60 | 90, changes: readonly ScenarioChange[]) =>
  useQuery({
    queryKey: ['scenario', days, changes],
    queryFn: () => call('scenarios.run', { days, changes: [...changes] }),
    placeholderData: (prev) => prev,
  })
export const useRules = () => useQuery({ queryKey: ['rules'], queryFn: () => call('rules.list', undefined) })
export const useSuggestions = (txnIds: readonly string[]) =>
  useQuery({
    queryKey: ['suggestions', txnIds],
    queryFn: () => call('suggestions.forTxns', { txnIds: [...txnIds] }),
    enabled: txnIds.length > 0,
    placeholderData: (prev) => prev,
  })

export const PAGE_SIZE = 200

export const useTxnPages = (filter: TxnFilter) =>
  useInfiniteQuery({
    queryKey: ['txns', 'pages', filter],
    queryFn: ({ pageParam }) => call('txns.query', { ...filter, cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })

/** Ledger data is local and cheap to reload, so any change refreshes every query (categories included). */
export function refreshLedger(qc: QueryClient) {
  return qc.invalidateQueries()
}

export async function undoChange(qc: QueryClient, auditGroupId: string) {
  try {
    await call('undo.apply', { auditGroupId })
    await refreshLedger(qc)
    toast.success('Undone')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Could not undo')
  }
}

type MutationOptions<C extends Channel> = {
  /** Toast shown on success; with an auditGroupId in the result it gets an Undo action. */
  success?: string | ((data: Output<C>) => string)
  /** Show errors as a toast (default true). Forms that render field errors can turn this off. */
  toastErrors?: boolean
  onSuccess?: (data: Output<C>) => void
  /** The open database was replaced (restore, demo): drop every cached query, categories included. */
  reloadAll?: boolean
}

/** Shared mutation hook: calls the channel, refreshes ledger queries, and offers one-step undo. */
export function useFinMutation<C extends Channel>(channel: C, opts: MutationOptions<C> = {}) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Input<C>) => call(channel, input),
    onSuccess: async (data) => {
      if (opts.reloadAll) {
        // Navigate etc. before the reset: the app re-mounts while every query reloads.
        opts.onSuccess?.(data)
        await qc.resetQueries()
      } else {
        await refreshLedger(qc)
      }
      if (opts.success) {
        const message = typeof opts.success === 'function' ? opts.success(data) : opts.success
        const groupId =
          data && typeof data === 'object' && 'auditGroupId' in data
            ? (data as { auditGroupId: string }).auditGroupId
            : null
        toast.success(
          message,
          groupId ? { action: { label: 'Undo', onClick: () => void undoChange(qc, groupId) } } : {},
        )
      }
      if (!opts.reloadAll) opts.onSuccess?.(data)
    },
    onError: (err) => {
      if (opts.toastErrors !== false) toast.error(err.message)
    },
  })
}
