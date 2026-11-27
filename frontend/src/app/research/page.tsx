'use client'

import { useState, useEffect, useRef, useMemo, useSyncExternalStore, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import MobileResearch from '@/components/layout/MobileResearch'
import type { ChartSeriesType } from '@/components/Chart'
import type { OverlayIndicatorId, PaneIndicatorId } from '@/lib/indicators'
import {
  syncSymbol,
  addToWatchlist,
  getWatchlist,
  removeFromWatchlist,
  type WatchlistItem,
} from '@/lib/api'
import { useRealtimeQuote } from '@/hooks/useRealtimeQuote'
import { useMacdHistory, useTechnicalInputs } from '@/hooks/useResearchTechnicals'
import { isNumber } from '@/lib/format'
import { useToast } from '@/components/Toast'
import { SkeletonText, Skeleton } from '@/components/Skeleton'
import {
  requestPriceSync,
  researchKeys,
  useResearchFundamentals,
  useResearchIndicators,
  useResearchPrices,
  useResearchStatus,
  useTickerInfo,
  isNotFoundError,
  type PriceRange,
} from '@/lib/researchData'
import { ResearchStatusBanner } from '@/components/research/ResearchStatusBanner'
import UnknownTicker from '@/components/research/UnknownTicker'
import { keyStatsSource } from '@/lib/researchKeyStats'
import { useChartPrefs, useResearchSymbol, useResearchTab } from '@/lib/researchPrefs'
import { ResearchPriceHeader, type ResearchChartPeriod } from '@/components/research/ResearchChartHeader'
import { ResearchChartCard } from '@/components/research/ResearchChartCard'
import { ResearchStatsCard } from '@/components/research/ResearchStatsCard'
import { ResearchTabPanels } from '@/components/research/ResearchTabs'
import {
  BollingerCard,
  MacdCard,
  MovingAveragesCard,
  RsiCard,
  TrendSummaryCard,
} from '@/components/research/TechnicalCards'
import { CompanyFolioPanel } from '@/components/research/CompanyFolioPanel'
import FullscreenChartModal from '@/components/research/FullscreenChartModal'
import { getExchangeTimezone } from '@/lib/world-exchanges'
import { isCompanyAsset } from '@/lib/assetType'
import { displayCompanyName, identityWarning } from '@/lib/tickerIdentity'
import { TickerIdentityBanner, useTickerIdentity } from '@/components/research/TickerIdentityBanner'

type ChartPeriod = ResearchChartPeriod

function isIntradayPeriod(period: ChartPeriod): boolean {
  return period === '1D' || period === '5D'
}

const PERIOD_DAYS: Record<ChartPeriod, number> = {
  '1D': 1,
  '5D': 5,
  '1M': 35,
  '3M': 98,
  '6M': 190,
  '1Y': 370,
  '2Y': 750,
  '5Y': 1900,
}

/** Bars to load for a chart period (shared React Query key via lib/researchData). */
function chartPriceRange(period: ChartPeriod, extendedHours: boolean): PriceRange {
  if (period === '1D') return { kind: 'intraday', interval: '1m', days: 1, extendedHours }
  if (period === '5D') return { kind: 'intraday', interval: '5m', days: 5, extendedHours }
  const days = PERIOD_DAYS[period]
  return { kind: 'daily', days, limit: Math.min(5000, Math.ceil(days * 1.25)) }
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

  // Last symbol and chart setup persist per user (lib/researchPrefs, shared with mobile).
  const selectedSymbol = useResearchSymbol(symbolParam)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const { prefs: chartPrefs, field: chartField, reset: resetChartPrefs } = useChartPrefs()
  const chartPeriod: ChartPeriod = chartPrefs.period
  const chartSeriesType: ChartSeriesType = chartPrefs.seriesType
  const { showMa: chartShowMa, showVolume: chartShowVolume, logScale: chartLogScale, showGrid: chartShowGrid } = chartPrefs
  const activeOverlays: OverlayIndicatorId[] = chartPrefs.overlays
  const activePanes: PaneIndicatorId[] = chartPrefs.panes
  const extendedHours = chartPrefs.extendedHours
  const {
    setChartPeriod, setChartSeriesType, setChartShowMa, setChartShowVolume, setChartLogScale, setChartShowGrid,
    setActiveOverlays, setActivePanes, setExtendedHours,
  } = useMemo(() => ({
    setChartPeriod: chartField('period'), setChartSeriesType: chartField('seriesType'), setChartShowMa: chartField('showMa'),
    setChartShowVolume: chartField('showVolume'), setChartLogScale: chartField('logScale'), setChartShowGrid: chartField('showGrid'),
    setActiveOverlays: chartField('overlays'), setActivePanes: chartField('panes'), setExtendedHours: chartField('extendedHours'),
  }), [chartField])
  const [fullscreenChart, setFullscreenChart] = useState(false)
  const [watchlistBusy, setWatchlistBusy] = useState(false)

  const { data: watchlistItems = [] } = useQuery<WatchlistItem[]>({
    queryKey: ['watchlist'],
    queryFn: getWatchlist,
    staleTime: 60_000,
    retry: false,
  })

  // Core sources: shared React Query keys with MobileResearch (lib/researchData),
  // failures surface as typed errors so the header banner can explain them.
  const tickerQ = useTickerInfo(selectedSymbol)
  const { data: tickerInfo, isPending: tickerInfoLoading } = tickerQ

  // Index / ETF symbols hide company-only panels (same helper as MobileResearch).
  const showCompanyPanels = isCompanyAsset(selectedSymbol, tickerInfo?.asset_type)

  // Stale / reassigned ticker warning (same hook + banner as MobileResearch).
  const { data: tickerIdentity } = useTickerIdentity(selectedSymbol)
  const headerTickerInfo = useMemo(
    () =>
      tickerInfo && tickerIdentity
        ? { ...tickerInfo, name: displayCompanyName(tickerInfo.name, tickerIdentity) ?? tickerInfo.name }
        : tickerInfo,
    [tickerInfo, tickerIdentity],
  )

  const inWatchlist = useMemo(
    () => watchlistItems.some((i) => i.symbol.toUpperCase() === selectedSymbol.toUpperCase()),
    [watchlistItems, selectedSymbol],
  )

  const exchangeTz = useMemo(
    () => getExchangeTimezone(tickerInfo?.exchange_display || tickerInfo?.exchange),
    [tickerInfo?.exchange_display, tickerInfo?.exchange],
  )


  // Live quote: shared, market-phase-aware poll with 429 backoff. No polling
  // once the profile says the ticker does not exist.
  const quoteQ = useRealtimeQuote({
    symbol: selectedSymbol,
    priority: 'high',
    useFinnhub: true,
    poll: !isNotFoundError(tickerQ.error),
  })
  const { data: realtimeQuote, isLoading: quoteLoading } = quoteQ

  const priceRange = useMemo(() => chartPriceRange(chartPeriod, extendedHours), [chartPeriod, extendedHours])
  const pricesQ = useResearchPrices(selectedSymbol, priceRange)
  const indicatorsQ = useResearchIndicators(selectedSymbol)
  const fundamentalsQ = useResearchFundamentals(selectedSymbol)
  const priceData = useMemo(() => pricesQ.data ?? [], [pricesQ.data])
  const indicators = indicatorsQ.data ?? null
  const fundamentals = fundamentalsQ.data ?? null
  const loading = pricesQ.isPending
  const error =
    syncError ??
    (pricesQ.isError && priceData.length === 0
      ? 'Price history is temporarily unavailable. Retrying automatically.'
      : pricesQ.isSuccess && priceData.length === 0
        ? 'No price data available. Click "Sync Data" to fetch.'
        : null)

  // One status for the header banner (same hook as MobileResearch).
  const researchStatus = useResearchStatus({
    symbol: selectedSymbol,
    quote: quoteQ,
    tickerInfo: tickerQ,
    prices: pricesQ,
    indicators: indicatorsQ,
    fundamentals: fundamentalsQ,
  })

  const handleSyncData = async () => {
    setSyncing(true)
    setSyncError(null)
    try {
      await syncSymbol(selectedSymbol)
      const { start: startDate, end: endDate } = chartPeriodRange(chartPeriod)
      await requestPriceSync(selectedSymbol, startDate, endDate)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['research.prices', selectedSymbol] }),
        queryClient.invalidateQueries({ queryKey: researchKeys.indicators(selectedSymbol) }),
        queryClient.invalidateQueries({ queryKey: researchKeys.fundamentals(selectedSymbol) }),
      ])
    } catch (err) {
      console.error('Error syncing:', err)
      setSyncError('Failed to sync data. Please try again.')
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

  // Realtime quote -> ticker profile price -> last daily bars. hasPrice=false means
  // no source has a real price yet (render a skeleton, never "$0.00").
  const priceInfo = researchStatus.priceInfo
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
  const quoteActivityFingerprint = Math.round(
    ((priceInfo.price || 0) * 1000 + (priceInfo.percent || 0) * 10000) / 10
  ) / 100

  const technicals = useTechnicalInputs(indicators, priceInfo.hasPrice ? priceInfo.price : null)
  const macdHist = useMacdHistory(selectedSymbol)
  const [tab, setTab] = useResearchTab()
  const keyStats = keyStatsSource(tickerInfo, priceInfo, fundamentals)
  const indicatorsLoading = indicatorsQ.isPending

  if (researchStatus.kind === 'not_found') {
    return (
      <AppLayout symbol={selectedSymbol}>
        <div className="mx-auto w-full max-w-[1100px] p-6">
          <UnknownTicker symbol={selectedSymbol} onRetry={researchStatus.retry} />
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout symbol={selectedSymbol}>
      <div className="mx-auto w-full max-w-[1600px] p-6">
        {identityWarning(tickerIdentity) && (
          <div className="mb-4">
            <TickerIdentityBanner identity={tickerIdentity} />
          </div>
        )}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          {/* Main column */}
          <div className="min-w-0 space-y-4">
            <ResearchStatusBanner status={researchStatus} />
            <ResearchPriceHeader
              symbol={selectedSymbol}
              tickerInfo={headerTickerInfo}
              companyNameFallback={displayCompanyName(fundamentals?.company_name, tickerIdentity)}
              profileLoading={tickerInfoLoading}
              priceInfo={priceInfo}
              quoteLoading={quoteLoading}
              priceTick={priceTick}
              inWatchlist={inWatchlist}
              watchlistBusy={watchlistBusy}
              onWatchlistToggle={handleWatchlistToggle}
              onSyncData={handleSyncData}
              syncing={syncing}
            />

            <ResearchStatsCard
              source={keyStats}
              price={priceInfo.hasPrice ? priceInfo.price : null}
              loading={tickerInfoLoading && !tickerInfo}
            />

            <ResearchChartCard
              symbol={selectedSymbol}
              currency={tickerInfo?.currency}
              priceData={priceData}
              loading={loading}
              error={error}
              onSyncData={handleSyncData}
              chartPeriod={chartPeriod}
              setChartPeriod={setChartPeriod}
              chartSeriesType={chartSeriesType}
              setChartSeriesType={setChartSeriesType}
              chartShowMa={chartShowMa}
              setChartShowMa={setChartShowMa}
              chartShowVolume={chartShowVolume}
              setChartShowVolume={setChartShowVolume}
              chartLogScale={chartLogScale}
              setChartLogScale={setChartLogScale}
              chartShowGrid={chartShowGrid}
              setChartShowGrid={setChartShowGrid}
              onResetChart={resetChartPrefs}
              activeOverlays={activeOverlays}
              activePanes={activePanes}
              setActiveOverlays={setActiveOverlays}
              setActivePanes={setActivePanes}
              extendedHours={extendedHours}
              onToggleExtendedHours={() => setExtendedHours((v) => !v)}
              exchangeTimezone={exchangeTz}
              onFullscreen={() => setFullscreenChart(true)}
              dataSource={priceInfo.dataSource}
              latency={priceInfo.latency}
              quoteLoading={quoteLoading}
              quoteActivityFingerprint={quoteActivityFingerprint}
            />

            <ResearchTabPanels
              tab={tab}
              onTabChange={setTab}
              symbol={selectedSymbol}
              tickerInfo={tickerInfo}
              tickerInfoLoading={tickerInfoLoading}
              fundamentals={fundamentals}
              fundamentalsLoading={fundamentalsQ.isPending}
              indicators={indicators}
              indicatorsLoading={indicatorsLoading}
              technicals={technicals}
              price={priceInfo.hasPrice ? priceInfo.price : null}
              quote={{ price: priceInfo.hasPrice ? priceInfo.price : null, percent: priceInfo.hasPrice ? priceInfo.percent : null, volume: priceInfo.volume }}
              showCompanyPanels={showCompanyPanels}
              onSync={handleSyncData}
              syncing={syncing}
            />
          </div>

          {/* Right rail */}
          <aside className="min-w-0 space-y-4" aria-label="Technical analysis" data-testid="technical-rail">
            <h2 className="pt-1 text-[15px] font-semibold text-fg-primary">Technical analysis</h2>
            <TrendSummaryCard inputs={technicals} loading={indicatorsLoading} />
            <RsiCard inputs={technicals} loading={indicatorsLoading} />
            <MovingAveragesCard inputs={technicals} loading={indicatorsLoading} />
            <MacdCard inputs={technicals} loading={indicatorsLoading} history={macdHist} />
            <BollingerCard inputs={technicals} loading={indicatorsLoading} />
            <p className="px-1 text-[11px] leading-snug text-fg-muted">
              Indicators from daily closes (SMA, RSI 14, MACD 12/26/9, Bollinger 20/2). Hover the info icons for how each label is derived. Not investment advice.
            </p>
            {showCompanyPanels && (
              <section aria-label="Company folio" className="pt-2">
                <h2 className="pb-3 text-[15px] font-semibold text-fg-primary">Company Folio</h2>
                <CompanyFolioPanel symbol={selectedSymbol} info={tickerInfo} isLoading={tickerInfoLoading} compact />
              </section>
            )}
          </aside>
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

// Only the tree for the current viewport mounts: both used to mount (one hidden
// by CSS), so every Research request ran twice and the hidden mobile tree
// polled the quote every 5s on desktop. The server snapshot is 'unknown', so
// SSR + hydration render the CSS-switched skeletons, then one tree mounts.
const DESKTOP_MQ = '(min-width: 768px)'
type Viewport = 'unknown' | 'desktop' | 'mobile'
function subscribeViewport(cb: () => void) {
  const mql = window.matchMedia(DESKTOP_MQ)
  mql.addEventListener('change', cb)
  return () => mql.removeEventListener('change', cb)
}
function useViewport(): Viewport {
  return useSyncExternalStore<Viewport>(
    subscribeViewport,
    () => (window.matchMedia(DESKTOP_MQ).matches ? 'desktop' : 'mobile'),
    () => 'unknown',
  )
}

function ResearchSkeleton() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Skeleton className="w-12 h-12 rounded-full" />
        <SkeletonText className="h-4 w-32" />
      </div>
    </div>
  )
}

export default function ResearchPage() {
  const viewport = useViewport()
  if (viewport === 'unknown') return <ResearchSkeleton />
  return (
    <>
      {viewport === 'desktop' && (
      <div className="hidden md:block">
        <DesktopResearchPage />
      </div>
      )}
      {viewport === 'mobile' && (
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
      )}
    </>
  )
}
