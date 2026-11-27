'use client'

import { CardSkeleton as Skeleton } from './ResearchCard'
import { cn } from '@/lib/utils'
import { fmtCompact, fmtPe, fmtPrice, type KeyStatsSource } from '@/lib/researchKeyStats'
import { rangePosition } from '@/lib/researchTechnicals'
import { RangeBar, ResearchCard } from './ResearchCard'

/**
 * Market cap / Volume / P/E / Open plus day and 52-week range bars. Values come
 * from lib/researchKeyStats (canonical quote + /api/quotes/ticker + DB
 * fundamentals); a missing value renders "—". Shared by desktop and mobile:
 * mobile orders the stats Market cap / P/E / Volume / Day open per the mock.
 */
export function ResearchStatsCard({
  source,
  price,
  loading = false,
  variant = 'desktop',
  className,
}: {
  source: KeyStatsSource
  price: number | null
  loading?: boolean
  variant?: 'desktop' | 'mobile'
  className?: string
}) {
  const s = source
  const avg = fmtCompact(s.avg_volume)
  const stats =
    variant === 'desktop'
      ? [
          { label: 'Market cap', value: fmtCompact(s.market_cap) },
          { label: 'Volume', value: fmtCompact(s.volume), sub: avg !== '—' ? `Avg ${avg}` : undefined },
          { label: 'P/E ratio', value: fmtPe(s.pe_ratio) },
          { label: 'Open', value: fmtPrice(s.open) },
        ]
      : [
          { label: 'Market cap', value: fmtCompact(s.market_cap) },
          { label: 'P/E ratio', value: fmtPe(s.pe_ratio) },
          { label: 'Volume', value: fmtCompact(s.volume), sub: avg !== '—' ? `Avg ${avg}` : undefined },
          { label: 'Day open', value: fmtPrice(s.open) },
        ]
  const day = rangePosition(price, s.day_low, s.day_high)
  const wk = rangePosition(price, s.week_52_low, s.week_52_high)
  const mobile = variant === 'mobile'

  return (
    <ResearchCard className={cn(mobile ? 'p-3' : 'p-4', className)} testId={mobile ? 'mobile-key-stats' : 'research-key-stats'} busy={loading}>
      <dl className="grid grid-cols-[repeat(4,minmax(0,1fr))] divide-x divide-line-subtle">
        {stats.map((st) => (
          <div key={st.label} className={cn('min-w-0', mobile ? 'px-1.5 first:pl-0 last:pr-0' : 'px-4 first:pl-0 last:pr-0')}>
            <dt className={cn('truncate text-fg-muted', mobile ? 'text-[10.5px]' : 'text-[12px]')}>{st.label}</dt>
            <dd className={cn('mt-0.5 truncate font-semibold tabular-nums text-fg-primary', mobile ? 'text-[13px]' : 'text-[17px]')}>
              {loading ? <Skeleton className={cn('inline-block align-middle', mobile ? 'h-4 w-12' : 'h-5 w-16')} /> : st.value}
            </dd>
            {!mobile && (
              <dd className="h-4 truncate text-[11px] tabular-nums text-fg-muted">{!loading && st.sub ? st.sub : ' '}</dd>
            )}
          </div>
        ))}
      </dl>
      <div className={cn('mt-3 grid gap-x-8 gap-y-3 border-t border-line-subtle pt-3', mobile ? 'grid-cols-[repeat(2,minmax(0,1fr))] gap-x-4' : 'grid-cols-[repeat(2,minmax(0,1fr))]')}>
        {loading ? (
          <>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </>
        ) : (
          <>
            <RangeBar label="Day range" position={day} lowLabel={fmtPrice(s.day_low)} highLabel={fmtPrice(s.day_high)} testId="day-range" />
            <RangeBar label="52-week range" position={wk} lowLabel={fmtPrice(s.week_52_low)} highLabel={fmtPrice(s.week_52_high)} testId="week52-range" />
          </>
        )}
      </div>
    </ResearchCard>
  )
}
