import { useState, type ReactNode } from 'react'
import { BarChart3Icon, TableIcon } from 'lucide-react'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@renderer/components/ui/card'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@renderer/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import { cn } from '@renderer/lib/utils'

export type ChartColumn<T> = { key: string; header: string; cell: (row: T) => ReactNode; numeric?: boolean }

/** The same numbers a chart draws, as a plain table: the accessible fallback for every chart (NFR accessibility). */
export function ChartTable<T>({
  caption,
  columns,
  rows,
  rowKey,
}: {
  caption: string
  columns: ChartColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
}) {
  return (
    <Table>
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          {columns.map((c) => (
            <TableHead key={c.key} className={cn(c.numeric && 'text-right')}>
              {c.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={rowKey(r)}>
            {columns.map((c) => (
              <TableCell key={c.key} className={cn(c.numeric && 'text-right tabular-nums')}>
                {c.cell(r)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** A card holding a chart, with a Chart / Table switch so every figure can also be read as numbers. */
export function ChartCard({
  title,
  description,
  chart,
  table,
  className,
}: {
  title: string
  description?: ReactNode
  chart: ReactNode
  table: ReactNode
  className?: string
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        <CardAction>
          <ToggleGroup
            data-print-hide
            type="single"
            variant="outline"
            size="sm"
            value={view}
            onValueChange={(v) => v && setView(v as 'chart' | 'table')}
            aria-label={`${title}: show as`}
          >
            <ToggleGroupItem value="chart" aria-label="Chart">
              <BarChart3Icon />
            </ToggleGroupItem>
            <ToggleGroupItem value="table" aria-label="Table">
              <TableIcon />
            </ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent>{view === 'chart' ? chart : table}</CardContent>
    </Card>
  )
}
