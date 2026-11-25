'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp, Activity, Flame } from 'lucide-react'
import SourceUnavailableNotice from '@/components/monitor/SourceUnavailableNotice'
import { fetchPolymarketFinance, type PolymarketFinanceData, type PolymarketFinanceItem } from '@/lib/monitor-extended-api'
import { PredictionMarketCard } from '@/components/ui/prediction-market-card'

/* ── Render item: native card from backend prices ──────────
 * The embed.polymarket.com iframe rendered blank (panel showed headers only),
 * so every item is drawn from the API's parsed outcomePrices instead. */
function PredictionItem({ item, index }: { item: PolymarketFinanceItem; index: number }) {
  return (
    <PredictionMarketCard
      question={item.question}
      outcomes={item.outcomes}
      yesPrice={item.yes_price}
      noPrice={item.no_price}
      volume={item.volume}
      slug={item.slug}
      category={item.category}
      delay={Math.min(index, 6) * 0.05}
    />
  )
}

/* ── Main Panel ──────────────────────────────────────────── */
export default function PolymarketFinancePanel() {
  const [tab, setTab] = useState<'stocks' | 'trending'>('stocks')

  const { data, isLoading, isError } = useQuery<PolymarketFinanceData>({
    queryKey: ['polymarket-finance'],
    queryFn: fetchPolymarketFinance,
    refetchInterval: 120_000,
    staleTime: 60_000,
  })

  const items = tab === 'stocks'
    ? (data?.stocks || [])
    : (data?.trending || []).concat(data?.macro || [])

  return (
    <div className="hud-panel flex flex-col overflow-hidden bg-surface-base/95 border border-line-subtle rounded-xl max-h-[42rem]">
      <div className="px-4 py-2.5 border-b border-line-subtle bg-surface-raised/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-fg-primary font-mono">
            PREDICTIONS
          </span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[8px] text-emerald-400 font-bold">
            <Activity className="w-2.5 h-2.5" /> LIVE
          </span>
        </div>
        <span className="text-[9px] text-fg-muted font-mono">Polymarket</span>
      </div>

      <div className="flex border-b border-line-subtle">
        <button
          type="button"
          aria-pressed={tab === 'stocks'}
          onClick={() => setTab('stocks')}
          className={`flex-1 px-3 py-2 text-[11px] font-medium transition-all flex items-center justify-center gap-1.5 ${
            tab === 'stocks'
              ? 'bg-sky-500/10 text-sky-400 border-b-2 border-sky-500'
              : 'text-fg-muted hover:text-fg-secondary'
          }`}
        >
          <TrendingUp className="w-3 h-3" /> Stocks & Finance
        </button>
        <button
          type="button"
          aria-pressed={tab === 'trending'}
          onClick={() => setTab('trending')}
          className={`flex-1 px-3 py-2 text-[11px] font-medium transition-all flex items-center justify-center gap-1.5 ${
            tab === 'trending'
              ? 'bg-orange-500/10 text-orange-400 border-b-2 border-orange-500'
              : 'text-fg-muted hover:text-fg-secondary'
          }`}
        >
          <Flame className="w-3 h-3" /> Trending Predictions
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-28 bg-surface-hover rounded-lg animate-pulse" />
            ))}
          </div>
        ) : isError || (data && !data.stocks?.length && !data.trending?.length && !data.macro?.length) ? (
          <SourceUnavailableNotice detail="Polymarket did not return markets. Retrying every 2 minutes." />
        ) : items.length === 0 ? (
          <div role="status" className="flex items-center justify-center p-8 text-xs text-fg-muted">
            No {tab === 'stocks' ? 'stock & finance' : 'trending'} markets right now. Try the other tab.
          </div>
        ) : items.map((item, i) => (
          <PredictionItem key={`${tab}-${i}`} item={item} index={i} />
        ))}
      </div>
    </div>
  )
}
