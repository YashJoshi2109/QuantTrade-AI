'use client'

import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
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
  FileText,
  BarChart3,
  Zap,
} from 'lucide-react'
import Image from 'next/image'
import TickerLogo from '@/components/TickerLogo'
import { useAuth } from '@/contexts/AuthContext'
import {
  fetchMarketStatus,
  fetchMarketMovers,
  fetchMarketIndices,
  fetchSectorPerformance,
  fetchPredictionAlerts,
  searchSymbols,
  syncSymbol,
  MarketStatus,
  MarketMovers,
  MarketIndex,
  SectorPerformance,
  SearchResult,
} from '@/lib/api'
import { useBreakingNews } from '@/hooks/useRealtimeNews'
import { formatNumber, formatPercent, isNumber } from '@/lib/format'
import MarketNewsGrid from '@/components/MarketNewsGrid'
import EconomicCalendarStrip from '@/components/EconomicCalendarStrip'
import MiniWorldMonitorSnapshot from '@/components/MiniWorldMonitorSnapshot'
import IpoRadarWidget from '@/components/IpoRadarWidget'
import { useToast } from '@/components/Toast'

function useGreeting(name?: string | null) {
  const now = new Date()
  const hour = now.getHours()
  const base =
    hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const username = name?.split(' ')[0] || 'Trader'
  return `${base}, ${username}`
}

function useCurrentTime() {
  const now = new Date()
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
          isOpen ? 'bg-[#00FF88] animate-pulse' : 'bg-fg-muted'
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

  return (
    <div className="shrink-0 w-[140px] h-[100px] rounded-2xl bg-surface-raised border border-line-subtle backdrop-blur-xl p-3 flex flex-col justify-between mr-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-fg-secondary font-medium">{label}</span>
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
          {isNumber(value) ? formatNumber(value, 2) : '—'}
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

  /* ── Search state ── */
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const { data: searchResults = [], isLoading: searching } = useQuery<SearchResult[]>({
    queryKey: ['mobile.dashSearch', searchQuery],
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
      try { await syncSymbol(symbol) } catch { /* ignore */ }
      router.push(`/research?symbol=${symbol}`)
    },
    [router],
  )

  const { data: status, isLoading: statusLoading } = useQuery<MarketStatus>({
    // Share cache with desktop dashboard/other views
    queryKey: ['marketStatus'],
    queryFn: fetchMarketStatus,
    refetchInterval: 60000,
  })

  const { data: movers, isLoading: moversLoading } = useQuery<MarketMovers>({
    // Share cache with desktop dashboard/markets page
    queryKey: ['marketMovers'],
    queryFn: () => fetchMarketMovers(),
    refetchInterval: 45000,
    staleTime: 25000,
  })

  const { data: indices } = useQuery<MarketIndex[]>({
    // Share cache with desktop markets page
    queryKey: ['marketIndices'],
    queryFn: () => fetchMarketIndices(),
    refetchInterval: 60000,
    staleTime: 30000,
  })

  const { data: sectors } = useQuery<SectorPerformance[]>({
    // Share cache with desktop dashboard/markets page
    queryKey: ['sectorPerformance'],
    queryFn: () => fetchSectorPerformance(),
    refetchInterval: 60000,
    staleTime: 30000,
  })

  const { data: breakingNews, isLoading: newsLoading } = useBreakingNews(10, 45000)
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

  const dateString = useMemo(() => {
    const now = new Date()
    return now.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    })
  }, [])

  const indexMap = useMemo(() => {
    const map: Record<string, MarketIndex | undefined> = {}

    if (indices && indices.length > 0) {
      indices.forEach((idx) => {
        const key = idx.symbol.toUpperCase()
        if (key.includes('GSPC') || key.includes('SPX') || key === 'SPY') {
          map.sp500 = idx
        } else if (key.includes('IXIC') || key.includes('NDX')) {
          map.nasdaq = idx
        } else if (key.includes('DJI') || key.includes('DOW')) {
          map.dow = idx
        }
      })
    }

    // Fallback static values if API or cache fails
    if (!map.sp500) {
      map.sp500 = {
        symbol: '^GSPC',
        name: 'S&P 500',
        price: 4783.45,
        change: 0.42,
        change_percent: 0.42,
        timestamp: new Date().toISOString(),
      }
    }
    if (!map.nasdaq) {
      map.nasdaq = {
        symbol: '^IXIC',
        name: 'NASDAQ',
        price: 15234.12,
        change: 0.87,
        change_percent: 0.87,
        timestamp: new Date().toISOString(),
      }
    }
    if (!map.dow) {
      map.dow = {
        symbol: '^DJI',
        name: 'Dow Jones',
        price: 37892.67,
        change: 0.15,
        change_percent: 0.15,
        timestamp: new Date().toISOString(),
      }
    }

    return map
  }, [indices])

  const topGainers = movers?.gainers?.slice(0, 8) ?? []
  const topLosers = movers?.losers?.slice(0, 8) ?? []
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
              className="h-8 w-8 rounded-full bg-surface-raised border border-line-subtle flex items-center justify-center active:scale-95"
            >
              <Search className="w-4 h-4 text-fg-primary" />
            </button>
            <Link
              href="/settings"
              className="h-8 w-8 rounded-full bg-surface-raised border border-line-subtle flex items-center justify-center active:scale-95"
            >
              <User className="w-4 h-4 text-fg-primary" />
            </Link>
          </div>
        </div>
      </header>

      {/* Search overlay */}
      {showSearch && (
        <div className="fixed inset-0 z-50 bg-surface-base/98 backdrop-blur-xl flex flex-col animate-fade-in">
          <div className="flex items-center gap-2 px-4 pt-safe pb-3 border-b border-line-subtle">
            <button
              type="button"
              onClick={() => setShowSearch(false)}
              className="p-2 -ml-2 rounded-full hover:bg-surface-hover active:scale-95"
            >
              <ArrowRight className="w-5 h-5 text-fg-secondary rotate-180" />
            </button>
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-muted" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search stocks, ETFs, crypto..."
                className="w-full h-10 rounded-full bg-surface-raised border border-line-subtle pl-9 pr-4 text-[13px] text-fg-primary placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-[#00D9FF]/60"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {searching && (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {!searching && searchQuery.trim().length > 0 && searchResults.length === 0 && (
              <div className="text-center py-8 text-fg-muted text-sm">
                No results for &quot;{searchQuery}&quot;
              </div>
            )}
            {!searching && searchQuery.trim().length === 0 && (
              <div className="text-center py-8 text-fg-muted text-sm">
                Type a symbol or company name to search
              </div>
            )}
            {searchResults.map((result) => (
              <button
                key={result.symbol}
                type="button"
                onClick={() => handleSearchSelect(result.symbol)}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-surface-hover active:bg-surface-hover transition-colors text-left"
              >
                <TickerLogo symbol={result.symbol} companyName={result.name} size={36} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-fg-primary">{result.symbol}</p>
                  <p className="text-[11px] text-fg-muted truncate">{result.name}</p>
                </div>
                {result.asset_type && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-surface-hover border border-line-subtle text-fg-secondary uppercase">
                    {result.asset_type}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Greeting */}
      <section className="px-1">
        <div className="rounded-2xl bg-gradient-to-br from-surface-overlay via-surface-base to-surface-overlay border border-line-subtle p-4 relative overflow-hidden">
          <div className="absolute -top-8 -right-10 w-28 h-28 bg-[#00D9FF]/15 blur-3xl" />
          <div className="relative space-y-1">
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
                <Link
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
                <Link
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
            breakingNews?.slice(0, 6).map((article, idx) => {
              const sentiment = (article.sentiment || '').toLowerCase()
              const sentimentColor =
                sentiment === 'bullish'
                  ? 'text-emerald-400'
                  : sentiment === 'bearish'
                  ? 'text-red-400'
                  : 'text-fg-secondary'
              const dotColor =
                sentiment === 'bullish'
                  ? 'bg-emerald-400'
                  : sentiment === 'bearish'
                  ? 'bg-red-400'
                  : 'bg-fg-muted'

              return (
                <a
                  key={article.url || `${article.title}-${idx}`}
                  href={article.url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-2xl bg-surface-raised border border-line-subtle p-3 active:scale-[0.98] transition-transform"
                >
                  <div className="h-8 w-8 rounded-xl bg-surface-base flex items-center justify-center border border-line-subtle">
                    <FileText className="w-4 h-4 text-fg-secondary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-[9px] mb-0.5">
                      {article.source && (
                        <span className="px-1.5 py-0.5 rounded-full bg-surface-base text-[#00D9FF] border border-[#00D9FF]/30">
                          {article.source}
                        </span>
                      )}
                      <span className="text-fg-muted">
                        {new Date(article.published_at).toLocaleTimeString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="text-[12px] text-fg-primary line-clamp-2">{article.title}</p>
                    <div className="mt-1 flex items-center gap-1.5 text-[10px]">
                      <span className={`flex items-center gap-1 ${sentimentColor}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                        {sentiment ? sentiment.charAt(0).toUpperCase() + sentiment.slice(1) : 'Neutral'}
                      </span>
                    </div>
                  </div>
                </a>
              )
            })}
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

