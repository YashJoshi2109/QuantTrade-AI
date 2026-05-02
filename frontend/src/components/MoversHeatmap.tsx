'use client'

import Link from 'next/link'

export interface MoversHeatmapRow {
  symbol: string
  name?: string
  change_percent: number
  price?: number
}

function bgForChange(change: number): string {
  if (change >= 3) return 'bg-green-600'
  if (change >= 2) return 'bg-green-500'
  if (change >= 1) return 'bg-green-500/80'
  if (change >= 0.5) return 'bg-green-500/60'
  if (change > 0.1) return 'bg-green-500/40'
  if (change >= -0.1) return 'bg-slate-600/50'   // flat / stale data → neutral gray
  if (change >= -0.5) return 'bg-red-500/40'
  if (change >= -1) return 'bg-red-500/60'
  if (change >= -2) return 'bg-red-500/80'
  if (change >= -3) return 'bg-red-500'
  return 'bg-red-600'
}

function textForChange(change: number): string {
  return Math.abs(change) >= 1 ? 'text-white' : 'text-white/85'
}

/**
 * Treemap-style grid from flat movers (e.g. regional gainers/losers/actives) for 1D performance when US sector data does not apply.
 */
function ChangeScaleLegend() {
  const stops = [
    '#b91c1c',
    '#dc2626',
    '#ef4444',
    '#f87171',
    '#64748b',
    '#4ade80',
    '#22c55e',
    '#16a34a',
    '#15803d',
    '#166534',
  ]
  return (
    <div className="mt-4 pt-3 border-t border-line-subtle space-y-1.5">
      <div className="text-[10px] text-fg-muted text-center">1-day % change (stronger color = larger move)</div>
      <div
        className="flex h-2 rounded-md overflow-hidden border border-line-default max-w-md mx-auto"
        role="img"
        aria-label="Loss to gain color scale"
      >
        {stops.map((c, i) => (
          <div key={i} className="flex-1 min-w-[3px]" style={{ backgroundColor: c }} />
        ))}
      </div>
      <div className="flex justify-between text-[9px] text-fg-muted max-w-md mx-auto font-mono px-1">
        <span>Losers</span>
        <span className="text-fg-muted">0</span>
        <span>Gainers</span>
      </div>
    </div>
  )
}

export default function MoversHeatmap({
  rows,
  className = '',
  emptyLabel = 'No movers to map yet',
  showLegend = false,
}: {
  rows: MoversHeatmapRow[]
  className?: string
  emptyLabel?: string
  /** When true, show a gradient key under the grid (helpful on regional views). */
  showLegend?: boolean
}) {
  if (!rows.length) {
    return (
      <div className={`rounded-lg border border-line-subtle bg-surface-base/40 py-12 text-center text-xs text-fg-muted ${className}`}>
        {emptyLabel}
      </div>
    )
  }

  return (
    <div className={className}>
      <div
        className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-1.5"
        role="list"
        aria-label="One day performance heatmap"
      >
        {rows.map((r) => {
          const bg = bgForChange(r.change_percent)
          const tc = textForChange(r.change_percent)
          const pct = r.change_percent >= 0 ? '+' : ''
          return (
            <Link
              key={r.symbol}
              href={`/research?symbol=${encodeURIComponent(r.symbol)}`}
              className={`${bg} rounded-md p-2 sm:p-2.5 flex flex-col items-center justify-center min-h-[56px] sm:min-h-[60px] border border-line-subtle transition-all hover:brightness-110 hover:scale-[1.02] hover:z-[1] hover:shadow-lg`}
              title={`${r.name ?? r.symbol}\n${pct}${r.change_percent.toFixed(2)}%`}
              role="listitem"
            >
              <span className={`font-bold text-[11px] sm:text-xs ${tc} tracking-tight`}>{r.symbol}</span>
              <span className={`text-[10px] font-mono ${tc}`}>
                {pct}
                {r.change_percent.toFixed(2)}%
              </span>
            </Link>
          )
        })}
      </div>
      {showLegend ? <ChangeScaleLegend /> : null}
    </div>
  )
}
