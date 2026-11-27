'use client'

/**
 * Layout-matched loading skeletons for data tables and mobile card lists
 * (screener, earnings, dividends). Built on the shared Skeleton primitive so
 * every tab pulses the same way and nothing shifts when data arrives.
 */
import { Skeleton } from '@/components/Skeleton'

/** A table: optional header row, then `rows` rows. Column 0 is a logo + two text lines. */
export function SkeletonDataTable({
  rows = 8,
  columns = 7,
  header = true,
  rowHeight = 52,
  className = '',
}: {
  rows?: number
  columns?: number
  header?: boolean
  rowHeight?: number
  className?: string
}) {
  const rest = Math.max(columns - 1, 0)
  return (
    <div className={`w-full ${className}`} role="status" aria-label="Loading" aria-busy="true">
      {header && (
        <div className="flex items-center gap-4 border-b border-line-subtle px-4 py-2.5">
          <Skeleton className="h-3 w-24" />
          <div className="ml-auto flex gap-6">
            {Array.from({ length: rest }).map((_, i) => <Skeleton key={i} className="h-3 w-12" />)}
          </div>
        </div>
      )}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-line-subtle px-4 last:border-b-0" style={{ height: rowHeight }}>
          <Skeleton variant="circular" className="h-6 w-6 shrink-0" />
          <div className="min-w-0 space-y-1.5">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-2.5 w-36" />
          </div>
          <div className="ml-auto flex gap-6">
            {Array.from({ length: rest }).map((_, i) => <Skeleton key={i} className="h-3 w-12" />)}
          </div>
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  )
}

/** Mobile card list: logo, two text lines, a right-aligned figure, and a 3-up stat row. */
export function SkeletonCardList({ count = 5, stats = 3 }: { count?: number; stats?: number }) {
  return (
    <ul className="space-y-2" role="status" aria-label="Loading" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} className="rounded-xl border border-line-subtle bg-surface-raised p-3">
          <div className="flex items-center gap-3">
            <Skeleton variant="circular" className="h-8 w-8 shrink-0" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-16" />
              <Skeleton className="h-2.5 w-40 max-w-full" />
            </div>
            <div className="space-y-1.5">
              <Skeleton className="ml-auto h-3.5 w-14" />
              <Skeleton className="ml-auto h-2.5 w-10" />
            </div>
          </div>
          {stats > 0 && (
            <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${stats}, minmax(0, 1fr))` }}>
              {Array.from({ length: stats }).map((_, j) => (
                <div key={j} className="space-y-1">
                  <Skeleton className="h-2 w-10" />
                  <Skeleton className="h-3 w-14" />
                </div>
              ))}
            </div>
          )}
        </li>
      ))}
      <span className="sr-only">Loading…</span>
    </ul>
  )
}

/** A summary panel: title line, a big figure, and a bar chart row (e.g. 12 monthly bars). */
export function SkeletonSummaryChart({ bars = 12, height = 160 }: { bars?: number; height?: number }) {
  return (
    <div role="status" aria-label="Loading" aria-busy="true">
      <Skeleton className="h-4 w-56" />
      <Skeleton className="mt-2 h-8 w-36" />
      <div className="mt-4 flex items-end gap-1.5" style={{ height }}>
        {Array.from({ length: bars }).map((_, i) => (
          <Skeleton key={i} className="flex-1 rounded-b-none" height={`${30 + ((i * 37) % 60)}%`} />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  )
}
