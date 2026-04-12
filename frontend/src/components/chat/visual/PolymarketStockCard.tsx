'use client'

import { useQuery } from '@tanstack/react-query'
import { Sparkles, ExternalLink, Activity, TrendingUp } from 'lucide-react'
import {
  fetchPolymarketStockEvents,
  type PolymarketStockEvent,
} from '@/lib/monitor-extended-api'

interface PolymarketOutcome {
  name: string
  price: number
}

interface Props {
  symbol: string
  companyName?: string
}

function ProbabilityBar({ probability, label }: { probability: number; label: string }) {
  const pct = Math.round(probability * 100)
  const isHigh = pct >= 65
  const isMid = pct >= 35 && pct < 65
  const barColor = isHigh
    ? 'from-emerald-500 to-emerald-400'
    : isMid
    ? 'from-amber-500 to-amber-400'
    : 'from-red-500 to-red-400'
  const textColor = isHigh ? 'text-emerald-400' : isMid ? 'text-amber-400' : 'text-red-400'

  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-slate-500 w-6 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${barColor} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-[10px] font-mono font-bold ${textColor} w-8 text-right`}>
        {pct}%
      </span>
    </div>
  )
}

export default function PolymarketStockCard({ symbol, companyName }: Props) {
  const { data: events = [], isLoading } = useQuery<PolymarketStockEvent[]>({
    queryKey: ['polymarket-stock', symbol, companyName ?? ''],
    queryFn: () => fetchPolymarketStockEvents(symbol, companyName),
    staleTime: 5 * 60_000,
    refetchInterval: 2 * 60_000,
    enabled: !!symbol,
  })

  // Check which events are specific to this symbol vs fallback
  const symLower = symbol.toLowerCase()
  const companyLower = companyName?.split(' ')[0]?.toLowerCase() ?? ''

  if (isLoading) {
    return (
      <div className="bg-[#0D1117] border border-slate-700/50 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-bold text-white">Prediction Markets</span>
        </div>
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-14 bg-slate-800/40 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (!events.length) {
    return (
      <div className="bg-[#0D1117] border border-slate-700/50 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-bold text-white">Prediction Markets</span>
          <span className="text-[9px] text-slate-600 ml-auto">Polymarket</span>
        </div>
        <p className="text-[10px] text-slate-500">
          No active prediction markets for {symbol}
        </p>
      </div>
    )
  }

  // Separate matched vs fallback
  const isSymbolMatch = (ev: PolymarketStockEvent) => {
    const title = (ev.question || ev.title || '').toLowerCase()
    const slug = (ev.slug || '').toLowerCase()
    const haystack = `${title} ${slug}`
    return haystack.includes(symLower) || (companyLower.length > 2 && haystack.includes(companyLower))
  }

  const matched = events.filter(isSymbolMatch)
  const fallback = events.filter((e) => !isSymbolMatch(e))

  return (
    <div className="bg-[#0D1117] border border-slate-700/50 rounded-xl p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 rounded-md bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
          <Sparkles className="w-3 h-3 text-amber-400" />
        </div>
        <span className="text-xs font-bold text-white">
          {matched.length > 0 ? `${symbol} Prediction Markets` : 'Stock Prediction Markets'}
        </span>
        <span className="inline-flex items-center gap-1 ml-auto text-[9px] text-slate-500 bg-slate-800/60 px-1.5 py-0.5 rounded-full border border-slate-700/40">
          <Activity className="w-2.5 h-2.5 text-emerald-400" />
          Polymarket
        </span>
      </div>

      {/* Matched events for this symbol */}
      {matched.length > 0 && (
        <div className="space-y-2">
          {matched.map((ev: PolymarketStockEvent) => (
            <EventCard key={ev.id} ev={ev} highlight />
          ))}
        </div>
      )}

      {/* Fallback / other stock events */}
      {fallback.length > 0 && (
        <>
          {matched.length > 0 && (
            <div className="flex items-center gap-2 mt-3 mb-2">
              <div className="flex-1 h-px bg-slate-800" />
              <span className="text-[9px] text-slate-600 flex items-center gap-1">
                <TrendingUp className="w-2.5 h-2.5" />
                Other Active Markets
              </span>
              <div className="flex-1 h-px bg-slate-800" />
            </div>
          )}
          <div className="space-y-2">
            {fallback.map((ev: PolymarketStockEvent) => (
              <EventCard key={ev.id} ev={ev} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function EventCard({ ev, highlight }: { ev: PolymarketStockEvent; highlight?: boolean }) {
  const question = ev.question || ev.title || 'Unknown event'
  const market = ev.markets?.[0]
  const outcomes = market?.outcomes || []
  const yesOutcome = outcomes.find((o) => o.name === 'Yes') || outcomes[0]
  const noOutcome = outcomes.find((o) => o.name === 'No') || outcomes[1]
  const vol = market?.volume_24hr
  const volStr = vol
    ? vol >= 1_000_000
      ? `$${(vol / 1_000_000).toFixed(1)}M`
      : vol >= 1_000
      ? `$${(vol / 1_000).toFixed(0)}K`
      : `$${vol.toFixed(0)}`
    : null
  const polyUrl = ev.slug
    ? `https://polymarket.com/event/${ev.slug}`
    : undefined

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 hover:border-amber-500/25 transition-colors group ${
        highlight
          ? 'border-amber-500/20 bg-amber-500/[0.03]'
          : 'border-slate-800/80 bg-[#080C14]'
      }`}
    >
      {/* Question */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-[11px] font-medium text-slate-200 leading-snug line-clamp-2 flex-1">
          {question}
        </p>
        {polyUrl && (
          <a
            href={polyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 p-1 rounded hover:bg-slate-800 text-slate-600 hover:text-amber-400 transition-colors opacity-0 group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {/* Probability bars */}
      {yesOutcome && (
        <ProbabilityBar
          probability={typeof yesOutcome.price === 'number' ? yesOutcome.price : 0}
          label="Yes"
        />
      )}
      {noOutcome && (
        <ProbabilityBar
          probability={typeof noOutcome.price === 'number' ? noOutcome.price : 0}
          label="No"
        />
      )}

      {/* Volume */}
      {volStr && (
        <div className="flex items-center justify-between mt-1.5 text-[9px]">
          <span className="text-slate-600">24h Volume</span>
          <span className="font-mono text-slate-400">{volStr}</span>
        </div>
      )}
    </div>
  )
}
