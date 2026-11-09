import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Channel, Input, Output } from '@shared/contract'
import type { TxnFilter } from '@shared/schemas'
import { call } from './ipc'

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => call('settings.get', undefined) })

export const useAccounts = (includeArchived = false) =>
  useQuery({ queryKey: ['accounts', includeArchived], queryFn: () => call('accounts.list', { includeArchived }) })

export const useCategories = () =>
  useQuery({ queryKey: ['categories'], queryFn: () => call('categories.list', undefined), staleTime: Infinity })

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
  useQuery({ queryKey: ['txns', 'summary', key, filter], queryFn: () => call('txns.query', { ...filter, limit: 10 }) })

export const useDashboard = () => useQuery({ queryKey: ['dashboard'], queryFn: () => call('dashboard.summary', undefined) })

export const useAppStatus = () => useQuery({ queryKey: ['app', 'status'], queryFn: () => call('app.status', undefined) })
export const useBackups = () => useQuery({ queryKey: ['backups'], queryFn: () => call('backup.list', undefined) })

export const PAGE_SIZE = 200

export const useTxnPages = (filter: TxnFilter) =>
  useInfiniteQuery({
    queryKey: ['txns', 'pages', filter],
    queryFn: ({ pageParam }) => call('txns.query', { ...filter, cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })

/** Ledger data is local and cheap to reload, so any change refreshes everything except static lists. */
export function refreshLedger(qc: QueryClient) {
  return qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'categories' })
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
          data && typeof data === 'object' && 'auditGroupId' in data ? (data as { auditGroupId: string }).auditGroupId : null
        toast.success(message, groupId ? { action: { label: 'Undo', onClick: () => void undoChange(qc, groupId) } } : {})
      }
      if (!opts.reloadAll) opts.onSuccess?.(data)
    },
    onError: (err) => {
      if (opts.toastErrors !== false) toast.error(err.message)
    },
  })
}
