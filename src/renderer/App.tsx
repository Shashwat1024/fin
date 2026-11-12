import { HashRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { ErrorState, LoadingState } from '@renderer/components/layout'
import { AppShell } from '@renderer/app/AppShell'
import { CommandPalette } from '@renderer/app/CommandPalette'
import { ShortcutsSheet } from '@renderer/components/ShortcutsSheet'
import { AccountDialogProvider } from '@renderer/features/accounts/AccountDialog'
import { AccountsPage } from '@renderer/features/accounts/AccountsPage'
import { ReconcileDialogProvider } from '@renderer/features/accounts/ReconcileDialog'
import { ImportPage } from '@renderer/features/import/ImportPage'
import { InsightsPage } from '@renderer/features/insights/InsightsPage'
import { BudgetPage } from '@renderer/features/budget/BudgetPage'
import { CategoriesPage } from '@renderer/features/categories/CategoriesPage'
import { DashboardPage } from '@renderer/features/dashboard/DashboardPage'
import { ForecastPage } from '@renderer/features/forecast/ForecastPage'
import { GoalsPage } from '@renderer/features/goals/GoalsPage'
import { NetWorthPage } from '@renderer/features/networth/NetWorthPage'
import { Onboarding } from '@renderer/features/onboarding/Onboarding'
import { RecurringPage } from '@renderer/features/recurring/RecurringPage'
import { SettingsPage } from '@renderer/features/settings/SettingsPage'
import { TransactionDialogProvider } from '@renderer/features/transactions/TransactionDialog'
import { TransactionsPage } from '@renderer/features/transactions/TransactionsPage'
import { MonthReviewPage } from '@renderer/features/review/MonthReviewPage'
import { YearReviewPage } from '@renderer/features/review/YearReviewPage'
import { TaxPage } from '@renderer/features/tax/TaxPage'
import { PeoplePage } from '@renderer/features/people/PeoplePage'
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
        <Route path="/import" element={<ImportPage />} />
        <Route path="/recurring" element={<RecurringPage />} />
        <Route path="/budget" element={<BudgetPage />} />
        <Route path="/goals" element={<GoalsPage />} />
        <Route path="/categories" element={<CategoriesPage />} />
        <Route path="/forecast" element={<ForecastPage />} />
        <Route path="/net-worth" element={<NetWorthPage />} />
        <Route path="/insights" element={<InsightsPage />} />
        <Route path="/review/:month" element={<MonthReviewPage />} />
        <Route path="/year" element={<YearReviewPage />} />
        <Route path="/tax" element={<TaxPage />} />
        <Route path="/people" element={<PeoplePage />} />
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
        <ReconcileDialogProvider>
          <TransactionDialogProvider>
            {settings.data.onboarded ? (
              <>
                <AppShell>
                  <Routed />
                </AppShell>
                <ErrorBoundary>
                  <CommandPalette />
                  <ShortcutsSheet />
                </ErrorBoundary>
              </>
            ) : (
              <Onboarding settings={settings.data} />
            )}
          </TransactionDialogProvider>
        </ReconcileDialogProvider>
      </AccountDialogProvider>
    </HashRouter>
  )
}
