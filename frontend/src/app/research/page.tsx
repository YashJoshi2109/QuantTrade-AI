'use client'

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import MobileResearch from '@/components/layout/MobileResearch'
import type { ChartSeriesType } from '@/components/Chart'
import type { OverlayIndicatorId, PaneIndicatorId } from '@/lib/indicators'
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
import { useRealtimeQuote } from '@/hooks/useRealtimeQuote'
import { useMacdHistory, useTechnicalInputs } from '@/hooks/useResearchTechnicals'
import { isNumber } from '@/lib/format'
import { useToast } from '@/components/Toast'
import { SkeletonText, Skeleton } from '@/components/Skeleton'
import type { TickerInfo } from '@/app/api/quotes/ticker/route'
import { resolvePriceInfo } from '@/lib/researchQuote'
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
import { displayCompanyName, tickerBannerState } from '@/lib/tickerIdentity'
import { RetiredPricePlaceholder, TickerIdentityBanner, useTickerIdentity } from '@/components/research/TickerIdentityBanner'

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

  // Last symbol and chart setup persist per user (lib/researchPrefs, shared with mobile).
  const selectedSymbol = useResearchSymbol(symbolParam)
  const [priceData, setPriceData] = useState<PriceBar[]>([])
  const [indicators, setIndicators] = useState<Indicators | null>(null)
  const [fundamentals, setFundamentals] = useState<FundamentalsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
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


  // Real-time quote with HIGH PRIORITY for research page and 5-second updates
  const { data: realtimeQuote, isLoading: quoteLoading } = useRealtimeQuote({ 
    symbol: selectedSymbol,
    refetchInterval: 15_000, // Update every 15 seconds
    priority: 'high', // High priority - will wait if rate limited
    useFinnhub: true // Use Finnhub for real-time data
  })

  // Each load gets an id; a slower response for a previous symbol/period must not
  // overwrite the current one (first-load race when the URL symbol arrives).
  const loadSeqRef = useRef(0)
  const loadedSymbolRef = useRef<string | null>(null)
  const loadSymbolData = useCallback(async () => {
    const seq = ++loadSeqRef.current
    const isStale = () => seq !== loadSeqRef.current
    setLoading(true)
    setError(null)
    if (loadedSymbolRef.current !== selectedSymbol) {
      // New symbol: drop the previous symbol's bars/indicators instead of showing them.
      loadedSymbolRef.current = selectedSymbol
      setPriceData([])
      setIndicators(null)
    }

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
      
      let [ind, fund] = await Promise.all([
        fetchIndicators(selectedSymbol).catch(() => null),
        fetchFundamentals(selectedSymbol).catch(() => null)
      ])

      // Cold backend / first sync of a new symbol: retry once before showing empty panels.
      if (!isStale() && (prices.length === 0 || !ind)) {
        await new Promise((resolve) => setTimeout(resolve, 2500))
        if (isStale()) return
        const [retryPrices, retryInd] = await Promise.all([
          prices.length === 0
            ? isIntradayPeriod(chartPeriod)
              ? fetchIntradayPrices(selectedSymbol, chartPeriod === '1D' ? '1m' : '5m', chartPeriod === '1D' ? 1 : 5, extendedHours).catch(() => [])
              : fetchPrices(selectedSymbol, startDate.toISOString(), endDate.toISOString(), barLimit).catch(() => [])
            : Promise.resolve(prices),
          ind ? Promise.resolve(ind) : fetchIndicators(selectedSymbol).catch(() => null),
        ])
        prices = retryPrices
        ind = retryInd
      }
      if (isStale()) return

      setPriceData(prices)
      setIndicators(ind)
      setFundamentals(fund)
      
      if (prices.length === 0) {
        setError('No price data available. Click "Sync Data" to fetch.')
      }
    } catch (err) {
      if (isStale()) return
      console.error('Error loading symbol data:', err)
      setError('Failed to load data. Please try again.')
    } finally {
      if (!isStale()) setLoading(false)
    }
  }, [selectedSymbol, chartPeriod, extendedHours])

  useEffect(() => {
    loadSymbolData()
  }, [loadSymbolData])

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

  // Realtime quote -> ticker profile price -> last daily bars. hasPrice=false means
  // no source has a real price yet (render a skeleton, never "$0.00").
  const priceInfo = resolvePriceInfo(realtimeQuote, tickerInfo, priceData)
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
  const indicatorsLoading = loading && !indicators
  // Retired tickers (SQ, PXD, ...): hide every price-dependent panel instead of
  // rendering nulls; the banner links the successor.
  const bannerState = tickerBannerState(tickerIdentity)
  const hidePrice = !!bannerState?.hidePricePanels

  return (
    <AppLayout symbol={selectedSymbol}>
      <div className="mx-auto w-full max-w-[1600px] p-6">
        {bannerState && (
          <div className="mb-4">
            <TickerIdentityBanner identity={tickerIdentity} />
          </div>
        )}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          {/* Main column */}
          <div className="min-w-0 space-y-4">
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

            {hidePrice ? (
              <RetiredPricePlaceholder identity={tickerIdentity} />
            ) : (
            <>
            <ResearchStatsCard
              source={keyStats}
              price={priceInfo.hasPrice ? priceInfo.price : null}
              loading={tickerInfoLoading && !tickerInfo}
              fieldNotes={fundamentals?.field_notes}
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
            </>
            )}

            <ResearchTabPanels
              tab={tab}
              onTabChange={setTab}
              symbol={selectedSymbol}
              tickerInfo={tickerInfo}
              tickerInfoLoading={tickerInfoLoading}
              fundamentals={fundamentals}
              fundamentalsLoading={loading && !fundamentals}
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
            {!hidePrice && (
            <>
            <h2 className="pt-1 text-[15px] font-semibold text-fg-primary">Technical analysis</h2>
            <TrendSummaryCard inputs={technicals} loading={indicatorsLoading} />
            <RsiCard inputs={technicals} loading={indicatorsLoading} />
            <MovingAveragesCard inputs={technicals} loading={indicatorsLoading} />
            <MacdCard inputs={technicals} loading={indicatorsLoading} history={macdHist} />
            <BollingerCard inputs={technicals} loading={indicatorsLoading} />
            <p className="px-1 text-[11px] leading-snug text-fg-muted">
              Indicators from daily closes (SMA, RSI 14, MACD 12/26/9, Bollinger 20/2). Hover the info icons for how each label is derived. Not investment advice.
            </p>
            </>
            )}
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
