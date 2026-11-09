import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PlusIcon, ReceiptTextIcon } from 'lucide-react'
import { todayIn } from '@domain/dates'
import { EmptyState, ErrorState, LoadingState, PageHeader, ShortcutHint } from '@renderer/components/layout'
import { MoneyText } from '@renderer/components/MoneyText'
import { ALL_ACCOUNTS } from '@renderer/components/pickers'
import { Button } from '@renderer/components/ui/button'
import { useFinMutation, useSettings, useTxnPages } from '@renderer/lib/queries'
import { BulkActionBar } from './BulkActionBar'
import { useTransactionDialog } from './TransactionDialog'
import { DEFAULT_FILTERS, isFiltered, toTxnFilter, TransactionFilters, type FilterState } from './TransactionFilters'
import { TransactionList } from './TransactionList'

const RANGES = ['this-month', 'last-month', 'last-30-days', 'last-90-days', 'this-fy'] as const

export function TransactionsPage() {
  const [params] = useSearchParams()
  const { data: settings } = useSettings()
  const dialog = useTransactionDialog()
  const [filters, setFilters] = useState<FilterState>(() => ({
    ...DEFAULT_FILTERS,
    accountId: params.get('account') ?? ALL_ACCOUNTS,
    categoryId: params.get('category'),
    range: (RANGES as readonly string[]).includes(params.get('range') ?? '') ? (params.get('range') as FilterState['range']) : 'all',
    direction: params.get('direction') === 'in' || params.get('direction') === 'out' ? (params.get('direction') as 'in' | 'out') : 'all',
  }))
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const today = todayIn(settings?.timezone ?? 'Asia/Kolkata')
  const fy = settings?.fyStartMonth ?? 4
  const query = useTxnPages(useMemo(() => toTxnFilter(filters, today, fy), [filters, today, fy]))
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.rows) ?? [], [query.data])
  const totals = query.data?.pages[0]?.totals
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

  return (
    <div className="flex h-full flex-col px-8 pt-8 pb-6">
      <PageHeader
        title="Transactions"
        description={
          totals ? (
            <span className="tabular-nums">
              {totals.count.toLocaleString('en-IN')} transactions · In <MoneyText minor={totals.inMinor} /> · Out{' '}
              <MoneyText minor={Math.abs(totals.outMinor)} /> · Net <MoneyText minor={totals.netMinor} />
            </span>
          ) : (
            ' '
          )
        }
        actions={
          <Button onClick={() => dialog.open({ mode: 'expense', accountId })}>
            <PlusIcon /> Add transaction <ShortcutHint combo="mod+n" className="ml-1 opacity-70" />
          </Button>
        }
      />
      <div className="flex flex-col gap-3 pb-3">
        <TransactionFilters value={filters} onChange={changeFilters} today={today} fyStartMonth={fy} />
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
        />
      )}
    </div>
  )
}
