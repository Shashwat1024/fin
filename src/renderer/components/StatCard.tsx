import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRightIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { cn } from '@renderer/lib/utils'

type Props = {
  label: string
  value: ReactNode
  /** Secondary line: comparison, explanation or freshness ("as of"). */
  detail?: ReactNode
  icon?: ReactNode
  /** Drill-down to the records behind the number (FR-025). */
  to?: string
  className?: string
}

/** A single headline number with its explanation and an optional drill-down link. */
export function StatCard({ label, value, detail, icon, to, className }: Props) {
  const body = (
    <Card className={cn('h-full gap-2 transition-colors', to && 'hover:border-primary/40', className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardDescription className="flex items-center gap-2">
          {icon}
          {label}
        </CardDescription>
        {to && <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />}
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <CardTitle className="text-2xl font-semibold tracking-tight">{value}</CardTitle>
        {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
      </CardContent>
    </Card>
  )
  return to ? (
    <Link to={to} className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={`${label}: view details`}>
      {body}
    </Link>
  ) : (
    body
  )
}
