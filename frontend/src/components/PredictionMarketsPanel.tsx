'use client'

import { useQuery } from '@tanstack/react-query'
import { Sparkles, Activity, AlertTriangle } from 'lucide-react'

interface PolymarketEvent {
  id: string
  question: string
  probability?: number
  volume_24hr?: number
  markets?: {
    outcomes?: {
      name?: string
      price?: number
    }[]
  }[]
}

async function fetchPolymarketEvents(): Promise<PolymarketEvent[]> {
  try {
    const url =
      'https://gamma-api.polymarket.com/events?active=true&closed=false&order=volume_24hr&ascending=false&limit=10'
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    })
    if (!res.ok) {
      throw new Error(`Polymarket HTTP ${res.status}`)
    }
    const data = await res.json()
    const events: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []

    return events.slice(0, 6).map((ev) => {
      const firstMarket = (ev.markets && ev.markets[0]) || {}
      const outcomes: any[] = Array.isArray(firstMarket.outcomes) ? firstMarket.outcomes : []
      // Pick the highest priced outcome as the "market view"
      const bestOutcome = outcomes.reduce(
        (best, cur) => {
          const price = typeof cur.price === 'number' ? cur.price : best.price
          return price > best.price ? { name: cur.name, price } : best
        },
        { name: 'Yes', price: 0 },
      )

      return {
        id: String(ev.id ?? ev.slug ?? ev.question),
        question: String(ev.question ?? ev.title ?? 'Prediction market'),
        probability: typeof bestOutcome.price === 'number' ? bestOutcome.price : undefined,
        volume_24hr: typeof ev.volume_24hr === 'number' ? ev.volume_24hr : undefined,
      }
    })
  } catch (err) {
    console.error('Polymarket fetch failed', err)
    return []
  }
}

export default function PredictionMarketsPanel() {
  const {
    data: events = [],
    isLoading,
    isError,
  } = useQuery<PolymarketEvent[]>({
    queryKey: ['polymarket-events'],
    queryFn: fetchPolymarketEvents,
    refetchInterval: 120_000,
    staleTime: 60_000,
  })

  return (
    <div className="hud-panel h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800/70 bg-gradient-to-r from-[#050814] via-[#07101f] to-[#050814] px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 border border-amber-400/40 shadow-[0_0_18px_rgba(251,191,36,0.35)]">
            <Sparkles className="h-4 w-4 text-amber-300" />
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-100">
              Prediction Markets
            </span>
            <span className="text-[10px] text-slate-500">
              Powered by Polymarket&nbsp;&middot;&nbsp;Top macro contracts
            </span>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-900/80 border border-slate-700/60 px-2 py-0.5 text-[10px] text-slate-400">
          <Activity className="w-3 h-3 text-emerald-400" />
          Live
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-[#050816]/95 px-3 py-3 space-y-2">
        {isLoading && !events.length && (
          <div className="flex items-center justify-center py-8 text-xs text-slate-500">
            Loading prediction markets…
          </div>
        )}

        {isError && !events.length && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
            <AlertTriangle className="w-3 h-3" />
            <span>Prediction markets temporarily unavailable.</span>
          </div>
        )}

        {!isLoading &&
          events.map((ev) => {
            const prob = typeof ev.probability === 'number' ? Math.round(ev.probability * 100) : null
            const vol =
              typeof ev.volume_24hr === 'number'
                ? ev.volume_24hr >= 1_000_000
                  ? `${(ev.volume_24hr / 1_000_000).toFixed(1)}M`
                  : ev.volume_24hr >= 1_000
                    ? `${(ev.volume_24hr / 1_000).toFixed(0)}k`
                    : `${ev.volume_24hr.toFixed(0)}`
                : null

            return (
              <div
                key={ev.id}
                className="rounded-lg border border-slate-800/80 bg-slate-900/70 px-3 py-2.5 hover:border-amber-400/40 hover:bg-slate-900 transition-colors"
              >
                <p className="text-[11px] font-medium text-slate-200 leading-snug line-clamp-2">
                  {ev.question}
                </p>
                <div className="mt-2 flex items-center justify-between text-[10px]">
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-500">Yes Prob.</span>
                    <span className="font-mono text-emerald-300">
                      {prob !== null ? `${prob}%` : '—'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-500">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                    <span>Vol 24h</span>
                    <span className="font-mono text-slate-300">{vol ?? '—'}</span>
                  </div>
                </div>
              </div>
            )
          })}

        {!isLoading && !events.length && !isError && (
          <div className="flex items-center justify-center py-6 text-[11px] text-slate-500">
            No active prediction events found.
          </div>
        )}
      </div>
    </div>
  )
}

