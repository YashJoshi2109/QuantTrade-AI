'use client'

/**
 * One-symbol statistical forecast row for the Marketwatch detail views
 * (desktop InstrumentPanel and the mobile stock sheet share it, so both show
 * the same range, hit rate and skeleton). Experimental, not investment advice.
 */
import ForecastBadge from '@/components/forecast/ForecastBadge'
import { useForecastSummaries } from '@/lib/useForecastSummaries'
import { cn } from '@/lib/utils'

export default function InstrumentForecast({ symbol, price, className }: {
  symbol: string
  price?: number | null
  className?: string
}) {
  const f = useForecastSummaries([symbol])
  return (
    <section aria-label="Statistical forecast" className={cn('flex items-center justify-between gap-3', className)}>
      <div className="min-w-0">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">1M range (80%)</h3>
        <p className="text-[10px] text-fg-muted" title="Statistical 80% price range in 1 month, and how often past ranges held. Experimental, not investment advice.">
          Statistical range, experimental
        </p>
      </div>
      <ForecastBadge symbol={symbol} item={f.byTicker[symbol.toUpperCase()]} loading={f.isLoading} h={20} price={price} className="w-40 shrink-0" />
    </section>
  )
}
