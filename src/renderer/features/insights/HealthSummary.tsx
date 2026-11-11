import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CompassIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { call } from '@renderer/lib/ipc'
import type { HealthDto, HealthMeasure } from '@shared/types'

export const useHealth = () =>
  useQuery({ queryKey: ['health'], queryFn: () => call('health.summary', undefined) })

/** The records behind each measure (FR-028). */
function links(m: HealthMeasure, recent: HealthDto['recent']): { label: string; to: string }[] {
  const range = recent ? `from=${recent.from}&to=${recent.to}&kind=standard` : null
  switch (m.key) {
    case 'emergency_cover':
      return [
        { label: 'Cash and bank accounts', to: '/accounts?group=cash' },
        ...(range
          ? [{ label: 'Essential spending', to: `/transactions?${range}&direction=out&group=needs` }]
          : []),
      ]
    case 'emi_share':
      return [
        { label: 'EMIs', to: '/recurring' },
        ...(range ? [{ label: 'Income', to: `/transactions?${range}&direction=in` }] : []),
      ]
    case 'savings_rate':
      return range ? [{ label: 'Money in and out', to: `/transactions?${range}` }] : []
    case 'card_share':
      return [{ label: 'Credit cards', to: '/accounts?group=cards' }]
  }
}

/** Where the user stands, as plain facts (US13). No scores or advice. */
export function HealthSummary({ title = 'Where you stand' }: { title?: string }) {
  const q = useHealth()
  if (q.isPending || q.isError) return null
  const { measures, recent } = q.data
  return (
    <Card role="region" aria-label={title}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CompassIcon className="size-4 text-muted-foreground" aria-hidden /> {title}
        </CardTitle>
        <CardDescription>Facts from your own records. Each one shows where it comes from.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {measures.map((m) => (
            <li key={m.key} className="flex flex-col gap-1 text-sm" data-testid={`health-${m.key}`}>
              <span className="text-xs font-medium text-muted-foreground">{m.label}</span>
              <p className={m.available ? undefined : 'text-muted-foreground'}>{m.text}</p>
              {m.available && (
                <p className="flex flex-wrap gap-x-3 text-xs">
                  {links(m, recent).map((l) => (
                    <Link
                      key={l.label}
                      to={l.to}
                      className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
                    >
                      {l.label}
                    </Link>
                  ))}
                </p>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
