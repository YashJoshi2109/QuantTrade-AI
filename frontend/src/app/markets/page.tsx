'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import AppLayout from '@/components/AppLayout'
import LiveNews from '@/components/LiveNews'
import MarketHeatmap from '@/components/MarketHeatmap'
import { 
  SkeletonMarketIndices, 
  SkeletonMarketStats, 
  SkeletonHeatmap, 
  SkeletonMoversSection,
  SkeletonNewsFeed 
} from '@/components/Skeleton'
import { 
  TrendingUp, 
  TrendingDown, 
  RefreshCw, 
  Globe, 
  BarChart3,
  Activity,
  Zap,
  Grid3X3,
  List
} from 'lucide-react'
import { fetchSectorPerformance, fetchMarketMovers, fetchMarketIndices, SectorPerformance, StockPerformance, MarketIndex } from '@/lib/api'
import { formatNumber, formatPercent, isNumber } from '@/lib/format'
import Link from 'next/link'

export default function MarketsPage() {
  const [view, setView] = useState<'heatmap' | 'list'>('heatmap')
  
  // Fetch market indices from dedicated endpoint
  const { data: indexData, isLoading: indicesLoading } = useQuery({
    queryKey: ['marketIndices'],
    queryFn: fetchMarketIndices,
    refetchInterval: 30000, // Update every 30 seconds
    staleTime: 15000,
  })
  
  // Fetch sector data with stocks
  const { data: sectors, isLoading: sectorsLoading, refetch: refetchSectors } = useQuery({
    queryKey: ['sectorPerformance'],
    queryFn: fetchSectorPerformance,
    refetchInterval: 30000, // Update every 30 seconds for real-time feel
    staleTime: 15000,
  })

  // Fetch movers
  const { data: movers, isLoading: moversLoading } = useQuery({
    queryKey: ['marketMovers'],
    queryFn: fetchMarketMovers,
    refetchInterval: 30000, // Update every 30 seconds
    staleTime: 15000,
  })

  // Calculate market stats
  const marketStats = {
    totalStocks: sectors?.reduce((acc, s) => acc + s.stocks.length, 0) || 0,
    gainers: sectors?.reduce((acc, s) => acc + s.stocks.filter(st => st.change_percent > 0).length, 0) || 0,
    losers: sectors?.reduce((acc, s) => acc + s.stocks.filter(st => st.change_percent < 0).length, 0) || 0,
  }

  return (
    <AppLayout>
      <div className="min-h-full">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2 sm:gap-3">
              <Globe className="w-6 h-6 sm:w-7 sm:h-7 text-blue-400" />
              Markets Overview
            </h1>
            <p className="text-slate-400 text-xs sm:text-sm mt-1">
              Real-time market data • {marketStats.totalStocks} stocks tracked
            </p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {/* View Toggle */}
            <div className="flex items-center gap-1 p-1 bg-slate-800/50 rounded-lg">
              <button
                onClick={() => setView('heatmap')}
                className={`p-2 rounded-md transition-all ${
                  view === 'heatmap' ? 'bg-blue-500/20 text-blue-400' : 'text-slate-400 hover:text-white'
                }`}
                aria-label="Heatmap view"
              >
                <Grid3X3 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setView('list')}
                className={`p-2 rounded-md transition-all ${
                  view === 'list' ? 'bg-blue-500/20 text-blue-400' : 'text-slate-400 hover:text-white'
                }`}
                aria-label="List view"
              >
                <List className="w-4 h-4" />
              </button>
            </div>
            <button 
              onClick={() => refetchSectors()}
              className="hud-card px-3 sm:px-4 py-2 text-xs sm:text-sm text-blue-400 hover:text-white flex items-center gap-2 transition-all"
              aria-label="Refresh data"
            >
              <RefreshCw className="w-4 h-4" />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>

        {/* Index Cards - Real-time */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {indicesLoading ? (
            <SkeletonMarketIndices />
          ) : indexData && indexData.length > 0 ? (
            indexData.map((index, idx) => {
              const hasValidPrice = isNumber(index.price) && index.price > 0
              const changePositive = isNumber(index.change_percent) ? index.change_percent >= 0 : false
              return (
                <div key={index.symbol || `index-${idx}`} className="hud-panel p-4 relative group">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="text-xs text-slate-500">{index.name}</div>
                    {hasValidPrice && <div className="live-pulse scale-75" />}
                  </div>
                  <div className="text-xl font-bold text-white font-mono">
                    {hasValidPrice
                      ? Number(index.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                      : '—'}
                  </div>
                  {hasValidPrice ? (
                    <div className={`text-sm font-mono flex items-center gap-1 ${
                      changePositive ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {changePositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                      {changePositive ? '+' : ''}{formatPercent(index.change_percent, 2)}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500">Market closed</div>
                  )}
                </div>
              )
            })
          ) : (
            // Fallback to static data if real-time fails
            [
              { name: 'S&P 500', value: 4783.45, change: 0.42 },
              { name: 'NASDAQ', value: 15234.12, change: 0.87 },
              { name: 'DOW JONES', value: 37892.67, change: 0.15 },
              { name: 'RUSSELL 2000', value: 2012.34, change: -0.23 },
            ].map((index, idx) => (
              <div key={idx} className="hud-panel p-4">
                <div className="text-xs text-slate-500 mb-1">{index.name}</div>
                <div className="text-xl font-bold text-white font-mono">
                  {index.value.toLocaleString()}
                </div>
                <div className={`text-sm font-mono flex items-center gap-1 ${
                  index.change >= 0 ? 'text-green-400' : 'text-red-400'
                }`}>
                  {index.change >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  {index.change >= 0 ? '+' : ''}{index.change}%
                </div>
              </div>
            ))
          )}
        </div>

        {/* Market Stats Bar */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <div className="hud-panel p-4 flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400" />
            </div>
            <div>
              <div className="text-lg sm:text-xl font-bold text-white">{marketStats.totalStocks}</div>
              <div className="text-xs text-slate-500">Total Stocks</div>
            </div>
          </div>
          <div className="hud-panel p-4 flex items-center gap-3">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-green-400" />
            </div>
            <div>
              <div className="text-lg sm:text-xl font-bold text-green-400">{marketStats.gainers}</div>
              <div className="text-xs text-slate-500">Gainers</div>
            </div>
          </div>
          <div className="hud-panel p-4 flex items-center gap-3">
            <div className="p-2 bg-red-500/10 rounded-lg">
              <TrendingDown className="w-4 h-4 sm:w-5 sm:h-5 text-red-400" />
            </div>
            <div>
              <div className="text-lg sm:text-xl font-bold text-red-400">{marketStats.losers}</div>
              <div className="text-xs text-slate-500">Losers</div>
            </div>
          </div>
          <div className="hud-panel p-4 flex items-center gap-3">
            <div className="p-2 bg-cyan-500/10 rounded-lg">
              <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-cyan-400" />
            </div>
            <div>
              <div className="text-lg sm:text-xl font-bold text-white">{sectors?.length || 0}</div>
              <div className="text-xs text-slate-500">Sectors</div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
          {/* Heatmap / List Section */}
          <div className="lg:col-span-9">
            <div className="hud-panel p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-blue-400" />
                  <span className="hidden sm:inline">1-Day Performance Map</span>
                  <span className="sm:hidden">Performance</span>
                </h2>
                <div className="flex items-center gap-2">
                  <div className="live-pulse" />
                  <span className="text-xs text-slate-400 ml-2">Real-time</span>
                </div>
              </div>
              
              {sectorsLoading ? (
                <SkeletonHeatmap />
              ) : view === 'heatmap' && sectors ? (
                <MarketHeatmap sectors={sectors} />
              ) : sectors ? (
                /* List View */
                <div className="space-y-4">
                  {sectors.map((sector, sectorIdx) => (
                    <div key={sector.sector || `sector-${sectorIdx}`} className="border border-slate-700/50 rounded-lg overflow-hidden">
                      <div className={`px-4 py-3 flex items-center justify-between ${
                        sector.change_percent >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'
                      }`}>
                          <span className="font-bold text-sm sm:text-base text-white">{sector.sector}</span>
                          <span className={`font-mono font-bold text-sm sm:text-base ${
                          sector.change_percent >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {sector.change_percent >= 0 ? '+' : ''}{formatPercent(sector.change_percent, 2)}
                        </span>
                      </div>
                      <div className="divide-y divide-slate-700/30">
                        {sector.stocks.slice(0, 10).map((stock, stockIdx) => (
                          <Link
                            key={stock.symbol || `${sector.sector}-${stock.name || stockIdx}`}
                            href={`/research?symbol=${stock.symbol}`}
                              className="flex items-center justify-between p-2 sm:p-3 hover:bg-slate-800/30 transition-colors"
                          >
                              <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                                <span className="font-bold text-white text-sm sm:text-base w-12 sm:w-16">{stock.symbol}</span>
                                <span className="text-xs sm:text-sm text-slate-400 truncate">{stock.name}</span>
                            </div>
                              <div className="flex items-center gap-2 sm:gap-6">
                                <span className="text-white font-mono text-sm sm:text-base">
                                {isNumber(stock.price) ? `$${formatNumber(stock.price, 2)}` : 'N/A'}
                              </span>
                              <span className={`font-mono w-20 text-right ${
                                stock.change_percent >= 0 ? 'text-green-400' : 'text-red-400'
                              }`}>
                                {stock.change_percent >= 0 ? '+' : ''}{formatPercent(stock.change_percent, 2)}
                              </span>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-20 text-slate-500">
                  No market data available
                </div>
              )}
            </div>
          </div>

          {/* Sidebar - Top Movers & News */}
          <div className="lg:col-span-3 space-y-4 sm:space-y-6">
            {/* Top Gainers */}
            <div className="hud-panel">
              <div className="p-3 sm:p-4 border-b border-slate-700/30 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-green-400" />
                <h3 className="font-bold text-white text-sm">Top Gainers</h3>
              </div>
              <div className="divide-y divide-slate-700/20">
                {moversLoading ? (
                  <SkeletonMoversSection />
                ) : movers?.gainers?.slice(0, 5).map((stock: StockPerformance, idx: number) => (
                  <Link
                    key={stock.symbol || `gainer-${idx}`}
                    href={`/research?symbol=${stock.symbol}`}
                    className="flex items-center justify-between p-2 sm:p-3 hover:bg-green-500/5 transition-colors"
                  >
                    <span className="font-bold text-white text-sm">{stock.symbol}</span>
                    <span className="text-green-400 font-mono text-sm">
                      {(isNumber(stock.change_percent) && stock.change_percent >= 0) ? '+' : ''}{formatPercent(stock.change_percent, 2)}
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            {/* Top Losers */}
            <div className="hud-panel">
              <div className="p-3 sm:p-4 border-b border-slate-700/30 flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-red-400" />
                <h3 className="font-bold text-white text-sm">Top Losers</h3>
              </div>
              <div className="divide-y divide-slate-700/20">
                {moversLoading ? (
                  <SkeletonMoversSection />
                ) : movers?.losers?.slice(0, 5).map((stock: StockPerformance, idx: number) => (
                  <Link
                    key={stock.symbol || `loser-${idx}`}
                    href={`/research?symbol=${stock.symbol}`}
                    className="flex items-center justify-between p-3 hover:bg-red-500/5 transition-colors"
                  >
                    <span className="font-bold text-white text-sm">{stock.symbol}</span>
                    <span className="text-red-400 font-mono text-sm">
                      {(isNumber(stock.change_percent) && stock.change_percent >= 0) ? '+' : ''}{formatPercent(stock.change_percent, 2)}
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            {/* Live News */}
            <div className="hud-panel">
              <div className="p-4 border-b border-slate-700/30 flex items-center gap-2">
                <div className="live-pulse" />
                <h3 className="font-bold text-white text-sm ml-2">Live Market News</h3>
              </div>
              <div className="p-4">
                <LiveNews limit={5} showTitle={false} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
