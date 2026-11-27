'use client'

import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
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
  fetchIntradayPrices,
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
import { isCompanyAsset } from '@/lib/assetType'
import { displayCompanyName } from '@/lib/tickerIdentity'
import { TickerIdentityBanner, useTickerIdentity } from '@/components/research/TickerIdentityBanner'
import Chart from '@/components/Chart'
import type { PaneIndicatorId } from '@/lib/indicators'
import { Skeleton } from '@/components/Skeleton'
import { keyStatsSource } from '@/lib/researchKeyStats'
import { KeyStatsGrid } from '@/components/research/KeyStatsGrid'
import LiveNews from '@/components/LiveNews'
import KeyFactorsPanel from '@/components/KeyFactorsPanel'
import FundamentalsPanel from '@/components/FundamentalsPanel'
import SecEdgarPanel from '@/components/research/SecEdgarPanel'
import ForecastPanel from '@/components/research/ForecastPanel'
import type { TickerInfo } from '@/app/api/quotes/ticker/route'
import { resolvePriceInfo } from '@/lib/researchQuote'
import { ExtendedHoursBadge } from '@/components/quote/ExtendedHoursBadge'
import OptionChainPanel from '@/components/research/OptionChainPanel'
import EarningsShortInterestPanel from '@/components/research/EarningsShortInterestPanel'
import EarningsBadge from '@/components/earnings/EarningsBadge'
import { CompanyFolioPanel } from '@/components/research/CompanyFolioPanel'
import TechnicalAnalysisGauge from '@/components/TechnicalAnalysisGauge'
import AskCopilotButton from '@/components/copilot/AskCopilotButton'
import { GitCompareArrows } from 'lucide-react'
import { compareHref } from '@/lib/compare'
import { oneOf, usePersistentState } from '@/lib/persistentState'
import { MOBILE_TABS, MOBILE_TIMEFRAMES, useResearchSymbol } from '@/lib/researchPrefs'

const TIMEFRAMES = MOBILE_TIMEFRAMES
type Timeframe = (typeof TIMEFRAMES)[number]
const VOLUME_PANE: PaneIndicatorId[] = ['volume']

export default function MobileResearch() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  // Last symbol, timeframe and tab persist per user (lib/researchPrefs, shared with desktop).
  const symbolFromUrl = useResearchSymbol(searchParams?.get('symbol'))

  const [timeframe, setTimeframe] = usePersistentState<Timeframe>('research.mobile.timeframe', '3M', { version: 2, validate: oneOf(MOBILE_TIMEFRAMES) })
  const [activeTab, setActiveTab] = usePersistentState<MobileResearchTab>('research.mobile.tab', 'overview', { version: 1, validate: oneOf(MOBILE_TABS) })
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
      case '6M':
        start.setDate(now.getDate() - 182)
        break
      case 'YTD':
        start.setMonth(0, 1)
        start.setHours(0, 0, 0, 0)
        break
      case '1Y':
        start.setDate(now.getDate() - 365)
        break
      case '2Y':
      default:
        start.setDate(now.getDate() - 730)
        break
    }
    return { startIso: start.toISOString(), endIso: end }
  }, [timeframe])

  const isIntraday = timeframe === '1D' || timeframe === '1W'
  const { data: prices, isLoading: pricesLoading } = useQuery<PriceBar[]>({
    queryKey: ['mobile.prices', symbolFromUrl, timeframe],
    queryFn: () =>
      isIntraday
        ? fetchIntradayPrices(symbolFromUrl, timeframe === '1D' ? '1m' : '5m', timeframe === '1D' ? 1 : 5)
        : fetchPrices(symbolFromUrl, startIso, endIso),
    staleTime: isIntraday ? 30_000 : 60_000,
    retry: 1,
  })

  const { data: indicators, isLoading: indicatorsLoading } =
    useQuery<Indicators>({
      queryKey: ['mobile.indicators', symbolFromUrl],
      queryFn: () => fetchIndicators(symbolFromUrl),
      staleTime: 60 * 1000,
      retry: 1,
    })

  // Same source as desktop (/api/quotes/ticker, shared React Query cache key).
  const { data: tickerInfo, isPending: tickerInfoLoading } = useQuery<TickerInfo>({
    queryKey: ['tickerInfo', symbolFromUrl],
    queryFn: async () => {
      const res = await fetch(`/api/quotes/ticker?symbol=${encodeURIComponent(symbolFromUrl)}`)
      if (!res.ok) throw new Error('Not found')
      return res.json()
    },
    staleTime: 300_000,
    retry: 1,
  })

  // Index / ETF symbols hide company-only panels (same helper as desktop).
  const showCompanyPanels = isCompanyAsset(symbolFromUrl, tickerInfo?.asset_type)

  // Stale / reassigned ticker warning (same hook + banner as desktop).
  const { data: tickerIdentity } = useTickerIdentity(symbolFromUrl)

  // Realtime -> ticker profile -> daily bars; never show a placeholder $0.00.
  const priceInfo = resolvePriceInfo(realtimeQuote, tickerInfo, prices)
  const price = priceInfo.price
  const pct = priceInfo.percent
  const change = priceInfo.change
  const isUp = isNumber(pct) && pct >= 0

  const eps = isNumber(tickerInfo?.eps) && tickerInfo.eps !== 0 ? tickerInfo.eps : fundamentals?.eps

  const companyName = displayCompanyName(tickerInfo?.name || fundamentals?.company_name, tickerIdentity)
  const keyStats = keyStatsSource(tickerInfo, priceInfo, fundamentals)
  // Chart colour follows the range shown (Apple Stocks): green when the
  // selected range closed at or above where it opened.
  const rangeUp = prices && prices.length > 1 ? prices[prices.length - 1].close >= prices[0].close : isUp

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
      <header className="sticky top-0 z-30 bg-surface-base/95 backdrop-blur-xl border-b border-line-subtle pt-safe pb-2 px-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Link
              href="/"
              className="h-8 w-8 shrink-0 rounded-full bg-surface-raised border border-line-subtle flex items-center justify-center active:scale-95"
            >
              <ArrowLeft className="w-4 h-4 text-fg-primary" />
            </Link>
            {/* Apple Stocks style: bold ticker + muted company name on one line. */}
            <div className="flex min-w-0 items-baseline gap-2">
              <h1 className="text-[22px] font-bold leading-none tracking-tight text-fg-primary">
                {symbolFromUrl}
              </h1>
              {companyName ? (
                <p className="min-w-0 truncate text-[13px] text-fg-muted" data-testid="mobile-research-name">
                  {companyName}
                </p>
              ) : tickerInfoLoading ? (
                <Skeleton className="h-3.5 w-28" />
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* Search button */}
            <button
              type="button"
              onClick={() => setShowSearch(true)}
              aria-label="Search symbols"
              className="h-8 w-8 rounded-full bg-surface-raised border border-line-subtle flex items-center justify-center active:scale-95"
            >
              <Search className="w-3.5 h-3.5 text-fg-primary" />
            </button>
            {/* Sync button */}
            <button
              type="button"
              onClick={handleSync}
              aria-label="Sync data"
              title="Sync data"
              className="h-8 w-8 rounded-full bg-surface-raised border border-line-subtle text-fg-primary inline-flex items-center justify-center active:scale-95 disabled:opacity-60"
              disabled={syncing}
            >
              {syncing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
            </button>
            {/* Watch button */}
            <button
              type="button"
              onClick={() => {
                if (!isWatched && isAuthenticated) watchMutation.mutate()
              }}
              disabled={watchMutation.isPending || isWatched}
              aria-label={isWatched ? 'Saved to watchlist' : 'Add to watchlist'}
              title={isWatched ? 'Saved to watchlist' : 'Add to watchlist'}
              className={`h-8 w-8 rounded-full border inline-flex items-center justify-center active:scale-95 disabled:opacity-60 ${
                isWatched
                  ? 'bg-[#00D9FF]/10 border-[#00D9FF]/30 text-[#00D9FF]'
                  : 'bg-surface-raised border-line-subtle text-fg-primary'
              }`}
            >
              {watchMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : isWatched ? (
                <BookmarkCheck className="w-3.5 h-3.5" />
              ) : (
                <Bookmark className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
        <EarningsBadge symbol={symbolFromUrl} variant="mobile" className="ml-10 mt-1" />
      </header>

      <TickerIdentityBanner identity={tickerIdentity} compact />

      {/* ── Search Overlay ── */}
      {showSearch && (
        <div className="fixed inset-0 z-50 bg-white/95 dark:bg-[#0b0f17]/95 backdrop-blur-xl flex flex-col">
          <div className="pt-safe px-4 pb-3 border-b border-line-subtle">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowSearch(false)}
                className="h-8 w-8 rounded-full bg-surface-raised border border-line-subtle flex items-center justify-center"
              >
                <X className="w-4 h-4 text-fg-secondary" />
              </button>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-muted" />
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by ticker or company name..."
                  aria-label="Search by ticker or company name"
                  className="w-full h-10 rounded-full bg-surface-raised border border-line-subtle pl-9 pr-3 text-[13px] text-fg-primary placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-[#00D9FF]/60"
                />
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pt-3 space-y-2">
            {searching && (
              <div className="py-8 text-center text-[11px] text-fg-muted">
                <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-[#00D9FF]" />
                Searching...
              </div>
            )}
            {!searching &&
              searchQuery.trim() &&
              searchResults.length === 0 && (
                <div className="py-8 text-center text-[11px] text-fg-muted">
                  No matches found. Try a different query.
                </div>
              )}
            {searchResults.map((r) => (
              <button
                key={r.symbol}
                type="button"
                onClick={() => handleSearchSelect(r.symbol)}
                className="w-full rounded-2xl bg-surface-raised border border-line-subtle p-3 text-left active:scale-[0.98]"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-fg-primary">
                      {r.symbol}
                    </p>
                    <p className="text-[11px] text-fg-muted truncate">
                      {r.name}
                    </p>
                  </div>
                  {r.sector && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-raised text-fg-secondary border border-line-subtle">
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
            {priceInfo.hasPrice ? (
              <div className="flex items-baseline gap-2 tabular-nums">
                <span className="text-[30px] font-bold leading-none text-fg-primary">
                  ${formatNumber(price, 2)}
                </span>
                <span
                  data-testid="mobile-research-change"
                  className={`text-[15px] font-semibold ${isUp ? 'text-emerald-500' : 'text-red-500'}`}
                >
                  {isUp ? '+' : ''}
                  {formatNumber(change, 2)} ({formatPercent(pct, 2)})
                </span>
              </div>
            ) : (
              <div className="flex items-baseline gap-2" aria-busy="true" aria-label="Loading quote">
                <Skeleton className="h-8 w-32" />
                <Skeleton className="h-4 w-24" />
              </div>
            )}
            <p className="mt-1.5 text-[12px] text-fg-muted" data-testid="mobile-research-venue">
              {[tickerInfo?.exchange_display || tickerInfo?.exchange, tickerInfo?.currency]
                .filter(Boolean)
                .join(' · ') || '\u00a0'}
            </p>
            {priceInfo.hasPrice && <ExtendedHoursBadge badge={priceInfo.extended} className="mt-1" />}
          </div>
          <div className="text-right text-[10px] text-fg-muted">
            <p>Real-time quote</p>
            <p>{priceInfo.dataSource || (quoteLoading ? 'connecting…' : 'unavailable')}</p>
          </div>
        </div>

        {/* Timeframes: one row, the selected range is a filled rounded pill. */}
        <div className="flex items-center justify-between gap-0.5" role="group" aria-label="Chart range">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              aria-pressed={timeframe === tf}
              onClick={() => setTimeframe(tf)}
              className={`flex-1 h-7 min-h-0 rounded-full text-[12px] font-semibold tabular-nums transition-colors ${
                timeframe === tf
                  ? 'bg-[color-mix(in_srgb,var(--text-primary)_14%,transparent)] text-fg-primary'
                  : 'text-fg-muted'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>

        <div className="overflow-hidden">
          <div className="h-[250px]">
            {prices && prices.length > 0 ? (
              <Chart
                data={prices}
                symbol={symbolFromUrl}
                seriesType="area"
                trend={rangeUp ? 'up' : 'down'}
                activePanes={VOLUME_PANE}
                showGrid={false}
                minimal
              />
            ) : pricesLoading ? (
              <div className="h-full p-3 flex flex-col gap-2" aria-busy="true" aria-label="Loading chart">
                <div className="flex gap-2">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-12" />
                </div>
                <Skeleton className="flex-1 w-full" />
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-[12px] text-fg-muted">
                No chart data. Try Sync.
              </div>
            )}
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
        <KeyStatsGrid
          source={keyStats}
          loading={tickerInfoLoading && !tickerInfo}
          className="border-y border-line-subtle"
          testId="mobile-key-stats"
        />
        {isNumber(eps) && (
          <p className="mt-1.5 text-[11px] text-fg-muted tabular-nums">EPS (TTM) {formatNumber(eps, 2)}</p>
        )}
      </section>

      <section className="px-1">
        <div className="flex items-stretch gap-2">
          <div className="min-w-0 flex-1">
            <AskCopilotButton symbol={symbolFromUrl} variant="mobile" />
          </div>
          <Link
            href={compareHref([symbolFromUrl])}
            className="flex shrink-0 items-center gap-1.5 rounded-2xl border border-line-subtle bg-surface-raised px-3 text-[12px] font-semibold text-fg-secondary active:scale-[0.98]"
          >
            <GitCompareArrows className="h-4 w-4" aria-hidden />
            Compare
          </Link>
        </div>
      </section>

      {/* ── Tabs ── */}
      <section className="px-1 space-y-3">
        <div
          role="tablist"
          aria-label="Research sections"
          className="sticky top-0 z-20 -mx-1 flex overflow-x-auto border-b border-line-subtle bg-surface-base/95 px-1 backdrop-blur"
        >
          {MOBILE_RESEARCH_TABS.map(({ key, label }) => {
            const isActive = activeTab === key
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={isActive}
                data-testid={`mobile-research-tab-${key}`}
                onClick={() => setActiveTab(key)}
                className={`flex-1 shrink-0 whitespace-nowrap px-2 py-2.5 text-[12px] font-medium border-b-2 ${
                  isActive
                    ? 'border-[#00D9FF] text-[#00D9FF]'
                    : 'border-transparent text-fg-muted'
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
            <div className="rounded-2xl bg-surface-raised border border-line-subtle p-3 text-[12px] text-fg-primary">
              <div className="space-y-3 pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#00D9FF]" />
                    <span className="text-[12px] font-semibold text-fg-primary">
                      AI Snapshot
                    </span>
                  </div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full border ${
                      aiReport.sentiment === 'Bullish'
                        ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                        : 'bg-surface-raised text-fg-secondary border-line-subtle'
                    }`}
                  >
                    {aiReport.sentiment}
                  </span>
                </div>
                <p className="text-[11px] text-fg-secondary leading-relaxed">
                  RSI signal is{' '}
                  <span className="text-fg-primary font-mono">
                    {aiReport.rsiSignal}
                  </span>{' '}
                  and price is{' '}
                  <span className="text-fg-primary font-mono">
                    {aiReport.trendSignal}
                  </span>
                  . This view mirrors the desktop research stack (realtime
                  quote + indicators + news), optimized for mobile.
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-surface-base border border-line-subtle p-2 text-center">
                    <p className="text-[10px] text-fg-muted mb-0.5">PRICE</p>
                    <p className="text-[12px] font-mono text-fg-primary">
                      ${formatNumber(price, 2)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-surface-base border border-line-subtle p-2 text-center">
                    <p className="text-[10px] text-fg-muted mb-0.5">RSI</p>
                    <p className="text-[12px] font-mono text-[#00D9FF]">
                      {formatNumber(
                        indicators?.indicators?.rsi,
                        0,
                        '--',
                      )}
                    </p>
                  </div>
                  <div className="rounded-xl bg-surface-base border border-line-subtle p-2 text-center">
                    <p className="text-[10px] text-fg-muted mb-0.5">
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

            {/* Same statistical forecast as desktop */}
            <ForecastPanel symbol={symbolFromUrl} />

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
        {activeTab === 'financials' && !showCompanyPanels && (
          <p className="rounded-2xl bg-surface-raised border border-line-subtle p-4 text-[12px] text-fg-muted">
            Company financials and SEC filings do not apply to {symbolFromUrl} (not an operating company).
          </p>
        )}
        {activeTab === 'financials' && showCompanyPanels && (
          <div className="space-y-4">
            <FundamentalsPanel
              fundamentals={fundamentals ?? null}
              price={price}
              loading={fundamentalsLoading}
              onSync={handleSync}
              syncing={syncing}
            />
            {/* Key Statistics, earnings and short interest (desktop parity) */}
            <EarningsShortInterestPanel symbol={symbolFromUrl} tickerInfo={tickerInfo} />
            {/* Same SEC EDGAR statements + AI analysis as desktop */}
            {symbolFromUrl && <SecEdgarPanel symbol={symbolFromUrl} />}
          </div>
        )}

        {/* === TECHNICALS TAB === */}
        {activeTab === 'technicals' && (
          <div className="rounded-2xl bg-surface-raised border border-line-subtle p-3 text-[12px] text-fg-primary">
            <div className="space-y-2 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 className="w-4 h-4 text-[#00D9FF]" />
                <span className="text-[12px] font-semibold text-fg-primary">
                  Technical Indicators
                </span>
              </div>
              {indicatorsLoading ? (
                <div className="grid grid-cols-2 gap-2" aria-busy="true" aria-label="Loading indicators">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="rounded-xl bg-surface-base border border-line-subtle p-2 space-y-1.5">
                      <Skeleton className="h-3 w-12" />
                      <Skeleton className="h-3.5 w-16" />
                    </div>
                  ))}
                </div>
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
                      className="rounded-xl bg-surface-base border border-line-subtle p-2"
                    >
                      <p className="text-fg-muted">{item.label}</p>
                      <p className="text-fg-primary font-mono">
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
        {activeTab === 'technicals' && (
          <TechnicalAnalysisGauge
            indicators={indicators ?? null}
            price={price}
            loading={indicatorsLoading}
          />
        )}

        {/* === OPTIONS TAB === same option chain panel as desktop, incl. its "Options data unavailable" state */}
        {activeTab === 'options' && symbolFromUrl && (
          <OptionChainPanel symbol={symbolFromUrl} />
        )}

        {/* === COMPANY & NEWS TAB === desktop Company Folio, then live news */}
        {activeTab === 'company' && (
          <div className="space-y-3">
            {showCompanyPanels && (
              <CompanyFolioPanel
                symbol={symbolFromUrl}
                info={tickerInfo}
                isLoading={tickerInfoLoading}
              />
            )}
          <div className="rounded-2xl bg-surface-raised border border-line-subtle p-3 text-[12px] text-fg-primary">
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <Newspaper className="w-4 h-4 text-amber-400" />
                <span className="text-[12px] font-semibold text-fg-primary">
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
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * Mobile tabs. Each desktop research panel is reachable from exactly one tab:
 * overview  - chart (above), AI snapshot, Price Forecast Range, Key Factors
 * financials - Fundamentals, Key Statistics/earnings/short interest, SEC EDGAR
 * options   - Option Chain
 * technicals - Technical Indicators, Technical Analysis gauges
 * company   - Company Folio, Live News
 */
export type MobileResearchTab = 'overview' | 'financials' | 'options' | 'technicals' | 'company'

export const MOBILE_RESEARCH_TABS: { key: MobileResearchTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'financials', label: 'Financials' },
  { key: 'options', label: 'Options' },
  { key: 'technicals', label: 'Technicals' },
  { key: 'company', label: 'Company' },
]
