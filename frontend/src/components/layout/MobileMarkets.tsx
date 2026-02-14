'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Search as SearchIcon, TrendingUp, TrendingDown, Activity } from 'lucide-react'
import {
  fetchMarketMovers,
  fetchSectorPerformance,
  fetchMarketIndices,
  MarketMovers,
  StockPerformance,
  SectorPerformance,
  MarketIndex,
} from '@/lib/api'
import { formatNumber, formatPercent, isNumber } from '@/lib/format'
import LiveNews from '@/components/LiveNews'
import MarketHeatmap from '@/components/MarketHeatmap'
import MarketMoversPanel from '@/components/MarketMoversPanel'

const FILTERS = ['All Assets', 'Stocks', 'Crypto', 'Forex', 'Commodities', 'ETFs', 'Indices']

export default function MobileMarkets() {
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState('All Assets')
  const [sectorView, setSectorView] = useState<'list' | 'heatmap'>('heatmap')

  const { data: movers, isLoading, refetch: refetchMovers } = useQuery<MarketMovers>({
    // Share cache with desktop markets/home pages
    queryKey: ['marketMovers'],
    queryFn: fetchMarketMovers,
    refetchInterval: 120000,
    staleTime: 60000,
  })

  const { data: sectors } = useQuery<SectorPerformance[]>({
    // Share cache with desktop markets/home pages
    queryKey: ['sectorPerformance'],
    queryFn: fetchSectorPerformance,
    refetchInterval: 120000,
    staleTime: 60000,
  })

  const { data: indices } = useQuery<MarketIndex[]>({
    // Share cache with desktop markets page
    queryKey: ['marketIndices'],
    queryFn: fetchMarketIndices,
    refetchInterval: 60000,
    staleTime: 30000,
  })

  const combined: StockPerformance[] = useMemo(() => {
    if (!movers) return []
    const seen = new Set<string>()
    const all = [...(movers.gainers || []), ...(movers.losers || [])]
    return all.filter((s) => {
      if (!s.symbol) return false
      const key = s.symbol.toUpperCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [movers])

  const filtered = useMemo(() => {
    let list = combined
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(
        (s) =>
          s.symbol.toLowerCase().includes(q) ||
          (s.name || '').toLowerCase().includes(q)
      )
    }
    // Asset-type filters would apply here once backend supports asset metadata
    return list
  }, [combined, search])

  const marketStats = useMemo(() => {
    if (!sectors || sectors.length === 0) {
      return { total: 0, gainers: 0, losers: 0 }
    }
    const total = sectors.reduce((acc, s) => acc + s.stocks.length, 0)
    const gainers = sectors.reduce(
      (acc, s) => acc + s.stocks.filter((st) => st.change_percent > 0).length,
      0
    )
    const losers = sectors.reduce(
      (acc, s) => acc + s.stocks.filter((st) => st.change_percent < 0).length,
      0
    )
    return { total, gainers, losers }
  }, [sectors])

  return (
    <div className="space-y-4 pb-4">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[#0A0E1A]/95 backdrop-blur-xl border-b border-white/10 pt-safe pb-2 px-1">
        <div>
          <h1 className="text-xl font-semibold text-white">Markets</h1>
          <p className="text-[11px] text-slate-400">
            Real-time movers across the U.S. market.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[#00D9FF]" />
          <span className="text-[10px] text-slate-400">Live</span>
        </div>
      </header>

      {/* Search */}
      <section className="px-1">
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search stocks, crypto, forex..."
            className="w-full h-10 rounded-full bg-[#1A2332] border border-white/10 pl-9 pr-9 text-[13px] text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-[#00D9FF]/60"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"
            >
              ✕
            </button>
          )}
        </div>
      </section>

      {/* Quick stats */}
      <section className="px-1">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-[#1A2332]/90 border border-white/10 p-2.5">
            <p className="text-[10px] text-slate-400 mb-0.5">Tracked</p>
            <p className="text-[14px] font-semibold text-white">
              {marketStats.total}
            </p>
          </div>
          <div className="rounded-xl bg-[#1A2332]/90 border border-emerald-500/30 p-2.5">
            <p className="text-[10px] text-slate-400 mb-0.5">Gainers</p>
            <p className="text-[14px] font-semibold text-emerald-400">
              {marketStats.gainers}
            </p>
          </div>
          <div className="rounded-xl bg-[#1A2332]/90 border border-red-500/30 p-2.5">
            <p className="text-[10px] text-slate-400 mb-0.5">Losers</p>
            <p className="text-[14px] font-semibold text-red-400">
              {marketStats.losers}
            </p>
          </div>
        </div>
      </section>

      {/* Indices */}
      <section className="px-1">
        <div className="flex overflow-x-auto scrollbar-hide gap-2">
          {(indices || []).slice(0, 4).map((idx) => {
            const up = isNumber(idx.change_percent) && idx.change_percent >= 0
            return (
              <div
                key={idx.symbol}
                className="shrink-0 w-[160px] rounded-2xl bg-[#1A2332]/90 border border-white/10 p-3"
              >
                <p className="text-[10px] text-slate-500">{idx.name}</p>
                <p className="text-[16px] font-mono text-white mt-1">
                  {isNumber(idx.price) ? formatNumber(idx.price, 2) : '—'}
                </p>
                <p className={`text-[11px] font-mono mt-1 ${up ? 'text-emerald-400' : 'text-red-400'}`}>
                  {up ? '+' : ''}
                  {formatPercent(idx.change_percent, 2)}
                </p>
              </div>
            )
          })}
          {(!indices || indices.length === 0) && (
            <div className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-3 text-[11px] text-slate-500">
              Indices unavailable right now.
            </div>
          )}
        </div>
      </section>

      {/* Sector performance (top) */}
      <section className="px-1">
        <div className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[12px] font-semibold text-white">Top Sectors</p>
            <div className="flex items-center gap-1 text-[10px]">
              <button
                type="button"
                onClick={() => setSectorView('list')}
                className={`px-2 py-1 rounded-full border ${
                  sectorView === 'list'
                    ? 'bg-[#00D9FF]/10 text-[#00D9FF] border-[#00D9FF]/40'
                    : 'bg-[#0A0E1A] text-slate-400 border-white/10'
                }`}
              >
                List
              </button>
              <button
                type="button"
                onClick={() => setSectorView('heatmap')}
                className={`px-2 py-1 rounded-full border ${
                  sectorView === 'heatmap'
                    ? 'bg-[#00D9FF]/10 text-[#00D9FF] border-[#00D9FF]/40'
                    : 'bg-[#0A0E1A] text-slate-400 border-white/10'
                }`}
              >
                Heatmap
              </button>
            </div>
          </div>
          {sectorView === 'list' ? (
            <div className="space-y-2">
              {(sectors || []).slice(0, 5).map((s) => {
                const up = s.change_percent >= 0
                return (
                  <div key={s.sector} className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-300">{s.sector}</span>
                    <span className={`text-[11px] font-mono ${up ? 'text-emerald-400' : 'text-red-400'}`}>
                      {up ? '+' : ''}
                      {formatPercent(s.change_percent, 2)}
                    </span>
                  </div>
                )
              })}
              {(!sectors || sectors.length === 0) && (
                <p className="text-[11px] text-slate-500">Sector data unavailable.</p>
              )}
            </div>
          ) : (
            <div className="mt-2">
              <MarketHeatmap sectors={sectors || []} className="text-xs" />
            </div>
          )}
        </div>
      </section>

      {/* Filters */}
      <section className="px-1">
        <div className="flex overflow-x-auto scrollbar-hide gap-2">
          {FILTERS.map((label) => {
            const isActive = activeFilter === label
            return (
              <button
                key={label}
                type="button"
                onClick={() => setActiveFilter(label)}
                className={`px-3 py-1.5 rounded-full text-[11px] border transition-all whitespace-nowrap ${
                  isActive
                    ? 'bg-[#00D9FF]/10 border-[#00D9FF]/60 text-[#00D9FF]'
                    : 'bg-[#1A2332] border-white/5 text-slate-400'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </section>

      {/* Combined movers list */}
      <section className="px-1 space-y-2">
        {isLoading && (
          <>
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-16 rounded-xl bg-[#1A2332]/80 border border-white/5 animate-pulse"
              />
            ))}
          </>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="h-32 rounded-2xl border border-dashed border-slate-700 flex flex-col items-center justify-center text-[13px] text-slate-400">
            <p>No stocks found</p>
            <p className="text-[11px] text-slate-500 mt-1">
              Try a different symbol or company name.
            </p>
          </div>
        )}
        {!isLoading &&
          filtered.map((stock) => {
            const pct = stock.change_percent
            const isUp = isNumber(pct) && pct >= 0
            const initials = stock.symbol.slice(0, 2).toUpperCase()
            return (
              <Link
                key={stock.symbol}
                href={`/research?symbol=${encodeURIComponent(stock.symbol)}`}
                className="block rounded-xl bg-[#1A2332]/90 border border-white/5 p-3 flex items-center justify-between active:scale-[0.98] transition-transform"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-slate-900 flex items-center justify-center text-[11px] font-semibold text-slate-200">
                    {initials}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-white">
                      {stock.symbol}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate max-w-[150px]">
                      {stock.name || '—'}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[13px] font-mono text-white">
                    {isNumber(stock.price)
                      ? `$${formatNumber(stock.price, 2)}`
                      : '—'}
                  </span>
                  <span
                    className={`mt-1 inline-flex items-center gap-1 text-[11px] font-mono ${
                      isUp ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {isUp ? (
                      <TrendingUp className="w-3 h-3" />
                    ) : (
                      <TrendingDown className="w-3 h-3" />
                    )}
                    {isUp ? '+' : ''}
                    {formatPercent(pct, 2)}
                  </span>
                </div>
              </Link>
            )
          })}
      </section>

      {/* Market Movers Panel – expanded for mobile */}
      <section className="px-1">
        <MarketMoversPanel
          gainers={movers?.gainers?.slice(0, 10) || []}
          losers={movers?.losers?.slice(0, 10) || []}
          loading={isLoading}
          onRefresh={() => refetchMovers()}
        />
      </section>

      {/* Live market news (compact) */}
      <section className="px-1 pb-4">
        <div className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-3">
          <p className="text-[12px] font-semibold text-white mb-2">Live Market News</p>
          <LiveNews limit={8} showTitle={false} />
        </div>
      </section>
    </div>
  )
}

