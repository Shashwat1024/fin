import { Link } from 'react-router-dom'
import {
  CalendarDaysIcon,
  EyeIcon,
  RepeatIcon,
  ShoppingBagIcon,
  StoreIcon,
  TagIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react'
import { formatDate } from '@domain/dates'
import { MoneyText } from '@renderer/components/MoneyText'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@renderer/components/ui/card'
import { useFinMutation } from '@renderer/lib/queries'
import { plural } from '@renderer/lib/text'
import type { InsightDto } from '@shared/types'

type Kind = InsightDto['kind']

export const KIND_LABELS: Record<Kind, string> = {
  category_change: 'Category',
  merchant_change: 'Merchant',
  subscription_price: 'Subscription price',
  subscription_creep: 'Subscriptions',
  weekend_spending: 'Weekends',
  unusual_purchase: 'One-off',
}

const KIND_ICONS: Record<Kind, LucideIcon> = {
  category_change: ShoppingBagIcon,
  merchant_change: StoreIcon,
  subscription_price: TagIcon,
  subscription_creep: RepeatIcon,
  weekend_spending: CalendarDaysIcon,
  unusual_purchase: ShoppingBagIcon,
}

/** The transactions behind an insight, on the Transactions page. */
export function insightHref(i: InsightDto): string {
  const p = new URLSearchParams({ from: i.filter.from, to: i.filter.to })
  if (i.filter.categoryId) p.set('category', i.filter.categoryId)
  if (i.filter.text) p.set('q', i.filter.text)
  return `/transactions?${p.toString()}`
}

/** One insight: what changed, against what, and the transactions behind it (FR-029, FR-026). */
export function InsightCard({ insight: i }: { insight: InsightDto }) {
  const dismiss = useFinMutation('insights.dismiss', { success: 'Insight dismissed' })
  const restore = useFinMutation('insights.restore', { success: 'Insight shown again' })
  const Icon = KIND_ICONS[i.kind]
  const Trend = i.direction === 'up' ? TrendingUpIcon : TrendingDownIcon
  const titleId = `insight-${i.key}`
  return (
    <Card
      role="article"
      aria-labelledby={titleId}
      className={i.dismissed ? 'opacity-70' : undefined}
      data-testid="insight"
    >
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon className="size-4" aria-hidden />
          {KIND_LABELS[i.kind]}
          {i.dismissed && <Badge variant="outline">Dismissed</Badge>}
        </CardDescription>
        <CardTitle
          id={titleId}
          role="heading"
          aria-level={3}
          className="flex items-start gap-2 text-base leading-snug"
        >
          <Trend className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          {i.title}
        </CardTitle>
        <CardAction>
          {i.dismissed ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={restore.isPending}
              onClick={() => restore.mutate({ key: i.key })}
              aria-label={`Show again: ${i.title}`}
            >
              <EyeIcon /> Show again
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={dismiss.isPending}
              onClick={() => dismiss.mutate({ key: i.key })}
              aria-label={`Dismiss: ${i.title}`}
            >
              <XIcon />
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm">{i.detail}</p>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-md bg-muted/50 px-3 py-2">
            <dt className="text-xs text-muted-foreground">{i.period.label}</dt>
            <dd className="font-medium">
              <MoneyText minor={i.currentMinor} />
            </dd>
          </div>
          {i.comparison && i.comparisonMinor !== null && (
            <div className="rounded-md bg-muted/50 px-3 py-2">
              <dt className="text-xs text-muted-foreground">Compared with: {i.comparison.label}</dt>
              <dd className="font-medium">
                <MoneyText minor={i.comparisonMinor} />
              </dd>
            </div>
          )}
        </dl>
        {i.sources.length > 0 && (
          <section aria-label="Transactions behind this">
            <h4 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Behind this
            </h4>
            <ul className="divide-y text-sm">
              {i.sources.map((s) => (
                <li key={`${s.txnId}-${s.amountMinor}`} className="flex items-center gap-3 py-1.5">
                  <span className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatDate(s.date)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  <MoneyText minor={-s.amountMinor} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </CardContent>
      <CardFooter>
        <Link to={insightHref(i)} className="text-sm text-primary underline underline-offset-4">
          {i.sourceCount > i.sources.length
            ? `See all ${plural(i.sourceCount, 'transaction')}`
            : 'Open in Transactions'}
        </Link>
      </CardFooter>
    </Card>
  )
}
