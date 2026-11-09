import { HashRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { ErrorState, LoadingState } from '@renderer/components/layout'
import { AppShell } from '@renderer/app/AppShell'
import { CommandPalette } from '@renderer/app/CommandPalette'
import { AccountDialogProvider } from '@renderer/features/accounts/AccountDialog'
import { AccountsPage } from '@renderer/features/accounts/AccountsPage'
import { DashboardPage } from '@renderer/features/dashboard/DashboardPage'
import { Onboarding } from '@renderer/features/onboarding/Onboarding'
import { SettingsPage } from '@renderer/features/settings/SettingsPage'
import { TransactionDialogProvider } from '@renderer/features/transactions/TransactionDialog'
import { TransactionsPage } from '@renderer/features/transactions/TransactionsPage'
import { useSettings } from '@renderer/lib/queries'

/** Route content is isolated so a crash in one page can be retried, and clears on navigation. */
function Routed() {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary resetKey={pathname}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/transactions" element={<TransactionsRoute />} />
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<DashboardPage />} />
      </Routes>
    </ErrorBoundary>
  )
}

/** Re-mount the ledger when its URL filters change (e.g. drilling down from the dashboard). */
function TransactionsRoute() {
  const { search } = useLocation()
  return <TransactionsPage key={search} />
}

export function App() {
  const settings = useSettings()
  if (settings.isPending) return <LoadingState label="Opening your data…" />
  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />

  return (
    <HashRouter>
      <AccountDialogProvider>
        <TransactionDialogProvider>
          {settings.data.onboarded ? (
            <>
              <AppShell>
                <Routed />
              </AppShell>
              <ErrorBoundary>
                <CommandPalette />
              </ErrorBoundary>
            </>
          ) : (
            <Onboarding settings={settings.data} />
          )}
        </TransactionDialogProvider>
      </AccountDialogProvider>
    </HashRouter>
  )
}
