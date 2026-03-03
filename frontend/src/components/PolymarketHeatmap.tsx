'use client'

import { useQuery } from '@tanstack/react-query'
import { BarChart3, Activity, AlertTriangle } from 'lucide-react'

interface PolymarketTile {
  id: string
  question: string
  yesPercent: number | null
  volume24h: number | null
}

async function fetchPolymarketForHeatmap(): Promise<PolymarketTile[]> {
  try {
    const url =
      'https://gamma-api.polymarket.com/events?active=true&closed=false&order=volume_24hr&ascending=false&limit=24'
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`Polymarket HTTP ${res.status}`)
    const data = await res.json()
    const events: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []

    return events.slice(0, 20).map((ev) => {
      const firstMarket = (ev.markets && ev.markets[0]) || {}
      const outcomes: any[] = Array.isArray(firstMarket.outcomes) ? firstMarket.outcomes : []
      const yesOutcome = outcomes.find((o: any) => String(o.name).toLowerCase() === 'yes') || outcomes[0]
      const yesPrice = typeof yesOutcome?.price === 'number' ? yesOutcome.price : 0
      const vol = typeof ev.volume_24hr === 'number' ? ev.volume_24hr : null
      return {
        id: String(ev.id ?? ev.slug ?? ev.question),
        question: String(ev.question ?? ev.title ?? 'Market').slice(0, 60),
        yesPercent: yesPrice > 0 ? Math.round(yesPrice * 100) : null,
        volume24h: vol,
      }
    })
  } catch (err) {
    console.error('Polymarket heatmap fetch failed', err)
    return []
  }
}

function getTileColor(yesPercent: number | null): string {
  if (yesPercent === null) return 'bg-slate-700/80 border-slate-600/60'
  if (yesPercent >= 70) return 'bg-emerald-600/90 border-emerald-500/50'
  if (yesPercent >= 50) return 'bg-emerald-500/70 border-emerald-400/40'
  if (yesPercent >= 30) return 'bg-amber-500/70 border-amber-400/40'
  if (yesPercent >= 10) return 'bg-orange-500/70 border-orange-400/40'
  return 'bg-red-500/70 border-red-400/40'
}

export default function PolymarketHeatmap() {
  const { data: tiles = [], isLoading, isError } = useQuery<PolymarketTile[]>({
    queryKey: ['polymarket-heatmap'],
    queryFn: fetchPolymarketForHeatmap,
    refetchInterval: 120_000,
    staleTime: 60_000,
  })

  return (
    <div className="hud-panel flex flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-800/70 bg-gradient-to-r from-[#050814] via-[#07101f] to-[#050814] px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 border border-violet-400/40">
            <BarChart3 className="h-4 w-4 text-violet-300" />
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-100">
              Polymarket Heatmap
            </span>
            <span className="text-[10px] text-slate-500">
              Yes % by contract · volume order · gamma-api.polymarket.com
            </span>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-900/80 border border-slate-700/60 px-2 py-0.5 text-[10px] text-slate-400">
          <Activity className="w-3 h-3 text-emerald-400" />
          Live
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {isLoading && !tiles.length && (
          <div className="flex items-center justify-center py-8 text-xs text-slate-500">
            Loading Polymarket heatmap…
          </div>
        )}
        {isError && !tiles.length && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
            <AlertTriangle className="w-3 h-3" />
            Heatmap temporarily unavailable.
          </div>
        )}

        {tiles.length > 0 && (
          <>
            <div className="flex items-center justify-center gap-2 mb-2 text-[10px] text-slate-500">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500/70" /> Low Yes</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-500/70" /> ~50%</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500/70" /> High Yes</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {tiles.map((t) => (
                <div
                  key={t.id}
                  className={`rounded-lg border p-2.5 transition-all hover:brightness-110 ${getTileColor(t.yesPercent)}`}
                >
                  <p className="text-[10px] font-medium text-slate-100 leading-tight line-clamp-2">
                    {t.question}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between text-[10px]">
                    <span className="font-mono text-white/90">
                      {t.yesPercent !== null ? `Yes ${t.yesPercent}%` : '—'}
                    </span>
                    <span className="text-white/70">
                      {t.volume24h != null
                        ? t.volume24h >= 1_000_000
                          ? `$${(t.volume24h / 1_000_000).toFixed(1)}M`
                          : t.volume24h >= 1_000
                            ? `$${(t.volume24h / 1_000).toFixed(0)}k`
                            : `$${t.volume24h.toFixed(0)}`
                        : '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {!isLoading && !tiles.length && !isError && (
          <div className="flex items-center justify-center py-6 text-[11px] text-slate-500">
            No active markets for heatmap.
          </div>
        )}
      </div>
    </div>
  )
}
