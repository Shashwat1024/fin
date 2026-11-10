import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRightIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { cn } from '@renderer/lib/utils'

type Props = {
  label: string
  value: ReactNode
  /** Secondary line: comparison or explanation. */
  detail?: ReactNode
  icon?: ReactNode
  /** Drill-down to the records behind the number (FR-025). */
  to?: string
  /** Extra controls under the number, kept outside the drill-down link (e.g. a freshness badge). */
  footer?: ReactNode
  className?: string
}

/** A single headline number with its explanation and an optional drill-down link. */
export function StatCard({ label, value, detail, icon, to, footer, className }: Props) {
  const body = (
    <>
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
    </>
  )
  return (
    <Card className={cn('h-full gap-2 transition-colors', to && 'hover:border-primary/40', className)}>
      {to ? (
        <Link
          to={to}
          className="flex flex-1 flex-col gap-2 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {body}
          <span className="sr-only">View details</span>
        </Link>
      ) : (
        body
      )}
      {footer && <CardFooter className="border-t-0 bg-transparent pt-0">{footer}</CardFooter>}
    </Card>
  )
}
