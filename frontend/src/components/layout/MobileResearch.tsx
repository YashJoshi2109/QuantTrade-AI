'use client'

import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  BarChart3,
  Sparkles,
  Newspaper,
  AlertTriangle,
  Loader2,
  Search,
  X,
} from 'lucide-react'
import {
  fetchPrices,
  fetchIndicators,
  syncSymbol,
  fetchFundamentals,
  searchSymbols,
  addToWatchlist,
  getWatchlist,
  FundamentalsData,
  PriceBar,
  Indicators,
  SearchResult,
  WatchlistItem,
} from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useRealtimeQuote } from '@/hooks/useRealtimeQuote'
import { formatNumber, formatPercent, isNumber } from '@/lib/format'
import Chart from '@/components/Chart'
import LiveNews from '@/components/LiveNews'
import KeyFactorsPanel from '@/components/KeyFactorsPanel'
import FundamentalsPanel from '@/components/FundamentalsPanel'

const TIMEFRAMES = ['1D', '1W', '1M', '3M', '1Y', 'All'] as const
type Timeframe = (typeof TIMEFRAMES)[number]

export default function MobileResearch() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const symbolFromUrl = (searchParams?.get('symbol') || 'NVDA').toUpperCase()

  const [timeframe, setTimeframe] = useState<Timeframe>('3M')
  const [activeTab, setActiveTab] = useState<
    'overview' | 'financials' | 'news' | 'technicals'
  >('overview')
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  /* ── Search state ── */
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const { data: searchResults = [], isLoading: searching } = useQuery<
    SearchResult[]
  >({
    queryKey: ['mobile.search', searchQuery],
    queryFn: () => searchSymbols(searchQuery, 10),
    enabled: showSearch && searchQuery.trim().length > 0,
    staleTime: 0,
  })

  useEffect(() => {
    if (showSearch) {
      setTimeout(() => searchInputRef.current?.focus(), 100)
    } else {
      setSearchQuery('')
    }
  }, [showSearch])

  const handleSearchSelect = useCallback(
    async (symbol: string) => {
      setShowSearch(false)
      setSearchQuery('')
      try {
        await syncSymbol(symbol)
      } catch {
        /* ignore */
      }
      router.push(`/research?symbol=${symbol}`)
    },
    [router],
  )

  /* ── Watchlist state ── */
  const { isAuthenticated } = useAuth()

  const { data: watchlistItems = [] } = useQuery<WatchlistItem[]>({
    queryKey: ['watchlist'],
    queryFn: getWatchlist,
    enabled: isAuthenticated,
    staleTime: 30000,
  })

  const isWatched = useMemo(
    () => watchlistItems.some((i) => i.symbol === symbolFromUrl),
    [watchlistItems, symbolFromUrl],
  )

  const watchMutation = useMutation({
    mutationFn: async () => {
      await syncSymbol(symbolFromUrl)
      return addToWatchlist({ symbol: symbolFromUrl })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watchlist'] })
    },
  })

  /* ── Data fetching ── */
  const { data: realtimeQuote, isLoading: quoteLoading } = useRealtimeQuote({
    symbol: symbolFromUrl,
    refetchInterval: 5000,
    priority: 'high',
    useFinnhub: true,
  })

  const { data: fundamentals, isLoading: fundamentalsLoading } =
    useQuery<FundamentalsData>({
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

  const { data: indicators, isLoading: indicatorsLoading } =
    useQuery<Indicators>({
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
  const eps = fundamentals?.eps
  const high52 = fundamentals?.week_52_high

  const aiReport = useMemo(() => {
    const rsi = indicators?.indicators?.rsi
    const sentiment = isNumber(rsi)
      ? rsi > 50
        ? 'Bullish'
        : 'Neutral'
      : 'Neutral'
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
      setSyncError(
        err instanceof Error ? err.message : 'Failed to sync data',
      )
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-4 pb-32 pb-safe">
      {/* ── Header ── */}
      <header className="sticky top-0 z-30 bg-[#0A0E1A]/95 backdrop-blur-xl border-b border-white/10 pt-safe pb-2 px-1">
        <div className="flex items-center justify-between">
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
            {/* Search button */}
            <button
              type="button"
              onClick={() => setShowSearch(true)}
              className="h-8 w-8 rounded-full bg-[#1A2332] border border-white/10 flex items-center justify-center active:scale-95"
            >
              <Search className="w-3.5 h-3.5 text-slate-200" />
            </button>
            {/* Sync button */}
            <button
              type="button"
              onClick={handleSync}
              className="h-8 px-3 rounded-full bg-[#1A2332] border border-white/10 text-[11px] text-slate-200 inline-flex items-center gap-1 active:scale-95 disabled:opacity-60"
              disabled={syncing}
            >
              {syncing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Sync
            </button>
            {/* Watch button */}
            <button
              type="button"
              onClick={() => {
                if (!isWatched && isAuthenticated) watchMutation.mutate()
              }}
              disabled={watchMutation.isPending || isWatched}
              className={`h-8 px-3 rounded-full border text-[11px] inline-flex items-center gap-1 active:scale-95 disabled:opacity-60 ${
                isWatched
                  ? 'bg-[#00D9FF]/10 border-[#00D9FF]/30 text-[#00D9FF]'
                  : 'bg-[#1A2332] border-white/10 text-slate-200'
              }`}
            >
              {watchMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : isWatched ? (
                <BookmarkCheck className="w-3.5 h-3.5" />
              ) : (
                <Bookmark className="w-3.5 h-3.5" />
              )}
              {isWatched ? 'Saved' : 'Watch'}
            </button>
          </div>
        </div>
      </header>

      {/* ── Search Overlay ── */}
      {showSearch && (
        <div className="fixed inset-0 z-50 bg-[#0A0E1A]/98 backdrop-blur-xl flex flex-col">
          <div className="pt-safe px-4 pb-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowSearch(false)}
                className="h-8 w-8 rounded-full bg-[#1A2332] border border-white/10 flex items-center justify-center"
              >
                <X className="w-4 h-4 text-slate-300" />
              </button>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by ticker or company name..."
                  className="w-full h-10 rounded-full bg-[#1A2332] border border-white/10 pl-9 pr-3 text-[13px] text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-[#00D9FF]/60"
                />
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pt-3 space-y-2">
            {searching && (
              <div className="py-8 text-center text-[11px] text-slate-500">
                <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-[#00D9FF]" />
                Searching...
              </div>
            )}
            {!searching &&
              searchQuery.trim() &&
              searchResults.length === 0 && (
                <div className="py-8 text-center text-[11px] text-slate-500">
                  No matches found. Try a different query.
                </div>
              )}
            {searchResults.map((r) => (
              <button
                key={r.symbol}
                type="button"
                onClick={() => handleSearchSelect(r.symbol)}
                className="w-full rounded-2xl bg-[#1A2332]/90 border border-white/10 p-3 text-left active:scale-[0.98]"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-white">
                      {r.symbol}
                    </p>
                    <p className="text-[11px] text-slate-500 truncate">
                      {r.name}
                    </p>
                  </div>
                  {r.sector && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-white/5">
                      {r.sector}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Price & Chart ── */}
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
              {quoteLoading && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#00D9FF] ml-1" />
              )}
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
                {pricesLoading
                  ? 'Loading chart data...'
                  : 'No chart data. Try Sync.'}
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

      {/* ── Key Stats ── */}
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
                    2,
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

      {/* ── Tabs ── */}
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

        {/* === OVERVIEW TAB === */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {/* AI Snapshot */}
            <div className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-3 text-[12px] text-slate-200">
              <div className="space-y-3 pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#00D9FF]" />
                    <span className="text-[12px] font-semibold text-white">
                      AI Snapshot
                    </span>
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
                  RSI signal is{' '}
                  <span className="text-white font-mono">
                    {aiReport.rsiSignal}
                  </span>{' '}
                  and price is{' '}
                  <span className="text-white font-mono">
                    {aiReport.trendSignal}
                  </span>
                  . This view mirrors the desktop research stack (realtime
                  quote + indicators + news), optimized for mobile.
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2 text-center">
                    <p className="text-[10px] text-slate-500 mb-0.5">PRICE</p>
                    <p className="text-[12px] font-mono text-white">
                      ${formatNumber(price, 2)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2 text-center">
                    <p className="text-[10px] text-slate-500 mb-0.5">RSI</p>
                    <p className="text-[12px] font-mono text-[#00D9FF]">
                      {formatNumber(
                        indicators?.indicators?.rsi,
                        0,
                        '--',
                      )}
                    </p>
                  </div>
                  <div className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2 text-center">
                    <p className="text-[10px] text-slate-500 mb-0.5">
                      CHANGE
                    </p>
                    <p
                      className={`text-[12px] font-mono ${isUp ? 'text-emerald-400' : 'text-red-400'}`}
                    >
                      {isUp ? '+' : ''}
                      {formatPercent(pct, 2)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Key Factors Panel */}
            <KeyFactorsPanel
              indicators={indicators ?? null}
              fundamentals={fundamentals ?? null}
              price={price}
              loading={indicatorsLoading || fundamentalsLoading}
            />
          </div>
        )}

        {/* === FINANCIALS TAB === */}
        {activeTab === 'financials' && (
          <FundamentalsPanel
            fundamentals={fundamentals ?? null}
            price={price}
            loading={fundamentalsLoading}
            onSync={handleSync}
            syncing={syncing}
          />
        )}

        {/* === TECHNICALS TAB === */}
        {activeTab === 'technicals' && (
          <div className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-3 text-[12px] text-slate-200">
            <div className="space-y-2 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 className="w-4 h-4 text-[#00D9FF]" />
                <span className="text-[12px] font-semibold text-white">
                  Technical Indicators
                </span>
              </div>
              {indicatorsLoading ? (
                <p className="text-[11px] text-slate-500">
                  Loading indicators\u2026
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  {[
                    {
                      label: 'SMA 20',
                      val: indicators?.indicators?.sma_20,
                      fmt: 'price',
                    },
                    {
                      label: 'SMA 50',
                      val: indicators?.indicators?.sma_50,
                      fmt: 'price',
                    },
                    {
                      label: 'SMA 200',
                      val: indicators?.indicators?.sma_200,
                      fmt: 'price',
                    },
                    {
                      label: 'RSI (14)',
                      val: indicators?.indicators?.rsi,
                      fmt: 'num',
                    },
                    {
                      label: 'MACD',
                      val: indicators?.indicators?.macd?.macd,
                      fmt: 'num',
                    },
                    {
                      label: 'Signal',
                      val: indicators?.indicators?.macd?.signal,
                      fmt: 'num',
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-xl bg-[#0A0E1A] border border-white/5 p-2"
                    >
                      <p className="text-slate-500">{item.label}</p>
                      <p className="text-slate-200 font-mono">
                        {item.fmt === 'price'
                          ? isNumber(item.val)
                            ? `$${formatNumber(item.val, 2)}`
                            : '\u2014'
                          : isNumber(item.val)
                            ? formatNumber(item.val, 2)
                            : '\u2014'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* === NEWS TAB === */}
        {activeTab === 'news' && (
          <div className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-3 text-[12px] text-slate-200">
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <Newspaper className="w-4 h-4 text-amber-400" />
                <span className="text-[12px] font-semibold text-white">
                  Live News
                </span>
              </div>
              <div className="rounded-2xl overflow-hidden">
                <LiveNews
                  symbol={symbolFromUrl}
                  limit={12}
                  showTitle={false}
                />
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
