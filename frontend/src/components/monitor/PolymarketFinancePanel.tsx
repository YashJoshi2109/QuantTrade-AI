'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp, Activity, Flame } from 'lucide-react'
import { fetchPolymarketFinance, type PolymarketFinanceData, type PolymarketFinanceItem } from '@/lib/monitor-extended-api'
import { PredictionMarketCard } from '@/components/ui/prediction-market-card'

/* ── Live Polymarket embed iframe ────────────────────────── */
function PolymarketEmbed({ slug }: { slug: string }) {
  return (
    <div className="relative rounded-lg overflow-hidden border border-slate-800/40 bg-slate-950/60">
      <iframe
        title={`Polymarket — ${slug}`}
        src={`https://embed.polymarket.com/market?event=${encodeURIComponent(slug)}&rotate=true&theme=dark&liveactivity=true&height=280`}
        width="100%"
        height={280}
        frameBorder="0"
        allowTransparency
        className="block w-full"
        loading="lazy"
      />
      <a
        href={`https://polymarket.com/event/${slug}`}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute top-3 right-4 w-[100px] h-[22px] z-10"
        aria-label="View on Polymarket"
      />
    </div>
  )
}

/* ── Render item: live embed if slug exists, else fallback card ── */
function PredictionItem({ item, index }: { item: PolymarketFinanceItem; index: number }) {
  if (item.slug) {
    return <PolymarketEmbed slug={item.slug} />
  }
  return (
    <PredictionMarketCard
      question={item.question}
      outcomes={item.outcomes}
      yesPrice={item.yes_price}
      noPrice={item.no_price}
      volume={item.volume}
      slug={item.slug}
      category={item.category}
      delay={index * 0.05}
    />
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

      <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-[280px] bg-slate-800/50 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center p-8 text-xs text-slate-500">
            No predictions found
          </div>
        ) : items.map((item, i) => (
          <PredictionItem key={`${tab}-${i}`} item={item} index={i} />
        ))}
      </div>
    </div>
  )
}
