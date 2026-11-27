'use client'

/**
 * Compact statistical-forecast display shared by watchlist rows (desktop +
 * mobile), the screener column and the portfolio card.
 *
 * Shows the 80% range for one horizon, its measured hit rate in past
 * walk-forward tests and whether it beat ARIMA(0,1,0). It never colours a
 * forecast green/red, and shows a midpoint only for a horizon with a tested
 * edge. Every variant has a skeleton with the same footprint (no layout shift).
 */
import { Skeleton } from '@/components/Skeleton'
import { cn } from '@/lib/utils'
import {
  describeHorizon, fmtMoney, fmtRange, fmtRangePct, hitRateText, hitRateTone, pickHorizon, positionInRange,
  type ForecastHorizonSummary, type Range, type SummaryItem,
} from '@/lib/forecastSummary'
import { horizonLabel } from '@/lib/forecastHonesty'

type Variant = 'cell' | 'inline'

const toneCls = { ok: 'text-fg-secondary', warn: 'text-amber-600 dark:text-amber-400', muted: 'text-fg-muted' } as const

/** Horizontal range bar: 95% (faint) and 80% (solid) bands, a neutral marker at `price`. */
export function ForecastRangeBar({ row, price, className }: { row: ForecastHorizonSummary; price?: number | null; className?: string }) {
  const outer: Range | null = row.range_95 ?? row.range_80
  if (!outer || !row.range_80) return null
  const span = outer[1] - outer[0] || 1
  const l80 = ((row.range_80[0] - outer[0]) / span) * 100
  const w80 = ((row.range_80[1] - row.range_80[0]) / span) * 100
  const pos = positionInRange(price, outer)
  const mid = row.edge ? positionInRange(row.midpoint, outer) : null
  return (
    <div className={cn('relative h-1.5 w-full rounded-full bg-blue-500/15', className)} aria-hidden>
      <span className="absolute inset-y-0 rounded-full bg-blue-500/45" style={{ left: `${l80}%`, width: `${w80}%` }} />
      {mid != null && <span className="absolute -top-0.5 h-2.5 w-px bg-blue-400" style={{ left: `${mid}%` }} />}
      {pos != null && (
        <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-base bg-fg-primary" style={{ left: `${pos}%` }} />
      )}
    </div>
  )
}

export function ForecastBadgeSkeleton({ variant = 'cell' }: { variant?: Variant }) {
  if (variant === 'inline') return <Skeleton className="h-3.5 w-36" />
  return (
    <div className="flex flex-col items-end gap-1" data-testid="forecast-badge-skeleton">
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="h-2.5 w-16" />
    </div>
  )
}

export default function ForecastBadge({
  symbol, item, loading, h = 20, variant = 'cell', price, className,
}: {
  symbol: string
  item?: SummaryItem | null
  loading?: boolean
  h?: number
  variant?: Variant
  /** Current price, for the marker on the range bar (cell variant). */
  price?: number | null
  className?: string
}) {
  if (loading && !item) return <ForecastBadgeSkeleton variant={variant} />
  const row = pickHorizon(item?.summary, h)

  if (!row || !row.range_80) {
    const why = item?.status === 'pending'
      ? 'Forecast is being computed; check back in a minute.'
      : item?.status === 'invalid' ? 'This symbol cannot be forecast.' : 'No forecast for this symbol yet (needs about 20 months of daily prices).'
    if (variant === 'inline') {
      return <span className={cn('text-[11px] text-fg-muted', className)} title={why}>{item?.status === 'pending' ? 'Forecast computing…' : ''}</span>
    }
    return (
      <span className={cn('block text-right text-[11px] text-fg-muted', className)} title={why}>
        {item?.status === 'pending' ? 'Computing…' : '—'}
      </span>
    )
  }

  const hr = hitRateText(row)
  const tone = toneCls[hitRateTone(row)]
  const title = describeHorizon(symbol, row)
  const digits = row.range_80[1] >= 1000 ? 0 : 2

  if (variant === 'inline') {
    return (
      <span className={cn('inline-flex max-w-full items-center gap-1 truncate text-[11px] tabular-nums text-fg-muted', className)} title={title}
        data-testid={`forecast-inline-${symbol}`}>
        <span className="font-medium text-fg-secondary">{horizonLabel(h)}</span>
        <span className="text-fg-primary">{fmtRange(row.range_80, digits)}</span>
        {hr && <span className={tone}>· {hr.replace('Held ', '')}</span>}
      </span>
    )
  }

  return (
    <div className={cn('flex min-w-0 flex-col items-end gap-0.5', className)} title={title} data-testid={`forecast-badge-${symbol}`}>
      <span className="whitespace-nowrap text-[12px] font-medium tabular-nums text-fg-primary">{fmtRange(row.range_80, digits)}</span>
      <ForecastRangeBar row={row} price={price} className="w-full max-w-[120px]" />
      <span className={cn('whitespace-nowrap text-[10px]', row.edge ? 'text-fg-secondary' : 'text-fg-muted')}>
        {hr ? <span className={tone}>{hr.replace(' tests', '')}</span> : fmtRangePct(row.range_80_pct)}
        {!row.edge && <span> · no edge</span>}
        {row.edge && row.midpoint != null && <span> · mid {fmtMoney(row.midpoint, digits)}</span>}
      </span>
    </div>
  )
}
