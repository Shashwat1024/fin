import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MoreHorizontalIcon, PauseIcon, PencilIcon, PlusIcon, RepeatIcon, Trash2Icon } from 'lucide-react'
import { addDays, formatDate } from '@domain/dates'
import { ConfirmDialog } from '@renderer/components/ConfirmDialog'
import { EmptyState, ErrorState, LoadingState, Page, PageHeader } from '@renderer/components/layout'
import { MoneyText } from '@renderer/components/MoneyText'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@renderer/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@renderer/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { useFinMutation, useOccurrences, useRecurring, useToday } from '@renderer/lib/queries'
import { plural } from '@renderer/lib/text'
import type { OccurrenceDto, RecurringItemDto } from '@shared/types'
import { OccurrenceList, pendingTotals } from './OccurrenceList'
import { KIND_LABELS, RecurringDialog } from './RecurringDialog'

/** Days of upcoming commitments shown on the Overview; the "Next 14 days" tab adds up to the same total. */
export const COMMITMENT_DAYS = 14
const VIEWS = ['next14', 'next60', 'past60'] as const
type View = (typeof VIEWS)[number]

function PendingSummary({ items }: { items: OccurrenceDto[] }) {
  const { outMinor, inMinor } = pendingTotals(items)
  return (
    <p className="text-sm text-muted-foreground" data-testid="pending-summary">
      Still expected: <MoneyText minor={outMinor} className="font-medium text-foreground" /> going out
      {inMinor > 0 && (
        <>
          {' '}
          · <MoneyText minor={inMinor} className="font-medium text-foreground" /> coming in
        </>
      )}
    </p>
  )
}

export function RecurringPage() {
  const today = useToday()
  const [params, setParams] = useSearchParams()
  const view: View = (VIEWS as readonly string[]).includes(params.get('view') ?? '') ? (params.get('view') as View) : 'next14'
  const items = useRecurring()
  const occurrences = useOccurrences(addDays(today, -60), addDays(today, 59))
  const [editing, setEditing] = useState<{ item?: RecurringItemDto } | null>(null)
  const [deleting, setDeleting] = useState<RecurringItemDto | null>(null)
  const remove = useFinMutation('recurring.delete', { success: 'Recurring item deleted', onSuccess: () => setDeleting(null) })

  if (items.isPending || occurrences.isPending) return <LoadingState />
  if (items.isError) return <ErrorState error={items.error} onRetry={() => void items.refetch()} />
  if (occurrences.isError) return <ErrorState error={occurrences.error} onRetry={() => void occurrences.refetch()} />

  const all = occurrences.data
  const overdue = all.filter((o) => o.state === 'overdue')
  const next14End = addDays(today, COMMITMENT_DAYS - 1)
  const next14 = all.filter((o) => o.dueDate >= today && o.dueDate <= next14End)
  const next60 = all.filter((o) => o.dueDate >= today)
  const past60 = all.filter((o) => o.dueDate < today).reverse()
  const newButton = (
    <Button onClick={() => setEditing({})}>
      <PlusIcon /> New recurring item
    </Button>
  )

  return (
    <Page>
      <PageHeader title="Recurring" description="Income, bills, subscriptions and EMIs that repeat. Payments are matched automatically." actions={newButton} />
      {items.data.length === 0 ? (
        <EmptyState
          icon={<RepeatIcon />}
          title="Nothing recurring yet"
          description="Add your salary, rent, EMIs and subscriptions to see what is coming up and spot anything missed."
          action={newButton}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {overdue.length > 0 && (
            <Card className="border-warning/50" role="region" aria-label="Needs a look">
              <CardHeader>
                <CardTitle>Needs a look</CardTitle>
                <CardDescription>
                  {plural(overdue.length, 'payment')} from the last 60 days with no matching transaction yet. Import the statement, link
                  the payment, or skip it.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <OccurrenceList items={overdue} empty="" />
              </CardContent>
            </Card>
          )}

          <Card>
            <Tabs value={view} onValueChange={(v) => setParams(v === 'next14' ? {} : { view: v }, { replace: true })}>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                <CardTitle>Schedule</CardTitle>
                <TabsList>
                  <TabsTrigger value="next14">Next 14 days</TabsTrigger>
                  <TabsTrigger value="next60">Next 60 days</TabsTrigger>
                  <TabsTrigger value="past60">Last 60 days</TabsTrigger>
                </TabsList>
              </CardHeader>
              <CardContent>
                <TabsContent value="next14" className="flex flex-col gap-2">
                  <PendingSummary items={next14} />
                  <OccurrenceList items={next14} empty="Nothing due in the next 14 days." />
                </TabsContent>
                <TabsContent value="next60" className="flex flex-col gap-2">
                  <PendingSummary items={next60} />
                  <OccurrenceList items={next60} empty="Nothing due in the next 60 days." />
                </TabsContent>
                <TabsContent value="past60">
                  <OccurrenceList items={past60} empty="Nothing was due in the last 60 days." />
                </TabsContent>
              </CardContent>
            </Tabs>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>All recurring items</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Next</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.data.map((r) => (
                    <TableRow key={r.id} className={r.active ? undefined : 'text-muted-foreground'}>
                      <TableCell>
                        <span className="font-medium">{r.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {KIND_LABELS[r.kind]}
                          {r.categoryPath && ` · ${r.categoryPath}`}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        {r.scheduleText}
                        {r.count && <span className="block text-xs text-muted-foreground">{plural(r.count, 'time')} in total</span>}
                        {r.endDate && <span className="block text-xs text-muted-foreground">until {formatDate(r.endDate)}</span>}
                      </TableCell>
                      <TableCell>
                        {r.accountName}
                        {r.toAccountName && <span className="text-muted-foreground"> → {r.toAccountName}</span>}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {!r.active ? (
                          <Badge variant="outline">
                            <PauseIcon aria-hidden /> Paused
                          </Badge>
                        ) : r.nextDue ? (
                          formatDate(r.nextDue)
                        ) : (
                          'Ended'
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <MoneyText minor={r.direction === 'in' ? r.amountMinor : -r.amountMinor} tone="auto" showPlus className="font-medium" />
                        {r.toleranceBp > 0 && <span className="block text-xs text-muted-foreground">± {r.toleranceBp / 100}%</span>}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.name}`}>
                              <MoreHorizontalIcon />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setEditing({ item: r })}>
                              <PencilIcon /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(r)}>
                              <Trash2Icon /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
      <RecurringDialog open={editing !== null} item={editing?.item} onOpenChange={(o) => !o && setEditing(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? ''}?`}
        description="Its schedule and any skips or linked payments are removed. Your transactions are not changed, and you can undo this."
        confirmLabel="Delete"
        destructive
        onConfirm={() => deleting && remove.mutate({ id: deleting.id })}
      />
    </Page>
  )
}
