import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowDownLeftIcon,
  ArrowLeftRightIcon,
  ArrowUpRightIcon,
  BookmarkIcon,
  CalendarDaysIcon,
  CalendarRangeIcon,
  ClipboardCheckIcon,
  FileTextIcon,
  FileUpIcon,
  FlaskConicalIcon,
  LandmarkIcon,
  KeyboardIcon,
  LayoutDashboardIcon,
  LightbulbIcon,
  LineChartIcon,
  MoonIcon,
  PieChartIcon,
  PlusIcon,
  ReceiptTextIcon,
  RepeatIcon,
  ScaleIcon,
  SettingsIcon,
  TagsIcon,
  TargetIcon,
  WandSparklesIcon,
  WalletIcon,
} from 'lucide-react'
import { ShortcutHint } from '@renderer/components/layout'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@renderer/components/ui/command'
import { useAccountDialog } from '@renderer/features/accounts/AccountDialog'
import { viewHref } from '@renderer/features/transactions/SavedViews'
import { useTransactionDialog } from '@renderer/features/transactions/TransactionDialog'
import { showShortcuts, useHotkey } from '@renderer/lib/hotkeys'
import { useAccounts, useFinMutation, useViews } from '@renderer/lib/queries'
import { useTheme } from '@renderer/lib/theme'

/** Ctrl+K: jump anywhere or start any action without the mouse. */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const txn = useTransactionDialog()
  const accountDialog = useAccountDialog()
  const { data: accounts = [] } = useAccounts()
  const { data: views = [] } = useViews()
  const { resolved } = useTheme()
  const settings = useFinMutation('settings.update')
  useHotkey('mod+k', () => setOpen((o) => !o))

  const run = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command palette"
      description="Search for a page or action"
    >
      <Command>
        <CommandInput placeholder="Type a command or search…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Add">
            <CommandItem onSelect={run(() => txn.open({ mode: 'expense' }))}>
              <ArrowUpRightIcon /> Add expense
              <CommandShortcut>
                <ShortcutHint combo="mod+n" />
              </CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={run(() => txn.open({ mode: 'income' }))}>
              <ArrowDownLeftIcon /> Add income
              <CommandShortcut>
                <ShortcutHint combo="mod+i" />
              </CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={run(() => txn.open({ mode: 'transfer' }))}>
              <ArrowLeftRightIcon /> Add transfer
              <CommandShortcut>
                <ShortcutHint combo="mod+t" />
              </CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={run(() => accountDialog.open())}>
              <PlusIcon /> New account
            </CommandItem>
            <CommandItem onSelect={run(() => navigate('/import'))}>
              <FileUpIcon /> Import a bank statement
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Go to">
            <CommandItem onSelect={run(() => navigate('/'))}>
              <LayoutDashboardIcon /> Overview
            </CommandItem>
            <CommandItem onSelect={run(() => navigate('/transactions'))}>
              <ReceiptTextIcon /> Transactions
            </CommandItem>
            <CommandItem onSelect={run(() => navigate('/accounts'))}>
              <LandmarkIcon /> Accounts
            </CommandItem>
            <CommandItem onSelect={run(() => navigate('/recurring'))}>
              <RepeatIcon /> Recurring
            </CommandItem>
            <CommandItem onSelect={run(() => navigate('/budget'))}>
              <PieChartIcon /> Budget
            </CommandItem>
            <CommandItem onSelect={run(() => navigate('/goals'))}>
              <TargetIcon /> Goals
            </CommandItem>
            <CommandItem onSelect={run(() => navigate('/categories'))}>
              <TagsIcon /> Categories
            </CommandItem>
            <CommandItem onSelect={run(() => navigate('/categories?tab=rules'))}>
              <WandSparklesIcon /> Rules
            </CommandItem>
            <CommandItem onSelect={run(() => navigate('/forecast'))}>
              <LineChartIcon /> Forecast
            </CommandItem>
            <CommandItem onSelect={run(() => navigate('/net-worth'))}>
              <ScaleIcon /> Net worth
            </CommandItem>
            <CommandItem onSelect={run(() => navigate('/insights'))}>
              <LightbulbIcon /> Insights
            </CommandItem>
            <CommandItem
              value="review last month monthly review"
              onSelect={run(() => navigate('/review/last'))}
            >
              <ClipboardCheckIcon /> Review last month
            </CommandItem>
            <CommandItem value="year in review annual summary" onSelect={run(() => navigate('/year'))}>
              <CalendarRangeIcon /> Year in review
            </CommandItem>
            <CommandItem value="tax deductions 80c" onSelect={run(() => navigate('/tax'))}>
              <FileTextIcon /> Tax deductions
            </CommandItem>
            <CommandItem
              value="spending calendar heatmap"
              onSelect={run(() => navigate('/insights?tab=calendar'))}
            >
              <CalendarDaysIcon /> Spending calendar
            </CommandItem>
            <CommandItem
              value="what if simulator scenario"
              onSelect={run(() => navigate('/insights?tab=what-if'))}
            >
              <FlaskConicalIcon /> What if… (simulator)
            </CommandItem>
            <CommandItem onSelect={run(() => navigate('/settings'))}>
              <SettingsIcon /> Settings
            </CommandItem>
          </CommandGroup>
          {views.length > 0 && (
            <CommandGroup heading="Saved views">
              {views.map((v) => (
                <CommandItem
                  key={v.id}
                  value={`view ${v.name} ${v.id}`}
                  onSelect={run(() => navigate(viewHref(v)))}
                >
                  <BookmarkIcon /> {v.name}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {accounts.length > 0 && (
            <>
              <CommandGroup heading="Accounts">
                {accounts.map((a) => (
                  <CommandItem
                    key={a.id}
                    value={`account ${a.name}`}
                    onSelect={run(() => navigate(`/transactions?account=${a.id}`))}
                  >
                    <WalletIcon /> {a.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
          <CommandGroup heading="Preferences">
            <CommandItem
              onSelect={run(() => settings.mutate({ theme: resolved === 'dark' ? 'light' : 'dark' }))}
            >
              <MoonIcon /> Switch to {resolved === 'dark' ? 'light' : 'dark'} theme
            </CommandItem>
            <CommandItem onSelect={run(showShortcuts)}>
              <KeyboardIcon /> Keyboard shortcuts
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
