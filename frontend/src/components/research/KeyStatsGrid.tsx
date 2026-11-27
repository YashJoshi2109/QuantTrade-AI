'use client'

import { Skeleton } from '@/components/Skeleton'
import { cn } from '@/lib/utils'
import { keyStatsColumns, type KeyStatsSource } from '@/lib/researchKeyStats'

/**
 * (Arbitrary grid-cols: globals.css forces `.grid-cols-3` to one column under 640px.)
 *
 * Apple Stocks style key stats, shared by the desktop Research header and
 * MobileResearch: 3 columns (Open/High/Low | Vol/P/E/Mkt Cap | 52W H/52W L/Avg Vol),
 * muted label left, right-aligned tabular value, thin column dividers, no boxes.
 */
export function KeyStatsGrid({
  source,
  loading = false,
  className,
  testId = 'key-stats',
}: {
  source: KeyStatsSource | null | undefined
  loading?: boolean
  className?: string
  testId?: string
}) {
  const cols = keyStatsColumns(source)
  return (
    <div className={cn('overflow-hidden', className)} data-testid={testId}>
      <div
        className="grid grid-cols-[repeat(3,minmax(0,1fr))] divide-x divide-line-subtle py-2"
        aria-busy={loading || undefined}
        aria-label={loading ? 'Loading key stats' : 'Key stats'}
      >
        {cols.map((col, c) => (
          <dl key={c} className="space-y-1.5 px-2.5 first:pl-0 last:pr-0">
            {col.map((s) => (
              <div key={s.label} className="flex items-baseline justify-between gap-2 text-[12px]">
                <dt className="text-fg-muted whitespace-nowrap">{s.label}</dt>
                <dd className="font-semibold text-fg-primary tabular-nums whitespace-nowrap">
                  {loading ? <Skeleton className="inline-block h-3 w-12 align-middle" /> : s.value}
                </dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
    </div>
  )
}
