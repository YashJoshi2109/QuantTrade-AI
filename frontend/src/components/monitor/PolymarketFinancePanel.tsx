'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp, Activity, Flame } from 'lucide-react'
import { fetchPolymarketFinance, type PolymarketFinanceData, type PolymarketOutcome } from '@/lib/monitor-extended-api'

/* ── Outcome bar (shows name + colored fill + %) ────────── */
function OutcomeBar({ outcome, rank }: { outcome: PolymarketOutcome; rank: number }) {
  const pct = Math.round(outcome.price * 100)
  const colors = [
    'from-sky-500/60 to-sky-400/30',
    'from-violet-500/50 to-violet-400/25',
    'from-amber-500/50 to-amber-400/25',
    'from-emerald-500/50 to-emerald-400/25',
    'from-slate-600/50 to-slate-500/25',
  ]
  const color = colors[rank] || colors[4]

  return (
    <div className="relative flex items-center gap-1.5 w-full" title={`${outcome.name}: ${pct}%`}>
      <div className="relative flex-1 h-5 rounded-md overflow-hidden bg-slate-800/60">
        <div
          className={`absolute inset-y-0 left-0 rounded-md bg-gradient-to-r ${color} transition-all duration-500`}
          style={{ width: `${Math.max(pct, 3)}%` }}
        />
        <div className="absolute inset-0 flex items-center justify-between px-2">
          <span className="text-[9px] font-medium text-slate-200 truncate max-w-[60%] z-10">
            {outcome.name}
          </span>
          <span className="text-[9px] font-bold font-mono text-slate-200 z-10">
            {pct}%
          </span>
        </div>
      </div>
    </div>
  )
}

/* ── Single prediction card ──────────────────────────────── */
function PredictionCard({ item }: { item: { question: string; outcomes?: PolymarketOutcome[]; yes_price?: number | null; no_price?: number | null; volume?: string; slug?: string } }) {
  const outcomes = item.outcomes || []
  const isBinary = outcomes.length === 2 && outcomes.some(o => o.name.toLowerCase() === 'yes')

  return (
    <div className="px-4 py-3 hover:bg-slate-800/20 transition-colors group">
      {item.slug ? (
        <a
          href={`https://polymarket.com/event/${item.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] font-medium text-slate-300 leading-snug line-clamp-2 mb-2 group-hover:text-sky-400 transition-colors block"
        >
          {item.question}
        </a>
      ) : (
        <p className="text-[11px] font-medium text-slate-300 leading-snug line-clamp-2 mb-2">
          {item.question}
        </p>
      )}

      <div className="space-y-1">
        {isBinary ? (
          <div className="flex gap-1.5">
            {outcomes.map((o, i) => {
              const pct = Math.round(o.price * 100)
              const isYes = o.name.toLowerCase() === 'yes'
              return (
                <div
                  key={i}
                  className={`flex items-center justify-center px-2 py-1 rounded text-[10px] font-bold font-mono ${
                    isYes
                      ? pct > 50 ? 'bg-emerald-500/25 text-emerald-400' : 'bg-slate-700/50 text-slate-400'
                      : pct > 50 ? 'bg-red-500/25 text-red-400' : 'bg-slate-700/50 text-slate-400'
                  }`}
                  style={{ flex: Math.max(pct, 10) }}
                  title={`${o.name}: ${pct}%`}
                >
                  {o.name} {pct}%
                </div>
              )
            })}
          </div>
        ) : outcomes.length > 0 ? (
          <div className="space-y-0.5">
            {outcomes.slice(0, 4).map((o, i) => (
              <OutcomeBar key={i} outcome={o} rank={i} />
            ))}
            {outcomes.length > 4 && (
              <span className="text-[8px] text-slate-600 pl-1">+{outcomes.length - 4} more</span>
            )}
          </div>
        ) : item.yes_price != null ? (
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
            item.yes_price > 0.5 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700/50 text-slate-400'
          }`}>
            Yes {Math.round(item.yes_price * 100)}%
          </span>
        ) : null}
      </div>

      {item.volume && item.volume !== '—' && (
        <div className="mt-1.5 text-right">
          <span className="text-[9px] text-slate-500 font-mono">Vol: {item.volume}</span>
        </div>
      )}
    </div>
  )
}

/* ── Main Panel ──────────────────────────────────────────── */
export default function PolymarketFinancePanel() {
  const [tab, setTab] = useState<'stocks' | 'trending'>('stocks')

  const { data, isLoading } = useQuery<PolymarketFinanceData>({
    queryKey: ['polymarket-finance'],
    queryFn: fetchPolymarketFinance,
    refetchInterval: 120_000,
    staleTime: 60_000,
  })

  const items = tab === 'stocks'
    ? (data?.stocks || [])
    : (data?.trending || []).concat(data?.macro || [])

  return (
    <div className="hud-panel flex flex-col overflow-hidden bg-slate-950/95 border border-slate-800/70 rounded-xl max-h-[42rem]">
      <div className="px-4 py-2.5 border-b border-slate-800/70 bg-gradient-to-r from-slate-950 via-slate-900/80 to-slate-950 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-200 font-mono">
            PREDICTIONS
          </span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[8px] text-emerald-400 font-bold">
            <Activity className="w-2.5 h-2.5" /> LIVE
          </span>
        </div>
        <span className="text-[9px] text-slate-600 font-mono">Polymarket</span>
      </div>

      <div className="flex border-b border-slate-800/50">
        <button
          onClick={() => setTab('stocks')}
          className={`flex-1 px-3 py-2 text-[11px] font-medium transition-all flex items-center justify-center gap-1.5 ${
            tab === 'stocks'
              ? 'bg-sky-500/10 text-sky-400 border-b-2 border-sky-500'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <TrendingUp className="w-3 h-3" /> Stocks & Finance
        </button>
        <button
          onClick={() => setTab('trending')}
          className={`flex-1 px-3 py-2 text-[11px] font-medium transition-all flex items-center justify-center gap-1.5 ${
            tab === 'trending'
              ? 'bg-orange-500/10 text-orange-400 border-b-2 border-orange-500'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <Flame className="w-3 h-3" /> Trending Predictions
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-800/30">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 bg-slate-800/50 rounded animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center p-8 text-xs text-slate-500">
            No predictions found
          </div>
        ) : items.map((item, i) => (
          <PredictionCard key={`${tab}-${i}`} item={item} />
        ))}
      </div>
    </div>
  )
}
