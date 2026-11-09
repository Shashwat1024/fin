import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowDownLeftIcon,
  ArrowLeftRightIcon,
  ArrowUpRightIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  MoonIcon,
  PlusIcon,
  ReceiptTextIcon,
  SettingsIcon,
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
  CommandSeparator,
  CommandShortcut,
} from '@renderer/components/ui/command'
import { useAccountDialog } from '@renderer/features/accounts/AccountDialog'
import { useTransactionDialog } from '@renderer/features/transactions/TransactionDialog'
import { useHotkey } from '@renderer/lib/hotkeys'
import { useAccounts, useFinMutation } from '@renderer/lib/queries'
import { useTheme } from '@renderer/lib/theme'

/** Ctrl+K: jump anywhere or start any action without the mouse. */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const txn = useTransactionDialog()
  const accountDialog = useAccountDialog()
  const { data: accounts = [] } = useAccounts()
  const { resolved } = useTheme()
  const settings = useFinMutation('settings.update')
  useHotkey('mod+k', () => setOpen((o) => !o))

  const run = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command palette" description="Search for a page or action">
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
        </CommandGroup>
        <CommandSeparator />
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
          <CommandItem onSelect={run(() => navigate('/settings'))}>
            <SettingsIcon /> Settings
          </CommandItem>
        </CommandGroup>
        {accounts.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Accounts">
              {accounts.map((a) => (
                <CommandItem key={a.id} value={`account ${a.name}`} onSelect={run(() => navigate(`/transactions?account=${a.id}`))}>
                  <WalletIcon /> {a.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        <CommandSeparator />
        <CommandGroup heading="Preferences">
          <CommandItem onSelect={run(() => settings.mutate({ theme: resolved === 'dark' ? 'light' : 'dark' }))}>
            <MoonIcon /> Switch to {resolved === 'dark' ? 'light' : 'dark'} theme
          </CommandItem>
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  )
}
