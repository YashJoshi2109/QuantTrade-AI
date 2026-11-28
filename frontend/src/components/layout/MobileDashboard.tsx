'use client'

import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import MobileSearchSheet from '@/components/search/MobileSearchSheet'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  Search,
  User,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  BarChart3,
  Zap,
} from 'lucide-react'
import Image from 'next/image'
import TickerLogo from '@/components/TickerLogo'
import { useClientNow } from '@/lib/use-client-now'
import { useAuth } from '@/contexts/AuthContext'
import { HOME_HEADING } from '@/lib/seo'
import {
  fetchMarketStatus,
  fetchMarketMovers,
  fetchMarketIndices,
  fetchSectorPerformance,
  fetchPredictionAlerts,
  MarketStatus,
  MarketMovers,
  MarketIndex,
  SectorPerformance,
} from '@/lib/api'
import { useNewsFeed } from '@/hooks/useNewsFeed'
import NewsFeedCard from '@/components/news/NewsFeedCard'
import { NewsLiveStatus } from '@/components/news/NewsLiveStatus'
import { formatNumber, formatPercent, isNumber } from '@/lib/format'
import { computeBreadth } from '@/lib/marketBreadth'
import { formatLevelOrPrice, isIndexLevel } from '@/lib/quoteDisplay'
import { normalizeMoverRows } from '@/lib/movers'
import MarketNewsGrid from '@/components/MarketNewsGrid'
import EconomicCalendarStrip from '@/components/EconomicCalendarStrip'
import MiniWorldMonitorSnapshot from '@/components/MiniWorldMonitorSnapshot'
import IpoRadarWidget from '@/components/IpoRadarWidget'
import { useToast } from '@/components/Toast'
import { useMarketIndices, useMarketMovers, useSectorPerformance } from '@/lib/marketQueries'
import { useMarketStatus } from '@/hooks/useMarketRefresh'

// Time-dependent strings render only after mount: the server's clock and zone
// differ from the browser's, which caused hydration error #418.
function useGreeting(name?: string | null) {
  const now = useClientNow(60_000)
  const username = name?.split(' ')[0] || 'Trader'
  if (!now) return `Welcome, ${username}`
  const hour = now.getHours()
  const base =
    hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  return `${base}, ${username}`
}

function useCurrentTime() {
  const now = useClientNow(30_000)
  if (!now) return '--:--'
  return now.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function MarketStatusPill({ status }: { status?: MarketStatus }) {
  const isOpen = status?.is_open ?? false
  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-surface-raised border border-line-subtle">
      <span
        className={`w-2 h-2 rounded-full ${
          isOpen ? 'bg-[#00FF88] animate-pulse' : 'bg-line-default'
        }`}
      />
      <span className="text-[10px] font-medium text-fg-primary">
        {isOpen ? 'Market Open' : 'Market Closed'}
      </span>
    </div>
  )
}

interface DashboardIndexCardProps {
  index?: MarketIndex
  label: string
}

function DashboardIndexCard({ index, label }: DashboardIndexCardProps) {
  const value = index?.price
  const pct = index?.change_percent
  const isUp = isNumber(pct) && pct >= 0
  // An ETF proxy (SPY for ^GSPC) is labelled as the ETF, never as the index.
  const shownLabel = index?.is_proxy ? index.name : label
  const level = index ? isIndexLevel(index) : true

  return (
    <div className="shrink-0 w-[140px] h-[100px] rounded-2xl bg-surface-raised border border-line-subtle backdrop-blur-xl p-3 flex flex-col justify-between mr-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-fg-secondary font-medium truncate" title={shownLabel}>
          {shownLabel}
        </span>
        {isNumber(pct) && (
          <span
            className={`flex items-center gap-0.5 text-[10px] font-mono ${
              isUp ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {isUp ? '+' : ''}
            {formatPercent(pct, 2)}
          </span>
        )}
      </div>
      <div className="mt-1">
        <div className="text-[14px] font-semibold text-fg-primary font-mono">
          {formatLevelOrPrice(value, level)}
        </div>
        <p className="mt-1 text-[10px] text-fg-muted">
          {index?.timestamp
            ? new Date(index.timestamp).toLocaleTimeString(undefined, {
                hour: 'numeric',
                minute: '2-digit',
              })
            : 'Delayed data'}
        </p>
      </div>
    </div>
  )
}

export default function MobileDashboard() {
  const router = useRouter()
  const { user } = useAuth()
  const { warning } = useToast()
  const greeting = useGreeting(user?.full_name || user?.username)
  const timeString = useCurrentTime()

  /* ── Search (shared full-screen sheet: components/search) ── */
  const [showSearch, setShowSearch] = useState(false)

  // Shared app-wide queries (lib/marketQueries): one poll per key for every view.
  const { data: status, isLoading: statusLoading } = useMarketStatus()
  const { data: movers, isLoading: moversLoading } = useMarketMovers()
  const { data: indices } = useMarketIndices()
  const { data: sectors } = useSectorPerformance()

  // Same cache entry as desktop home + MarketNewsGrid (unified feed, latest, limit 50).
  const breakingFeed = useNewsFeed({ limit: 50 })
  const newsLoading = breakingFeed.isLoading
  const { data: predictionAlerts = [] } = useQuery({
    queryKey: ['predictionAlerts'],
    queryFn: () => fetchPredictionAlerts(0.65, 2.0),
    refetchInterval: 90000,
    staleTime: 45000,
  })

  useEffect(() => {
    const firstHigh = predictionAlerts.find((a) => a.severity === 'high')
    if (!firstHigh) return
    const key = `mobile-pred-alert-${firstHigh.symbol}-${firstHigh.timeframe}-${firstHigh.direction}`
    if (!localStorage.getItem(key)) {
      warning(`Signal alert: ${firstHigh.message}`, 6000)
      localStorage.setItem(key, '1')
    }
  }, [predictionAlerts, warning])

  const clientNow = useClientNow()
  const dateString = useMemo(() => {
    if (!clientNow) return '\u00a0'
    return clientNow.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    })
  }, [clientNow])

  const indexMap = useMemo(() => {
    const map: Record<string, MarketIndex | undefined> = {}

    if (indices && indices.length > 0) {
      indices.forEach((idx) => {
        const key = idx.symbol.toUpperCase()
        // Same symbols the desktop tiles use. ETF rows (SPY/QQQ/DIA) are never
        // mapped onto an index card: a missing level renders as "—".
        if (key.includes('GSPC') || key.includes('SPX')) {
          map.sp500 ??= idx
        } else if (key.includes('IXIC')) {
          map.nasdaq ??= idx
        } else if (key.includes('DJI')) {
          map.dow ??= idx
        }
      })
    }

    // No fabricated fallback levels: a missing index renders as "—".
    return map
  }, [indices])

  const topGainers = normalizeMoverRows(movers?.gainers).slice(0, 8)
  const topLosers = normalizeMoverRows(movers?.losers).slice(0, 8)
  // Same source (sector heatmap), classifier and ±0.1% flat band as desktop home + /markets.
  const breadth = useMemo(() => computeBreadth(sectors), [sectors])
  const topSectors = sectors?.slice(0, 6) ?? []

  return (
    <div className="space-y-5">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-surface-base/95 backdrop-blur-xl border-b border-line-subtle pt-safe pb-2 px-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-[#00D9FF] via-[#4c6fff] to-[#00D9FF] p-[1px]">
              <div className="h-full w-full rounded-2xl bg-surface-base flex items-center justify-center overflow-hidden">
                <Image src="/logo.png" alt="QuantTrade AI" width={20} height={20} className="object-contain" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1">
                <span className="text-[11px] tracking-[0.22em] text-fg-secondary font-semibold">
                  QUANTTRADE AI
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                {!statusLoading && <MarketStatusPill status={status} />}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSearch(true)}
              aria-label="Search stocks"
              className="h-8 w-8 rounded-full bg-surface-raised border border-line-subtle flex items-center justify-center active:scale-95"
            >
              <Search className="w-4 h-4 text-fg-primary" aria-hidden />
            </button>
            <Link
              href="/settings"
              aria-label="Account settings"
              className="h-8 w-8 rounded-full bg-surface-raised border border-line-subtle flex items-center justify-center active:scale-95"
            >
              <User className="w-4 h-4 text-fg-primary" aria-hidden />
            </Link>
          </div>
        </div>
      </header>

      <MobileSearchSheet open={showSearch} onClose={() => setShowSearch(false)} />

      {/* Greeting */}
      <section className="px-1">
        <div className="rounded-2xl bg-gradient-to-br from-surface-overlay via-surface-base to-surface-overlay border border-line-subtle p-4 relative overflow-hidden">
          <div className="absolute -top-8 -right-10 w-28 h-28 bg-[#00D9FF]/15 blur-3xl" />
          <div className="relative space-y-1">
            {/* Page-level heading for the mobile tree. Not an <h1>: the desktop
                tree (also in the server HTML) owns the page's single <h1>. */}
            <p role="heading" aria-level={1} className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#00D9FF]">
              {HOME_HEADING}
            </p>
            <p className="text-[11px] text-fg-secondary">{dateString}</p>
            <h2 className="text-lg font-semibold text-fg-primary">{greeting}</h2>
            <p className="text-[11px] text-fg-secondary flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
              {timeString} • Live market overview
            </p>
          </div>
        </div>
      </section>

      {/* Quick stats carousel */}
      <section className="px-1">
        <div className="flex items-stretch overflow-x-auto scrollbar-hide -mx-1 px-1">
          <div className="shrink-0 w-[140px] h-[100px] rounded-2xl bg-surface-raised border border-line-subtle backdrop-blur-xl p-3 flex flex-col justify-between mr-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-fg-secondary font-medium">Market</span>
              <Activity className="w-3.5 h-3.5 text-[#00D9FF]" />
            </div>
            <div className="mt-1">
              <p className="text-[12px] text-fg-secondary">
                {status?.status === 'OPEN' ? 'U.S. markets are trading.' : 'Markets are closed.'}
              </p>
              <p className="mt-1 text-[9px] text-fg-muted">
                NYSE · NASDAQ{' '}
                {status?.is_weekday ? (status?.is_open ? 'session live' : 'off-hours') : 'weekend'}
              </p>
              {breadth.total > 0 && (
                <p className="mt-1 text-[9px] font-mono tabular-nums" aria-label="Market breadth">
                  <span className="text-emerald-400">{breadth.gainers}↑</span>{' '}
                  <span className="text-red-400">{breadth.losers}↓</span>{' '}
                  <span className="text-fg-muted">{breadth.flat} flat /{breadth.total}</span>
                </p>
              )}
            </div>
          </div>

          <DashboardIndexCard index={indexMap.sp500} label="S&P 500" />
          <DashboardIndexCard index={indexMap.nasdaq} label="NASDAQ" />
          <DashboardIndexCard index={indexMap.dow} label="DOW JONES" />
        </div>
      </section>

      {/* Top movers */}
      <section className="px-1 space-y-4">
        {/* Sector performance */}
        <div>
          <div className="flex items-center justify-between mb-2 px-0.5">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[#00D9FF]" />
              <h3 className="text-[13px] font-semibold text-fg-primary">Top Sectors</h3>
            </div>
            <Link href="/markets" className="text-[11px] text-[#00D9FF]">
              View all
            </Link>
          </div>
          <div className="flex overflow-x-auto scrollbar-hide gap-2">
            {topSectors.length === 0 &&
              Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="w-[160px] h-[80px] rounded-2xl bg-surface-raised border border-line-subtle animate-pulse"
                />
              ))}
            {topSectors.map((s) => {
              const up = s.change_percent >= 0
              return (
                <div
                  key={s.sector}
                  className="shrink-0 w-[160px] h-[80px] rounded-2xl bg-surface-raised border border-line-subtle backdrop-blur-xl p-3 flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-fg-secondary truncate">{s.sector}</span>
                    <span className={`text-[11px] font-mono ${up ? 'text-emerald-400' : 'text-red-400'}`}>
                      {up ? '+' : ''}
                      {formatPercent(s.change_percent, 2)}
                    </span>
                  </div>
                  <div className="text-[10px] text-fg-muted">
                    {s.stocks?.length ?? 0} stocks
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Gainers */}
        <div>
          <div className="flex items-center justify-between mb-2 px-0.5">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <h3 className="text-[13px] font-semibold text-fg-primary">Top Gainers</h3>
            </div>
            <Link href="/markets" className="text-[11px] text-[#00D9FF]">
              View all
            </Link>
          </div>
          <div className="flex overflow-x-auto scrollbar-hide gap-2">
            {moversLoading && (
              <>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-[130px] h-[130px] rounded-2xl bg-surface-raised border border-line-subtle animate-pulse"
                  />
                ))}
              </>
            )}
            {!moversLoading &&
              topGainers.map((stock, idx) => (
                <Link prefetch={false}
                  key={stock.symbol || `gainer-${idx}`}
                  href={`/research?symbol=${stock.symbol}`}
                  className="w-[130px] h-[130px] rounded-2xl bg-surface-raised border border-emerald-500/20 backdrop-blur-xl p-3 flex flex-col justify-between active:scale-[0.97] transition-transform"
                >
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 font-mono">
                      #{idx + 1}
                    </span>
                    <span className="text-emerald-400 font-mono">
                      {stock.change_percent >= 0 ? '+' : ''}
                      {formatPercent(stock.change_percent, 2)}
                    </span>
                  </div>
                  <div>
                    <div className="text-[18px] font-semibold text-fg-primary">
                      {stock.symbol}
                    </div>
                    <div className="text-[10px] text-fg-muted line-clamp-1">
                      {stock.name}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-mono text-fg-secondary">
                      {isNumber(stock.price)
                        ? `$${formatNumber(stock.price, 2)}`
                        : '—'}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-fg-muted" />
                  </div>
                </Link>
              ))}
          </div>
        </div>

        {/* Losers */}
        <div>
          <div className="flex items-center justify-between mb-2 px-0.5">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-400" />
              <h3 className="text-[13px] font-semibold text-fg-primary">Top Losers</h3>
            </div>
            <Link href="/markets" className="text-[11px] text-[#00D9FF]">
              View all
            </Link>
          </div>
          <div className="flex overflow-x-auto scrollbar-hide gap-2">
            {moversLoading && (
              <>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-[130px] h-[130px] rounded-2xl bg-surface-raised border border-line-subtle animate-pulse"
                  />
                ))}
              </>
            )}
            {!moversLoading &&
              topLosers.map((stock, idx) => (
                <Link prefetch={false}
                  key={stock.symbol || `loser-${idx}`}
                  href={`/research?symbol=${stock.symbol}`}
                  className="w-[130px] h-[130px] rounded-2xl bg-surface-raised border border-red-500/20 backdrop-blur-xl p-3 flex flex-col justify-between active:scale-[0.97] transition-transform"
                >
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-300 font-mono">
                      #{idx + 1}
                    </span>
                    <span className="text-red-400 font-mono">
                      {stock.change_percent >= 0 ? '+' : ''}
                      {formatPercent(stock.change_percent, 2)}
                    </span>
                  </div>
                  <div>
                    <div className="text-[18px] font-semibold text-fg-primary">
                      {stock.symbol}
                    </div>
                    <div className="text-[10px] text-fg-muted line-clamp-1">
                      {stock.name}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-mono text-fg-secondary">
                      {isNumber(stock.price)
                        ? `$${formatNumber(stock.price, 2)}`
                        : '—'}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-fg-muted" />
                  </div>
                </Link>
              ))}
          </div>
        </div>
      </section>

      <section className="px-1 pb-4">
        <IpoRadarWidget />
      </section>

      {/* Global macro globe snapshot */}
      <section className="px-1">
        <MiniWorldMonitorSnapshot />
      </section>

      {/* Breaking news */}
      <section className="px-1 pb-4">
        <div className="flex items-center justify-between mb-2 px-0.5">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-xl bg-surface-raised flex items-center justify-center border border-amber-400/40">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div>
              <h3 className="text-[13px] font-semibold text-fg-primary">Breaking News</h3>
              <p className="text-[10px] text-fg-muted">Live stories moving the market</p>
            </div>
          </div>
          <NewsLiveStatus feed={breakingFeed} />
        </div>
        <div className="space-y-2">
          {newsLoading &&
            Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl bg-surface-raised border border-line-subtle h-[70px] animate-pulse"
              />
            ))}
          {!newsLoading &&
            breakingFeed.items.slice(0, 6).map((item) => (
              <NewsFeedCard
                key={item.cluster_id}
                item={item}
                variant="compact"
                isNew={breakingFeed.newIds.has(item.cluster_id)}
              />
            ))}
          {!newsLoading && breakingFeed.items.length === 0 && (
            <p className="rounded-2xl border border-line-subtle bg-surface-raised p-3 text-[11px] text-fg-muted">
              {breakingFeed.isError ? 'News is temporarily unavailable.' : 'No stories right now.'}
            </p>
          )}
        </div>
      </section>

      {/* Economic Calendar */}
      <section className="px-1 pb-3">
        <EconomicCalendarStrip />
      </section>

      {/* Market Intelligence & News – full editorial grid */}
      <section className="px-1 pb-6">
        <MarketNewsGrid />
      </section>
    </div>
  )
}

