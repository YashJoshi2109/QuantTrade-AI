'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import AppLayout from '@/components/AppLayout'
import LiveNews from '@/components/LiveNews'
import { useAuth } from '@/contexts/AuthContext'
import { 
  TrendingUp, 
  TrendingDown, 
  Sparkles, 
  Flame, 
  Plus, 
  Zap, 
  ArrowRight, 
  Activity,
  BarChart3,
  Cpu,
  LogIn,
  RefreshCw,
  Loader2
} from 'lucide-react'
import { fetchMarketMovers, fetchSectorPerformance, fetchLiveMarketNews, StockPerformance, SectorPerformance, fetchMarketStatus, MarketStatus, fetchHeatmapData, HeatmapData } from '@/lib/api'
import MarketHeatmap from '@/components/MarketHeatmap'

// Market Status Component
function MarketStatusCard() {
  const { data: marketStatus, isLoading } = useQuery<MarketStatus>({
    queryKey: ['marketStatus'],
    queryFn: fetchMarketStatus,
    refetchInterval: 60000, // Refresh every minute
  })

  const isOpen = marketStatus?.is_open ?? false
  const status = marketStatus?.status ?? 'CLOSED'

  return (
    <div className="bento-sm">
      <div className="hud-panel h-full p-5 flex flex-col justify-between">
        <div>
          <div className="hud-label mb-2">MARKET STATUS</div>
          {isLoading ? (
            <div className="flex items-center gap-2 mt-2">
              <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
              <span className="text-sm text-slate-400">Loading...</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mt-2">
                <div className={`w-2 h-2 rounded-full ${isOpen ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
                <span className={`text-lg font-bold ${isOpen ? 'text-green-400' : 'text-red-400'}`}>
                  {status}
                </span>
              </div>
              <div className="text-[10px] text-slate-500 font-mono mt-2">
                {marketStatus?.exchanges.NYSE ? 'NYSE' : 'NYSE'} · {marketStatus?.exchanges.NASDAQ ? 'NASDAQ' : 'NASDAQ'}
              </div>
              <div className="text-[9px] text-slate-600 font-mono mt-1">
                {marketStatus?.current_time_et?.split(' ')[1] || ''} ET
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Home() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth()

  // Fetch live market movers (gainers/losers)
  const { data: movers, isLoading: moversLoading, refetch: refetchMovers } = useQuery({
    queryKey: ['marketMovers'],
    queryFn: fetchMarketMovers,
    refetchInterval: 60000, // Refresh every minute
    staleTime: 30000,
  })

  // Fetch sector performance
  const { data: sectors, isLoading: sectorsLoading } = useQuery({
    queryKey: ['sectorPerformance'],
    queryFn: fetchSectorPerformance,
    refetchInterval: 60000,
    staleTime: 30000,
  })

  // Fetch heatmap data for homepage
  const { data: heatmapData, isLoading: heatmapLoading } = useQuery<HeatmapData>({
    queryKey: ['heatmapData'],
    queryFn: fetchHeatmapData,
    refetchInterval: 300000, // Refetch every 5 minutes
    staleTime: 120000,
  })

  // Fetch live news (throttled to 20 minutes)
  const { data: liveNews, isLoading: newsLoading } = useQuery({
    queryKey: ['liveNews'],
    queryFn: () => fetchLiveMarketNews('technology,earnings', 5),
    refetchInterval: 1200000, // Refresh every 20 minutes
    staleTime: 600000,
  })

  const topGainers = movers?.gainers?.slice(0, 5) || []
  const topLosers = movers?.losers?.slice(0, 5) || []
  const topSectors = sectors?.slice(0, 4) || []

  return (
    <AppLayout>
      <div className="p-6 min-h-full">
        {/* Bento Grid Layout */}
        <div className="bento-grid">
          
          {/* Hero Card - Live Market News */}
          <div className="bento-xl bento-tall">
            <div className="hud-panel h-full p-6 relative overflow-hidden group">
              {/* Animated background */}
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-transparent to-cyan-500/10" />
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />
              
              {/* Content */}
              <div className="relative h-full flex flex-col">
                {/* Badge */}
                <div className="flex items-center gap-2 mb-4">
                  <span className="inline-flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold text-white bg-gradient-to-r from-blue-500 to-cyan-500 rounded-lg uppercase tracking-wider shadow-lg shadow-blue-500/30">
                    <Zap className="w-3 h-3" />
                    Live News
                  </span>
                  <div className="live-pulse" />
                  <span className="text-[10px] text-slate-500 font-mono ml-2">REAL-TIME</span>
                </div>
                
                {/* Live News Feed */}
                <div className="flex-1 overflow-hidden">
                  {newsLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
                    </div>
                  ) : liveNews?.news && liveNews.news.length > 0 ? (
                    <div className="space-y-3 h-full overflow-y-auto pr-2">
                      {liveNews.news.slice(0, 4).map((news, idx) => (
                        <a
                          key={idx}
                          href={news.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block p-3 hud-card hover:border-blue-500/30 transition-all group/item"
                        >
                          <div className="flex items-start gap-3">
                            <div className={`p-1.5 rounded ${
                              news.sentiment === 'Bullish' ? 'bg-green-500/20' :
                              news.sentiment === 'Bearish' ? 'bg-red-500/20' : 'bg-slate-700/50'
                            }`}>
                              {news.sentiment === 'Bullish' ? (
                                <TrendingUp className="w-3 h-3 text-green-400" />
                              ) : news.sentiment === 'Bearish' ? (
                                <TrendingDown className="w-3 h-3 text-red-400" />
                              ) : (
                                <Activity className="w-3 h-3 text-slate-400" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-white font-medium group-hover/item:text-blue-400 transition-colors line-clamp-2">
                                {news.title}
                              </p>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-[10px] text-slate-500">{news.source}</span>
                                {news.tickers && news.tickers.length > 0 && (
                                  <div className="flex gap-1">
                                    {news.tickers.slice(0, 3).map(t => (
                                      <span key={t} className="px-1.5 py-0.5 text-[9px] bg-blue-500/20 text-blue-400 rounded">
                                        {t}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-center">
                      <Activity className="w-10 h-10 text-slate-600 mb-3" />
                      <p className="text-slate-400 text-sm">Loading live market news...</p>
                      <p className="text-slate-500 text-xs mt-1">API rate limit may apply</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Top Gainers */}
          <div className="bento-md bento-tall">
            <div className="hud-panel h-full flex flex-col">
              {/* Header */}
              <div className="p-4 border-b border-slate-700/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-green-400" />
                  <h3 className="font-bold text-white text-sm">Top 10 Gainers</h3>
                </div>
                <button 
                  onClick={() => refetchMovers()}
                  className="hud-card p-2 text-blue-400 hover:text-white transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
              </div>
              
              {/* Items */}
              <div className="flex-1 overflow-y-auto">
                {moversLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                  </div>
                ) : topGainers.length > 0 ? (
                  topGainers.map((stock: StockPerformance, idx: number) => (
                    <Link
                      key={stock.symbol}
                      href={`/research?symbol=${stock.symbol}`}
                      className="p-3 flex items-center justify-between hover:bg-green-500/5 border-b border-slate-700/20 transition-all group"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-5 h-5 flex items-center justify-center text-[10px] text-slate-400 bg-slate-800/50 rounded font-mono">
                          {idx + 1}
                        </span>
                        <div>
                          <span className="font-bold text-white group-hover:text-green-400 transition-colors text-sm">{stock.symbol}</span>
                          <div className="text-[10px] text-slate-500 truncate max-w-[120px]">{stock.name}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm text-white">${stock.price.toFixed(2)}</div>
                        <div className="font-mono text-xs text-green-400 flex items-center justify-end gap-0.5">
                          +{stock.change_percent.toFixed(2)}%
                          <TrendingUp className="w-3 h-3" />
                        </div>
                      </div>
                    </Link>
                  ))
                ) : (
                  <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                    No data available
                  </div>
                )}
              </div>
              
              {/* Footer */}
              <div className="p-3 border-t border-slate-700/30">
                <Link 
                  href="/markets"
                  className="flex items-center justify-center gap-2 py-2 text-sm text-green-400 hover:text-white font-medium rounded-lg hover:bg-green-500/10 transition-all"
                >
                  View All Gainers
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>

          {/* Top Losers */}
          <div className="bento-md bento-tall">
            <div className="hud-panel h-full flex flex-col">
              {/* Header */}
              <div className="p-4 border-b border-slate-700/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-red-400" />
                  <h3 className="font-bold text-white text-sm">Top 10 Losers</h3>
                </div>
              </div>
              
              {/* Items */}
              <div className="flex-1 overflow-y-auto">
                {moversLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                  </div>
                ) : topLosers.length > 0 ? (
                  topLosers.map((stock: StockPerformance, idx: number) => (
                    <Link
                      key={stock.symbol}
                      href={`/research?symbol=${stock.symbol}`}
                      className="p-3 flex items-center justify-between hover:bg-red-500/5 border-b border-slate-700/20 transition-all group"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-5 h-5 flex items-center justify-center text-[10px] text-slate-400 bg-slate-800/50 rounded font-mono">
                          {idx + 1}
                        </span>
                        <div>
                          <span className="font-bold text-white group-hover:text-red-400 transition-colors text-sm">{stock.symbol}</span>
                          <div className="text-[10px] text-slate-500 truncate max-w-[120px]">{stock.name}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm text-white">${stock.price.toFixed(2)}</div>
                        <div className="font-mono text-xs text-red-400 flex items-center justify-end gap-0.5">
                          {stock.change_percent.toFixed(2)}%
                          <TrendingDown className="w-3 h-3" />
                        </div>
                      </div>
                    </Link>
                  ))
                ) : (
                  <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                    No data available
                  </div>
                )}
              </div>
              
              {/* Footer */}
              <div className="p-3 border-t border-slate-700/30">
                <Link 
                  href="/markets"
                  className="flex items-center justify-center gap-2 py-2 text-sm text-red-400 hover:text-white font-medium rounded-lg hover:bg-red-500/10 transition-all"
                >
                  View All Losers
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>

          {/* Sector Performance */}
          <div className="bento-md">
            <div className="hud-panel h-full p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-blue-400" />
                  <h3 className="font-bold text-white text-sm">Sector Performance</h3>
                </div>
                <Link href="/markets" className="text-[10px] text-blue-400 hover:text-white font-medium transition-colors">
                  View All →
                </Link>
              </div>
              <div className="space-y-3">
                {sectorsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                  </div>
                ) : topSectors.length > 0 ? (
                  topSectors.map((sector: SectorPerformance) => (
                    <div key={sector.sector} className="group">
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="text-slate-400 group-hover:text-white transition-colors">{sector.sector}</span>
                        <span className={`font-mono font-bold ${sector.change_percent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {sector.change_percent >= 0 ? '+' : ''}{sector.change_percent.toFixed(2)}%
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 ${
                            sector.change_percent >= 0
                              ? 'bg-gradient-to-r from-green-500 to-emerald-400' 
                              : 'bg-gradient-to-r from-red-500 to-rose-400'
                          }`}
                          style={{ width: `${Math.min(Math.abs(sector.change_percent) * 10, 100)}%` }}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center text-slate-500 text-sm py-4">No sector data</div>
                )}
              </div>
            </div>
          </div>

          {/* AI Insights - Dynamic from Copilot */}
          <div className="bento-md bento-tall">
            <div className="hud-panel h-full flex flex-col relative overflow-hidden">
              {/* Decorative glow */}
              <div className="absolute top-0 right-0 w-40 h-40 bg-blue-500/10 rounded-full blur-3xl" />
              
              {/* Header */}
              <div className="p-4 border-b border-slate-700/30 flex items-center justify-between relative">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-cyan-400" />
                  <h3 className="font-bold text-white text-sm">Market Summary</h3>
                  <span className="px-2 py-0.5 text-[9px] bg-cyan-500/20 text-cyan-400 rounded font-bold">AI</span>
                </div>
                <Sparkles className="w-4 h-4 text-blue-400" />
              </div>
              
              {/* Summary */}
              <div className="flex-1 p-4 overflow-y-auto relative">
                <div className="space-y-4">
                  <div className="hud-card p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Activity className="w-4 h-4 text-blue-400" />
                      <span className="text-xs font-bold text-white">Market Overview</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      {moversLoading ? 'Loading market data...' : 
                        `Today's market shows ${movers?.gainers?.length || 0} stocks gaining and ${movers?.losers?.length || 0} stocks declining. 
                        Top performer: ${movers?.gainers?.[0]?.symbol || 'N/A'} (+${movers?.gainers?.[0]?.change_percent?.toFixed(2) || 0}%)`
                      }
                    </p>
                  </div>
                  
                  <div className="hud-card p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <BarChart3 className="w-4 h-4 text-green-400" />
                      <span className="text-xs font-bold text-white">Sector Analysis</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      {sectorsLoading ? 'Loading sector data...' :
                        `${topSectors.filter(s => s.change_percent > 0).length} sectors in green. 
                        Leading: ${topSectors[0]?.sector || 'N/A'} (${topSectors[0]?.change_percent?.toFixed(2) || 0}%)`
                      }
                    </p>
                  </div>

                  <div className="hud-card p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Zap className="w-4 h-4 text-yellow-400" />
                      <span className="text-xs font-bold text-white">Quick Action</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed mb-2">
                      Ask the QuantTrade AI for deeper analysis on any stock or sector.
                    </p>
                    <button 
                      className="text-[10px] text-blue-400 hover:text-white transition-colors"
                      onClick={() => {
                        // Trigger copilot focus
                        const input = document.querySelector('input[placeholder*="Ask about"]') as HTMLInputElement
                        if (input) input.focus()
                      }}
                    >
                      Open Copilot →
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Stats - User Dependent */}
          {isAuthenticated && (
            <>
              <div className="bento-sm">
                <div className="hud-panel h-full p-5 flex flex-col justify-between">
                  <div>
                    <div className="hud-label mb-2">WELCOME BACK</div>
                    <div className="text-lg font-bold text-white truncate">{user?.username || user?.full_name}</div>
                    <div className="text-xs text-slate-500 mt-1 truncate">{user?.email}</div>
                  </div>
                  <Link href="/settings" className="text-[10px] text-blue-400 hover:text-white transition-colors mt-2">
                    Settings →
                  </Link>
                </div>
              </div>

              <div className="bento-sm">
                <div className="hud-panel h-full p-5 flex flex-col justify-between">
                  <div>
                    <div className="hud-label mb-2">YOUR WATCHLIST</div>
                    <div className="text-2xl font-bold text-white hud-value">—</div>
                    <div className="text-xs text-slate-500 mt-1">Tracked symbols</div>
                  </div>
                  <Link href="/watchlist" className="text-[10px] text-blue-400 hover:text-white transition-colors mt-2">
                    Manage →
                  </Link>
                </div>
              </div>
            </>
          )}

          <MarketStatusCard />

          <div className="bento-sm">
            <div className="hud-panel h-full p-5 flex flex-col justify-between">
              <div>
                <div className="hud-label mb-2">S&P 500 STOCKS</div>
                <div className="text-2xl font-bold text-white hud-value">
                  {heatmapLoading ? (
                    <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
                  ) : (
                    heatmapData?.total_stocks || '170+'
                  )}
                </div>
                <div className="text-xs text-slate-500 mt-1">Available to analyze</div>
              </div>
              <Link href="/markets" className="text-[10px] text-blue-400 hover:text-white transition-colors mt-2">
                Explore →
              </Link>
            </div>
          </div>

        </div>
        
        {/* Market Heatmap Section */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-blue-400" />
                Market Performance Map
              </h2>
              <p className="text-xs text-slate-500 mt-1">S&P 500 real-time heatmap by sector</p>
            </div>
            <Link 
              href="/markets"
              className="text-sm text-blue-400 hover:text-white flex items-center gap-1 transition-colors"
            >
              View Full Map <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          
          <div className="hud-panel p-6">
            {heatmapLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
                <span className="ml-3 text-slate-400">Loading market data...</span>
              </div>
            ) : heatmapData ? (
              <div className="space-y-4">
                {/* Stats Bar */}
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="hud-stat p-3">
                    <div className="text-xs text-slate-500 mb-1">GAINERS</div>
                    <div className="text-lg font-bold text-green-400">{heatmapData.gainers}</div>
                  </div>
                  <div className="hud-stat p-3">
                    <div className="text-xs text-slate-500 mb-1">LOSERS</div>
                    <div className="text-lg font-bold text-red-400">{heatmapData.losers}</div>
                  </div>
                  <div className="hud-stat p-3">
                    <div className="text-xs text-slate-500 mb-1">UNCHANGED</div>
                    <div className="text-lg font-bold text-slate-400">{heatmapData.unchanged}</div>
                  </div>
                </div>
                
                {/* Heatmap Component */}
                <MarketHeatmap sectors={heatmapData.sectors} />
              </div>
            ) : (
              <div className="text-center py-20 text-slate-400">
                <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No market data available</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
