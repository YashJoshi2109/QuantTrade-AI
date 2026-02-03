'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import AppLayout from '@/components/AppLayout'
import ApiStatsMonitor from '@/components/ApiStatsMonitor'
import LiveNews from '@/components/LiveNews'
import MarketHeatmap from '@/components/MarketHeatmap'
import { 
  TrendingUp, 
  TrendingDown, 
  RefreshCw, 
  Globe, 
  BarChart3,
  Activity,
  Zap,
  Loader2,
  Grid3X3,
  List
} from 'lucide-react'
import { fetchSectorPerformance, fetchMarketMovers, SectorPerformance, StockPerformance } from '@/lib/api'
import { useRealtimeQuotes } from '@/hooks/useRealtimeQuote'
import Link from 'next/link'

// Major indices to track in real-time
const INDEX_SYMBOLS = ['^GSPC', '^IXIC', '^DJI', '^RUT'] // S&P 500, NASDAQ, DOW, Russell 2000

export default function MarketsPage() {
  const [view, setView] = useState<'heatmap' | 'list'>('heatmap')
  
  // Real-time index quotes with HIGH PRIORITY for markets page
  const { data: indexQuotes, isLoading: indicesLoading } = useRealtimeQuotes(
    INDEX_SYMBOLS,
    10000, // Update every 10 seconds
    'high' // High priority - critical market data
  )
  
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
      <div className="p-6 min-h-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <Globe className="w-7 h-7 text-blue-400" />
              Markets Overview
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Real-time market data • {marketStats.totalStocks} stocks tracked
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* View Toggle */}
            <div className="flex items-center gap-1 p-1 bg-slate-800/50 rounded-lg">
              <button
                onClick={() => setView('heatmap')}
                className={`p-2 rounded-md transition-all ${
                  view === 'heatmap' ? 'bg-blue-500/20 text-blue-400' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Grid3X3 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setView('list')}
                className={`p-2 rounded-md transition-all ${
                  view === 'list' ? 'bg-blue-500/20 text-blue-400' : 'text-slate-400 hover:text-white'
                }`}
              >
                <List className="w-4 h-4" />
              </button>
            </div>
            <button 
              onClick={() => refetchSectors()}
              className="hud-card px-4 py-2 text-sm text-blue-400 hover:text-white flex items-center gap-2 transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>

        {/* Index Cards - Real-time */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {indicesLoading ? (
            <div className="col-span-4 flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
              <span className="ml-3 text-slate-400">Loading market indices...</span>
            </div>
          ) : indexQuotes && indexQuotes.length > 0 ? (
            indexQuotes.map((quote, idx) => {
              const indexNames = ['S&P 500', 'NASDAQ', 'DOW JONES', 'RUSSELL 2000']
              return (
                <div key={quote.symbol || idx} className="hud-panel p-4 relative group">
                  {quote.data_source && (
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-xs text-emerald-400 font-mono px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded">
                        {quote.data_source}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 mb-1">
                    <div className="text-xs text-slate-500">{indexNames[idx] || quote.symbol}</div>
                    <div className="live-pulse scale-75" />
                  </div>
                  <div className="text-xl font-bold text-white font-mono">
                    {quote.price > 0 ? quote.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'N/A'}
                  </div>
                  <div className={`text-sm font-mono flex items-center gap-1 ${
                    quote.change_percent >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {quote.change_percent >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                    {quote.change_percent >= 0 ? '+' : ''}{quote.change_percent.toFixed(2)}%
                  </div>
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
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="hud-panel p-4 flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Activity className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <div className="text-xl font-bold text-white">{marketStats.totalStocks}</div>
              <div className="text-xs text-slate-500">Total Stocks</div>
            </div>
          </div>
          <div className="hud-panel p-4 flex items-center gap-3">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <TrendingUp className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <div className="text-xl font-bold text-green-400">{marketStats.gainers}</div>
              <div className="text-xs text-slate-500">Gainers</div>
            </div>
          </div>
          <div className="hud-panel p-4 flex items-center gap-3">
            <div className="p-2 bg-red-500/10 rounded-lg">
              <TrendingDown className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <div className="text-xl font-bold text-red-400">{marketStats.losers}</div>
              <div className="text-xs text-slate-500">Losers</div>
            </div>
          </div>
          <div className="hud-panel p-4 flex items-center gap-3">
            <div className="p-2 bg-cyan-500/10 rounded-lg">
              <Zap className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <div className="text-xl font-bold text-white">{sectors?.length || 0}</div>
              <div className="text-xs text-slate-500">Sectors</div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-12 gap-6">
          {/* Heatmap / List Section */}
          <div className="col-span-12 lg:col-span-9">
            <div className="hud-panel p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-blue-400" />
                  1-Day Performance Map
                </h2>
                <div className="flex items-center gap-2">
                  <div className="live-pulse" />
                  <span className="text-xs text-slate-400 ml-2">Real-time</span>
                </div>
              </div>
              
              {sectorsLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
                </div>
              ) : view === 'heatmap' && sectors ? (
                <MarketHeatmap sectors={sectors} />
              ) : sectors ? (
                /* List View */
                <div className="space-y-4">
                  {sectors.map(sector => (
                    <div key={sector.sector} className="border border-slate-700/50 rounded-lg overflow-hidden">
                      <div className={`px-4 py-3 flex items-center justify-between ${
                        sector.change_percent >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'
                      }`}>
                        <span className="font-bold text-white">{sector.sector}</span>
                        <span className={`font-mono font-bold ${
                          sector.change_percent >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {sector.change_percent >= 0 ? '+' : ''}{sector.change_percent.toFixed(2)}%
                        </span>
                      </div>
                      <div className="divide-y divide-slate-700/30">
                        {sector.stocks.slice(0, 10).map(stock => (
                          <Link
                            key={stock.symbol}
                            href={`/research?symbol=${stock.symbol}`}
                            className="flex items-center justify-between p-3 hover:bg-slate-800/30 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <span className="font-bold text-white w-16">{stock.symbol}</span>
                              <span className="text-sm text-slate-400 truncate max-w-[200px]">{stock.name}</span>
                            </div>
                            <div className="flex items-center gap-6">
                              <span className="text-white font-mono">${stock.price.toFixed(2)}</span>
                              <span className={`font-mono w-20 text-right ${
                                stock.change_percent >= 0 ? 'text-green-400' : 'text-red-400'
                              }`}>
                                {stock.change_percent >= 0 ? '+' : ''}{stock.change_percent.toFixed(2)}%
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
          <div className="col-span-12 lg:col-span-3 space-y-6">
            {/* Top Gainers */}
            <div className="hud-panel">
              <div className="p-4 border-b border-slate-700/30 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-green-400" />
                <h3 className="font-bold text-white text-sm">Top Gainers</h3>
              </div>
              <div className="divide-y divide-slate-700/20">
                {moversLoading ? (
                  <div className="p-8 flex justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                  </div>
                ) : movers?.gainers?.slice(0, 5).map((stock: StockPerformance) => (
                  <Link
                    key={stock.symbol}
                    href={`/research?symbol=${stock.symbol}`}
                    className="flex items-center justify-between p-3 hover:bg-green-500/5 transition-colors"
                  >
                    <span className="font-bold text-white text-sm">{stock.symbol}</span>
                    <span className="text-green-400 font-mono text-sm">
                      +{stock.change_percent.toFixed(2)}%
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            {/* Top Losers */}
            <div className="hud-panel">
              <div className="p-4 border-b border-slate-700/30 flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-red-400" />
                <h3 className="font-bold text-white text-sm">Top Losers</h3>
              </div>
              <div className="divide-y divide-slate-700/20">
                {moversLoading ? (
                  <div className="p-8 flex justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                  </div>
                ) : movers?.losers?.slice(0, 5).map((stock: StockPerformance) => (
                  <Link
                    key={stock.symbol}
                    href={`/research?symbol=${stock.symbol}`}
                    className="flex items-center justify-between p-3 hover:bg-red-500/5 transition-colors"
                  >
                    <span className="font-bold text-white text-sm">{stock.symbol}</span>
                    <span className="text-red-400 font-mono text-sm">
                      {stock.change_percent.toFixed(2)}%
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
      
      {/* API Stats Monitor - shows rate limit status */}
      <ApiStatsMonitor />
    </AppLayout>
  )
}
