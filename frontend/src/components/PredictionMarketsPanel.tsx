'use client'

import { useQuery } from '@tanstack/react-query'
import { Sparkles, Activity, AlertTriangle } from 'lucide-react'
import { fetchPolymarketBrowseTiles } from '@/lib/monitor-extended-api'

interface PolymarketEvent {
  id: string
  question: string
  probability?: number
  volume_24hr?: number
}

async function fetchPolymarketEvents(): Promise<PolymarketEvent[]> {
  try {
    const tiles = await fetchPolymarketBrowseTiles(10)
    return tiles.slice(0, 6).map((t) => ({
      id: t.id,
      question: t.question,
      probability: typeof t.yes_price === 'number' ? t.yes_price : undefined,
      volume_24hr: typeof t.volume_24h === 'number' ? t.volume_24h : undefined,
    }))
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
      <div className="flex items-center justify-between border-b border-line-subtle/70 bg-gradient-to-r from-[#050814] via-[#07101f] to-[#050814] px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 border border-amber-400/40 shadow-[0_0_18px_rgba(251,191,36,0.35)]">
            <Sparkles className="h-4 w-4 text-amber-300" />
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-100">
              Prediction Markets
            </span>
            <span className="text-[10px] text-fg-muted">
              Powered by Polymarket&nbsp;&middot;&nbsp;Top macro contracts
            </span>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-surface-base border border-line-subtle px-2 py-0.5 text-[10px] text-fg-muted">
          <Activity className="w-3 h-3 text-emerald-400" />
          Live
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-surface-base px-3 py-3 space-y-2">
        {isLoading && !events.length && (
          <div className="flex items-center justify-center py-8 text-xs text-fg-muted">
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
                className="rounded-lg border border-line-subtle bg-surface-base px-3 py-2.5 hover:border-amber-400/40 hover:bg-surface-base transition-colors"
              >
                <p className="text-[11px] font-medium text-slate-200 leading-snug line-clamp-2">
                  {ev.question}
                </p>
                <div className="mt-2 flex items-center justify-between text-[10px]">
                  <div className="flex items-center gap-1.5">
                    <span className="text-fg-muted">Yes Prob.</span>
                    <span className="font-mono text-emerald-300">
                      {prob !== null ? `${prob}%` : '—'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-fg-muted">
                    <span className="w-1.5 h-1.5 rounded-full bg-fg-muted" />
                    <span>Vol 24h</span>
                    <span className="font-mono text-fg-secondary">{vol ?? '—'}</span>
                  </div>
                </div>
              </div>
            )
          })}

        {!isLoading && !events.length && !isError && (
          <div className="flex items-center justify-center py-6 text-[11px] text-fg-muted">
            No active prediction events found.
          </div>
        )}
      </div>
    </div>
  )
}

