import type { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  FileUpIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  PieChartIcon,
  PlusIcon,
  ReceiptTextIcon,
  RepeatIcon,
  SearchIcon,
  SettingsIcon,
  TagsIcon,
  TargetIcon,
  type LucideIcon,
} from 'lucide-react'
import { ShortcutHint } from '@renderer/components/layout'
import { Button } from '@renderer/components/ui/button'
import { DemoBanner } from '@renderer/features/demo/DemoBanner'
import { useTransactionDialog } from '@renderer/features/transactions/TransactionDialog'
import { useHotkey } from '@renderer/lib/hotkeys'
import { cn } from '@renderer/lib/utils'

const NAV: { to: string; label: string; icon: LucideIcon; combo: string }[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboardIcon, combo: 'mod+1' },
  { to: '/transactions', label: 'Transactions', icon: ReceiptTextIcon, combo: 'mod+2' },
  { to: '/accounts', label: 'Accounts', icon: LandmarkIcon, combo: 'mod+3' },
  { to: '/import', label: 'Import', icon: FileUpIcon, combo: 'mod+4' },
  { to: '/recurring', label: 'Recurring', icon: RepeatIcon, combo: 'mod+5' },
  { to: '/budget', label: 'Budget', icon: PieChartIcon, combo: 'mod+6' },
  { to: '/goals', label: 'Goals', icon: TargetIcon, combo: 'mod+7' },
  { to: '/categories', label: 'Categories', icon: TagsIcon, combo: 'mod+8' },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, combo: 'mod+,' },
]

function NavItem({ to, label, icon: Icon, combo }: (typeof NAV)[number]) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/80 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-3 focus-visible:ring-sidebar-ring/50',
          isActive && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
        )
      }
    >
      <Icon className="size-4" aria-hidden />
      <span className="flex-1">{label}</span>
      <ShortcutHint combo={combo} className="opacity-0 transition-opacity group-hover:opacity-60" />
    </NavLink>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const txn = useTransactionDialog()
  useHotkey('mod+1', () => navigate('/'))
  useHotkey('mod+2', () => navigate('/transactions'))
  useHotkey('mod+3', () => navigate('/accounts'))
  useHotkey('mod+4', () => navigate('/import'))
  useHotkey('mod+5', () => navigate('/recurring'))
  useHotkey('mod+6', () => navigate('/budget'))
  useHotkey('mod+7', () => navigate('/goals'))
  useHotkey('mod+8', () => navigate('/categories'))
  useHotkey('mod+,', () => navigate('/settings'))
  return (
    <div className="flex h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-background focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="flex w-60 shrink-0 flex-col gap-6 border-r bg-sidebar px-3 py-5 text-sidebar-foreground">
        <div className="flex items-center gap-2 px-3">
          <div className="grid size-7 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground" aria-hidden>
            ₹
          </div>
          <span className="text-lg font-semibold tracking-tight">Fin</span>
        </div>
        <Button className="mx-1 justify-start" onClick={() => txn.open({ mode: 'expense' })}>
          <PlusIcon /> Add transaction
        </Button>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {NAV.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </nav>
        <div className="mt-auto px-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <SearchIcon className="size-3.5" /> Command palette <ShortcutHint combo="mod+k" />
          </span>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <DemoBanner />
        <main id="main" className="min-h-0 flex-1 overflow-auto bg-background">
          {children}
        </main>
      </div>
    </div>
  )
}
