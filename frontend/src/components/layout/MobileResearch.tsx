'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  Bookmark,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  BarChart3,
  Sparkles,
  Newspaper,
  AlertTriangle,
  Loader2,
} from 'lucide-react'
import {
  fetchPrices,
  fetchIndicators,
  syncSymbol,
  fetchFundamentals,
  FundamentalsData,
  PriceBar,
  Indicators,
} from '@/lib/api'
import { useRealtimeQuote } from '@/hooks/useRealtimeQuote'
import { formatNumber, formatPercent, isNumber } from '@/lib/format'
import Chart from '@/components/Chart'
import LiveNews from '@/components/LiveNews'

const TIMEFRAMES = ['1D', '1W', '1M', '3M', '1Y', 'All'] as const
type Timeframe = (typeof TIMEFRAMES)[number]

export default function MobileResearch() {
  const searchParams = useSearchParams()
  const symbolFromUrl = (searchParams?.get('symbol') || 'NVDA').toUpperCase()
  const [timeframe, setTimeframe] = useState<Timeframe>('1M')
  const [activeTab, setActiveTab] = useState<
    'overview' | 'financials' | 'news' | 'technicals'
  >('overview')
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  // Same realtime quote flow as desktop research
  const { data: realtimeQuote, isLoading: quoteLoading } = useRealtimeQuote({
    symbol: symbolFromUrl,
    refetchInterval: 5000,
    priority: 'high',
    useFinnhub: true,
  })

  const { data: fundamentals } = useQuery<FundamentalsData>({
    queryKey: ['mobile.fundamentals', symbolFromUrl],
    queryFn: () => fetchFundamentals(symbolFromUrl),
    staleTime: 5 * 60 * 1000,
  })

  const { startIso, endIso } = useMemo(() => {
    const now = new Date()
    const end = now.toISOString()
    const start = new Date(now)
    switch (timeframe) {
      case '1D':
        start.setDate(now.getDate() - 2)
        break
      case '1W':
        start.setDate(now.getDate() - 7)
        break
      case '1M':
        start.setDate(now.getDate() - 30)
        break
      case '3M':
        start.setDate(now.getDate() - 90)
        break
      case '1Y':
        start.setDate(now.getDate() - 365)
        break
      case 'All':
      default:
        return { startIso: undefined, endIso: undefined }
    }
    return { startIso: start.toISOString(), endIso: end }
  }, [timeframe])

  const { data: prices, isLoading: pricesLoading } = useQuery<PriceBar[]>({
    queryKey: ['mobile.prices', symbolFromUrl, timeframe],
    queryFn: () => fetchPrices(symbolFromUrl, startIso, endIso),
    staleTime: 60 * 1000,
  })

  const { data: indicators, isLoading: indicatorsLoading } = useQuery<Indicators>({
    queryKey: ['mobile.indicators', symbolFromUrl],
    queryFn: () => fetchIndicators(symbolFromUrl),
    staleTime: 60 * 1000,
  })

  const price = realtimeQuote?.price ?? 0
  const pct = realtimeQuote?.change_percent ?? 0
  const change = realtimeQuote?.change ?? 0
  const isUp = isNumber(pct) && pct >= 0

  const marketCap = fundamentals?.market_cap
  const pe = fundamentals?.pe_ratio
  const forwardPe = fundamentals?.forward_pe
  const peg = fundamentals?.peg_ratio
  const priceToSales = fundamentals?.price_to_sales
  const priceToBook = fundamentals?.price_to_book
  const profitMargin = fundamentals?.profit_margin
  const operatingMargin = fundamentals?.operating_margin
  const grossMargin = fundamentals?.gross_margin
  const roe = fundamentals?.roe
  const roa = fundamentals?.roa
  const roi = (fundamentals as any)?.roi as number | undefined
  const debtToEquity = fundamentals?.debt_to_equity
  const currentRatio = fundamentals?.current_ratio
  const quickRatio = fundamentals?.quick_ratio
  const beta = fundamentals?.beta
  const rsiFundamental = fundamentals?.rsi
  const eps = fundamentals?.eps
  const epsNextQuarter = fundamentals?.eps_next_quarter
  const earningsDate = fundamentals?.earnings_date
  const targetPrice = fundamentals?.target_price
  const recommendation = fundamentals?.recommendation
  const high52 = fundamentals?.week_52_high

  const aiReport = useMemo(() => {
    const rsi = indicators?.indicators?.rsi
    const sentiment = isNumber(rsi) ? (rsi > 50 ? 'Bullish' : 'Neutral') : 'Neutral'
    const rsiSignal = isNumber(rsi)
      ? rsi > 70
        ? 'Overbought'
        : rsi < 30
          ? 'Oversold'
          : 'Neutral'
      : 'N/A'
    const sma50 = indicators?.indicators?.sma_50
    const trendSignal =
      isNumber(price) && isNumber(sma50)
        ? price > sma50
          ? 'Above SMA50'
          : 'Below SMA50'
        : 'N/A'
    return { sentiment, rsiSignal, trendSignal }
  }, [indicators, price])

  const handleSync = async () => {
    setSyncError(null)
    setSyncing(true)
    try {
      await syncSymbol(symbolFromUrl)
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Failed to sync data')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-4 pb-28 pb-safe">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[#0A0E1A]/95 backdrop-blur-xl border-b border-white/10 pt-safe pb-2 px-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="h-8 w-8 rounded-full bg-[#1A2332] border border-white/10 flex items-center justify-center active:scale-95"
          >
            <ArrowLeft className="w-4 h-4 text-slate-200" />
          </Link>
          <div>
            <div className="flex items-center gap-1">
              <h1 className="text-[18px] font-semibold text-white">
                {symbolFromUrl}
              </h1>
            </div>
            <p className="text-[11px] text-slate-400">
              {fundamentals?.company_name || 'Company overview'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSync}
            className="h-8 px-3 rounded-full bg-[#1A2332] border border-white/10 text-[11px] text-slate-200 inline-flex items-center gap-1 active:scale-95 disabled:opacity-60"
            disabled={syncing}
          >
            {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Sync
          </button>
          <button
            type="button"
            className="h-8 px-3 rounded-full bg-[#1A2332] border border-white/10 text-[11px] text-slate-200 inline-flex items-center gap-1 active:scale-95"
          >
            <Bookmark className="w-3.5 h-3.5" />
            Watch
          </button>
        </div>
      </header>

      {/* Price & chart */}
      <section className="px-1 space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[28px] font-bold text-white font-mono">
              ${formatNumber(price, 2)}
            </div>
            <div className="mt-1 flex items-center gap-1">
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full font-mono ${
                  isUp
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    : 'bg-red-500/10 text-red-400 border border-red-500/30'
                }`}
              >
                {isUp ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <TrendingDown className="w-3 h-3" />
                )}
                {isUp ? '+' : ''}
                {formatNumber(change, 2)} ({formatPercent(pct, 2)})
              </span>
              {quoteLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#00D9FF] ml-1" />}
            </div>
          </div>
          <div className="text-right text-[10px] text-slate-500">
            <p>Real-time quote</p>
            <p>{realtimeQuote?.data_source || 'multi-source'}</p>
          </div>
        </div>

        <div className="rounded-2xl bg-[#1A2332]/80 border border-white/10 overflow-hidden">
          <div className="h-[250px] chart-grid bg-[#0A0E1A]">
            {prices && prices.length > 0 ? (
              <Chart data={prices} symbol={symbolFromUrl} />
            ) : (
              <div className="h-full flex items-center justify-center text-[12px] text-slate-500">
                {pricesLoading ? 'Loading chart data...' : 'No chart data. Try Sync.'}
              </div>
            )}
          </div>
        </div>

        {/* Timeframes */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1 rounded-full bg-[#1A2332] p-1 border border-white/10">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={`px-2 py-1 rounded-full text-[11px] font-medium ${
                  timeframe === tf
                    ? 'bg-[#00D9FF]/15 text-[#00D9FF]'
                    : 'text-slate-400'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
      </section>

      {syncError && (
        <section className="px-1">
          <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-3 py-2 text-[11px] text-red-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5" />
            <span>{syncError}</span>
          </div>
        </section>
      )}

      {/* Key stats */}
      <section className="px-1">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-[#1A2332]/90 border border-white/10 p-3">
            <p className="text-[10px] text-slate-400 mb-1">Market Cap</p>
            <p className="text-[14px] font-semibold text-white">
              {isNumber(marketCap)
                ? formatNumber(
                    marketCap >= 1e12
                      ? marketCap / 1e12
                      : marketCap >= 1e9
                      ? marketCap / 1e9
                      : marketCap / 1e6,
                    2
                  ) +
                  (marketCap >= 1e12
                    ? 'T'
                    : marketCap >= 1e9
                    ? 'B'
                    : 'M')
                : 'N/A'}
            </p>
          </div>
          <div className="rounded-xl bg-[#1A2332]/90 border border-white/10 p-3">
            <p className="text-[10px] text-slate-400 mb-1">P/E Ratio</p>
            <p className="text-[14px] font-semibold text-white">
              {isNumber(pe) ? formatNumber(pe, 2) : 'N/A'}
            </p>
          </div>
          {isNumber(eps) && (
            <div className="rounded-xl bg-[#1A2332]/90 border border-white/10 p-3">
              <p className="text-[10px] text-slate-400 mb-1">EPS (TTM)</p>
              <p className="text-[14px] font-semibold text-white">
                {formatNumber(eps, 2)}
              </p>
            </div>
          )}
          {isNumber(high52) && (
            <div className="rounded-xl bg-[#1A2332]/90 border border-white/10 p-3">
              <p className="text-[10px] text-slate-400 mb-1">52W High</p>
              <p className="text-[14px] font-semibold text-white">
                {`$${formatNumber(high52, 2)}`}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Tabs */}
      <section className="px-1 space-y-3">
        <div className="flex border-b border-white/10">
          {['overview', 'financials', 'news', 'technicals'].map((tabKey) => {
            const label =
              tabKey === 'overview'
                ? 'Overview'
                : tabKey === 'financials'
                ? 'Financials'
                : tabKey === 'news'
                ? 'News'
                : 'Technicals'
            const key = tabKey as typeof activeTab
            const isActive = activeTab === key
            return (
              <button
                key={tabKey}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`flex-1 py-2 text-[12px] font-medium border-b-2 ${
                  isActive
                    ? 'border-[#00D9FF] text-[#00D9FF]'
                    : 'border-transparent text-slate-500'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>

        <div className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-3 text-[12px] text-slate-200">
          {activeTab === 'overview' && (
            <div className="space-y-3 pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#00D9FF]" />
                  <span className="text-[12px] font-semibold text-white">AI Snapshot</span>
                </div>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full border ${
                    aiReport.sentiment === 'Bullish'
                      ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                      : 'bg-slate-500/10 text-slate-300 border-white/10'
                  }`}
                >
                  {aiReport.sentiment}
                </span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                RSI signal is <span className="text-white font-mono">{aiReport.rsiSignal}</span> and price is{' '}
                <span className="text-white font-mono">{aiReport.trendSignal}</span>. This view mirrors the desktop research
                stack (realtime quote + indicators + news), optimized for mobile.
              </p>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2 text-center">
                  <p className="text-[10px] text-slate-500 mb-0.5">PRICE</p>
                  <p className="text-[12px] font-mono text-white">${formatNumber(price, 2)}</p>
                </div>
                <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2 text-center">
                  <p className="text-[10px] text-slate-500 mb-0.5">RSI</p>
                  <p className="text-[12px] font-mono text-[#00D9FF]">
                    {formatNumber(indicators?.indicators?.rsi, 0, '--')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'financials' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 className="w-4 h-4 text-emerald-400" />
                <span className="text-[12px] font-semibold text-white">Fundamentals</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                  <p className="text-slate-500">Sector</p>
                  <p className="text-slate-200">{fundamentals?.sector || '—'}</p>
                </div>
                <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                  <p className="text-slate-500">Industry</p>
                  <p className="text-slate-200">{fundamentals?.industry || '—'}</p>
                </div>
                <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                  <p className="text-slate-500">P/E</p>
                  <p className="text-slate-200 font-mono">{isNumber(pe) ? formatNumber(pe, 2) : '—'}</p>
                </div>
                <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                  <p className="text-slate-500">Forward P/E</p>
                  <p className="text-slate-200 font-mono">
                    {isNumber(forwardPe) ? formatNumber(forwardPe, 2) : '—'}
                  </p>
                </div>
                <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                  <p className="text-slate-500">PEG</p>
                  <p className="text-slate-200 font-mono">
                    {isNumber(peg) ? formatNumber(peg, 2) : '—'}
                  </p>
                </div>
                <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                  <p className="text-slate-500">P/S</p>
                  <p className="text-slate-200 font-mono">
                    {isNumber(priceToSales) ? formatNumber(priceToSales, 2) : '—'}
                  </p>
                </div>
                <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                  <p className="text-slate-500">P/B</p>
                  <p className="text-slate-200 font-mono">
                    {isNumber(priceToBook) ? formatNumber(priceToBook, 2) : '—'}
                  </p>
                </div>
                <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                  <p className="text-slate-500">Beta</p>
                  <p className="text-slate-200 font-mono">
                    {isNumber(beta) ? formatNumber(beta, 2) : '—'}
                  </p>
                </div>
                <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                  <p className="text-slate-500">Profit Margin</p>
                  <p className="text-slate-200 font-mono">
                    {isNumber(profitMargin) ? `${formatNumber(profitMargin, 1)}%` : '—'}
                  </p>
                </div>
                <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                  <p className="text-slate-500">Operating Margin</p>
                  <p className="text-slate-200 font-mono">
                    {isNumber(operatingMargin) ? `${formatNumber(operatingMargin, 1)}%` : '—'}
                  </p>
                </div>
                <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                  <p className="text-slate-500">Gross Margin</p>
                  <p className="text-slate-200 font-mono">
                    {isNumber(grossMargin) ? `${formatNumber(grossMargin, 1)}%` : '—'}
                  </p>
                </div>
                <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                  <p className="text-slate-500">ROE</p>
                  <p className="text-slate-200 font-mono">
                    {isNumber(roe) ? `${formatNumber(roe, 1)}%` : '—'}
                  </p>
                </div>
                <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                  <p className="text-slate-500">ROA</p>
                  <p className="text-slate-200 font-mono">
                    {isNumber(roa) ? `${formatNumber(roa, 1)}%` : '—'}
                  </p>
                </div>
                <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                  <p className="text-slate-500">ROI</p>
                  <p className="text-slate-200 font-mono">
                    {isNumber(roi) ? `${formatNumber(roi, 1)}%` : '—'}
                  </p>
                </div>
                <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                  <p className="text-slate-500">Debt/Equity</p>
                  <p className="text-slate-200 font-mono">
                    {isNumber(debtToEquity) ? formatNumber(debtToEquity, 2) : '—'}
                  </p>
                </div>
                <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                  <p className="text-slate-500">Current Ratio</p>
                  <p className="text-slate-200 font-mono">
                    {isNumber(currentRatio) ? formatNumber(currentRatio, 2) : '—'}
                  </p>
                </div>
                <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                  <p className="text-slate-500">Quick Ratio</p>
                  <p className="text-slate-200 font-mono">
                    {isNumber(quickRatio) ? formatNumber(quickRatio, 2) : '—'}
                  </p>
                </div>
                {isNumber(fundamentals?.week_52_low) && (
                  <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                    <p className="text-slate-500">52W Low</p>
                    <p className="text-slate-200 font-mono">
                      {`$${formatNumber(fundamentals?.week_52_low, 2)}`}
                    </p>
                  </div>
                )}
                {isNumber(high52) && (
                  <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                    <p className="text-slate-500">52W High</p>
                    <p className="text-slate-200 font-mono">
                      {`$${formatNumber(high52, 2)}`}
                    </p>
                  </div>
                )}
                {isNumber(eps) && (
                  <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                    <p className="text-slate-500">EPS (TTM)</p>
                    <p className="text-slate-200 font-mono">
                      {formatNumber(eps, 2)}
                    </p>
                  </div>
                )}
                {isNumber(epsNextQuarter) && (
                  <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                    <p className="text-slate-500">EPS Next Q</p>
                    <p className="text-slate-200 font-mono">
                      {formatNumber(epsNextQuarter, 2)}
                    </p>
                  </div>
                )}
                {earningsDate && (
                  <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                    <p className="text-slate-500">Earnings Date</p>
                    <p className="text-slate-200 font-mono">
                      {earningsDate}
                    </p>
                  </div>
                )}
                {isNumber(targetPrice) && (
                  <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                    <p className="text-slate-500">Target Price</p>
                    <p className="text-slate-200 font-mono">
                      {`$${formatNumber(targetPrice, 2)}`}
                    </p>
                  </div>
                )}
                {recommendation && (
                  <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                    <p className="text-slate-500">Recommendation</p>
                    <p className="text-slate-200 font-mono">
                      {recommendation}
                    </p>
                  </div>
                )}
                {isNumber(rsiFundamental) && (
                  <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                    <p className="text-slate-500">RSI (14)</p>
                    <p className="text-slate-200 font-mono">
                      {formatNumber(rsiFundamental, 1)}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'technicals' && (
            <div className="space-y-2 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 className="w-4 h-4 text-[#00D9FF]" />
                <span className="text-[12px] font-semibold text-white">Technical Indicators</span>
              </div>
              {indicatorsLoading ? (
                <p className="text-[11px] text-slate-500">Loading indicators…</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  {[
                    { label: 'SMA 20', val: indicators?.indicators?.sma_20, fmt: 'price' },
                    { label: 'SMA 50', val: indicators?.indicators?.sma_50, fmt: 'price' },
                    { label: 'SMA 200', val: indicators?.indicators?.sma_200, fmt: 'price' },
                    { label: 'RSI (14)', val: indicators?.indicators?.rsi, fmt: 'num' },
                    { label: 'MACD', val: indicators?.indicators?.macd?.macd, fmt: 'num' },
                    { label: 'Signal', val: indicators?.indicators?.macd?.signal, fmt: 'num' },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2">
                      <p className="text-slate-500">{item.label}</p>
                      <p className="text-slate-200 font-mono">
                        {item.fmt === 'price'
                          ? isNumber(item.val)
                            ? `$${formatNumber(item.val, 2)}`
                            : '—'
                          : isNumber(item.val)
                            ? formatNumber(item.val, 2)
                            : '—'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'news' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <Newspaper className="w-4 h-4 text-amber-400" />
                <span className="text-[12px] font-semibold text-white">Live News</span>
              </div>
              <div className="rounded-2xl overflow-hidden">
                <LiveNews symbol={symbolFromUrl} limit={12} showTitle={false} />
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

