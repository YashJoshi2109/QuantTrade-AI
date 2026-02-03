'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import AppLayout from '@/components/AppLayout'
import Chart from '@/components/Chart'
import LiveNews from '@/components/LiveNews'
import ApiStatsMonitor from '@/components/ApiStatsMonitor'
import { Sparkles, TrendingUp, TrendingDown, Loader2, RefreshCw, Activity, Target, AlertTriangle, Zap, BarChart3, Newspaper } from 'lucide-react'
import { fetchPrices, fetchIndicators, syncSymbol, PriceBar, Indicators } from '@/lib/api'
import { useRealtimeQuote } from '@/hooks/useRealtimeQuote'

function ResearchContent() {
  const searchParams = useSearchParams()
  const symbolParam = searchParams?.get('symbol') || null
  
  const [selectedSymbol, setSelectedSymbol] = useState(symbolParam || 'NVDA')
  const [priceData, setPriceData] = useState<PriceBar[]>([])
  const [indicators, setIndicators] = useState<Indicators | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Real-time quote with HIGH PRIORITY for research page and 5-second updates
  const { data: realtimeQuote, isLoading: quoteLoading } = useRealtimeQuote({ 
    symbol: selectedSymbol,
    refetchInterval: 5000, // Update every 5 seconds
    priority: 'high', // High priority - will wait if rate limited
    useFinnhub: true // Use Finnhub for real-time data
  })

  useEffect(() => {
    if (symbolParam && symbolParam !== selectedSymbol) {
      setSelectedSymbol(symbolParam.toUpperCase())
    }
  }, [symbolParam])

  useEffect(() => {
    loadSymbolData()
  }, [selectedSymbol])

  const loadSymbolData = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const [prices, ind] = await Promise.all([
        fetchPrices(selectedSymbol).catch(() => []),
        fetchIndicators(selectedSymbol).catch(() => null)
      ])
      
      setPriceData(prices)
      setIndicators(ind)
      
      if (prices.length === 0) {
        setError('No price data available. Click "Sync Data" to fetch.')
      }
    } catch (err) {
      console.error('Error loading symbol data:', err)
      setError('Failed to load data. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleSyncData = async () => {
    setSyncing(true)
    try {
      await syncSymbol(selectedSymbol)
      await loadSymbolData()
    } catch (err) {
      console.error('Error syncing:', err)
      setError('Failed to sync data.')
    } finally {
      setSyncing(false)
    }
  }

  const getPriceInfo = () => {
    // Use real-time quote if available (most current)
    if (realtimeQuote && realtimeQuote.price > 0) {
      return { 
        price: realtimeQuote.price, 
        change: realtimeQuote.change, 
        percent: realtimeQuote.change_percent,
        volume: realtimeQuote.volume,
        high: realtimeQuote.high,
        low: realtimeQuote.low,
        dataSource: realtimeQuote.data_source,
        latency: realtimeQuote.latency_ms
      }
    }
    // Fallback to historical price data
    if (priceData.length < 2) return { price: 0, change: 0, percent: 0 }
    const latest = priceData[priceData.length - 1]
    const previous = priceData[priceData.length - 2]
    const change = latest.close - previous.close
    const percent = (change / previous.close) * 100
    return { price: latest.close, change, percent, volume: latest.volume }
  }

  const priceInfo = getPriceInfo()
  const isPositive = priceInfo.percent >= 0

  const aiReport = {
    sentiment: indicators?.indicators?.rsi && indicators.indicators.rsi > 50 ? 'Bullish' : 'Neutral',
    rsiSignal: indicators?.indicators?.rsi ? (
      indicators.indicators.rsi > 70 ? 'Overbought' :
      indicators.indicators.rsi < 30 ? 'Oversold' : 'Neutral'
    ) : 'N/A',
    trendSignal: priceInfo.price > (indicators?.indicators?.sma_50 || 0) ? 'Above SMA50' : 'Below SMA50',
  }

  const technicalData = [
    { label: 'SMA 20', value: indicators?.indicators?.sma_20, format: 'price' },
    { label: 'SMA 50', value: indicators?.indicators?.sma_50, format: 'price' },
    { label: 'SMA 200', value: indicators?.indicators?.sma_200, format: 'price' },
    { label: 'RSI (14)', value: indicators?.indicators?.rsi, format: 'number' },
    { label: 'MACD', value: indicators?.indicators?.macd?.macd, format: 'number' },
    { label: 'Signal', value: indicators?.indicators?.macd?.signal, format: 'number' },
    { label: 'BB Upper', value: indicators?.indicators?.bollinger_bands?.upper, format: 'price' },
    { label: 'BB Lower', value: indicators?.indicators?.bollinger_bands?.lower, format: 'price' },
  ]

  return (
    <AppLayout symbol={selectedSymbol}>
      <div className="p-6 h-full">
        {/* Bento Grid Layout */}
        <div className="grid grid-cols-12 gap-4 h-full">
          
          {/* Main Chart - Large Panel */}
          <div className="col-span-12 lg:col-span-9 row-span-2">
            <div className="hud-panel h-full flex flex-col">
              {/* Chart Header */}
              <div className="p-4 border-b border-blue-500/10 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-xl font-bold text-white">{selectedSymbol}</h2>
                      <span className="text-xs text-slate-500 font-mono px-2 py-0.5 bg-slate-800/50 rounded">NASDAQ</span>
                      {realtimeQuote && !quoteLoading && (
                        <div className="flex items-center gap-2">
                          <div className="live-pulse" />
                          {priceInfo.dataSource && (
                            <span className="text-xs text-emerald-400 font-mono px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded">
                              {priceInfo.dataSource}
                            </span>
                          )}
                          {priceInfo.latency && priceInfo.latency < 500 && (
                            <span className="text-xs text-blue-400 font-mono px-2 py-0.5 bg-blue-500/10 border border-blue-500/20 rounded">
                              {priceInfo.latency}ms
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {(realtimeQuote || priceData.length > 0) && (
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-2xl font-bold text-white hud-value">
                          ${priceInfo.price.toFixed(2)}
                          {quoteLoading && <Loader2 className="inline w-4 h-4 ml-2 animate-spin text-blue-400" />}
                        </span>
                        <span className={`flex items-center gap-1 px-2 py-1 rounded-lg text-sm font-bold ${
                          isPositive 
                            ? 'bg-green-500/10 text-green-400 border border-green-500/20' 
                            : 'bg-red-500/10 text-red-400 border border-red-500/20'
                        }`}>
                          {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                          {isPositive ? '+' : ''}{priceInfo.percent.toFixed(2)}%
                        </span>
                        {priceInfo.volume && (
                          <span className="text-xs text-slate-400 font-mono">
                            Vol: {(priceInfo.volume / 1000000).toFixed(2)}M
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <button 
                    onClick={handleSyncData}
                    disabled={syncing}
                    className="hud-card flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-300 hover:text-white hover:border-blue-500/30 transition-all disabled:opacity-50"
                  >
                    {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    Sync Data
                  </button>
                  <button className="hud-card flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border-blue-500/30 transition-all">
                    <Activity className="w-4 h-4" />
                    Advanced
                  </button>
                </div>
              </div>
              
              {/* Chart Area */}
              <div className="flex-1 relative min-h-[300px]">
                {loading ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
                      <span className="text-sm text-slate-500 font-mono">LOADING DATA...</span>
                    </div>
                  </div>
                ) : error ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <AlertTriangle className="w-12 h-12 text-yellow-500 mb-4" />
                    <p className="text-sm text-slate-400 mb-3">{error}</p>
                    <button 
                      onClick={handleSyncData}
                      className="hud-card px-4 py-2 text-sm text-blue-400 hover:text-white transition-colors"
                    >
                      Click to sync data →
                    </button>
                  </div>
                ) : (
                  <Chart data={priceData} symbol={selectedSymbol} />
                )}
              </div>
            </div>
          </div>

          {/* Technical Indicators Panel */}
          <div className="col-span-12 lg:col-span-3 row-span-2">
            <div className="hud-panel h-full flex flex-col">
              <div className="p-4 border-b border-blue-500/10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-cyan-400" />
                  <h3 className="font-bold text-sm text-white">Technical Indicators</h3>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
                  </div>
                ) : (
                  <div className="p-3 space-y-2">
                    {technicalData.map((item, i) => (
                      <div key={i} className="hud-stat p-3 flex items-center justify-between">
                        <span className="text-xs text-slate-400">{item.label}</span>
                        <span className="text-sm font-mono text-white hud-value">
                          {item.value !== undefined && item.value !== null
                            ? item.format === 'price' 
                              ? `$${item.value.toFixed(2)}`
                              : item.value.toFixed(2)
                            : 'N/A'
                          }
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              {/* Signal Summary */}
              <div className="p-4 border-t border-blue-500/10">
                <div className="hud-label mb-3">SIGNAL SUMMARY</div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">RSI Signal</span>
                    <span className={`text-xs font-bold px-2 py-1 rounded ${
                      aiReport.rsiSignal === 'Overbought' ? 'bg-red-500/10 text-red-400' :
                      aiReport.rsiSignal === 'Oversold' ? 'bg-green-500/10 text-green-400' :
                      'bg-slate-700/50 text-slate-300'
                    }`}>
                      {aiReport.rsiSignal}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">Trend</span>
                    <span className="text-xs font-bold px-2 py-1 rounded bg-slate-700/50 text-slate-300">
                      {aiReport.trendSignal}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* AI Analysis Panel */}
          <div className="col-span-12 lg:col-span-6">
            <div className="hud-panel p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-blue-400" />
                  <h3 className="font-bold text-sm text-white">AI Analysis</h3>
                </div>
                <span className={`text-xs font-bold px-3 py-1 rounded-lg ${
                  aiReport.sentiment === 'Bullish' 
                    ? 'bg-green-500/10 text-green-400 border border-green-500/20' 
                    : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                }`}>
                  {aiReport.sentiment}
                </span>
              </div>
              
              <p className="text-sm text-slate-400 leading-relaxed mb-4">
                Based on technical analysis of <span className="text-blue-400 font-bold">{selectedSymbol}</span>, 
                the current RSI is <span className="text-white font-mono">{indicators?.indicators?.rsi?.toFixed(1) || 'N/A'}</span> and 
                the stock is trading {priceInfo.price > (indicators?.indicators?.sma_50 || 0) ? 'above' : 'below'} its 50-day moving average.
                {priceInfo.percent > 0 ? ' Positive momentum detected.' : ' Caution advised on entry.'}
              </p>
              
              {priceData.length > 0 && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="hud-stat p-3 text-center">
                    <div className="text-lg font-bold text-white hud-value">${priceInfo.price.toFixed(2)}</div>
                    <div className="text-[10px] text-slate-500">CURRENT</div>
                  </div>
                  <div className="hud-stat p-3 text-center">
                    <div className={`text-lg font-bold hud-value ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                      {isPositive ? '+' : ''}{priceInfo.change.toFixed(2)}
                    </div>
                    <div className="text-[10px] text-slate-500">CHANGE</div>
                  </div>
                  <div className="hud-stat p-3 text-center">
                    <div className={`text-lg font-bold hud-value ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                      {isPositive ? '+' : ''}{priceInfo.percent.toFixed(2)}%
                    </div>
                    <div className="text-[10px] text-slate-500">PERCENT</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Risk & Catalysts */}
          <div className="col-span-12 lg:col-span-3">
            <div className="hud-panel p-5 h-full">
              <div className="flex items-center gap-2 mb-4">
                <Target className="w-4 h-4 text-orange-400" />
                <h3 className="font-bold text-sm text-white">Key Factors</h3>
              </div>
              
              <div className="space-y-3">
                <div>
                  <div className="hud-label mb-2">RISKS</div>
                  <ul className="space-y-1.5">
                    <li className="text-xs text-slate-400 flex items-start gap-2">
                      <span className="w-1 h-1 bg-red-400 rounded-full mt-1.5 flex-shrink-0" />
                      Market volatility impact
                    </li>
                    <li className="text-xs text-slate-400 flex items-start gap-2">
                      <span className="w-1 h-1 bg-red-400 rounded-full mt-1.5 flex-shrink-0" />
                      Sector headwinds possible
                    </li>
                  </ul>
                </div>
                
                <div className="hud-glow-line" />
                
                <div>
                  <div className="hud-label mb-2">CATALYSTS</div>
                  <ul className="space-y-1.5">
                    <li className="text-xs text-slate-400 flex items-start gap-2">
                      <span className="w-1 h-1 bg-green-400 rounded-full mt-1.5 flex-shrink-0" />
                      Upcoming earnings
                    </li>
                    <li className="text-xs text-slate-400 flex items-start gap-2">
                      <span className="w-1 h-1 bg-green-400 rounded-full mt-1.5 flex-shrink-0" />
                      Industry trends favorable
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="col-span-12 lg:col-span-3">
            <div className="hud-panel p-5 h-full flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-4 h-4 text-cyan-400" />
                  <h3 className="font-bold text-sm text-white">Quick Stats</h3>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center">
                    <div className="text-lg font-bold text-white hud-value">{priceData.length}</div>
                    <div className="text-[10px] text-slate-500">DATA POINTS</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-cyan-400 hud-value">
                      {indicators?.indicators?.rsi?.toFixed(0) || '--'}
                    </div>
                    <div className="text-[10px] text-slate-500">RSI</div>
                  </div>
                </div>
              </div>
              
              <button 
                onClick={handleSyncData}
                disabled={syncing}
                className="w-full mt-4 hud-card py-2.5 text-sm font-medium text-blue-400 hover:text-white hover:border-blue-500/30 transition-all disabled:opacity-50"
              >
                {syncing ? 'Syncing...' : 'Refresh All Data'}
              </button>
            </div>
          </div>

          {/* Live News Section */}
          <div className="col-span-12">
            <div className="hud-panel">
              <div className="p-4 border-b border-blue-500/10 flex items-center gap-2">
                <Newspaper className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-white">{selectedSymbol} Live News</h3>
                <span className="ml-auto text-xs text-slate-500 font-mono">REAL-TIME</span>
                <div className="live-pulse" />
              </div>
              <div className="p-4">
                <LiveNews symbol={selectedSymbol} limit={8} showTitle={false} />
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

export default function ResearchPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
          <span className="text-sm text-slate-500 font-mono">LOADING...</span>
        </div>
      </div>
    }>
      <ResearchContent />
    </Suspense>
  )
}
