import type { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  FileUpIcon,
  KeyboardIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  LightbulbIcon,
  LineChartIcon,
  MonitorIcon,
  MoonIcon,
  PieChartIcon,
  PlusIcon,
  ReceiptTextIcon,
  RepeatIcon,
  ScaleIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
  TagsIcon,
  TargetIcon,
  type LucideIcon,
} from 'lucide-react'
import { ShortcutHint } from '@renderer/components/layout'
import { Button } from '@renderer/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import { DemoBanner } from '@renderer/features/demo/DemoBanner'
import { useTransactionDialog } from '@renderer/features/transactions/TransactionDialog'
import { showShortcuts, useHotkey } from '@renderer/lib/hotkeys'
import { useFinMutation } from '@renderer/lib/queries'
import { useTheme } from '@renderer/lib/theme'
import { cn } from '@renderer/lib/utils'
import type { Theme } from '@shared/types'

const NAV: { to: string; label: string; icon: LucideIcon; combo?: string }[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboardIcon, combo: 'mod+1' },
  { to: '/transactions', label: 'Transactions', icon: ReceiptTextIcon, combo: 'mod+2' },
  { to: '/accounts', label: 'Accounts', icon: LandmarkIcon, combo: 'mod+3' },
  { to: '/import', label: 'Import', icon: FileUpIcon, combo: 'mod+4' },
  { to: '/recurring', label: 'Recurring', icon: RepeatIcon, combo: 'mod+5' },
  { to: '/budget', label: 'Budget', icon: PieChartIcon, combo: 'mod+6' },
  { to: '/goals', label: 'Goals', icon: TargetIcon, combo: 'mod+7' },
  { to: '/categories', label: 'Categories', icon: TagsIcon, combo: 'mod+8' },
  { to: '/forecast', label: 'Forecast', icon: LineChartIcon, combo: 'mod+9' },
  { to: '/net-worth', label: 'Net worth', icon: ScaleIcon, combo: 'mod+0' },
  { to: '/insights', label: 'Insights', icon: LightbulbIcon },
]
const SETTINGS = { to: '/settings', label: 'Settings', icon: SettingsIcon, combo: 'mod+,' }

/** Quick appearance switch in the sidebar; the same choice as Settings › Appearance. */
function ThemeSwitch() {
  const { theme } = useTheme()
  const update = useFinMutation('settings.update')
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={theme}
      onValueChange={(v) => v && update.mutate({ theme: v as Theme })}
      aria-label="Appearance"
      className="w-full"
    >
      <ToggleGroupItem value="system" aria-label="System theme" title="System" className="flex-1">
        <MonitorIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="light" aria-label="Light theme" title="Light" className="flex-1">
        <SunIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="dark" aria-label="Dark theme" title="Dark" className="flex-1">
        <MoonIcon />
      </ToggleGroupItem>
    </ToggleGroup>
  )
}

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
      {combo && <ShortcutHint combo={combo} className="opacity-0 transition-opacity group-hover:opacity-60" />}
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
  useHotkey('mod+9', () => navigate('/forecast'))
  useHotkey('mod+0', () => navigate('/net-worth'))
  useHotkey('mod+,', () => navigate('/settings'))
  return (
    <div className="flex h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-background focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="flex w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r bg-sidebar px-3 py-5 text-sidebar-foreground">
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
        <div className="mt-auto flex flex-col gap-3 border-t pt-4">
          <nav aria-label="App">
            <NavItem {...SETTINGS} />
          </nav>
          <div className="px-1">
            <ThemeSwitch />
          </div>
        </div>
        <div className="flex flex-col gap-2 px-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <SearchIcon className="size-3.5" /> Command palette <ShortcutHint combo="mod+k" />
          </span>
          <button
            type="button"
            onClick={showShortcuts}
            className="flex items-center gap-2 rounded text-left outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-sidebar-ring/50"
          >
            <KeyboardIcon className="size-3.5" /> Keyboard shortcuts <ShortcutHint combo="shift+?" />
          </button>
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
