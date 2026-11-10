import type { DrillTarget } from '@shared/types'

/** Route for a metric's drill-down; the target page shows a total equal to the metric (SC-005). */
export function drillHref(target: DrillTarget): string {
  if (target.page === 'networth') return '/net-worth'
  if (target.page === 'forecast') return '/forecast'
  if (target.page === 'accounts') return target.group === 'all' ? '/accounts' : `/accounts?group=${target.group}`
  const p = new URLSearchParams({ from: target.from, to: target.to })
  if (target.direction) p.set('direction', target.direction)
  if (target.kind) p.set('kind', target.kind)
  return `/transactions?${p.toString()}`
}
