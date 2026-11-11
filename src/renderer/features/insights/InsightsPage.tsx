import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LightbulbIcon } from 'lucide-react'
import { formatDate } from '@domain/dates'
import { EmptyState, ErrorState, LoadingState, Page, PageHeader } from '@renderer/components/layout'
import { Label } from '@renderer/components/ui/label'
import { Switch } from '@renderer/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { useInsights } from '@renderer/lib/queries'
import { HealthSummary } from './HealthSummary'
import { InsightCard } from './InsightCard'
import { SpendingCalendar } from './SpendingCalendar'
import { WhatIf } from './WhatIf'

function Feed() {
  const [showDismissed, setShowDismissed] = useState(false)
  const q = useInsights(showDismissed)
  if (q.isPending) return <LoadingState />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const { insights, asOf, historyStart, dismissedCount } = q.data
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <p data-testid="insights-as-of">
          {asOf
            ? `Based on your transactions up to ${formatDate(asOf)}, compared with your own history.`
            : 'No transactions yet.'}
        </p>
        {(dismissedCount > 0 || showDismissed) && (
          <div className="flex items-center gap-2">
            <Switch id="show-dismissed" checked={showDismissed} onCheckedChange={setShowDismissed} />
            <Label htmlFor="show-dismissed">Show dismissed ({dismissedCount})</Label>
          </div>
        )}
      </div>
      {insights.length === 0 ? (
        <EmptyState
          icon={<LightbulbIcon />}
          title={historyStart ? 'Nothing stands out right now' : 'No history yet'}
          description={
            historyStart
              ? 'Insights compare last month with the months before it, recent payments with the past year, and your subscriptions over time. They appear when something changes noticeably.'
              : 'Add or import a couple of months of transactions and patterns will show up here.'
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {insights.map((i) => (
            <InsightCard key={i.key} insight={i} />
          ))}
        </div>
      )}
    </div>
  )
}

/** Behaviour insights, the what-if simulator (US8) and the spending calendar (US12). None of them
 * changes stored data except dismissals. */
export function InsightsPage() {
  const [params, setParams] = useSearchParams()
  const asked = params.get('tab')
  const tab = asked === 'what-if' || asked === 'calendar' ? asked : 'insights'
  return (
    <Page>
      <PageHeader
        title="Insights"
        description="Patterns in your spending, a month at a glance, and what would happen if something changed."
      />
      <Tabs
        value={tab}
        onValueChange={(t) => setParams(t === 'insights' ? {} : { tab: t }, { replace: true })}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="insights">Insights</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="what-if">What if</TabsTrigger>
        </TabsList>
        <TabsContent value="insights" className="flex flex-col gap-6">
          <HealthSummary />
          <Feed />
        </TabsContent>
        <TabsContent value="calendar">
          <SpendingCalendar />
        </TabsContent>
        <TabsContent value="what-if">
          <WhatIf />
        </TabsContent>
      </Tabs>
    </Page>
  )
}
