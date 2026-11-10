import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2Icon, MinusIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, TargetIcon, Trash2Icon, XIcon } from 'lucide-react'
import { formatDate } from '@domain/dates'
import { formatMoney, money } from '@domain/money'
import { ConfirmDialog } from '@renderer/components/ConfirmDialog'
import { EmptyState, ErrorState, LoadingState, Page, PageHeader } from '@renderer/components/layout'
import { MoneyText } from '@renderer/components/MoneyText'
import { Button } from '@renderer/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@renderer/components/ui/dropdown-menu'
import { Progress } from '@renderer/components/ui/progress'
import { useFinMutation, useGoals } from '@renderer/lib/queries'
import type { GoalDto } from '@shared/types'
import { ContributeDialog, GoalDialog, type ContributeTarget } from './GoalDialogs'

const rupees = (minor: number) => formatMoney(money(minor))

/** One calm sentence about where the goal stands (Constitution: neutral, no shaming). */
export function goalStatusText(g: GoalDto): string {
  switch (g.status) {
    case 'achieved':
      return 'Reached. Well done.'
    case 'on_track':
      return g.targetDate
        ? `On track: about ${formatDate(g.projectedDate!)} at ${rupees(g.paceMonthlyMinor)} a month.`
        : `About ${formatDate(g.projectedDate!)} at ${rupees(g.paceMonthlyMinor)} a month.`
    case 'off_track':
      return `At ${rupees(g.paceMonthlyMinor)} a month you would get there around ${formatDate(g.projectedDate!)}. ${rupees(g.requiredMonthlyMinor!)} a month reaches it by ${formatDate(g.targetDate!)}.`
    case 'no_pace':
      return g.requiredMonthlyMinor !== null
        ? `${rupees(g.requiredMonthlyMinor)} a month reaches it by ${formatDate(g.targetDate!)}.`
        : 'Nothing added in the last 3 months, so there is no projected date yet.'
    case 'past_target':
      return `The target date ${formatDate(g.targetDate!)} has passed. ${rupees(g.remainingMinor)} to go; you can set a new date.`
  }
}

export function GoalProgress({ g, className }: { g: GoalDto; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
        <span>
          <MoneyText minor={g.savedMinor} className="font-semibold" /> <span className="text-muted-foreground">of</span>{' '}
          <MoneyText minor={g.targetMinor} />
        </span>
        <span className="font-medium tabular-nums">{g.percent}%</span>
      </div>
      <Progress value={g.percent} aria-label={`${g.name}: ${g.percent}% of target saved`} className="h-2" />
    </div>
  )
}

export function GoalsPage() {
  const goals = useGoals()
  const [editing, setEditing] = useState<{ goal?: GoalDto } | null>(null)
  const [contributing, setContributing] = useState<ContributeTarget | null>(null)
  const [deleting, setDeleting] = useState<GoalDto | null>(null)
  const remove = useFinMutation('goals.delete', { success: 'Goal deleted', onSuccess: () => setDeleting(null) })
  const removeEntry = useFinMutation('goals.deleteContribution', { success: 'Entry removed' })

  const newButton = (
    <Button onClick={() => setEditing({})}>
      <PlusIcon /> New goal
    </Button>
  )
  return (
    <Page>
      <PageHeader title="Goals" description="Savings targets, with what is needed each month to reach them on time." actions={newButton} />
      {goals.isPending ? (
        <LoadingState />
      ) : goals.isError ? (
        <ErrorState error={goals.error} onRetry={() => void goals.refetch()} />
      ) : goals.data.length === 0 ? (
        <EmptyState
          icon={<TargetIcon />}
          title="No goals yet"
          description="An emergency fund, a trip, a down payment: set a target and Fin shows the monthly amount and when you will get there."
          action={newButton}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {goals.data.map((g) => (
            <Card key={g.id} aria-label={g.name} role="region">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {g.status === 'achieved' && <CheckCircle2Icon className="size-4 text-positive" aria-hidden />}
                  {g.name}
                </CardTitle>
                <CardDescription>
                  {g.targetDate ? `By ${formatDate(g.targetDate)}` : 'No target date'}
                  {g.linkedAccountName && (
                    <>
                      {' · follows '}
                      <Link className="underline underline-offset-4" to={`/transactions?account=${g.linkedAccountId}`}>
                        {g.linkedAccountName}
                      </Link>
                    </>
                  )}
                </CardDescription>
                <CardAction>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${g.name}`}>
                        <MoreHorizontalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {!g.linkedAccountId && (
                        <DropdownMenuItem onSelect={() => setContributing({ goal: g, direction: 'take' })}>
                          <MinusIcon /> Take money out
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => setEditing({ goal: g })}>
                        <PencilIcon /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(g)}>
                        <Trash2Icon /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <GoalProgress g={g} />
                <p className="text-sm" data-testid="goal-status">
                  {goalStatusText(g)}
                </p>
                {!g.linkedAccountId && g.contributions.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">Recent entries</summary>
                    <ul className="mt-2 divide-y">
                      {g.contributions.slice(0, 8).map((c) => (
                        <li key={c.id} className="flex items-center gap-3 py-1.5">
                          <span className="w-24 text-muted-foreground tabular-nums">{formatDate(c.date)}</span>
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">{c.note}</span>
                          <MoneyText minor={c.amountMinor} showPlus tone="auto" />
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Remove entry of ${rupees(c.amountMinor)} on ${formatDate(c.date)}`}
                            onClick={() => removeEntry.mutate({ id: c.id })}
                          >
                            <XIcon />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </CardContent>
              {!g.linkedAccountId && g.status !== 'achieved' && (
                <CardFooter>
                  <Button variant="outline" onClick={() => setContributing({ goal: g, direction: 'add' })}>
                    <PlusIcon /> Add money
                  </Button>
                </CardFooter>
              )}
            </Card>
          ))}
        </div>
      )}
      <GoalDialog open={editing !== null} goal={editing?.goal} onOpenChange={(o) => !o && setEditing(null)} />
      <ContributeDialog target={contributing} onOpenChange={(o) => !o && setContributing(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? ''}?`}
        description="The goal and its entries are removed. Your accounts and transactions are not changed, and you can undo this."
        confirmLabel="Delete goal"
        destructive
        onConfirm={() => deleting && remove.mutate({ id: deleting.id })}
      />
    </Page>
  )
}
