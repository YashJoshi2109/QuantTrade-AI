'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Rocket, RefreshCw } from 'lucide-react'
import { fetchIpoCalendar, type IpoCalendarEntry } from '@/lib/api'

export default function IpoRadarWidget() {
  const {
    data = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['ipoCalendar'],
    queryFn: () => fetchIpoCalendar(),
    refetchInterval: 3_600_000,
    staleTime: 1_800_000,
  })

  const rows: IpoCalendarEntry[] = data.slice(0, 10)

  return (
    <div className="hud-panel p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Rocket className="w-4 h-4 text-fuchsia-400" />
          <h3 className="font-bold text-white text-sm">IPO Radar</h3>
          <span className="px-1.5 py-0.5 text-[9px] bg-fuchsia-500/20 text-fuchsia-300 rounded font-bold">
            PIPELINE
          </span>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="hud-card p-1.5 text-fuchsia-400 hover:text-white transition-colors"
          aria-label="Refresh IPO calendar"
        >
          <RefreshCw className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {isLoading ? (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="min-w-[140px] h-16 rounded-lg bg-slate-800/50 animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-[11px] text-slate-500 leading-relaxed">
          No upcoming IPO rows returned. When the backend has a Finnhub API key, the next listings
          appear here automatically.
        </p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-thin">
          {rows.map((ipo, idx) => {
            const sym = ipo.symbol?.trim()
            const href = sym ? `/research?symbol=${encodeURIComponent(sym)}` : undefined
            const Inner = (
              <div className="min-w-[155px] rounded-lg border border-slate-700/60 bg-slate-900/70 px-3 py-2.5 hover:border-fuchsia-500/40 transition-colors">
                <div className="text-[10px] text-slate-500 font-mono">{ipo.date || '—'}</div>
                <div className="text-xs font-bold text-white mt-0.5 line-clamp-2 leading-snug">
                  {sym || ipo.name}
                </div>
                <div className="text-[10px] text-slate-400 mt-1 line-clamp-1">
                  {sym ? ipo.name : ipo.exchange || ipo.status || 'IPO'}
                </div>
              </div>
            )
            return href ? (
              <Link key={`${ipo.date}-${sym}-${idx}`} href={href} className="shrink-0">
                {Inner}
              </Link>
            ) : (
              <div key={`${ipo.date}-${ipo.name}-${idx}`} className="shrink-0">
                {Inner}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
