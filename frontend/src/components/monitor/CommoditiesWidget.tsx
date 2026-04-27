'use client'

import { useQuery } from '@tanstack/react-query'
import { TrendingUp, TrendingDown, Minus, BarChart2 } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

interface CommodityQuote {
  name: string
  symbol: string
  group?: string
  price: string
  change: string
  change_pct: string
  direction: string
}

async function fetchCommodities(): Promise<CommodityQuote[]> {
  try {
    const res = await fetch(`${API_URL}/api/v1/monitor/commodities`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const items: CommodityQuote[] = data.commodities || []
    if (items.length > 0) return items
  } catch (err) {
    console.warn('Commodities fetch failed:', err)
  }

  // Fallback static snapshot
  return [
    { name: 'VIX', symbol: 'VIX', group: 'macro', price: '--', change: '--', change_pct: '', direction: 'flat' },
    { name: 'Gold', symbol: 'XAUUSD', group: 'commodities', price: '--', change: '--', change_pct: '', direction: 'flat' },
    { name: 'Crude Oil', symbol: 'CL', group: 'commodities', price: '--', change: '--', change_pct: '', direction: 'flat' },
    { name: 'Nat Gas', symbol: 'NG', group: 'commodities', price: '--', change: '--', change_pct: '', direction: 'flat' },
    { name: 'DXY', symbol: 'DXY', group: 'forex', price: '--', change: '--', change_pct: '', direction: 'flat' },
    { name: 'Bitcoin', symbol: 'BTC', group: 'crypto', price: '--', change: '--', change_pct: '', direction: 'flat' },
  ]
}

export default function CommoditiesWidget() {
  const { data: commodities, isLoading } = useQuery({
    queryKey: ['commodities-widget'],
    queryFn: fetchCommodities,
    refetchInterval: 120_000,
    staleTime: 60_000,
  })

  return (
    <div className="hud-panel bg-surface-base/95 border border-line-subtle rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-line-subtle bg-surface-raised/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-fg-primary font-mono">
            COMMODITIES & VOLATILITY
          </span>
        </div>
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[8px] text-emerald-400 font-bold">
          LIVE
        </span>
      </div>

      {isLoading ? (
        <div className="p-3 space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-8 bg-surface-hover rounded animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="divide-y divide-line-subtle">
          {(commodities || []).slice(0, 10).map((c) => (
            <div key={c.symbol} className="flex items-center justify-between px-4 py-2.5 hover:bg-surface-hover transition-colors">
              <div className="flex items-center gap-2.5">
                {c.direction === 'up' ? (
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                ) : c.direction === 'down' ? (
                  <TrendingDown className="w-3.5 h-3.5 text-red-400" />
                ) : (
                  <Minus className="w-3.5 h-3.5 text-fg-muted" />
                )}
                <div>
                  <span className="text-[11px] font-medium text-fg-primary">{c.name}</span>
                  <span className="text-[9px] text-fg-muted ml-1.5 font-mono">{c.symbol}</span>
                  {c.group && (
                    <span className="ml-1.5 text-[8px] uppercase tracking-wider text-fg-muted">{c.group}</span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[12px] font-mono font-bold text-fg-primary">{c.price}</div>
                {c.change && c.change !== '--' && (
                  <div className={`text-[9px] font-mono ${
                    c.direction === 'up' ? 'text-emerald-400' : c.direction === 'down' ? 'text-red-400' : 'text-fg-muted'
                  }`}>
                    {c.change}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
