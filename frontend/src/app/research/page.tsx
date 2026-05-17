'use client'

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import MobileResearch from '@/components/layout/MobileResearch'
import Chart, { type ChartSeriesType } from '@/components/Chart'
import LiveNews from '@/components/LiveNews'
import Link from 'next/link'
import type { OverlayIndicatorId, PaneIndicatorId } from '@/lib/indicators'
import {
  Sparkles, TrendingUp, TrendingDown, RefreshCw, AlertTriangle,
  BarChart3, Newspaper, Loader2,
} from 'lucide-react'
import {
  fetchPrices,
  fetchIntradayPrices,
  fetchIndicators,
  fetchFundamentals,
  syncSymbol,
  PriceBar,
  Indicators,
  FundamentalsData,
  addToWatchlist,
  getWatchlist,
  removeFromWatchlist,
  type WatchlistItem,
} from '@/lib/api'
import TechnicalAnalysisGauge from '@/components/TechnicalAnalysisGauge'
import KeyFactorsPanel from '@/components/KeyFactorsPanel'
import FundamentalsPanel from '@/components/FundamentalsPanel'
import { useRealtimeQuote } from '@/hooks/useRealtimeQuote'
import { formatNumber, formatPercent, isNumber } from '@/lib/format'
import { QuoteActivityFlash } from '@/components/QuoteActivityFlash'
import { useToast } from '@/components/Toast'
import { SkeletonChart, SkeletonIndicators, SkeletonText, Skeleton } from '@/components/Skeleton'
import type { TickerInfo } from '@/app/api/quotes/ticker/route'
import { ResearchChartHeader, type ResearchChartPeriod } from '@/components/research/ResearchChartHeader'
import { CompanyFolioPanel } from '@/components/research/CompanyFolioPanel'
import EarningsShortInterestPanel from '@/components/research/EarningsShortInterestPanel'
import FullscreenChartModal from '@/components/research/FullscreenChartModal'
import OptionChainPanel from '@/components/research/OptionChainPanel'
import SecEdgarPanel from '@/components/research/SecEdgarPanel'
import IndicatorToolbar from '@/components/research/IndicatorToolbar'
import TickerLogo from '@/components/TickerLogo'
import { getExchangeTimezone } from '@/lib/world-exchanges'

type ChartPeriod = ResearchChartPeriod

function isIntradayPeriod(period: ChartPeriod): boolean {
  return period === '1D' || period === '5D'
}

function chartPeriodRange(period: ChartPeriod): { start: Date; end: Date; barLimit: number } {
  const end = new Date()
  const start = new Date(end)
  const dayMap: Record<ChartPeriod, number> = {
    '1D': 1,
    '5D': 5,
    '1M': 35,
    '3M': 98,
    '6M': 190,
    '1Y': 370,
    '2Y': 750,
    '5Y': 1900,
  }
  // Use local date consistently (not mixing setUTCDate with local Date)
  start.setDate(start.getDate() - dayMap[period])
  const barLimit = Math.min(5000, Math.ceil(dayMap[period] * (isIntradayPeriod(period) ? 390 : 1.25)))
  return { start, end, barLimit }
}

function ResearchContent() {
  const searchParams = useSearchParams()
  const symbolParam = searchParams?.get('symbol') || null
  const queryClient = useQueryClient()
  const toast = useToast()

  const [selectedSymbol, setSelectedSymbol] = useState(symbolParam || 'NVDA')
  const [priceData, setPriceData] = useState<PriceBar[]>([])
  const [indicators, setIndicators] = useState<Indicators | null>(null)
  const [fundamentals, setFundamentals] = useState<FundamentalsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>('1Y')
  const [chartSeriesType, setChartSeriesType] = useState<ChartSeriesType>('candlestick')
  const [chartShowMa, setChartShowMa] = useState(true)
  const [chartShowVolume, setChartShowVolume] = useState(false)
  const [chartLogScale, setChartLogScale] = useState(false)
  const [chartShowGrid, setChartShowGrid] = useState(true)
  const [activeOverlays, setActiveOverlays] = useState<OverlayIndicatorId[]>(['sma20', 'ema50'])
  const [activePanes, setActivePanes] = useState<PaneIndicatorId[]>(['volume'])
  const [extendedHours, setExtendedHours] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [fullscreenChart, setFullscreenChart] = useState(false)
  const advancedRef = useRef<HTMLDivElement>(null)
  const [watchlistBusy, setWatchlistBusy] = useState(false)
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const aiAbortRef = useRef<AbortController | null>(null)

  const { data: watchlistItems = [] } = useQuery<WatchlistItem[]>({
    queryKey: ['watchlist'],
    queryFn: getWatchlist,
    staleTime: 60_000,
    retry: false,
  })

  // Company ticker info (Yahoo Finance — name, sector, description, officers, financials)
  const { data: tickerInfo, isPending: tickerInfoLoading } = useQuery<TickerInfo>({
    queryKey: ['tickerInfo', selectedSymbol],
    queryFn: async () => {
      const res = await fetch(`/api/quotes/ticker?symbol=${encodeURIComponent(selectedSymbol)}`)
      if (!res.ok) throw new Error('Not found')
      return res.json()
    },
    staleTime: 300_000,
    retry: 1,
  })

  const inWatchlist = useMemo(
    () => watchlistItems.some((i) => i.symbol.toUpperCase() === selectedSymbol.toUpperCase()),
    [watchlistItems, selectedSymbol],
  )

  const exchangeTz = useMemo(
    () => getExchangeTimezone(tickerInfo?.exchange_display || tickerInfo?.exchange),
    [tickerInfo?.exchange_display, tickerInfo?.exchange],
  )


  // Real-time quote with HIGH PRIORITY for research page and 5-second updates
  const { data: realtimeQuote, isLoading: quoteLoading } = useRealtimeQuote({ 
    symbol: selectedSymbol,
    refetchInterval: 15_000, // Update every 15 seconds
    priority: 'high', // High priority - will wait if rate limited
    useFinnhub: true // Use Finnhub for real-time data
  })

  useEffect(() => {
    if (symbolParam && symbolParam !== selectedSymbol) {
      setSelectedSymbol(symbolParam.toUpperCase())
    }
  }, [symbolParam])

  useEffect(() => {
    if (!advancedOpen) return
    const onDoc = (e: MouseEvent) => {
      if (advancedRef.current && !advancedRef.current.contains(e.target as Node)) {
        setAdvancedOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [advancedOpen])

  const loadSymbolData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const { start: startDate, end: endDate, barLimit } = chartPeriodRange(chartPeriod)

      let prices: PriceBar[] = []

      if (isIntradayPeriod(chartPeriod)) {
        // Intraday: 1D = 1min bars, 5D = 5min bars
        const interval = chartPeriod === '1D' ? '1m' : '5m'
        const days = chartPeriod === '1D' ? 1 : 5
        prices = await fetchIntradayPrices(selectedSymbol, interval, days, extendedHours).catch(() => [])
      } else {
        // Daily bars
        prices = await fetchPrices(
          selectedSymbol,
          startDate.toISOString(),
          endDate.toISOString(),
          barLimit
        ).catch(() => [])

        if (prices.length === 0) {
          try {
            const apiBase = process.env.NEXT_PUBLIC_API_URL || ''
            const syncParams = new URLSearchParams({ start: startDate.toISOString(), end: endDate.toISOString() })
            await fetch(`${apiBase}/api/v1/prices/${selectedSymbol}/sync?${syncParams}`, { method: 'POST' })

            await new Promise((resolve) => setTimeout(resolve, 2000))
            prices = await fetchPrices(
              selectedSymbol,
              startDate.toISOString(),
              endDate.toISOString(),
              barLimit
            ).catch(() => [])
          } catch (syncErr) {
            console.warn('Sync attempt failed:', syncErr)
          }
        }
      }
      
      const [ind, fund] = await Promise.all([
        fetchIndicators(selectedSymbol).catch(() => null),
        fetchFundamentals(selectedSymbol).catch(() => null)
      ])
      
      setPriceData(prices)
      setIndicators(ind)
      setFundamentals(fund)
      
      if (prices.length === 0) {
        setError('No price data available. Click "Sync Data" to fetch.')
      }
    } catch (err) {
      console.error('Error loading symbol data:', err)
      setError('Failed to load data. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [selectedSymbol, chartPeriod, extendedHours])

  useEffect(() => {
    loadSymbolData()
  }, [loadSymbolData])

  const fetchAiAnalysis = useCallback(async (ind?: Indicators | null, price?: number, changePct?: number, volume?: number) => {
    if (aiAbortRef.current) aiAbortRef.current.abort()
    aiAbortRef.current = new AbortController()
    setAiText('')
    setAiLoading(true)
    try {
      const body = {
        symbol: selectedSymbol,
        price,
        change_pct: changePct,
        rsi: ind?.indicators?.rsi,
        macd: ind?.indicators?.macd?.macd,
        macd_signal: ind?.indicators?.macd?.signal,
        sma_20: ind?.indicators?.sma_20,
        sma_50: ind?.indicators?.sma_50,
        sma_200: ind?.indicators?.sma_200,
        bb_upper: ind?.indicators?.bollinger_bands?.upper,
        bb_lower: ind?.indicators?.bollinger_bands?.lower,
        volume,
      }
      const res = await fetch('/api/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: aiAbortRef.current.signal,
      })
      if (!res.ok || !res.body) { setAiLoading(false); return }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        setAiText((prev) => prev + decoder.decode(value, { stream: true }))
      }
    } catch (e: unknown) {
      if ((e as { name?: string }).name !== 'AbortError') setAiText('')
    } finally {
      setAiLoading(false)
    }
  }, [selectedSymbol])

  const handleSyncData = async () => {
    setSyncing(true)
    setError(null)
    try {
      await syncSymbol(selectedSymbol)

      const { start: startDate, end: endDate } = chartPeriodRange(chartPeriod)

      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL || ''
        const syncParams = new URLSearchParams({ start: startDate.toISOString(), end: endDate.toISOString() })
        await fetch(`${apiBase}/api/v1/prices/${selectedSymbol}/sync?${syncParams}`, { method: 'POST' })
      } catch (syncErr) {
        console.warn('Price sync failed, continuing with regular fetch:', syncErr)
      }

      await loadSymbolData()
    } catch (err) {
      console.error('Error syncing:', err)
      setError('Failed to sync data. Please try again.')
    } finally {
      setSyncing(false)
    }
  }

  const handleWatchlistToggle = async () => {
    if (watchlistBusy) return
    setWatchlistBusy(true)
    try {
      if (inWatchlist) {
        await removeFromWatchlist(selectedSymbol)
        toast.success(`${selectedSymbol.toUpperCase()} removed from watchlist`)
      } else {
        await addToWatchlist({ symbol: selectedSymbol })
        toast.success(`${selectedSymbol.toUpperCase()} added to watchlist`)
      }
      await queryClient.invalidateQueries({ queryKey: ['watchlist'] })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Watchlist action failed'
      if (/already/i.test(msg)) toast.warning(msg)
      else toast.error(msg)
    } finally {
      setWatchlistBusy(false)
    }
  }

  const getPriceInfo = () => {
    // Ignore realtime rows that are placeholders (fetchQuote returns zeros on failure)
    if (realtimeQuote && isNumber(realtimeQuote.price) && realtimeQuote.price > 0) {
      return {
        price: realtimeQuote.price,
        change: realtimeQuote.change ?? 0,
        percent: realtimeQuote.change_percent ?? 0,
        volume: realtimeQuote.volume,
        high: realtimeQuote.high,
        low: realtimeQuote.low,
        dataSource: realtimeQuote.data_source,
        latency: realtimeQuote.latency_ms,
      }
    }
    if (priceData.length < 2) return { price: 0, change: 0, percent: 0, volume: undefined as number | undefined }
    const latest = priceData[priceData.length - 1]
    const previous = priceData[priceData.length - 2]
    const change = latest.close - previous.close
    const percent = previous.close !== 0 ? (change / previous.close) * 100 : 0
    return { price: latest.close, change, percent, volume: latest.volume }
  }

  const priceInfo = getPriceInfo()
  const pricePrevRef = useRef<number | null>(null)
  const [priceTick, setPriceTick] = useState<'up' | 'down' | null>(null)

  useEffect(() => {
    const p = priceInfo.price
    if (!isNumber(p) || p <= 0) return
    const prev = pricePrevRef.current
    pricePrevRef.current = p
    if (prev === null || !isNumber(prev) || prev <= 0) return
    if (Math.abs(p - prev) < 1e-6) return
    setPriceTick(p > prev ? 'up' : 'down')
    const id = window.setTimeout(() => setPriceTick(null), 900)
    return () => window.clearTimeout(id)
  }, [priceInfo.price])
  const isPositive = isNumber(priceInfo.percent) ? priceInfo.percent >= 0 : false
  const quoteActivityFingerprint = Math.round(
    ((priceInfo.price || 0) * 1000 + (priceInfo.percent || 0) * 10000) / 10
  ) / 100

  const aiReport = useMemo(() => {
    const ind = indicators?.indicators
    const rsi = ind?.rsi
    const macdObj = ind?.macd
    const bb = ind?.bollinger_bands
    const p = priceInfo.price
    const sma20 = ind?.sma_20
    const sma50 = ind?.sma_50
    const sma200 = ind?.sma_200

    let macdText = 'MACD is not available for this symbol yet — sync data if you expect it.'
    if (macdObj && isNumber(macdObj.macd) && isNumber(macdObj.signal)) {
      const d = macdObj.macd - macdObj.signal
      macdText =
        d > 0
          ? 'MACD line sits above its signal line, which often accompanies bullish momentum shifts.'
          : d < 0
            ? 'MACD line sits below its signal line, which often accompanies bearish momentum shifts.'
            : 'MACD and signal are effectively tied — short-term momentum is in balance.'
    }

    let bbText = 'Bollinger Band width and position are unavailable.'
    if (bb && isNumber(bb.upper) && isNumber(bb.lower) && isNumber(bb.middle) && isNumber(p)) {
      const range = bb.upper - bb.lower
      if (range > 0) {
        const pos = (p - bb.lower) / range
        const pct = (pos * 100).toFixed(0)
        if (pos > 0.85) {
          bbText = `Price is in the upper fifth of the band (${pct}% of the range) — watch for extension vs. mean reversion.`
        } else if (pos < 0.15) {
          bbText = `Price is in the lower fifth of the band (${pct}% of the range) — bounce risk or trend continuation depending on volume.`
        } else {
          bbText = `Price trades near the middle of the bands (${pct}% of range), away from volatility extremes.`
        }
      }
    }

    const parts: string[] = []
    if (isNumber(p) && isNumber(sma20)) parts.push(p > sma20 ? 'above the 20-day SMA' : 'at or under the 20-day SMA')
    if (isNumber(p) && isNumber(sma50)) parts.push(p > sma50 ? 'above the 50-day SMA' : 'at or under the 50-day SMA')
    if (isNumber(p) && isNumber(sma200)) {
      parts.push(p > sma200 ? 'above the 200-day SMA (long-term bid often intact)' : 'under the 200-day SMA (long-term trend pressure)')
    }

    let stackNote = ''
    if (isNumber(sma20) && isNumber(sma50) && isNumber(sma200)) {
      if (sma20 > sma50 && sma50 > sma200) stackNote = ' SMAs stack bullish (20 over 50 over 200).'
      else if (sma20 < sma50 && sma50 < sma200) stackNote = ' SMAs stack bearish (20 under 50 under 200).'
      else stackNote = ' SMA alignment is mixed — the trend regime looks transitional.'
    }

    const maSummary =
      parts.length > 0 ? `Relative to moving averages, price is ${parts.join(', ')}.${stackNote}` : 'Moving-average context needs synced indicator data.'

    let sentiment: 'Bullish' | 'Bearish' | 'Neutral' = 'Neutral'
    if (isNumber(rsi) && isNumber(p) && isNumber(sma50)) {
      let bull = 0
      let bear = 0
      if (rsi > 52) bull += 1
      else if (rsi < 48) bear += 1
      if (p > sma50) bull += 1
      else bear += 1
      if (macdObj && isNumber(macdObj.macd) && isNumber(macdObj.signal)) {
        if (macdObj.macd > macdObj.signal) bull += 1
        else if (macdObj.macd < macdObj.signal) bear += 1
      }
      if (bull >= 2 && bull > bear) sentiment = 'Bullish'
      else if (bear >= 2 && bear > bull) sentiment = 'Bearish'
    }

    const bullets: string[] = []
    if (isNumber(rsi)) {
      bullets.push(
        `RSI(14) is ${formatNumber(rsi, 1)} — ${
          rsi > 70 ? 'stretched toward overbought' : rsi < 30 ? 'stretched toward oversold' : 'in a neutral band'
        }.`,
      )
    }
    if (isNumber(priceInfo.percent)) {
      bullets.push(
        `Change vs prior close: ${priceInfo.percent >= 0 ? '+' : ''}${formatPercent(priceInfo.percent, 2)}.`,
      )
    }
    if (isNumber(priceInfo.volume) && priceInfo.volume > 0) {
      bullets.push(`Volume: about ${formatNumber(priceInfo.volume / 1e6, 2)}M shares on this print.`)
    }

    return {
      sentiment,
      rsiSignal: isNumber(rsi) ? (rsi > 70 ? 'Overbought' : rsi < 30 ? 'Oversold' : 'Neutral') : 'N/A',
      trendSignal: isNumber(p) && isNumber(sma50) ? (p > sma50 ? 'Above SMA 50' : 'Below SMA 50') : 'N/A',
      macdText,
      bbText,
      maSummary,
      bullets,
    }
  }, [indicators, priceInfo])

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
            <div className="hud-panel h-full flex flex-col overflow-hidden">
              <ResearchChartHeader
                selectedSymbol={selectedSymbol}
                tickerInfo={tickerInfo}
                companyNameFallback={fundamentals?.company_name}
                profileLoading={tickerInfoLoading}
                chartPeriod={chartPeriod}
                chartSeriesType={chartSeriesType}
                chartShowMa={chartShowMa}
                setChartPeriod={setChartPeriod}
                setChartSeriesType={setChartSeriesType}
                setChartShowMa={setChartShowMa}
                chartShowVolume={chartShowVolume}
                setChartShowVolume={setChartShowVolume}
                chartLogScale={chartLogScale}
                setChartLogScale={setChartLogScale}
                chartShowGrid={chartShowGrid}
                setChartShowGrid={setChartShowGrid}
                priceInfo={priceInfo}
                quoteLoading={quoteLoading}
                priceTick={priceTick}
                quoteActivityFingerprint={quoteActivityFingerprint}
                priceDataLength={priceData.length}
                advancedOpen={advancedOpen}
                setAdvancedOpen={setAdvancedOpen}
                advancedRef={advancedRef}
                inWatchlist={inWatchlist}
                watchlistBusy={watchlistBusy}
                onWatchlistToggle={handleWatchlistToggle}
                onSyncData={handleSyncData}
                syncing={syncing}
              />

              {/* Indicator Toolbar */}
              <IndicatorToolbar
                activeOverlays={activeOverlays}
                activePanes={activePanes}
                onToggleOverlay={(id) => setActiveOverlays((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])}
                onTogglePane={(id) => setActivePanes((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])}
                extendedHours={extendedHours}
                onToggleExtendedHours={() => setExtendedHours((v) => !v)}
              />

              {/* Chart Area */}
              <div className="flex-1 relative min-h-[300px]">
                {/* Fullscreen button */}
                {!loading && !error && priceData.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setFullscreenChart(true)}
                    className="absolute top-2 right-2 z-10 p-1.5 rounded-lg bg-surface-raised border border-line-default text-fg-muted hover:text-white hover:bg-surface-active transition-colors"
                    title="Fullscreen chart"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5h-4m4 0v-4m0 4l-5-5" />
                    </svg>
                  </button>
                )}
                {loading ? (
                  <SkeletonChart />
                ) : error ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <AlertTriangle className="w-12 h-12 text-yellow-500 mb-4" />
                    <p className="text-sm text-fg-muted mb-3">{error}</p>
                    <button 
                      onClick={handleSyncData}
                      className="hud-card px-4 py-2 text-sm text-blue-400 hover:text-white transition-colors"
                    >
                      Click to sync data →
                    </button>
                  </div>
                ) : (
                  <Chart
                    data={priceData}
                    symbol={selectedSymbol}
                    seriesType={chartSeriesType}
                    activeOverlays={chartShowMa ? activeOverlays : activeOverlays.filter(id => !['sma20', 'ema50'].includes(id))}
                    activePanes={chartShowVolume ? activePanes : activePanes.filter(id => id !== 'volume')}
                    logScale={chartLogScale}
                    showGrid={chartShowGrid}
                    exchangeTimezone={exchangeTz}
                  />
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
                  <h3 className="font-bold text-sm text-fg-primary">Technical Indicators</h3>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <SkeletonIndicators />
                ) : (
                  <div className="p-3 space-y-2">
                    {technicalData.map((item) => (
                      <div key={item.label} className="hud-stat p-3 flex items-center justify-between">
                        <span className="text-xs text-fg-muted">{item.label}</span>
                        <span className="text-sm font-mono text-fg-primary hud-value">
                          {item.format === 'price'
                            ? (isNumber(item.value) ? `$${formatNumber(item.value, 2)}` : 'N/A')
                            : formatNumber(item.value, 2)
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
                    <span className="text-xs text-fg-muted">RSI Signal</span>
                    <span className={`text-xs font-bold px-2 py-1 rounded ${
                      aiReport.rsiSignal === 'Overbought' ? 'bg-red-500/10 text-red-400' :
                      aiReport.rsiSignal === 'Oversold' ? 'bg-green-500/10 text-green-400' :
                      'bg-surface-raised text-fg-secondary'
                    }`}>
                      {aiReport.rsiSignal}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-fg-muted">Trend</span>
                    <span className="text-xs font-bold px-2 py-1 rounded bg-surface-raised text-fg-secondary">
                      {aiReport.trendSignal}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* AI Analysis Panel */}
          <div className="col-span-12 lg:col-span-6">
            <div className="hud-panel p-5 h-full flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-blue-400" />
                  <h3 className="font-bold text-sm text-fg-primary">AI Analysis</h3>
                  {aiText && !aiLoading && (
                    <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                      Gemini Flash
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 justify-end">
                  <span
                    className={`text-xs font-bold px-3 py-1 rounded-lg border ${
                      aiReport.sentiment === 'Bullish'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                        : aiReport.sentiment === 'Bearish'
                          ? 'bg-red-500/10 text-red-400 border-red-500/25'
                          : 'bg-amber-500/10 text-amber-300 border-amber-500/25'
                    }`}
                  >
                    {aiReport.sentiment}
                  </span>
                  <button
                    onClick={() => fetchAiAnalysis(indicators, priceInfo.price ?? undefined, priceInfo.percent ?? undefined, priceInfo.volume ?? undefined)}
                    disabled={aiLoading}
                    className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg border border-blue-500/30 bg-blue-500/8 text-blue-400 hover:bg-blue-500/15 transition-colors disabled:opacity-50"
                    title="Refresh with real-time AI analysis"
                  >
                    {aiLoading
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <RefreshCw className="w-3 h-3" />}
                    {aiLoading ? 'Generating…' : 'AI Refresh'}
                  </button>
                </div>
              </div>

              <div className="space-y-3 text-sm text-fg-muted leading-relaxed flex-1">
                {/* OpenRouter AI text — shown when available */}
                {aiText ? (
                  <div className="space-y-3">
                    <p className="text-fg-secondary leading-relaxed text-[13px]">
                      {aiText}
                      {aiLoading && <span className="inline-block w-1.5 h-4 bg-blue-400 ml-0.5 animate-pulse align-middle rounded-sm" />}
                    </p>
                    <div className="flex flex-wrap gap-2 text-[10px]">
                      <span className="px-2 py-0.5 rounded bg-surface-raised border border-line-subtle text-fg-muted">
                        RSI: {aiReport.rsiSignal}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-surface-raised border border-line-subtle text-fg-muted">
                        Trend: {aiReport.trendSignal}
                      </span>
                    </div>
                  </div>
                ) : (
                  /* Rules-based fallback */
                  <>
                    <p>
                      Snapshot for <span className="text-blue-400 font-semibold">{selectedSymbol}</span> combines
                      momentum (RSI, MACD) with structure (moving averages and Bollinger position). It is a rules-based
                      synthesis, not a prediction — use it as a starting point alongside your own process.
                    </p>
                    <p>{aiReport.macdText}</p>
                    <p>{aiReport.bbText}</p>
                    <p>{aiReport.maSummary}</p>
                    {aiReport.bullets.length > 0 && (
                      <ul className="list-disc pl-5 space-y-1.5 text-fg-secondary text-[13px]">
                        {aiReport.bullets.map((b, i) => (
                          <li key={i}>{b}</li>
                        ))}
                      </ul>
                    )}
                    <div className="text-[11px] text-fg-muted flex items-center gap-1.5 mt-1">
                      <Sparkles className="w-3 h-3" />
                      Click "AI Refresh" above for a real-time Gemini-powered read
                    </div>
                  </>
                )}
                <p className="text-[11px] text-fg-muted border-t border-line-subtle pt-3 leading-snug">
                  Not investment advice. Verify levels on your chart before acting.
                </p>
              </div>

              {priceData.length > 0 && (
                <div className="grid grid-cols-3 gap-3 mt-auto">
                  <div className="hud-stat p-3 text-center">
                    <div
                      className={`text-lg font-bold text-fg-primary hud-value ${
                        priceTick === 'up'
                          ? 'quote-price-flash-up'
                          : priceTick === 'down'
                            ? 'quote-price-flash-down'
                            : ''
                      }`}
                    >
                      ${formatNumber(priceInfo.price, 2)}
                    </div>
                    <div className="text-[10px] text-fg-muted">CURRENT</div>
                  </div>
                  <div className="hud-stat p-3 text-center">
                    <div className={`text-lg font-bold hud-value ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                      {isPositive ? '+' : ''}
                      {formatNumber(priceInfo.change, 2)}
                    </div>
                    <div className="text-[10px] text-fg-muted">CHANGE</div>
                  </div>
                  <div className="hud-stat p-3 text-center">
                    <div className={`text-lg font-bold hud-value ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                      {isPositive ? '+' : ''}
                      {formatPercent(priceInfo.percent, 2)}
                    </div>
                    <div className="text-[10px] text-fg-muted">PERCENT</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Technical Analysis Gauges – below AI Analysis */}
          <div className="col-span-12 lg:col-span-6">
            <TechnicalAnalysisGauge
              indicators={indicators}
              price={priceInfo.price}
              loading={loading}
            />
          </div>

          {/* Key Factors Panel */}
          <div className="col-span-12 lg:col-span-6">
            <KeyFactorsPanel
              indicators={indicators}
              fundamentals={fundamentals}
              price={priceInfo.price}
              loading={loading}
            />
          </div>

          {/* Fundamentals Panel */}
          <div className="col-span-12 lg:col-span-6">
            <FundamentalsPanel
              fundamentals={fundamentals}
              price={priceInfo.price}
              loading={loading}
              onSync={handleSyncData}
              syncing={syncing}
            />
          </div>

          <CompanyFolioPanel
            symbol={selectedSymbol}
            info={tickerInfo}
            isLoading={tickerInfoLoading}
          />

          {/* Earnings, Short Interest & Key Stats */}
          <div className="col-span-12">
            <EarningsShortInterestPanel
              symbol={selectedSymbol}
              tickerInfo={tickerInfo}
            />
          </div>

          {/* Option Chain with Greeks (Public.com) */}
          <OptionChainPanel symbol={selectedSymbol} />

          {/* SEC EDGAR Fundamentals & Filings */}
          <SecEdgarPanel symbol={selectedSymbol} />

          {/* Live News Section */}
          <div className="col-span-12">
            <div className="relative hud-panel overflow-hidden">
              <div
                className="pointer-events-none absolute inset-0 opacity-30"
                aria-hidden
              >
                <div className="absolute inset-0 animate-research-flow bg-[length:400%_400%] bg-gradient-to-r from-slate-800/40 via-blue-950/30 to-slate-800/40" />
              </div>
              <div className="relative flex flex-wrap items-center gap-2 border-b border-blue-500/10 p-4">
                <div className="flex items-center gap-2">
                  <TickerLogo
                    symbol={selectedSymbol}
                    companyName={tickerInfo?.name}
                    size={36}
                    className="rounded-lg border border-blue-500/20"
                  />
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-blue-500/25 bg-blue-500/10">
                    <Newspaper className="h-5 w-5 text-blue-400" />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-display font-bold text-fg-primary">
                    {tickerInfo?.name ? (
                      <>
                        <span className="text-fg-muted">News · </span>
                        {tickerInfo.name}
                      </>
                    ) : (
                      <>{selectedSymbol} Live News</>
                    )}
                  </h3>
                  <p className="text-[10px] text-fg-muted">Headlines and filings-driven flow for this symbol</p>
                </div>
                <span className="rounded border border-line-default bg-surface-raised px-2 py-1 font-mono text-[10px] uppercase text-fg-muted">
                  Real-time
                </span>
                <QuoteActivityFlash fingerprint={quoteActivityFingerprint} />
              </div>
              <div className="p-4">
                <LiveNews symbol={selectedSymbol} limit={8} showTitle={false} />
              </div>
            </div>

          </div>

        </div>
      </div>
      <FullscreenChartModal
        isOpen={fullscreenChart}
        onClose={() => setFullscreenChart(false)}
        symbol={selectedSymbol}
        priceData={priceData}
        chartSeriesType={chartSeriesType}
        chartShowMa={chartShowMa}
        exchangeTimezone={exchangeTz}
      />
    </AppLayout>
  )
}

function DesktopResearchPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-surface-base flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Skeleton className="w-12 h-12 rounded-full" />
            <SkeletonText className="h-4 w-32" />
          </div>
        </div>
      }
    >
      <ResearchContent />
    </Suspense>
  )
}

export default function ResearchPage() {
  return (
    <>
      <div className="hidden md:block">
        <DesktopResearchPage />
      </div>
      <div className="md:hidden">
        <Suspense
          fallback={
            <MobileLayout>
              <div className="min-h-[60vh] flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                  <Skeleton className="w-12 h-12 rounded-full" />
                  <SkeletonText className="h-4 w-32" />
                </div>
              </div>
            </MobileLayout>
          }
        >
          <MobileLayout>
            <MobileResearch />
          </MobileLayout>
        </Suspense>
      </div>
    </>
  )
}
