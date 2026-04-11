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
import {
  Sparkles, TrendingUp, TrendingDown, RefreshCw, AlertTriangle,
  BarChart3, Newspaper, Loader2, Globe, Building2, Users, ExternalLink,
  DollarSign, Target, Info, SlidersHorizontal, X, Star,
} from 'lucide-react'
import {
  fetchPrices,
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

type ChartPeriod = '1M' | '3M' | '6M' | '1Y' | '2Y' | '5Y'

function chartPeriodRange(period: ChartPeriod): { start: Date; end: Date; barLimit: number } {
  const end = new Date()
  const start = new Date(end)
  const dayMap: Record<ChartPeriod, number> = {
    '1M': 35,
    '3M': 98,
    '6M': 190,
    '1Y': 370,
    '2Y': 750,
    '5Y': 1900,
  }
  start.setUTCDate(start.getUTCDate() - dayMap[period])
  const barLimit = Math.min(5000, Math.ceil(dayMap[period] * 1.25))
  return { start, end, barLimit }
}

// ─── Global Ticker Info Panel ─────────────────────────────────────────────────
function CompanyBioSection({ info }: { info: TickerInfo | undefined }) {
  const [bioExpanded, setBioExpanded] = useState(false)

  if (!info || !info.name) return null

  const fmtBig = (n: number) => {
    if (!n || !isFinite(n)) return '—'
    if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
    return `$${formatNumber(n, 0)}`
  }
  const fmtPct = (n: number) => (n && isFinite(n) ? `${n.toFixed(2)}%` : '—')
  const fmtNum = (n: number, d = 2) => (n && isFinite(n) ? formatNumber(n, d) : '—')

  const recColor = (r: string) =>
    r === 'buy' || r === 'strongBuy'
      ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
      : r === 'sell' || r === 'strongSell'
      ? 'text-red-400 bg-red-500/10 border-red-500/20'
      : 'text-amber-400 bg-amber-500/10 border-amber-500/20'

  const marginBar = (label: string, value: number) => {
    const isValid = value && isFinite(value)
    const color = value > 20 ? 'bg-emerald-500' : value > 10 ? 'bg-cyan-500' : value > 0 ? 'bg-amber-500' : 'bg-red-500'
    return (
      <div>
        <div className="flex justify-between mb-0.5">
          <span className="text-[10px] text-slate-500">{label}</span>
          <span className={`text-[10px] font-bold font-mono ${value > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {isValid ? `${value.toFixed(1)}%` : '—'}
          </span>
        </div>
        {isValid && (
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(Math.abs(value), 100)}%` }} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="col-span-12 space-y-4">

      {/* ── Company Profile Card ──────────────────────────────────── */}
      <div className="hud-panel overflow-hidden">
        <div className="p-4 border-b border-slate-700/30">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <Building2 className="w-5 h-5 text-[#007AFF]" />
                <h3 className="text-base font-bold text-white">About {info.name}</h3>
                {info.recommendation && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${recColor(info.recommendation)}`}>
                    {info.recommendation.replace('strong', 'Strong ').toUpperCase()}
                    {info.analyst_count ? ` (${info.analyst_count})` : ''}
                  </span>
                )}
              </div>

              {/* Tags row */}
              <div className="flex items-center gap-2 flex-wrap mb-3">
                {info.sector && (
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-violet-500/10 border border-violet-500/20 text-violet-400 rounded-md">
                    {info.sector}
                  </span>
                )}
                {info.industry && (
                  <span className="text-[10px] px-2 py-0.5 bg-slate-800/60 text-slate-400 rounded-md">
                    {info.industry}
                  </span>
                )}
                {info.country && (
                  <span className="text-[10px] text-slate-500 flex items-center gap-1">
                    <Globe className="w-3 h-3" />{info.country}
                  </span>
                )}
                {info.employees > 0 && (
                  <span className="text-[10px] text-slate-500 flex items-center gap-1">
                    <Users className="w-3 h-3" />{info.employees.toLocaleString()} employees
                  </span>
                )}
                {info.exchange_display && (
                  <span className="text-[10px] font-mono px-2 py-0.5 bg-slate-800/60 text-slate-500 rounded-md">
                    {info.exchange_display} · {info.currency}
                  </span>
                )}
              </div>

              {/* Description */}
              {info.description && (
                <div>
                  <p className={`text-[11px] text-slate-400 leading-relaxed ${bioExpanded ? '' : 'line-clamp-3'}`}>
                    {info.description}
                  </p>
                  {info.description.length > 200 && (
                    <button
                      onClick={() => setBioExpanded(e => !e)}
                      className="text-[10px] text-[#007AFF] hover:text-blue-300 mt-1 transition-colors"
                    >
                      {bioExpanded ? 'Show less' : 'Read more'}
                    </button>
                  )}
                </div>
              )}
            </div>

            {info.website && (
              <a href={info.website} target="_blank" rel="noopener noreferrer"
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700/60 text-[11px] text-slate-400 hover:text-white hover:border-[rgba(0,122,255,0.4)] transition-colors"
              >
                <ExternalLink className="w-3 h-3" /> Website
              </a>
            )}
          </div>
        </div>

        {/* ── Leadership Team ──────────────────────────────── */}
        {info.officers && info.officers.length > 0 && (
          <div className="px-4 py-3 border-b border-slate-800/40">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 font-bold">Leadership</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {info.officers.slice(0, 4).map((o, i) => (
                <div key={i} className="flex items-center gap-2 px-2.5 py-2 bg-slate-800/20 rounded-lg">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500/20 to-violet-500/20 border border-slate-700/50 flex items-center justify-center text-[10px] font-bold text-slate-300">
                    {o.name?.split(' ').map(w => w[0]).join('').slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold text-white truncate">{o.name}</div>
                    <div className="text-[9px] text-slate-500 truncate">{o.title}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Financials Grid ────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 divide-x divide-y divide-slate-800/40">
          {[
            { label: 'Market Cap', value: fmtBig(info.market_cap), icon: '📊' },
            { label: 'Enterprise Val', value: fmtBig(info.enterprise_value) },
            { label: 'Revenue', value: fmtBig(info.revenue) },
            { label: 'Rev Growth', value: fmtPct(info.revenue_growth), highlight: info.revenue_growth > 0 },
            { label: 'Net Income', value: fmtBig(info.net_income) },
            { label: 'EBITDA', value: fmtBig(info.ebitda) },
            { label: 'Free Cash Flow', value: fmtBig(info.free_cash_flow) },
            { label: 'Op. Cash Flow', value: fmtBig(info.operating_cashflow) },
            { label: 'P/E Ratio', value: fmtNum(info.pe_ratio) },
            { label: 'Fwd P/E', value: fmtNum(info.forward_pe) },
            { label: 'PEG Ratio', value: fmtNum(info.peg_ratio) },
            { label: 'EPS', value: info.eps ? `$${fmtNum(info.eps)}` : '—' },
            { label: 'P/B', value: fmtNum(info.price_to_book) },
            { label: 'EV/EBITDA', value: fmtNum(info.enterprise_to_ebitda) },
            { label: 'EV/Revenue', value: fmtNum(info.enterprise_to_revenue) },
            { label: 'D/E Ratio', value: fmtNum(info.debt_to_equity) },
          ].map((m) => (
            <div key={m.label} className="p-3 flex flex-col gap-0.5">
              <span className="text-[9px] text-slate-600 uppercase tracking-wider">{m.label}</span>
              <span className={`text-xs font-bold font-mono ${(m as { highlight?: boolean }).highlight ? 'text-emerald-400' : 'text-white'}`}>
                {m.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Margins + Returns + Balance Sheet — 3-column ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Profitability Margins */}
        <div className="hud-panel p-4">
          <h4 className="text-xs font-bold text-white mb-3 flex items-center gap-2">
            <BarChart3 className="w-3.5 h-3.5 text-cyan-400" /> Profitability Margins
          </h4>
          <div className="space-y-2.5">
            {marginBar('Gross Margin', info.gross_margins)}
            {marginBar('Operating Margin', info.operating_margins)}
            {marginBar('EBITDA Margin', info.ebitda_margins)}
            {marginBar('Profit Margin', info.profit_margins)}
          </div>
        </div>

        {/* Returns + Efficiency */}
        <div className="hud-panel p-4">
          <h4 className="text-xs font-bold text-white mb-3 flex items-center gap-2">
            <Target className="w-3.5 h-3.5 text-emerald-400" /> Returns & Efficiency
          </h4>
          <div className="space-y-2">
            {[
              { label: 'Return on Equity', value: fmtPct(info.return_on_equity) },
              { label: 'Return on Assets', value: fmtPct(info.return_on_assets) },
              { label: 'Revenue Growth', value: fmtPct(info.revenue_growth) },
              { label: 'Beta', value: fmtNum(info.beta) },
            ].map(m => (
              <div key={m.label} className="flex justify-between items-center py-1.5 border-b border-slate-800/30 last:border-0">
                <span className="text-[11px] text-slate-500">{m.label}</span>
                <span className="text-[11px] font-bold font-mono text-white">{m.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Balance Sheet + Ownership */}
        <div className="hud-panel p-4">
          <h4 className="text-xs font-bold text-white mb-3 flex items-center gap-2">
            <DollarSign className="w-3.5 h-3.5 text-amber-400" /> Balance Sheet & Ownership
          </h4>
          <div className="space-y-2">
            {[
              { label: 'Total Cash', value: fmtBig(info.total_cash) },
              { label: 'Total Debt', value: fmtBig(info.total_debt) },
              { label: 'Shares Outstanding', value: info.shares_outstanding ? `${(info.shares_outstanding / 1e9).toFixed(2)}B` : '—' },
              { label: 'Insider Ownership', value: fmtPct(info.held_percent_insiders) },
              { label: 'Institutional', value: fmtPct(info.held_percent_institutions) },
              { label: 'Short % Float', value: fmtPct(info.short_percent_of_float) },
            ].map(m => (
              <div key={m.label} className="flex justify-between items-center py-1.5 border-b border-slate-800/30 last:border-0">
                <span className="text-[11px] text-slate-500">{m.label}</span>
                <span className="text-[11px] font-bold font-mono text-white">{m.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Price Range + Dividends + Analyst — full width ─ */}
      <div className="hud-panel overflow-hidden">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 divide-x divide-y divide-slate-800/40">
          {[
            { label: '52W High', value: info.week_52_high ? `$${fmtNum(info.week_52_high)}` : '—' },
            { label: '52W Low', value: info.week_52_low ? `$${fmtNum(info.week_52_low)}` : '—' },
            { label: 'Avg Volume', value: info.avg_volume ? `${(info.avg_volume / 1e6).toFixed(1)}M` : '—' },
            { label: 'Div Yield', value: fmtPct(info.dividend_yield) },
            { label: 'Div Rate', value: info.dividend_rate ? `$${fmtNum(info.dividend_rate)}` : '—' },
            { label: 'Target High', value: info.target_high ? `$${fmtNum(info.target_high)}` : '—' },
            { label: 'Target Low', value: info.target_low ? `$${fmtNum(info.target_low)}` : '—' },
            { label: 'Target Avg', value: info.target_price ? `$${fmtNum(info.target_price)}` : '—', highlight: true },
          ].map((m) => (
            <div key={m.label} className="p-3 flex flex-col gap-0.5">
              <span className="text-[9px] text-slate-600 uppercase tracking-wider">{m.label}</span>
              <span className={`text-xs font-bold font-mono ${(m as { highlight?: boolean }).highlight ? 'text-[#007AFF]' : 'text-white'}`}>
                {m.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
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
  const [advancedOpen, setAdvancedOpen] = useState(false)
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
  const { data: tickerInfo } = useQuery<TickerInfo>({
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

      let prices = await fetchPrices(
        selectedSymbol,
        startDate.toISOString(),
        endDate.toISOString(),
        barLimit
      ).catch(() => [])

      if (prices.length === 0) {
        try {
          const syncUrl = new URL(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/v1/prices/${selectedSymbol}/sync`)
          syncUrl.searchParams.append('start', startDate.toISOString())
          syncUrl.searchParams.append('end', endDate.toISOString())
          await fetch(syncUrl.toString(), { method: 'POST' })

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
  }, [selectedSymbol, chartPeriod])

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
        const syncUrl = new URL(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/v1/prices/${selectedSymbol}/sync`)
        syncUrl.searchParams.append('start', startDate.toISOString())
        syncUrl.searchParams.append('end', endDate.toISOString())
        await fetch(syncUrl.toString(), { method: 'POST' })
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
            <div className="hud-panel h-full flex flex-col">
              {/* Chart Header — Redesigned */}
              <div className="p-4 border-b border-blue-500/10 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div>
                    {/* Ticker + Company Name */}
                    <div className="flex items-center gap-3">
                      <h2 className="text-2xl font-black text-white tracking-tight">{selectedSymbol}</h2>
                      {tickerInfo?.exchange_display && (
                        <span className="text-[10px] font-mono px-2 py-0.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-md">
                          {tickerInfo.exchange_display}
                        </span>
                      )}
                      {realtimeQuote && !quoteLoading && (
                        <div className="flex items-center gap-1.5">
                          <QuoteActivityFlash fingerprint={quoteActivityFingerprint} />
                          {priceInfo.dataSource && (
                            <span className="text-[10px] text-emerald-400 font-mono px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded-md">
                              {priceInfo.dataSource}
                            </span>
                          )}
                          {priceInfo.latency && priceInfo.latency < 500 && (
                            <span className="text-[10px] text-blue-400 font-mono px-1.5 py-0.5 bg-blue-500/10 border border-blue-500/20 rounded-md">
                              {priceInfo.latency}ms
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {/* Company name + sector */}
                    {tickerInfo?.name && (
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-sm text-slate-400">{tickerInfo.name}</span>
                        {tickerInfo.sector && (
                          <span className="text-[10px] text-slate-500 px-1.5 py-0.5 bg-slate-800/60 rounded">
                            {tickerInfo.sector}
                          </span>
                        )}
                        {tickerInfo.industry && (
                          <span className="text-[10px] text-slate-600 hidden lg:inline">
                            {tickerInfo.industry}
                          </span>
                        )}
                      </div>
                    )}
                    {/* Price row */}
                    {(priceInfo.price > 0 || quoteLoading || priceData.length > 0) && (
                      <div className="flex items-center gap-3 mt-1.5">
                        <span
                          className={`text-2xl font-black text-white hud-value transition-colors duration-300 font-mono ${
                            priceTick === 'up'
                              ? 'quote-price-flash-up'
                              : priceTick === 'down'
                                ? 'quote-price-flash-down'
                                : ''
                          }`}
                        >
                          ${formatNumber(priceInfo.price, 2)}
                          {quoteLoading && <Loader2 className="inline w-4 h-4 ml-2 animate-spin text-blue-400" />}
                        </span>
                        <span className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-sm font-bold ${
                          isPositive
                            ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                            : 'bg-red-500/10 text-red-400 border border-red-500/20'
                        }`}>
                          {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                          {isPositive ? '+' : ''}{formatPercent(priceInfo.percent, 2)}
                        </span>
                        {isNumber(priceInfo.volume) && priceInfo.volume > 0 && (
                          <span className="text-[11px] text-slate-500 font-mono">
                            Vol: {formatNumber(priceInfo.volume / 1000000, 2)}M
                          </span>
                        )}
                        {tickerInfo && tickerInfo.target_price > 0 && (
                          <span className="text-[11px] text-[#007AFF] font-mono hidden sm:inline">
                            PT: ${formatNumber(tickerInfo.target_price, 2)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <span className="text-[10px] font-mono text-slate-500 px-2 py-1 rounded bg-slate-800/50 hidden sm:inline">
                    {chartPeriod} daily
                  </span>
                  <button
                    type="button"
                    onClick={handleWatchlistToggle}
                    disabled={watchlistBusy}
                    aria-pressed={inWatchlist}
                    className={`hud-card group flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all disabled:opacity-50 ${
                      inWatchlist
                        ? 'text-amber-300 border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/20'
                        : 'text-amber-500 hover:text-amber-400 hover:border-amber-500/30 bg-amber-500/5'
                    }`}
                  >
                    <Star
                      className={`w-4 h-4 shrink-0 ${inWatchlist ? 'fill-amber-400 text-amber-300' : 'text-amber-500 group-hover:fill-amber-400/40'}`}
                      aria-hidden
                    />
                    {watchlistBusy ? 'Saving…' : inWatchlist ? 'In watchlist' : 'Add watchlist'}
                  </button>
                  <button
                    type="button"
                    onClick={handleSyncData}
                    disabled={syncing}
                    className="hud-card flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-300 hover:text-white hover:border-blue-500/30 transition-all disabled:opacity-50"
                  >
                    {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    Sync Data
                  </button>
                  <div className="relative" ref={advancedRef}>
                    <button
                      type="button"
                      onClick={() => setAdvancedOpen((o) => !o)}
                      className={`hud-card flex items-center gap-2 px-4 py-2 text-sm font-medium border transition-all ${
                        advancedOpen
                          ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                          : 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border-blue-500/30'
                      }`}
                      aria-expanded={advancedOpen}
                      aria-haspopup="dialog"
                    >
                      <SlidersHorizontal className="w-4 h-4" />
                      Advanced
                    </button>
                    {advancedOpen ? (
                      <div
                        className="absolute right-0 top-full mt-2 z-[80] w-[min(100vw-2rem,18rem)] rounded-xl border border-slate-700/80 bg-[#0b0f14] shadow-2xl p-4 space-y-4 text-left"
                        role="dialog"
                        aria-label="Chart options"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-white">Chart</span>
                          <button
                            type="button"
                            onClick={() => setAdvancedOpen(false)}
                            className="p-1 rounded text-slate-500 hover:text-white"
                            aria-label="Close"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-2">Period</div>
                          <div className="flex flex-wrap gap-1.5">
                            {(
                              [
                                ['1M', '1M'],
                                ['3M', '3M'],
                                ['6M', '6M'],
                                ['1Y', '1Y'],
                              ] as const
                            ).map(([id, label]) => (
                              <button
                                key={id}
                                type="button"
                                onClick={() => setChartPeriod(id)}
                                className={`px-2.5 py-1 rounded-md text-[11px] font-mono border transition-colors ${
                                  chartPeriod === id
                                    ? 'bg-blue-500/25 text-blue-200 border-blue-500/50'
                                    : 'bg-slate-800/50 text-slate-400 border-slate-700/60 hover:text-white'
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-2">Series</div>
                          <div className="flex flex-wrap gap-1.5">
                            {(
                              [
                                ['candlestick', 'OHLC'],
                                ['line', 'Line'],
                                ['area', 'Area'],
                              ] as const
                            ).map(([id, label]) => (
                              <button
                                key={id}
                                type="button"
                                onClick={() => setChartSeriesType(id)}
                                className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                                  chartSeriesType === id
                                    ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/45'
                                    : 'bg-slate-800/50 text-slate-400 border-slate-700/60 hover:text-white'
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={chartShowMa}
                            onChange={(e) => setChartShowMa(e.target.checked)}
                            disabled={chartSeriesType !== 'candlestick'}
                            className="rounded border-slate-600"
                          />
                          <span className={chartSeriesType !== 'candlestick' ? 'opacity-40' : ''}>
                            SMA 20 / EMA 50 overlays
                          </span>
                        </label>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              
              {/* Chart Area */}
              <div className="flex-1 relative min-h-[300px]">
                {loading ? (
                  <SkeletonChart />
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
                  <Chart
                    data={priceData}
                    symbol={selectedSymbol}
                    seriesType={chartSeriesType}
                    showMovingAverages={chartShowMa && chartSeriesType === 'candlestick'}
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
                  <h3 className="font-bold text-sm text-white">Technical Indicators</h3>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <SkeletonIndicators />
                ) : (
                  <div className="p-3 space-y-2">
                    {technicalData.map((item) => (
                      <div key={item.label} className="hud-stat p-3 flex items-center justify-between">
                        <span className="text-xs text-slate-400">{item.label}</span>
                        <span className="text-sm font-mono text-white hud-value">
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
            <div className="hud-panel p-5 h-full flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-blue-400" />
                  <h3 className="font-bold text-sm text-white">AI Analysis</h3>
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

              <div className="space-y-3 text-sm text-slate-400 leading-relaxed flex-1">
                {/* OpenRouter AI text — shown when available */}
                {aiText ? (
                  <div className="space-y-3">
                    <p className="text-slate-300 leading-relaxed text-[13px]">
                      {aiText}
                      {aiLoading && <span className="inline-block w-1.5 h-4 bg-blue-400 ml-0.5 animate-pulse align-middle rounded-sm" />}
                    </p>
                    <div className="flex flex-wrap gap-2 text-[10px]">
                      <span className="px-2 py-0.5 rounded bg-slate-800/60 border border-slate-700/50 text-slate-500">
                        RSI: {aiReport.rsiSignal}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-800/60 border border-slate-700/50 text-slate-500">
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
                      <ul className="list-disc pl-5 space-y-1.5 text-slate-300 text-[13px]">
                        {aiReport.bullets.map((b, i) => (
                          <li key={i}>{b}</li>
                        ))}
                      </ul>
                    )}
                    <div className="text-[11px] text-slate-600 flex items-center gap-1.5 mt-1">
                      <Sparkles className="w-3 h-3" />
                      Click "AI Refresh" above for a real-time Gemini-powered read
                    </div>
                  </>
                )}
                <p className="text-[11px] text-slate-500 border-t border-slate-700/40 pt-3 leading-snug">
                  Not investment advice. Verify levels on your chart before acting.
                </p>
              </div>

              {priceData.length > 0 && (
                <div className="grid grid-cols-3 gap-3 mt-auto">
                  <div className="hud-stat p-3 text-center">
                    <div
                      className={`text-lg font-bold text-white hud-value ${
                        priceTick === 'up'
                          ? 'quote-price-flash-up'
                          : priceTick === 'down'
                            ? 'quote-price-flash-down'
                            : ''
                      }`}
                    >
                      ${formatNumber(priceInfo.price, 2)}
                    </div>
                    <div className="text-[10px] text-slate-500">CURRENT</div>
                  </div>
                  <div className="hud-stat p-3 text-center">
                    <div className={`text-lg font-bold hud-value ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                      {isPositive ? '+' : ''}
                      {formatNumber(priceInfo.change, 2)}
                    </div>
                    <div className="text-[10px] text-slate-500">CHANGE</div>
                  </div>
                  <div className="hud-stat p-3 text-center">
                    <div className={`text-lg font-bold hud-value ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                      {isPositive ? '+' : ''}
                      {formatPercent(priceInfo.percent, 2)}
                    </div>
                    <div className="text-[10px] text-slate-500">PERCENT</div>
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

          {/* Company Bio + Financials (Yahoo Finance) */}
          <CompanyBioSection info={tickerInfo} />

          {/* Live News Section */}
          <div className="col-span-12">
            <div className="hud-panel">
              <div className="p-4 border-b border-blue-500/10 flex items-center gap-2">
                <Newspaper className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-white">{selectedSymbol} Live News</h3>
                <span className="ml-auto text-xs text-slate-500 font-mono">REAL-TIME</span>
                <QuoteActivityFlash fingerprint={quoteActivityFingerprint} />
              </div>
              <div className="p-4">
                <LiveNews symbol={selectedSymbol} limit={8} showTitle={false} />
              </div>
            </div>

          </div>

        </div>
      </div>
    </AppLayout>
  )
}

function DesktopResearchPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center">
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
