import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PlusIcon, ReceiptTextIcon } from 'lucide-react'
import { todayIn } from '@domain/dates'
import { EmptyState, ErrorState, LoadingState, PageHeader, ShortcutHint } from '@renderer/components/layout'
import { MoneyText } from '@renderer/components/MoneyText'
import { ALL_ACCOUNTS } from '@renderer/components/pickers'
import { Button } from '@renderer/components/ui/button'
import {
  useCategories,
  useFinMutation,
  useSettings,
  useSuggestions,
  useTxnPages,
  useViews,
} from '@renderer/lib/queries'
import { BulkActionBar } from './BulkActionBar'
import { SaveViewButton, ViewMenu } from './SavedViews'
import { useTransactionDialog } from './TransactionDialog'
import {
  DEFAULT_FILTERS,
  filtersToQuery,
  groupFromParam,
  isFiltered,
  rangeFromParams,
  toTxnFilter,
  TransactionFilters,
  type FilterState,
} from './TransactionFilters'
import { TransactionList } from './TransactionList'

const RANGES = ['this-month', 'last-month', 'last-30-days', 'last-90-days', 'this-fy'] as const

export function TransactionsPage() {
  const [params] = useSearchParams()
  const { data: settings } = useSettings()
  const dialog = useTransactionDialog()
  const { data: categories } = useCategories()
  const { data: views } = useViews()
  const view = views?.find((v) => v.id === params.get('view'))
  const [filters, setFilters] = useState<FilterState>(() => ({
    ...DEFAULT_FILTERS,
    text: params.get('q') ?? '',
    accountId: params.get('account') ?? ALL_ACCOUNTS,
    // A deleted category's transactions moved to its replacement, so a saved filter on it is dropped.
    categoryId: categories?.find((c) => c.id === params.get('category'))?.archived
      ? null
      : params.get('category'),
    importBatchId: params.get('batch'),
    customRange: rangeFromParams(params),
    kind: params.get('kind') === 'standard' ? 'standard' : null,
    group: groupFromParam(params.get('group')),
    range: (RANGES as readonly string[]).includes(params.get('range') ?? '')
      ? (params.get('range') as FilterState['range'])
      : 'all',
    direction:
      params.get('direction') === 'in' || params.get('direction') === 'out'
        ? (params.get('direction') as 'in' | 'out')
        : 'all',
  }))
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const today = todayIn(settings?.timezone ?? 'Asia/Kolkata')
  const fy = settings?.fyStartMonth ?? 4
  const query = useTxnPages(useMemo(() => toTxnFilter(filters, today, fy), [filters, today, fy]))
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.rows) ?? [], [query.data])
  const totals = query.data?.pages[0]?.totals
  // Suggestions for uncategorised rows: shown, never applied until accepted (FR-020).
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const candidateIds = useMemo(
    () =>
      rows
        .filter((r) => r.kind === 'standard' && !r.categoryId && r.splitCount === 0)
        .map((r) => r.id)
        .slice(0, 1000),
    [rows],
  )
  const suggestions = useSuggestions(candidateIds)
  const suggestionMap = useMemo(
    () => new Map((suggestions.data ?? []).filter((s) => !dismissed.has(s.txnId)).map((s) => [s.txnId, s])),
    [suggestions.data, dismissed],
  )
  const accept = useFinMutation('txns.update', { success: (r) => `Categorised as ${r.txn.categoryPath}` })
  const remove = useFinMutation('txns.delete', {
    success: (r) => `Deleted ${r.count} transaction${r.count === 1 ? '' : 's'}`,
    onSuccess: () => setSelected(new Set()),
  })

  const changeFilters = useCallback((f: FilterState) => {
    setFilters(f)
    setSelected(new Set())
  }, [])
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage])
  const accountId = filters.accountId === ALL_ACCOUNTS ? undefined : filters.accountId
  const filterQuery = filtersToQuery(filters)

  return (
    <div className="flex h-full flex-col px-8 pt-8 pb-6">
      <PageHeader
        title={view?.name ?? 'Transactions'}
        description={
          totals ? (
            <span className="tabular-nums">
              {totals.count.toLocaleString('en-IN')} transactions · In <MoneyText minor={totals.inMinor} /> ·
              Out <MoneyText minor={Math.abs(totals.outMinor)} /> · Net <MoneyText minor={totals.netMinor} />
            </span>
          ) : (
            ' '
          )
        }
        actions={
          <>
            {view && <ViewMenu view={view} query={filterQuery} />}
            <Button onClick={() => dialog.open({ mode: 'expense', accountId })}>
              <PlusIcon /> Add transaction{' '}
              <ShortcutHint
                combo="mod+n"
                className="ml-1 *:bg-transparent *:text-primary-foreground *:ring-1 *:ring-primary-foreground/50"
              />
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-3 pb-3">
        <TransactionFilters
          value={filters}
          onChange={changeFilters}
          today={today}
          fyStartMonth={fy}
          extra={
            isFiltered(filters) &&
            filterQuery !== view?.query &&
            !filters.importBatchId && <SaveViewButton query={filterQuery} />
          }
        />
        {selected.size > 0 && <BulkActionBar ids={[...selected]} onClear={() => setSelected(new Set())} />}
      </div>
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<ReceiptTextIcon />}
          title={isFiltered(filters) ? 'No matching transactions' : 'No transactions yet'}
          description={
            isFiltered(filters)
              ? 'Try a different search or clear the filters.'
              : 'Add your first expense or income. Press Ctrl+N from anywhere.'
          }
          action={
            isFiltered(filters) ? (
              <Button variant="outline" onClick={() => changeFilters(DEFAULT_FILTERS)}>
                Clear filters
              </Button>
            ) : (
              <Button onClick={() => dialog.open({ mode: 'expense', accountId })}>Add transaction</Button>
            )
          }
        />
      ) : (
        <TransactionList
          rows={rows}
          total={totals?.count ?? rows.length}
          hasMore={Boolean(hasNextPage)}
          loadingMore={isFetchingNextPage}
          onLoadMore={loadMore}
          selected={selected}
          onSelectedChange={setSelected}
          onOpen={(t) => dialog.open({ txnId: t.id })}
          onDelete={(ids) => remove.mutate({ ids })}
          suggestions={suggestionMap}
          onAcceptSuggestion={(sg) => accept.mutate({ id: sg.txnId, patch: { categoryId: sg.categoryId } })}
          onDismissSuggestion={(id) => setDismissed((d) => new Set(d).add(id))}
        />
      )}
    </div>
  )
}
