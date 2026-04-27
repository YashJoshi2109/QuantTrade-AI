'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BarChart3, Globe } from 'lucide-react'
import MobileSymbolSearch from '@/components/ui/mobile-symbol-search'
import { Continent } from '@/lib/world-exchanges'
import {
  ContinentTabBar,
  CurrencySelector,
  WorldIndicesGrid,
  ExchangeUniverseSection,
  ExchangeSectorHeatmap,
  useCurrencyRates,
} from '@/app/markets/page'
import MarketHeatmap from '@/components/MarketHeatmap'
import { useQuery } from '@tanstack/react-query'
import { fetchSectorPerformance } from '@/lib/api'
import { useExchangeHeatmap } from '@/hooks/useExchangeHeatmap'

function MarketPulse({ continent }: { continent: Continent }) {
  const { data, isLoading } = useExchangeHeatmap(continent)
  
  if (isLoading) {
    return <div className="h-20 rounded-xl bg-surface-raised/40 animate-pulse border border-line-subtle" />
  }

  const sectors = data?.sectors ?? []
  let gainers = 0, losers = 0, flat = 0, total = 0
  
  sectors.forEach(s => {
    s.stocks.forEach(stock => {
      total++
      if (stock.change_percent > 0) gainers++
      else if (stock.change_percent < 0) losers++
      else flat++
    })
  })

  if (total === 0) return null

  const gainPct = (gainers / total) * 100
  const lossPct = (losers / total) * 100
  const flatPct = (flat / total) * 100

  return (
    <div className="rounded-2xl bg-surface-raised backdrop-blur-md border border-line-subtle p-4 shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold text-fg-secondary uppercase tracking-widest flex items-center gap-1.5">
          <BarChart3 className="w-3.5 h-3.5 text-[#00D9FF]" />
          Market Pulse
        </h3>
        <span className="text-[10px] text-fg-muted font-mono bg-black/20 px-2 py-0.5 rounded-md">
          {total} tracked
        </span>
      </div>
      
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="text-center bg-emerald-500/10 border border-emerald-500/20 rounded-lg py-1.5">
          <div className="text-sm font-bold text-emerald-400">{gainers}</div>
          <div className="text-[9px] text-emerald-500/70 uppercase">Advancing</div>
        </div>
        <div className="text-center bg-red-500/10 border border-red-500/20 rounded-lg py-1.5">
          <div className="text-sm font-bold text-red-400">{losers}</div>
          <div className="text-[9px] text-red-500/70 uppercase">Declining</div>
        </div>
        <div className="text-center bg-surface-raised border border-line-subtle rounded-lg py-1.5">
          <div className="text-sm font-bold text-fg-secondary">{flat}</div>
          <div className="text-[9px] text-fg-muted/70 uppercase">Unchanged</div>
        </div>
      </div>

      <div className="flex h-2 rounded-full overflow-hidden bg-surface-raised shadow-inner">
        <div className="bg-emerald-500 transition-all duration-1000" style={{ width: `${gainPct}%` }} />
        <div className="bg-surface-raised transition-all duration-1000" style={{ width: `${flatPct}%` }} />
        <div className="bg-red-500 transition-all duration-1000" style={{ width: `${lossPct}%` }} />
      </div>
    </div>
  )
}

export default function MobileMarkets() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [activeContinent, setActiveContinent] = useState<Continent>('global')
  const [displayCurrency, setDisplayCurrency] = useState('USD')
  const { data: currencyRates = {} } = useCurrencyRates()

  const { data: usSectors } = useQuery({
    queryKey: ['sectorPerformance'],
    queryFn: () => fetchSectorPerformance(),
    refetchInterval: 120000,
    staleTime: 60000,
  })

  return (
    <div className="flex flex-col min-h-screen bg-surface-base pb-24">
      {/* ── Header ── */}
      <header className="sticky top-0 z-30 bg-surface-base/95 backdrop-blur-xl border-b border-line-subtle pt-safe px-4 py-3 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border border-emerald-500/20 flex items-center justify-center">
              <Globe className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-base font-bold text-fg-primary leading-tight">Global Markets</h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
                <p className="text-[10px] text-fg-muted font-mono tracking-wider">LIVE FEED</p>
              </div>
            </div>
          </div>
          <CurrencySelector value={displayCurrency} onChange={setDisplayCurrency} />
        </div>

        <MobileSymbolSearch
          value={search}
          onChange={setSearch}
          onSelect={(result) => router.push(`/research?symbol=${encodeURIComponent(result.symbol)}`)}
          placeholder="Search stocks, crypto, forex..."
          uppercase={false}
        />

        {/* Tab Scroller */}
        <div className="mt-3">
          <ContinentTabBar active={activeContinent} onChange={setActiveContinent} />
        </div>
      </header>

      {/* ── Content ── */}
      <main className="flex-1 overflow-y-auto px-4 pt-4 space-y-6">
        
        {/* World Indices */}
        <section>
          <WorldIndicesGrid
            continent={activeContinent}
            currency={displayCurrency}
            rates={currencyRates}
          />
        </section>

        {/* Sector Performance Heatmap */}
        <section>
          {activeContinent === 'global' ? (
            <div className="bg-surface-raised backdrop-blur-md border border-line-subtle rounded-2xl p-4 shadow-lg">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="w-5 h-5 text-blue-400" />
                <h2 className="text-base font-bold text-fg-primary">1-Day Performance Map</h2>
              </div>
              <MarketHeatmap sectors={usSectors} />
            </div>
          ) : (
            <ExchangeSectorHeatmap continent={activeContinent} />
          )}
        </section>

        {/* Market Pulse */}
        <section>
          <MarketPulse continent={activeContinent} />
        </section>

        {/* Ranked Universe */}
        {activeContinent !== 'global' && (
          <section>
            <ExchangeUniverseSection continent={activeContinent} />
          </section>
        )}
        
      </main>
    </div>
  )
}
