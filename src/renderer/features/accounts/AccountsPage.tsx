import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  FileUpIcon,
  ScaleIcon,
  LandmarkIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  ReceiptTextIcon,
  WalletIcon,
} from 'lucide-react'
import { formatDate } from '@domain/dates'
import {
  ACCOUNT_GROUP_LABELS,
  ACCOUNT_GROUPS,
  ACCOUNT_TYPE_LABELS,
  inAccountGroup,
  type AccountGroup,
} from '@domain/ledger'
import { EmptyState, ErrorState, LoadingState, Page, PageHeader } from '@renderer/components/layout'
import { MoneyText } from '@renderer/components/MoneyText'
import { StatCard } from '@renderer/components/StatCard'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@renderer/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu'
import { Label } from '@renderer/components/ui/label'
import { Switch } from '@renderer/components/ui/switch'
import { useAccounts, useFinMutation } from '@renderer/lib/queries'
import { summarizeAccounts } from '@renderer/lib/summary'
import type { AccountDto } from '@shared/types'
import { useAccountDialog } from './AccountDialog'
import { useReconcileDialog } from './ReconcileDialog'

const SECTIONS: { title: string; match: (a: AccountDto) => boolean }[] = [
  { title: 'Cash & bank', match: (a) => a.isLiquid },
  { title: 'Credit cards & loans', match: (a) => a.nature === 'liability' },
  { title: 'Investments & other assets', match: (a) => !a.isLiquid && a.nature === 'asset' },
]

export function AccountsPage() {
  const [showArchived, setShowArchived] = useState(false)
  const accounts = useAccounts(showArchived)
  const dialog = useAccountDialog()
  const active = (accounts.data ?? []).filter((a) => !a.archived)
  const summary = summarizeAccounts(active)
  const [params] = useSearchParams()
  const groupParam = params.get('group')
  const group: AccountGroup = (ACCOUNT_GROUPS as readonly string[]).includes(groupParam ?? '')
    ? (groupParam as AccountGroup)
    : 'all'
  const shown = (accounts.data ?? []).filter((a) => inAccountGroup(group, a.type))
  const groupTotal = shown.filter((a) => !a.archived).reduce((t, a) => t + a.balanceMinor, 0)

  return (
    <Page>
      <PageHeader
        title="Accounts"
        description="Balances include every transaction up to today."
        actions={
          <>
            <div className="flex items-center gap-2 pr-2">
              <Switch id="show-archived" checked={showArchived} onCheckedChange={setShowArchived} />
              <Label htmlFor="show-archived" className="text-sm font-normal text-muted-foreground">
                Show archived
              </Label>
            </div>
            <Button onClick={() => dialog.open()}>
              <PlusIcon /> New account
            </Button>
          </>
        }
      />
      {accounts.isPending ? (
        <LoadingState />
      ) : accounts.isError ? (
        <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
      ) : (accounts.data ?? []).length === 0 ? (
        <EmptyState
          icon={<LandmarkIcon />}
          title="Add your first account"
          description="Start with your main bank account. You can add cards, cash and loans any time."
          action={<Button onClick={() => dialog.open()}>New account</Button>}
        />
      ) : (
        <div className="flex flex-col gap-8">
          <div className="grid grid-cols-3 gap-4">
            <StatCard
              label="Cash position"
              value={<MoneyText minor={summary.cashMinor} />}
              detail="Cash and bank accounts"
            />
            <StatCard
              label="Owed"
              value={<MoneyText minor={summary.owedMinor} />}
              detail="Credit cards and loans"
            />
            <StatCard
              label="Net worth"
              value={<MoneyText minor={summary.netWorthMinor} />}
              detail="Everything you own minus what you owe"
            />
          </div>
          {group !== 'all' && (
            <div
              role="status"
              className="flex items-center justify-between gap-4 rounded-lg border bg-muted/40 px-4 py-3 text-sm"
            >
              <span>
                Showing {ACCOUNT_GROUP_LABELS[group].toLowerCase()} · Total{' '}
                <MoneyText minor={groupTotal} className="font-semibold" />
              </span>
              <Button variant="outline" size="sm" asChild>
                <Link to="/accounts">Show all accounts</Link>
              </Button>
            </div>
          )}
          {SECTIONS.map((section) => {
            const list = shown.filter(section.match)
            if (list.length === 0) return null
            return (
              <section key={section.title} aria-label={section.title}>
                <h2 className="mb-3 text-sm font-medium text-muted-foreground">{section.title}</h2>
                <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
                  {list.map((a) => (
                    <AccountCard key={a.id} account={a} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </Page>
  )
}

function AccountCard({ account }: { account: AccountDto }) {
  const navigate = useNavigate()
  const dialog = useAccountDialog()
  const reconcile = useReconcileDialog()
  const archive = useFinMutation('accounts.archive', {
    success: (r) => `${r.account.archived ? 'Archived' : 'Restored'} ${r.account.name}`,
  })
  return (
    <Card className={account.archived ? 'opacity-60' : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 truncate">
          <WalletIcon className="size-4 text-muted-foreground" aria-hidden />
          {account.name}
        </CardTitle>
        <CardDescription className="flex items-center gap-2">
          {ACCOUNT_TYPE_LABELS[account.type]}
          {account.archived && <Badge variant="outline">Archived</Badge>}
        </CardDescription>
        <CardAction>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for ${account.name}`}>
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => navigate(`/transactions?account=${account.id}`)}>
                <ReceiptTextIcon /> View transactions
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => dialog.open(account)}>
                <PencilIcon /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => reconcile.open(account)}>
                <ScaleIcon /> Check against statement
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate('/import')}>
                <FileUpIcon /> Import statement
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => archive.mutate({ id: account.id, archived: !account.archived })}
              >
                {account.archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
                {account.archived ? 'Restore' : 'Archive'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent>
        <button
          type="button"
          className="w-full rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={() => navigate(`/transactions?account=${account.id}`)}
        >
          <div className="text-2xl font-semibold tracking-tight">
            <MoneyText minor={account.balanceMinor} currency={account.currency} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {account.nature === 'liability' ? 'Owed · ' : ''}
            {account.txnCount === 0
              ? 'No transactions yet'
              : `${account.txnCount.toLocaleString('en-IN')} transactions · last ${formatDate(account.lastTxnDate!)}`}
          </div>
        </button>
      </CardContent>
    </Card>
  )
}
