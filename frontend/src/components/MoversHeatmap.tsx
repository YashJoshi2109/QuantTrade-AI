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
  if (change >= 0) return 'bg-green-500/40'
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
export default function MoversHeatmap({
  rows,
  className = '',
  emptyLabel = 'No movers to map yet',
}: {
  rows: MoversHeatmapRow[]
  className?: string
  emptyLabel?: string
}) {
  if (!rows.length) {
    return (
      <div className={`rounded-lg border border-slate-800/60 bg-slate-950/40 py-12 text-center text-xs text-slate-500 ${className}`}>
        {emptyLabel}
      </div>
    )
  }

  return (
    <div
      className={`grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5 ${className}`}
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
            className={`${bg} rounded-md p-2 flex flex-col items-center justify-center min-h-[52px] border border-white/5 transition-all hover:brightness-110 hover:scale-[1.02]`}
            title={`${r.name ?? r.symbol}\n${pct}${r.change_percent.toFixed(2)}%`}
            role="listitem"
          >
            <span className={`font-bold text-[11px] ${tc}`}>{r.symbol}</span>
            <span className={`text-[10px] font-mono ${tc}`}>
              {pct}
              {r.change_percent.toFixed(2)}%
            </span>
          </Link>
        )
      })}
    </div>
  )
}
