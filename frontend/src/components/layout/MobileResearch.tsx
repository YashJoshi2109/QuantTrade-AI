'use client'

import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CandlestickChart,
  GitCompareArrows,
  Home,
  Loader2,
  Maximize2,
  MoreHorizontal,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Star,
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
  removeFromWatchlist,
  getWatchlist,
  FundamentalsData,
  PriceBar,
  Indicators,
  SearchResult,
  WatchlistItem,
} from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useRealtimeQuote } from '@/hooks/useRealtimeQuote'
import { useMacdHistory, useTechnicalInputs } from '@/hooks/useResearchTechnicals'
import { isCompanyAsset } from '@/lib/assetType'
import { displayCompanyName } from '@/lib/tickerIdentity'
import { TickerIdentityBanner, useTickerIdentity } from '@/components/research/TickerIdentityBanner'
import Chart from '@/components/Chart'
import TickerLogo from '@/components/TickerLogo'
import type { PaneIndicatorId } from '@/lib/indicators'
import { CardSkeleton as Skeleton } from '@/components/research/ResearchCard'
import { keyStatsSource } from '@/lib/researchKeyStats'
import type { TickerInfo } from '@/app/api/quotes/ticker/route'
import { resolvePriceInfo } from '@/lib/researchQuote'
import EarningsBadge from '@/components/earnings/EarningsBadge'
import FullscreenChartModal from '@/components/research/FullscreenChartModal'
import { ResearchStatsCard } from '@/components/research/ResearchStatsCard'
import { ResearchTabPanels } from '@/components/research/ResearchTabs'
import { ExtendedPill, companyHeadline } from '@/components/research/ResearchChartHeader'
import { BollingerCard, MacdCard, MovingAveragesCard, RsiCard, TrendSummaryCard } from '@/components/research/TechnicalCards'
import { CompanyFolioPanel } from '@/components/research/CompanyFolioPanel'
import { buildCopilotHref } from '@/lib/copilot-handoff'
import { compareHref } from '@/lib/compare'
import { cn } from '@/lib/utils'
import { isBool, objectOf, oneOf, usePersistentState } from '@/lib/persistentState'
import {
  MOBILE_CHART_TYPES,
  MOBILE_TIMEFRAMES,
  mobileRangeStart,
  useResearchSymbol,
  useResearchTab,
  type MobileChartType,
  type MobileTimeframe,
} from '@/lib/researchPrefs'
import { exchangeLabel, fmtChange, fmtNum, toneText } from '@/lib/researchTechnicals'

const VOLUME_PANE: PaneIndicatorId[] = ['volume']
const NO_PANES: PaneIndicatorId[] = []

interface MobileChartPrefs {
  type: MobileChartType
  volume: boolean
}
const DEFAULT_MOBILE_CHART: MobileChartPrefs = { type: 'area', volume: true }
const parseMobileChart = objectOf<MobileChartPrefs>(DEFAULT_MOBILE_CHART, { type: oneOf(MOBILE_CHART_TYPES), volume: isBool })

const roundBtn =
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line-subtle text-fg-primary active:scale-95 disabled:opacity-60'

/**
 * Mobile Research (design mock): header, price + extended pill, 4-stat row with
 * range bars, "Price performance" chart, RSI + MACD, Moving averages, trend
 * gauge + Bollinger, then the same tab set as desktop (ResearchTabPanels) and
 * a sticky "Ask AI Copilot" action bar. Cards and rules are shared with the
 * desktop page (components/research/*, lib/researchTechnicals).
 */
export default function MobileResearch() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  // Last symbol, timeframe and tab persist per user (lib/researchPrefs, shared with desktop).
  const symbolFromUrl = useResearchSymbol(searchParams?.get('symbol'))

  const [timeframe, setTimeframe] = usePersistentState<MobileTimeframe>('research.mobile.timeframe', '3M', {
    version: 3,
    validate: oneOf(MOBILE_TIMEFRAMES),
  })
  const [chartPrefs, setChartPrefs, chartCtl] = usePersistentState<MobileChartPrefs>('research.mobile.chart', DEFAULT_MOBILE_CHART, {
    version: 1,
    validate: parseMobileChart,
  })
  const [tab, setTab] = useResearchTab()
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('touchstart', onDoc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('touchstart', onDoc)
    }
  }, [menuOpen])

  /* ── Search state ── */
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const { data: searchResults = [], isLoading: searching } = useQuery<SearchResult[]>({
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

  /* ── Watchlist ── */
  const { isAuthenticated } = useAuth()
  const { data: watchlistItems = [] } = useQuery<WatchlistItem[]>({
    queryKey: ['watchlist'],
    queryFn: getWatchlist,
    enabled: isAuthenticated,
    staleTime: 30000,
  })
  const isWatched = useMemo(
    () => watchlistItems.some((i) => i.symbol.toUpperCase() === symbolFromUrl.toUpperCase()),
    [watchlistItems, symbolFromUrl],
  )
  const [watchBusy, setWatchBusy] = useState(false)
  const [watchError, setWatchError] = useState<string | null>(null)
  const toggleWatch = async () => {
    if (watchBusy) return
    setWatchError(null)
    if (!isAuthenticated) {
      setWatchError('Sign in to save symbols to your watchlist.')
      return
    }
    setWatchBusy(true)
    try {
      if (isWatched) {
        await removeFromWatchlist(symbolFromUrl)
      } else {
        await syncSymbol(symbolFromUrl).catch(() => undefined)
        await addToWatchlist({ symbol: symbolFromUrl })
      }
      await queryClient.invalidateQueries({ queryKey: ['watchlist'] })
    } catch (err) {
      setWatchError(err instanceof Error ? err.message : 'Watchlist action failed')
    } finally {
      setWatchBusy(false)
    }
  }

  /* ── Data fetching ── */
  const { data: realtimeQuote, isLoading: quoteLoading } = useRealtimeQuote({
    symbol: symbolFromUrl,
    refetchInterval: 5000,
    priority: 'high',
    useFinnhub: true,
  })

  const { data: fundamentals, isLoading: fundamentalsLoading } = useQuery<FundamentalsData>({
    queryKey: ['mobile.fundamentals', symbolFromUrl],
    queryFn: () => fetchFundamentals(symbolFromUrl),
    staleTime: 5 * 60 * 1000,
  })

  const isIntraday = timeframe === '1D' || timeframe === '5D'
  const { data: prices, isLoading: pricesLoading } = useQuery<PriceBar[]>({
    queryKey: ['mobile.prices', symbolFromUrl, timeframe],
    queryFn: () => {
      if (isIntraday) {
        return fetchIntradayPrices(symbolFromUrl, timeframe === '1D' ? '1m' : '5m', timeframe === '1D' ? 1 : 5)
      }
      const end = new Date()
      return fetchPrices(symbolFromUrl, mobileRangeStart(timeframe, end).toISOString(), end.toISOString(), timeframe === 'ALL' ? 5000 : 500)
    },
    staleTime: isIntraday ? 30_000 : 60_000,
    retry: 1,
  })

  const { data: indicators, isLoading: indicatorsLoading } = useQuery<Indicators>({
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
  const { data: tickerIdentity } = useTickerIdentity(symbolFromUrl)

  // Realtime -> ticker profile -> daily bars; never show a placeholder $0.00.
  const priceInfo = resolvePriceInfo(realtimeQuote, tickerInfo, prices)
  const livePrice = priceInfo.hasPrice ? priceInfo.price : null
  const isUp = priceInfo.percent >= 0
  const technicals = useTechnicalInputs(indicators, livePrice)
  const macdHist = useMacdHistory(symbolFromUrl)

  const companyName = companyHeadline(symbolFromUrl, displayCompanyName(tickerInfo?.name || fundamentals?.company_name, tickerIdentity))
  const meta = [symbolFromUrl, exchangeLabel(tickerInfo?.exchange_display || tickerInfo?.exchange), tickerInfo?.industry || tickerInfo?.sector]
    .filter(Boolean)
    .join(' · ')
  const keyStats = keyStatsSource(tickerInfo, priceInfo, fundamentals)
  // Chart colour follows the range shown: green when the range closed at or above where it opened.
  const rangeUp = prices && prices.length > 1 ? prices[prices.length - 1].close >= prices[0].close : isUp
  const live = !!priceInfo.dataSource && !priceInfo.stale && !!realtimeQuote

  const handleSync = async () => {
    setSyncError(null)
    setSyncing(true)
    try {
      await syncSymbol(symbolFromUrl)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mobile.prices', symbolFromUrl] }),
        queryClient.invalidateQueries({ queryKey: ['mobile.indicators', symbolFromUrl] }),
        queryClient.invalidateQueries({ queryKey: ['mobile.fundamentals', symbolFromUrl] }),
      ])
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Failed to sync data')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-3 pb-20" data-testid="mobile-research">
      {/* ── Header ── */}
      <header className="sticky top-0 z-30 -mx-4 border-b border-line-subtle bg-white/95 px-4 pb-2.5 pt-safe backdrop-blur-xl dark:bg-[#0b0f17]/95">
        <div className="flex items-center gap-2.5 pt-2">
          <TickerLogo symbol={symbolFromUrl} companyName={companyName || undefined} size={40} className="rounded-xl border border-line-subtle" />
          <div className="min-w-0 flex-1">
            {companyName ? (
              <h1 className="truncate text-[17px] font-bold leading-tight text-fg-primary" data-testid="mobile-research-name">
                {companyName}
              </h1>
            ) : tickerInfoLoading ? (
              <Skeleton className="h-5 w-36" />
            ) : (
              <h1 className="truncate text-[17px] font-bold leading-tight text-fg-primary">{symbolFromUrl}</h1>
            )}
            <p className="truncate text-[12px] text-fg-muted" data-testid="mobile-research-venue">
              {meta}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleWatch}
            disabled={watchBusy}
            aria-pressed={isWatched}
            aria-label={isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
            className={roundBtn}
          >
            {watchBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className={cn('h-4 w-4', isWatched && 'fill-amber-400 text-amber-500')} />}
          </button>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="More actions"
              className={roundBtn}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuOpen && (
              <div role="menu" className="rs-card absolute right-0 top-11 z-40 w-48 overflow-hidden py-1 shadow-theme-lg">
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    setShowSearch(true)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] text-fg-primary"
                >
                  <Search className="h-4 w-4 text-fg-muted" /> Search symbols
                </button>
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    handleSync()
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] text-fg-primary"
                >
                  <RefreshCw className="h-4 w-4 text-fg-muted" /> Sync data
                </button>
                <Link role="menuitem" href={compareHref([symbolFromUrl])} className="flex items-center gap-2 px-3 py-2.5 text-[13px] text-fg-primary">
                  <GitCompareArrows className="h-4 w-4 text-fg-muted" /> Compare
                </Link>
                <Link role="menuitem" href="/" className="flex items-center gap-2 px-3 py-2.5 text-[13px] text-fg-primary">
                  <Home className="h-4 w-4 text-fg-muted" /> Home
                </Link>
              </div>
            )}
          </div>
        </div>
        <EarningsBadge symbol={symbolFromUrl} variant="mobile" className="ml-[50px] mt-1" />
      </header>

      <TickerIdentityBanner identity={tickerIdentity} compact />

      {/* ── Search overlay ── */}
      {showSearch && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white/95 backdrop-blur-xl dark:bg-[#0b0f17]/95">
          <div className="border-b border-line-subtle px-4 pb-3 pt-safe">
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSearch(false)}
                aria-label="Close search"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-line-subtle bg-surface-raised"
              >
                <X className="h-4 w-4 text-fg-secondary" />
              </button>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by ticker or company name..."
                  aria-label="Search by ticker or company name"
                  className="h-10 w-full rounded-full border border-line-subtle bg-surface-raised pl-9 pr-3 text-[13px] text-fg-primary placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-blue-500/60"
                />
              </div>
            </div>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto px-4 pt-3">
            {searching && (
              <div className="py-8 text-center text-[11px] text-fg-muted">
                <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-blue-500" />
                Searching...
              </div>
            )}
            {!searching && searchQuery.trim() && searchResults.length === 0 && (
              <div className="py-8 text-center text-[11px] text-fg-muted">No matches found. Try a different query.</div>
            )}
            {searchResults.map((r) => (
              <button
                key={r.symbol}
                type="button"
                onClick={() => handleSearchSelect(r.symbol)}
                className="w-full rounded-2xl border border-line-subtle bg-surface-raised p-3 text-left active:scale-[0.98]"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-fg-primary">{r.symbol}</p>
                    <p className="truncate text-[11px] text-fg-muted">{r.name}</p>
                  </div>
                  {r.sector && (
                    <span className="rounded-full border border-line-subtle bg-surface-raised px-2 py-0.5 text-[10px] text-fg-secondary">{r.sector}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Price ── */}
      <section className="space-y-2" aria-label="Quote">
        {priceInfo.hasPrice ? (
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 tabular-nums">
            <span className="text-[32px] font-semibold leading-none tracking-tight text-fg-primary">${fmtNum(priceInfo.price, 2)}</span>
            <span data-testid="mobile-research-change" className={cn('inline-flex items-center gap-0.5 text-[15px] font-medium', toneText(isUp ? 'up' : 'down'))}>
              {isUp ? <ArrowUpRight className="h-4 w-4" aria-hidden /> : <ArrowDownRight className="h-4 w-4" aria-hidden />}
              {fmtChange(priceInfo.change, priceInfo.percent)}
            </span>
          </div>
        ) : (
          <div className="flex items-baseline gap-2" aria-busy="true" aria-label="Loading quote">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-4 w-24" />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {priceInfo.hasPrice && <ExtendedPill badge={priceInfo.extended} />}
          <span className="inline-flex items-center gap-1.5 text-[12px] text-fg-muted" title={priceInfo.dataSource ? `Source: ${priceInfo.dataSource}` : undefined}>
            <span className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-emerald-500' : 'bg-slate-400')} aria-hidden />
            {live ? 'Live market data' : quoteLoading ? 'Connecting…' : priceInfo.hasPrice ? `Last price · ${priceInfo.dataSource ?? 'profile'}` : 'Quote unavailable'}
          </span>
        </div>
        {watchError && <p className="text-[12px] text-amber-600 dark:text-amber-400">{watchError}</p>}
      </section>

      <ResearchStatsCard source={keyStats} price={livePrice} loading={tickerInfoLoading && !tickerInfo} variant="mobile" />

      {/* ── Price performance ── */}
      <section className="rs-card overflow-hidden" data-testid="mobile-chart-card">
        <div className="flex items-center justify-between px-3 pt-3">
          <h2 className="text-[14px] font-semibold text-fg-primary">Price performance</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setChartPrefs((p) => ({ ...p, type: p.type === 'area' ? 'candlestick' : 'area' }))}
              aria-pressed={chartPrefs.type === 'candlestick'}
              aria-label={chartPrefs.type === 'area' ? 'Show candles' : 'Show area chart'}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted active:scale-95"
            >
              <CandlestickChart className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setFullscreen(true)}
              disabled={!prices || prices.length === 0}
              aria-label="Full screen chart"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted active:scale-95 disabled:opacity-40"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-0.5 px-2 pt-2" role="group" aria-label="Chart range">
          {MOBILE_TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              aria-pressed={timeframe === tf}
              onClick={() => setTimeframe(tf)}
              className={cn(
                'h-7 min-h-0 flex-1 rounded-full text-[12px] font-semibold tabular-nums transition-colors',
                timeframe === tf ? 'bg-blue-600 text-white dark:bg-blue-500' : 'text-fg-muted',
              )}
            >
              {tf}
            </button>
          ))}
        </div>
        <div className="mt-2 h-[240px]">
          {prices && prices.length > 0 ? (
            <Chart
              data={prices}
              symbol={symbolFromUrl}
              seriesType={chartPrefs.type}
              trend={rangeUp ? 'up' : 'down'}
              activePanes={chartPrefs.volume ? VOLUME_PANE : NO_PANES}
              showGrid={false}
              minimal
            />
          ) : pricesLoading ? (
            <div className="flex h-full flex-col gap-2 p-3" aria-busy="true" aria-label="Loading chart">
              <Skeleton className="w-full flex-1" />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-[12px] text-fg-muted">No chart data. Try Sync.</div>
          )}
        </div>
        <div className="border-t border-line-subtle px-3 py-2 text-[11px] text-fg-muted">
          {isIntraday ? (timeframe === '1D' ? '1-min bars' : '5-min bars') : 'Daily bars'}
          {priceInfo.dataSource ? ` · Quote: ${priceInfo.dataSource}` : ''}
        </div>
      </section>

      {syncError && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-700 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <span>{syncError}</span>
        </div>
      )}

      {/* ── Technicals ── */}
      <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3">
        <RsiCard inputs={technicals} loading={indicatorsLoading} compact className="p-3" />
        <MacdCard inputs={technicals} loading={indicatorsLoading} history={macdHist} compact className="p-3" />
      </div>
      <MovingAveragesCard inputs={technicals} loading={indicatorsLoading} showTrend />
      <TrendSummaryCard inputs={technicals} loading={indicatorsLoading} />
      <BollingerCard inputs={technicals} loading={indicatorsLoading} />

      {/* ── Company Folio: right after the technicals, as on desktop's rail ── */}
      {showCompanyPanels && (
        <section aria-label="Company folio">
          <h2 className="pb-2 text-[15px] font-semibold text-fg-primary">Company Folio</h2>
          <CompanyFolioPanel symbol={symbolFromUrl} info={tickerInfo} isLoading={tickerInfoLoading} compact />
        </section>
      )}

      {/* ── Same tab set as desktop ── */}
      <ResearchTabPanels
        tab={tab}
        onTabChange={setTab}
        symbol={symbolFromUrl}
        tickerInfo={tickerInfo}
        tickerInfoLoading={tickerInfoLoading}
        fundamentals={fundamentals ?? null}
        fundamentalsLoading={fundamentalsLoading}
        indicators={indicators ?? null}
        indicatorsLoading={indicatorsLoading}
        technicals={technicals}
        price={livePrice}
        quote={{ price: livePrice, percent: priceInfo.hasPrice ? priceInfo.percent : null, volume: priceInfo.volume }}
        showCompanyPanels={showCompanyPanels}
        onSync={handleSync}
        syncing={syncing}
        testIdPrefix="mobile-research-tab"
        newsLimit={12}
      />

      {/* ── Sticky action bar (sits above the bottom nav) ── */}
      <div
        className="fixed inset-x-0 z-30 px-4 md:hidden"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 136px)' }}
        data-testid="mobile-action-bar"
      >
        <div className="rs-card mx-auto flex max-w-md items-center gap-2 p-2 shadow-theme-lg">
          <Link
            href={buildCopilotHref(symbolFromUrl.toUpperCase())}
            data-testid="ask-copilot"
            aria-label={`Ask AI Copilot about ${symbolFromUrl.toUpperCase()}`}
            className="inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 text-[14px] font-semibold text-white active:scale-[0.98]"
          >
            <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">Ask AI Copilot</span>
          </Link>
          <Link href={compareHref([symbolFromUrl])} aria-label={`Compare ${symbolFromUrl}`} className={cn(roundBtn, 'h-11 w-11 rounded-xl')}>
            <GitCompareArrows className="h-4 w-4" />
          </Link>
          <button type="button" onClick={() => setSettingsOpen(true)} aria-label="Chart settings" className={cn(roundBtn, 'h-11 w-11 rounded-xl')}>
            <Settings2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={handleSync} disabled={syncing} aria-label="Refresh data" className={cn(roundBtn, 'h-11 w-11 rounded-xl')}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* ── Chart settings sheet ── */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setSettingsOpen(false)} role="presentation">
          <div
            role="dialog"
            aria-label="Chart settings"
            className="w-full rounded-t-2xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)] dark:bg-[#0f1520]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-fg-primary">Chart settings</h2>
              <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Close" className="p-1 text-fg-muted">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mb-2 text-[11px] uppercase tracking-wide text-fg-muted">Chart type</div>
            <div className="mb-4 grid grid-cols-[repeat(2,minmax(0,1fr))] gap-2">
              {MOBILE_CHART_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={chartPrefs.type === t}
                  onClick={() => setChartPrefs((p) => ({ ...p, type: t }))}
                  className={cn(
                    'h-10 rounded-xl border text-[13px] font-medium',
                    chartPrefs.type === t ? 'border-blue-600 bg-blue-600 text-white' : 'border-line-default text-fg-secondary',
                  )}
                >
                  {t === 'area' ? 'Area' : 'Candles'}
                </button>
              ))}
            </div>
            <label className="flex items-center justify-between py-2 text-[13px] text-fg-primary">
              Volume
              <input
                type="checkbox"
                checked={chartPrefs.volume}
                onChange={(e) => setChartPrefs((p) => ({ ...p, volume: e.target.checked }))}
                className="h-5 w-5 accent-blue-600"
              />
            </label>
            <button type="button" onClick={() => chartCtl.reset()} className="mt-2 text-[12px] font-medium text-blue-600 dark:text-blue-400">
              Reset chart settings
            </button>
          </div>
        </div>
      )}

      <FullscreenChartModal
        isOpen={fullscreen}
        onClose={() => setFullscreen(false)}
        symbol={symbolFromUrl}
        priceData={prices ?? []}
        chartSeriesType={chartPrefs.type}
        chartShowMa={false}
      />
    </div>
  )
}
