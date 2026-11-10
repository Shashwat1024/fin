import { AlertTriangleIcon, LineChartIcon } from 'lucide-react'
import { formatDate } from '@domain/dates'
import { formatMoney, money } from '@domain/money'
import { MoneyText } from '@renderer/components/MoneyText'
import { StatCard } from '@renderer/components/StatCard'
import { CONFIDENCE_LABELS } from '@renderer/features/forecast/ForecastPage'
import { drillHref } from '@renderer/lib/drill'
import { useForecast } from '@renderer/lib/queries'

/** The 30-day forecast's lowest point (FR-025/027, SC-006); the same query as the Forecast page. */
export function ForecastCard() {
  const q = useForecast(30)
  const f = q.data
  const warn = f && f.belowBuffer.length > 0 ? f.belowBuffer[0]! : null
  return (
    <StatCard
      icon={<LineChartIcon className="size-4" />}
      label="Lowest in 30 days"
      value={!f ? '…' : f.hasCashAccounts ? <MoneyText minor={f.low.balanceMinor} /> : '—'}
      detail={
        !f ? null : !f.hasCashAccounts ? (
          'Add a cash or bank account to see a forecast'
        ) : (
          <>
            {f.low.date === f.today ? 'Today' : `On ${formatDate(f.low.date)}`} · {CONFIDENCE_LABELS[f.confidence]} estimate
            {warn && (
              <span className="mt-1 flex items-center gap-1.5 text-foreground">
                <AlertTriangleIcon className="size-3.5 text-warning" aria-hidden />
                Below your {formatMoney(money(f.bufferMinor))} buffer from {formatDate(warn.from)}
              </span>
            )}
          </>
        )
      }
      to={drillHref({ page: 'forecast' })}
    />
  )
}
