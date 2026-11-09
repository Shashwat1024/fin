import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { formatMoney, money } from '@domain/money'
import { cn } from '@renderer/lib/utils'

export type LinePoint = { date: string; valueMinor: number }

type Props = {
  points: readonly LinePoint[]
  /** Accessible name; the same numbers are also offered as a table by the surrounding ChartCard. */
  label: string
  /** A dashed horizontal reference line (e.g. the minimum buffer). */
  reference?: { valueMinor: number; label: string } | null
  /** Date ranges to shade (e.g. days below the buffer). */
  ranges?: readonly { from: string; to: string }[]
  /** One point to mark and label (e.g. the lowest balance). */
  marker?: { date: string; label: string } | null
  /** A second line on the same dates, drawn dashed and muted (e.g. the forecast before a what-if change). */
  compare?: readonly LinePoint[] | null
  /** Tooltip body for the hovered point. */
  tooltip: (index: number) => ReactNode
  height?: number
  className?: string
}

const PAD = { top: 12, right: 12, bottom: 24, left: 64 }
const DAY_MONTH = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const MONTH_YEAR = new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' })
const asDate = (d: string) => new Date(`${d}T00:00:00Z`)

/** Round gridline values (1, 2 or 5 × 10ⁿ steps) covering [min, max], always including zero when in range. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const pad = Math.max(Math.abs(max) * 0.1, 100_000)
    min -= pad
    max += pad
  }
  const rough = (max - min) / count
  const pow = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough)!
  const start = Math.floor(min / step) * step
  const out: number[] = []
  for (let v = start; v <= max + step * 0.001; v += step) out.push(v)
  if (out.at(-1)! < max) out.push(out.at(-1)! + step)
  return out
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/**
 * A single-series line over dates, drawn as SVG. Hover or use ←/→ for the value on each day;
 * gridlines and axes stay quiet so the line, the reference and any shaded range carry the meaning.
 */
export function LineChart({ points, label, reference, ranges = [], marker, compare, tooltip, height = 240, className }: Props) {
  const [box, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const n = points.length
  const values = [...points, ...(compare ?? [])].map((p) => p.valueMinor)
  const ticks = niceTicks(Math.min(...values, reference?.valueMinor ?? Infinity), Math.max(...values, reference?.valueMinor ?? -Infinity))
  const lo = ticks[0]!
  const hi = ticks.at(-1)!
  const plotW = Math.max(0, width - PAD.left - PAD.right)
  const plotH = height - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo || 1)) * plotH
  const index = new Map(points.map((p, i) => [p.date, i]))
  const line = (list: readonly LinePoint[]) => list.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.valueMinor).toFixed(1)}`).join('')
  const path = line(points)
  const spanMonths = n > 1 ? (asDate(points[n - 1]!.date).getTime() - asDate(points[0]!.date).getTime()) / 86_400_000 > 120 : false
  const fmt = (d: string) => (spanMonths ? MONTH_YEAR : DAY_MONTH).format(asDate(d))
  const xTicks = n <= 1 ? [0] : Array.from(new Set(Array.from({ length: Math.min(6, n) }, (_, k) => Math.round((k * (n - 1)) / Math.min(5, n - 1)))))
  const step = Math.max(1, plotW / Math.max(1, n - 1))
  const m = marker ? index.get(marker.date) : undefined

  const pick = (clientX: number, rect: DOMRect) => {
    const i = Math.round(((clientX - rect.left - PAD.left) / (plotW || 1)) * (n - 1))
    setActive(Math.max(0, Math.min(n - 1, i)))
  }
  const onKey = (e: KeyboardEvent) => {
    const move = { ArrowRight: 1, ArrowLeft: -1, PageDown: 7, PageUp: -7 }[e.key]
    if (move !== undefined) {
      e.preventDefault()
      setActive((a) => Math.max(0, Math.min(n - 1, (a ?? (move > 0 ? -1 : n)) + move)))
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      setActive(e.key === 'Home' ? 0 : n - 1)
    } else if (e.key === 'Escape') setActive(null)
  }

  return (
    <div ref={box} className={cn('relative select-none', className)} style={{ height }}>
      {width > 0 && n > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          tabIndex={0}
          className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
        >
          {ranges.map((r) => {
            const a = index.get(r.from)
            const b = index.get(r.to)
            if (a === undefined || b === undefined) return null
            const x0 = Math.max(PAD.left, x(a) - step / 2)
            const x1 = Math.min(PAD.left + plotW, x(b) + step / 2)
            return <rect key={r.from} x={x0} y={PAD.top} width={Math.max(2, x1 - x0)} height={plotH} className="fill-warning/15" />
          })}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} className={t === 0 ? 'stroke-muted-foreground/50' : 'stroke-border'} />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                {formatMoney(money(t), { compact: true })}
              </text>
            </g>
          ))}
          {xTicks.map((i) => (
            <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="fill-muted-foreground text-[11px]">
              {fmt(points[i]!.date)}
            </text>
          ))}
          {reference && (
            <g>
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={y(reference.valueMinor)}
                y2={y(reference.valueMinor)}
                strokeDasharray="4 4"
                strokeWidth={1.5}
                className="stroke-warning"
              />
              <text x={PAD.left + plotW - 4} y={y(reference.valueMinor) - 5} textAnchor="end" className="fill-muted-foreground text-[11px]">
                {reference.label}
              </text>
            </g>
          )}
          {compare && compare.length > 0 && (
            <path d={line(compare)} fill="none" strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" className="stroke-muted-foreground/70" />
          )}
          <path d={path} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="stroke-series-in" />
          {m !== undefined && marker && (
            <g>
              <circle cx={x(m)} cy={y(points[m]!.valueMinor)} r={5} strokeWidth={2} className="fill-series-in stroke-card" />
              <text
                x={x(m)}
                y={y(points[m]!.valueMinor) + 18}
                textAnchor={x(m) < PAD.left + 60 ? 'start' : x(m) > PAD.left + plotW - 60 ? 'end' : 'middle'}
                className="fill-foreground text-[11px] font-medium"
              >
                {marker.label}
              </text>
            </g>
          )}
          {active !== null && (
            <g pointerEvents="none">
              <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotH} className="stroke-muted-foreground/60" />
              <circle cx={x(active)} cy={y(points[active]!.valueMinor)} r={4} strokeWidth={2} className="fill-series-in stroke-card" />
            </g>
          )}
        </svg>
      )}
      {active !== null && (
        <div
          role="status"
          className="pointer-events-none absolute top-0 z-10 min-w-44 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
          style={x(active) > width / 2 ? { right: width - x(active) + 12 } : { left: x(active) + 12 }}
        >
          {tooltip(active)}
        </div>
      )}
    </div>
  )
}
