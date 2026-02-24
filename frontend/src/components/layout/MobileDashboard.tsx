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
import { useAuth } from '@/contexts/AuthContext'
import {
  fetchMarketStatus,
  fetchMarketMovers,
  fetchMarketIndices,
  fetchSectorPerformance,
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
import LiveNewsChannelPanel from '@/components/LiveNewsChannelPanel'
import MiniWorldMonitorSnapshot from '@/components/MiniWorldMonitorSnapshot'

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
    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#1A2332]/80 border border-white/10">
      <span
        className={`w-2 h-2 rounded-full ${
          isOpen ? 'bg-[#00FF88] animate-pulse' : 'bg-slate-500'
        }`}
      />
      <span className="text-[10px] font-medium text-slate-200">
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
    <div className="shrink-0 w-[140px] h-[100px] rounded-2xl bg-[#1A2332]/90 border border-white/10 backdrop-blur-xl p-3 flex flex-col justify-between mr-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-400 font-medium">{label}</span>
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
        <div className="text-[14px] font-semibold text-white font-mono">
          {isNumber(value) ? formatNumber(value, 2) : '—'}
        </div>
        <p className="mt-1 text-[10px] text-slate-500">
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
    refetchInterval: 120000,
    staleTime: 60000,
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
    refetchInterval: 120000,
    staleTime: 60000,
  })

  const { data: breakingNews, isLoading: newsLoading } = useBreakingNews(10, 60000)

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
      <header className="sticky top-0 z-30 bg-[#0A0E1A]/95 backdrop-blur-xl border-b border-white/10 pt-safe pb-2 px-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-[#00D9FF] via-[#4c6fff] to-[#00D9FF] p-[1px]">
              <div className="h-full w-full rounded-2xl bg-[#0A0E1A] flex items-center justify-center overflow-hidden">
                <Image src="/logo.png" alt="QuantTrade AI" width={20} height={20} className="object-contain" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1">
                <span className="text-[11px] tracking-[0.22em] text-slate-400 font-semibold">
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
              className="h-8 w-8 rounded-full bg-[#1A2332] border border-white/10 flex items-center justify-center active:scale-95"
            >
              <Search className="w-4 h-4 text-slate-200" />
            </button>
            <Link
              href="/settings"
              className="h-8 w-8 rounded-full bg-[#1A2332] border border-white/10 flex items-center justify-center active:scale-95"
            >
              <User className="w-4 h-4 text-slate-200" />
            </Link>
          </div>
        </div>
      </header>

      {/* Search overlay */}
      {showSearch && (
        <div className="fixed inset-0 z-50 bg-[#0A0E1A]/98 backdrop-blur-xl flex flex-col animate-fade-in">
          <div className="flex items-center gap-2 px-4 pt-safe pb-3 border-b border-white/10">
            <button
              type="button"
              onClick={() => setShowSearch(false)}
              className="p-2 -ml-2 rounded-full hover:bg-white/5 active:scale-95"
            >
              <ArrowRight className="w-5 h-5 text-slate-400 rotate-180" />
            </button>
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search stocks, ETFs, crypto..."
                className="w-full h-10 rounded-full bg-[#1A2332] border border-white/10 pl-9 pr-4 text-[13px] text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-[#00D9FF]/60"
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
              <div className="text-center py-8 text-slate-500 text-sm">
                No results for &quot;{searchQuery}&quot;
              </div>
            )}
            {!searching && searchQuery.trim().length === 0 && (
              <div className="text-center py-8 text-slate-500 text-sm">
                Type a symbol or company name to search
              </div>
            )}
            {searchResults.map((result) => (
              <button
                key={result.symbol}
                type="button"
                onClick={() => handleSearchSelect(result.symbol)}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/5 active:bg-white/10 transition-colors text-left"
              >
                <div className="w-9 h-9 rounded-full bg-[#1A2332] border border-white/10 flex items-center justify-center text-[11px] font-bold text-white">
                  {result.symbol.slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-white">{result.symbol}</p>
                  <p className="text-[11px] text-slate-500 truncate">{result.name}</p>
                </div>
                {result.asset_type && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-slate-400 uppercase">
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
        <div className="rounded-2xl bg-gradient-to-br from-[#141B2D] via-[#0A0E1A] to-[#141B2D] border border-white/10 p-4 relative overflow-hidden">
          <div className="absolute -top-8 -right-10 w-28 h-28 bg-[#00D9FF]/15 blur-3xl" />
          <div className="relative space-y-1">
            <p className="text-[11px] text-slate-400">{dateString}</p>
            <h2 className="text-lg font-semibold text-white">{greeting}</h2>
            <p className="text-[11px] text-slate-400 flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
              {timeString} • Live market overview
            </p>
          </div>
        </div>
      </section>

      {/* Quick stats carousel */}
      <section className="px-1">
        <div className="flex items-stretch overflow-x-auto scrollbar-hide -mx-1 px-1">
          <div className="shrink-0 w-[140px] h-[100px] rounded-2xl bg-[#1A2332]/90 border border-white/10 backdrop-blur-xl p-3 flex flex-col justify-between mr-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400 font-medium">Market</span>
              <Activity className="w-3.5 h-3.5 text-[#00D9FF]" />
            </div>
            <div className="mt-1">
              <p className="text-[12px] text-slate-300">
                {status?.status === 'OPEN' ? 'U.S. markets are trading.' : 'Markets are closed.'}
              </p>
              <p className="mt-1 text-[9px] text-slate-500">
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
              <h3 className="text-[13px] font-semibold text-white">Top Sectors</h3>
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
                  className="w-[160px] h-[80px] rounded-2xl bg-[#1A2332]/80 border border-white/10 animate-pulse"
                />
              ))}
            {topSectors.map((s) => {
              const up = s.change_percent >= 0
              return (
                <div
                  key={s.sector}
                  className="shrink-0 w-[160px] h-[80px] rounded-2xl bg-[#1A2332]/90 border border-white/10 backdrop-blur-xl p-3 flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-300 truncate">{s.sector}</span>
                    <span className={`text-[11px] font-mono ${up ? 'text-emerald-400' : 'text-red-400'}`}>
                      {up ? '+' : ''}
                      {formatPercent(s.change_percent, 2)}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500">
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
              <h3 className="text-[13px] font-semibold text-white">Top Gainers</h3>
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
                    className="w-[130px] h-[130px] rounded-2xl bg-[#1A2332]/80 border border-white/10 animate-pulse"
                  />
                ))}
              </>
            )}
            {!moversLoading &&
              topGainers.map((stock, idx) => (
                <Link
                  key={stock.symbol || `gainer-${idx}`}
                  href={`/research?symbol=${stock.symbol}`}
                  className="w-[130px] h-[130px] rounded-2xl bg-[#1A2332]/90 border border-emerald-500/20 backdrop-blur-xl p-3 flex flex-col justify-between active:scale-[0.97] transition-transform"
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
                    <div className="text-[18px] font-semibold text-white">
                      {stock.symbol}
                    </div>
                    <div className="text-[10px] text-slate-500 line-clamp-1">
                      {stock.name}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-mono text-slate-300">
                      {isNumber(stock.price)
                        ? `$${formatNumber(stock.price, 2)}`
                        : '—'}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
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
              <h3 className="text-[13px] font-semibold text-white">Top Losers</h3>
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
                    className="w-[130px] h-[130px] rounded-2xl bg-[#1A2332]/80 border border-white/10 animate-pulse"
                  />
                ))}
              </>
            )}
            {!moversLoading &&
              topLosers.map((stock, idx) => (
                <Link
                  key={stock.symbol || `loser-${idx}`}
                  href={`/research?symbol=${stock.symbol}`}
                  className="w-[130px] h-[130px] rounded-2xl bg-[#1A2332]/90 border border-red-500/20 backdrop-blur-xl p-3 flex flex-col justify-between active:scale-[0.97] transition-transform"
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
                    <div className="text-[18px] font-semibold text-white">
                      {stock.symbol}
                    </div>
                    <div className="text-[10px] text-slate-500 line-clamp-1">
                      {stock.name}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-mono text-slate-300">
                      {isNumber(stock.price)
                        ? `$${formatNumber(stock.price, 2)}`
                        : '—'}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                  </div>
                </Link>
              ))}
          </div>
        </div>
      </section>

      {/* Global macro globe snapshot */}
      <section className="px-1">
        <MiniWorldMonitorSnapshot />
      </section>

      {/* Breaking news */}
      <section className="px-1 pb-4">
        <div className="flex items-center justify-between mb-2 px-0.5">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-xl bg-[#1A2332] flex items-center justify-center border border-amber-400/40">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div>
              <h3 className="text-[13px] font-semibold text-white">Breaking News</h3>
              <p className="text-[10px] text-slate-500">Live stories moving the market</p>
            </div>
          </div>
        </div>
        <div className="space-y-2">
          {newsLoading &&
            Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl bg-[#1A2332]/90 border border-white/10 h-[70px] animate-pulse"
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
                  : 'text-slate-400'
              const dotColor =
                sentiment === 'bullish'
                  ? 'bg-emerald-400'
                  : sentiment === 'bearish'
                  ? 'bg-red-400'
                  : 'bg-slate-500'

              return (
                <a
                  key={article.url || `${article.title}-${idx}`}
                  href={article.url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-2xl bg-[#1A2332]/95 border border-white/10 p-3 active:scale-[0.98] transition-transform"
                >
                  <div className="h-8 w-8 rounded-xl bg-[#0A0E1A] flex items-center justify-center border border-white/10">
                    <FileText className="w-4 h-4 text-slate-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-[9px] mb-0.5">
                      {article.source && (
                        <span className="px-1.5 py-0.5 rounded-full bg-[#0A0E1A] text-[#00D9FF] border border-[#00D9FF]/30">
                          {article.source}
                        </span>
                      )}
                      <span className="text-slate-500">
                        {new Date(article.published_at).toLocaleTimeString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="text-[12px] text-white line-clamp-2">{article.title}</p>
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

      {/* Live global TV news */}
      <section className="px-1 pb-4">
        <LiveNewsChannelPanel />
      </section>

      {/* Market Intelligence & News – full editorial grid */}
      <section className="px-1 pb-6">
        <MarketNewsGrid />
      </section>
    </div>
  )
}

