'use client'

import Link from 'next/link'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import MobileDashboard from '@/components/layout/MobileDashboard'
import { useBreakingNews } from '@/hooks/useRealtimeNews'
import { useAuth } from '@/contexts/AuthContext'
import { motion } from 'framer-motion'
import {
  TrendingUp,
  TrendingDown,
  Sparkles,
  Zap,
  ArrowRight,
  Activity,
  BarChart3,
  RefreshCw,
  Globe,
  Target,
  ShieldAlert,
  Minus,
  Eye,
  Clock,
  Signal,
  Layers,
} from 'lucide-react'
import {
  fetchMarketMovers,
  fetchSectorPerformance,
  fetchPredictionAlerts,
  fetchQuote,
  getWatchlist,
  StockPerformance,
  SectorPerformance,
  QuoteData,
} from '@/lib/api'
import MarketNewsGrid from '@/components/MarketNewsGrid'
import MiniWorldMonitorSnapshot from '@/components/MiniWorldMonitorSnapshot'
import LiveNewsChannelPanel from '@/components/LiveNewsChannelPanel'
import { formatNumber, formatPercent, isNumber } from '@/lib/format'
import { SkeletonMoversSection, SkeletonSectorPerformance } from '@/components/Skeleton'
import BrandedNewsLoading from '@/components/loading/BrandedNewsLoading'
import IndicesBarSkeleton from '@/components/loading/IndicesBarSkeleton'
import { ProCard } from '@/components/ui/pro'
import IpoRadarWidget from '@/components/IpoRadarWidget'

// Key market indices / liquid ETFs (bar scrolls horizontally on small screens)
const INDICES = [
  { symbol: 'SPY', label: 'S&P 500' },
  { symbol: 'QQQ', label: 'Nasdaq 100' },
  { symbol: 'DIA', label: 'Dow 30' },
  { symbol: 'IWM', label: 'Russell 2K' },
  { symbol: 'GLD', label: 'Gold' },
  { symbol: 'TLT', label: '20Y Treasury' },
  { symbol: 'XLF', label: 'Financials' },
  { symbol: 'XLE', label: 'Energy' },
  { symbol: 'SMH', label: 'Semiconductors' },
  { symbol: 'VNQ', label: 'REITs' },
  { symbol: 'EEM', label: 'Emerging' },
  { symbol: 'USO', label: 'Oil' },
]

function useMarketIndices() {
  return useQuery({
    queryKey: ['marketIndices'],
    queryFn: async (): Promise<QuoteData[]> => {
      const results = await Promise.allSettled(
        INDICES.map(({ symbol }) => fetchQuote(symbol, 'normal'))
      )
      return results
        .filter((r): r is PromiseFulfilledResult<QuoteData> => r.status === 'fulfilled')
        .map((r) => r.value)
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
}

// ─── Indices Bar ─────────────────────────────────────────────────────────────
function IndicesBar({ quotes }: { quotes: QuoteData[] }) {
  return (
    <div className="flex items-center gap-px bg-slate-950/60 border-b border-slate-800/60 overflow-x-auto scrollbar-none">
      <div className="shrink-0 flex items-center gap-1.5 px-3 py-2 border-r border-slate-800/60 bg-sky-500/10">
        <Signal className="w-3 h-3 text-sky-400" />
        <span className="text-[9px] font-black uppercase tracking-[0.15em] text-sky-400 font-mono whitespace-nowrap">
          INDICES
        </span>
      </div>
      {quotes.map((q) => {
        const up = q.change_percent >= 0
        return (
          <Link
            key={q.symbol}
            href={`/research?symbol=${q.symbol}`}
            className="shrink-0 flex items-center gap-2 px-3 py-2 border-r border-slate-800/40 hover:bg-slate-800/40 transition-colors group"
          >
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-white font-mono group-hover:text-sky-400 transition-colors">
                  {q.symbol}
                </span>
                <span className="text-[9px] text-slate-500 hidden sm:block max-w-[72px] truncate">
                  {INDICES.find((i) => i.symbol === q.symbol)?.label}
                </span>
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="text-[11px] font-mono font-bold text-white">
                  {q.price > 0 ? `$${formatNumber(q.price, 2)}` : '—'}
                </span>
                <span
                  className={`text-[9px] font-mono font-bold flex items-center gap-0.5 ${
                    up ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {up ? <TrendingUp className="w-2 h-2" /> : <TrendingDown className="w-2 h-2" />}
                  {up ? '+' : ''}{formatPercent(q.change_percent, 2)}
                </span>
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}

// ─── Prediction Alerts Widget ─────────────────────────────────────────────────
function PredictionAlertsWidget() {
  const alertDirectionUp = (d: string | undefined) =>
    String(d ?? '')
      .trim()
      .toLowerCase() === 'up'

  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ['predictionAlerts'],
    queryFn: () => fetchPredictionAlerts(0.65, 2.0),
    refetchInterval: 90_000,
    staleTime: 45_000,
    placeholderData: keepPreviousData,
  })

  const severityColor = (s: string) =>
    s === 'high' ? 'text-red-400 bg-red-500/10 border-red-500/20' :
    s === 'medium' ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' :
    'text-slate-400 bg-slate-700/30 border-slate-600/20'

  return (
    <div className="hud-panel h-full flex flex-col">
      <div className="p-4 border-b border-slate-700/30 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-violet-400" />
          <h3 className="font-bold text-white text-sm">AI Alerts</h3>
          <span className="px-1.5 py-0.5 text-[9px] bg-violet-500/20 text-violet-400 rounded font-bold">
            LIVE
          </span>
        </div>
        <Link
          href="/research"
          className="text-[10px] text-violet-400 hover:text-white font-medium transition-colors"
        >
          Research →
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/40">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 rounded bg-slate-800/40 animate-pulse" />
            ))}
          </div>
        ) : alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-8 text-center px-4">
            <Target className="w-8 h-8 text-slate-700 mb-2" />
            <p className="text-slate-500 text-xs">No active alerts above threshold</p>
          </div>
        ) : (
          alerts.slice(0, 6).map((alert, idx) => (
            <Link
              key={`${alert.symbol}-${idx}`}
              href={`/research?symbol=${alert.symbol}`}
              className="flex items-start gap-2.5 p-3 hover:bg-slate-800/30 transition-colors group"
            >
              <div
                className={`mt-0.5 px-1.5 py-0.5 text-[9px] font-bold rounded border ${severityColor(
                  alert.severity
                )}`}
              >
                {alert.severity.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-white text-xs group-hover:text-violet-400 transition-colors font-mono">
                    {alert.symbol}
                  </span>
                  <span
                    className={`text-[9px] font-bold ${
                      alertDirectionUp(alert.direction) ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {alertDirectionUp(alert.direction) ? '▲' : '▼'}{' '}
                    {formatPercent(alert.expected_return, 1)}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">{alert.message}</p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs font-bold font-mono text-violet-400">
                  {Math.round(alert.confidence * 100)}%
                </div>
                <div className="text-[9px] text-slate-600">conf</div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}

// ─── Watchlist Snapshot ───────────────────────────────────────────────────────
function WatchlistSnapshot() {
  const { isAuthenticated } = useAuth()

  const { data: watchlist = [], isLoading: wlLoading } = useQuery({
    queryKey: ['watchlist'],
    queryFn: () => getWatchlist(),
    enabled: isAuthenticated,
    staleTime: 60_000,
    refetchInterval: 120_000,
  })

  // Fetch live quotes for first 5 watchlist items
  const symbols = watchlist.slice(0, 5).map((w) => w.symbol)
  const { data: quotes = [], isLoading: quotesLoading } = useQuery({
    queryKey: ['watchlistQuotes', symbols],
    queryFn: async (): Promise<QuoteData[]> => {
      if (symbols.length === 0) return []
      const res = await Promise.allSettled(symbols.map((s) => fetchQuote(s, 'normal')))
      return res
        .filter((r): r is PromiseFulfilledResult<QuoteData> => r.status === 'fulfilled')
        .map((r) => r.value)
    },
    enabled: symbols.length > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const quoteMap = Object.fromEntries(quotes.map((q) => [q.symbol, q]))
  const isLoading = wlLoading || quotesLoading

  return (
    <div className="hud-panel h-full flex flex-col">
      <div className="p-4 border-b border-slate-700/30 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-cyan-400" />
          <h3 className="font-bold text-white text-sm">Watchlist</h3>
        </div>
        <Link
          href="/watchlist"
          className="text-[10px] text-cyan-400 hover:text-white font-medium transition-colors"
        >
          View All →
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!isAuthenticated ? (
          <div className="flex flex-col items-center justify-center h-full py-6 text-center px-4">
            <Eye className="w-7 h-7 text-slate-700 mb-2" />
            <p className="text-slate-500 text-xs">Sign in to see your watchlist</p>
            <Link
              href="/auth"
              className="mt-3 px-3 py-1.5 text-xs bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded hover:bg-cyan-500/30 transition-colors"
            >
              Sign In
            </Link>
          </div>
        ) : isLoading ? (
          <div className="p-3 space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-9 rounded bg-slate-800/40 animate-pulse" />
            ))}
          </div>
        ) : watchlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-6 text-center px-4">
            <Eye className="w-7 h-7 text-slate-700 mb-2" />
            <p className="text-slate-500 text-xs">No symbols in watchlist</p>
            <Link
              href="/research"
              className="mt-3 px-3 py-1.5 text-xs bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded hover:bg-cyan-500/30 transition-colors"
            >
              Add symbols
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/40">
            {watchlist.slice(0, 5).map((item) => {
              const q = quoteMap[item.symbol]
              const up = q ? q.change_percent >= 0 : null
              return (
                <Link
                  key={item.symbol}
                  href={`/research?symbol=${item.symbol}`}
                  className="flex items-center justify-between p-3 hover:bg-cyan-500/5 transition-colors group"
                >
                  <div>
                    <div className="font-bold text-white text-xs font-mono group-hover:text-cyan-400 transition-colors">
                      {item.symbol}
                    </div>
                    {item.name && (
                      <div className="text-[10px] text-slate-500 truncate max-w-[100px]">
                        {item.name}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    {q ? (
                      <>
                        <div className="text-xs font-mono text-white font-bold">
                          {q.price > 0 ? `$${formatNumber(q.price, 2)}` : '—'}
                        </div>
                        <div
                          className={`text-[10px] font-mono font-bold flex items-center justify-end gap-0.5 ${
                            up ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {up ? '+' : ''}{formatPercent(q.change_percent, 2)}
                          {up ? (
                            <TrendingUp className="w-2.5 h-2.5" />
                          ) : (
                            <TrendingDown className="w-2.5 h-2.5" />
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="text-[10px] text-slate-600">—</div>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Sector Heatmap Widget ────────────────────────────────────────────────────
function SectorHeatmap({ sectors }: { sectors: SectorPerformance[]; loading: boolean }) {
  if (sectors.length === 0) return null

  const max = Math.max(...sectors.map((s) => Math.abs(s.change_percent || 0)), 1)

  return (
    <div className="grid grid-cols-2 gap-1.5">
      {sectors.slice(0, 8).map((s, i) => {
        const pct = s.change_percent || 0
        const up = pct >= 0
        const intensity = Math.min(Math.abs(pct) / max, 1)
        return (
          <div
            key={s.sector || i}
            className="relative rounded overflow-hidden h-12 flex flex-col justify-center px-2.5"
            style={{
              background: up
                ? `rgba(34,197,94,${0.06 + intensity * 0.18})`
                : `rgba(239,68,68,${0.06 + intensity * 0.18})`,
              border: `1px solid ${up ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
            }}
          >
            <div className="text-[9px] text-slate-400 truncate">{s.sector}</div>
            <div
              className={`text-xs font-bold font-mono ${up ? 'text-emerald-400' : 'text-red-400'}`}
            >
              {up ? '+' : ''}{formatPercent(pct, 2)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Desktop Dashboard ────────────────────────────────────────────────────────
function DesktopHome() {
  const { user, isAuthenticated } = useAuth()

  const { data: movers, isLoading: moversLoading, refetch: refetchMovers } = useQuery({
    queryKey: ['marketMovers'],
    queryFn: () => fetchMarketMovers(),
    refetchInterval: 45_000,
    staleTime: 25_000,
    gcTime: 300_000,
    placeholderData: keepPreviousData,
  })

  const { data: sectors = [], isLoading: sectorsLoading } = useQuery({
    queryKey: ['sectorPerformance'],
    queryFn: () => fetchSectorPerformance(),
    refetchInterval: 60_000,
    staleTime: 30_000,
    gcTime: 300_000,
    placeholderData: keepPreviousData,
  })

  const {
    data: liveNews = [],
    isPending: newsPending,
    isError: newsError,
    isFetching: newsFetching,
    refetch: refetchNews,
  } = useBreakingNews(20, 45_000)

  const { data: indices = [], isLoading: indicesLoading } = useMarketIndices()

  const topGainers = movers?.gainers?.slice(0, 10) || []
  const topLosers = movers?.losers?.slice(0, 10) || []
  const breadth = (movers?.gainers?.length || 0) - (movers?.losers?.length || 0)
  const breadthTone = breadth > 0 ? 'Risk-On' : breadth < 0 ? 'Risk-Off' : 'Balanced'
  const breadthColor = breadth > 0 ? 'text-emerald-400' : breadth < 0 ? 'text-red-400' : 'text-yellow-400'

  return (
    <AppLayout>
      <div className="min-h-full flex flex-col">
        {/* Indices bar — skeleton while quotes stream in */}
        {indicesLoading ? (
          <IndicesBarSkeleton />
        ) : indices.length > 0 ? (
          <IndicesBar quotes={indices} />
        ) : null}

        {/* Dashboard header */}
        <div className="px-4 pt-4 pb-2 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-sky-400" />
              {isAuthenticated && user?.email ? (
                <>Dashboard — <span className="text-sky-400 font-mono text-sm">{user.email.split('@')[0]}</span></>
              ) : (
                'Dashboard'
              )}
            </h1>
            <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              {' · '}
              <span className={breadthColor + ' font-bold'}>{breadthTone}</span>
              {!moversLoading && (
                <> · {movers?.gainers?.length || 0}↑ {movers?.losers?.length || 0}↓</>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="live-pulse" />
            <span className="text-[10px] text-slate-500 font-mono">LIVE DATA</span>
          </div>
        </div>

        {/* Main bento grid */}
        <div className="flex-1 p-4 pt-2">
          <div className="grid grid-cols-12 gap-3 auto-rows-min">

            {/* ── Row 1 ── */}

            {/* Live News — responsive height + scroll */}
            <div className="col-span-12 lg:col-span-5 lg:row-span-2">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="h-full min-h-[min(420px,70vh)] lg:min-h-[520px]"
              >
                <div className="hud-panel h-full min-h-[inherit] max-h-[min(85vh,1200px)] flex flex-col relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-500/8 via-transparent to-cyan-500/5 pointer-events-none" />
                  <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-blue-500/40 to-transparent" />

                  <div className="p-4 border-b border-slate-700/30 flex items-center justify-between shrink-0 relative">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[9px] font-bold text-white bg-gradient-to-r from-blue-500 to-cyan-500 rounded uppercase tracking-wider shadow-lg shadow-blue-500/20">
                        <Zap className="w-2.5 h-2.5" />
                        LIVE NEWS
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">Top 20</span>
                      <div className="live-pulse" />
                      {newsFetching && !newsPending && (
                        <span className="text-[10px] text-slate-500 font-mono">Syncing…</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => refetchNews()}
                      className="hud-card p-1.5 text-blue-400 hover:text-white transition-colors"
                      aria-label="Refresh news"
                    >
                      <RefreshCw className={`w-3 h-3 ${newsFetching ? 'animate-spin' : ''}`} />
                    </button>
                  </div>

                  <div className="flex-1 min-h-0 overflow-y-auto relative">
                    {newsPending ? (
                      <BrandedNewsLoading rows={14} />
                    ) : newsError ? (
                      <div className="flex flex-col items-center justify-center h-full py-10 text-center px-4">
                        <Activity className="w-8 h-8 text-amber-500/60 mb-3" />
                        <p className="text-slate-300 text-sm font-medium">Could not load headlines</p>
                        <button
                          type="button"
                          onClick={() => refetchNews()}
                          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 border border-slate-600 text-xs text-white hover:border-cyan-500/50"
                        >
                          <RefreshCw className="w-3 h-3" /> Retry
                        </button>
                      </div>
                    ) : liveNews.length > 0 ? (
                      <div className="p-2 sm:p-3 grid grid-cols-1 xl:grid-cols-2 gap-2">
                        {liveNews.slice(0, 20).map((news, idx) => {
                          const key = news.id ?? news.url ?? `${news.title}-${idx}`
                          const isBullish = news.sentiment === 'Bullish'
                          const isBearish = news.sentiment === 'Bearish'
                          const Inner = (
                            <div className="flex items-start gap-2.5 p-2.5 sm:p-3 rounded-lg border border-slate-800/50 bg-slate-950/30 hover:bg-blue-500/5 hover:border-slate-700/60 transition-colors group/item h-full">
                              <div
                                className={`mt-0.5 p-1.5 rounded shrink-0 ${
                                  isBullish
                                    ? 'bg-green-500/15'
                                    : isBearish
                                    ? 'bg-red-500/15'
                                    : 'bg-slate-700/40'
                                }`}
                              >
                                {isBullish ? (
                                  <TrendingUp className="w-3 h-3 text-green-400" />
                                ) : isBearish ? (
                                  <TrendingDown className="w-3 h-3 text-red-400" />
                                ) : (
                                  <Minus className="w-3 h-3 text-slate-400" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[13px] sm:text-sm text-white font-medium group-hover/item:text-blue-300 transition-colors line-clamp-3 leading-snug">
                                  {news.title}
                                </p>
                                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                  <span className="text-[10px] text-slate-500 flex items-center gap-1 min-w-0">
                                    <Clock className="w-2.5 h-2.5 shrink-0" />
                                    <span className="truncate">{news.source}</span>
                                  </span>
                                  {news.related_tickers && news.related_tickers.length > 0 && (
                                    <div className="flex gap-1 flex-wrap">
                                      {news.related_tickers.slice(0, 3).map((t) => (
                                        <span
                                          key={t}
                                          className="px-1.5 py-0.5 text-[9px] bg-blue-500/15 text-blue-400 rounded font-mono"
                                        >
                                          {t}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                          return news.url ? (
                            <a
                              key={key}
                              href={news.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block min-w-0"
                            >
                              {Inner}
                            </a>
                          ) : (
                            <div key={key} className="min-w-0">
                              {Inner}
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full py-10 text-center px-4">
                        <Activity className="w-8 h-8 text-slate-700 mb-3" />
                        <p className="text-slate-400 text-sm">No headlines available</p>
                        <button
                          type="button"
                          onClick={() => refetchNews()}
                          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 border border-slate-600 text-xs text-white hover:border-cyan-500/50"
                        >
                          <RefreshCw className="w-3 h-3" /> Retry
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            </div>

            {/* Top Gainers — 3.5 cols */}
            <div className="col-span-12 sm:col-span-6 lg:col-span-4">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.05 }}
                className="h-full min-h-[200px]"
              >
                <div className="hud-panel h-full flex flex-col">
                  <div className="px-4 py-3 border-b border-slate-700/30 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-emerald-400" />
                      <h3 className="font-bold text-white text-sm">Top Gainers</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-emerald-400 font-mono font-bold">
                        {topGainers.length > 0 ? `+${formatPercent(topGainers[0]?.change_percent, 1)} lead` : ''}
                      </span>
                      <button
                        onClick={() => refetchMovers()}
                        className="p-1.5 rounded text-slate-500 hover:text-white hover:bg-slate-800/60 transition-colors"
                      >
                        <RefreshCw className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {moversLoading ? (
                      <SkeletonMoversSection count={8} />
                    ) : topGainers.length > 0 ? (
                      topGainers.map((stock: StockPerformance, idx: number) => (
                        <Link
                          key={stock.symbol || `gainer-${idx}`}
                          href={`/research?symbol=${stock.symbol}`}
                          className="flex items-center justify-between px-4 py-2.5 hover:bg-emerald-500/5 border-b border-slate-800/30 transition-all group"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="w-4 text-[10px] text-slate-600 font-mono text-right">
                              {idx + 1}
                            </span>
                            <div>
                              <span className="font-bold text-white group-hover:text-emerald-400 transition-colors text-xs font-mono">
                                {stock.symbol}
                              </span>
                              <div className="text-[10px] text-slate-500 truncate max-w-[110px]">
                                {stock.name}
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-mono text-xs text-white">
                              {isNumber(stock.price) ? `$${formatNumber(stock.price, 2)}` : '—'}
                            </div>
                            <div className="font-mono text-[10px] text-emerald-400 font-bold">
                              +{formatPercent(stock.change_percent, 2)}
                            </div>
                          </div>
                        </Link>
                      ))
                    ) : (
                      <div className="flex items-center justify-center h-24 text-slate-500 text-xs">
                        No data
                      </div>
                    )}
                  </div>
                  <div className="px-4 py-2.5 border-t border-slate-700/30 shrink-0">
                    <Link
                      href="/markets"
                      className="flex items-center justify-center gap-1.5 text-xs text-emerald-400 hover:text-white font-medium transition-colors"
                    >
                      All Gainers <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              </motion.div>
            </div>

            {/* Top Losers — 3.5 cols */}
            <div className="col-span-12 sm:col-span-6 lg:col-span-3">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.08 }}
                className="h-full min-h-[200px]"
              >
                <div className="hud-panel h-full flex flex-col">
                  <div className="px-4 py-3 border-b border-slate-700/30 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                      <TrendingDown className="w-4 h-4 text-red-400" />
                      <h3 className="font-bold text-white text-sm">Top Losers</h3>
                    </div>
                    {topLosers.length > 0 && (
                      <span className="text-[10px] text-red-400 font-mono font-bold">
                        {formatPercent(topLosers[0]?.change_percent, 1)} worst
                      </span>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {moversLoading ? (
                      <SkeletonMoversSection count={8} />
                    ) : topLosers.length > 0 ? (
                      topLosers.map((stock: StockPerformance, idx: number) => (
                        <Link
                          key={stock.symbol || `loser-${idx}`}
                          href={`/research?symbol=${stock.symbol}`}
                          className="flex items-center justify-between px-4 py-2.5 hover:bg-red-500/5 border-b border-slate-800/30 transition-all group"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="w-4 text-[10px] text-slate-600 font-mono text-right">
                              {idx + 1}
                            </span>
                            <div>
                              <span className="font-bold text-white group-hover:text-red-400 transition-colors text-xs font-mono">
                                {stock.symbol}
                              </span>
                              <div className="text-[10px] text-slate-500 truncate max-w-[90px]">
                                {stock.name}
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-mono text-xs text-white">
                              {isNumber(stock.price) ? `$${formatNumber(stock.price, 2)}` : '—'}
                            </div>
                            <div className="font-mono text-[10px] text-red-400 font-bold">
                              {formatPercent(stock.change_percent, 2)}
                            </div>
                          </div>
                        </Link>
                      ))
                    ) : (
                      <div className="flex items-center justify-center h-24 text-slate-500 text-xs">
                        No data
                      </div>
                    )}
                  </div>
                  <div className="px-4 py-2.5 border-t border-slate-700/30 shrink-0">
                    <Link
                      href="/markets"
                      className="flex items-center justify-center gap-1.5 text-xs text-red-400 hover:text-white font-medium transition-colors"
                    >
                      All Losers <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              </motion.div>
            </div>

            {/* ── Row 2 supplement (fills row next to live news) ── */}

            {/* Mini World Monitor */}
            <div className="col-span-12 sm:col-span-6 lg:col-span-4">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 }}
                className="h-full min-h-[200px]"
              >
                <MiniWorldMonitorSnapshot />
              </motion.div>
            </div>

            {/* Watchlist Snapshot */}
            <div className="col-span-12 sm:col-span-6 lg:col-span-3">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.12 }}
                className="h-full min-h-[200px]"
              >
                <WatchlistSnapshot />
              </motion.div>
            </div>

            {/* ── Row 3 ── */}

            {/* Sector Heatmap */}
            <div className="col-span-12 sm:col-span-6 lg:col-span-4">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.14 }}
              >
                <div className="hud-panel p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-blue-400" />
                      <h3 className="font-bold text-white text-sm">Sector Heatmap</h3>
                    </div>
                    <Link
                      href="/markets"
                      className="text-[10px] text-blue-400 hover:text-white font-medium transition-colors"
                    >
                      Markets →
                    </Link>
                  </div>
                  {sectorsLoading ? (
                    <SkeletonSectorPerformance count={4} />
                  ) : (
                    <SectorHeatmap sectors={sectors} loading={sectorsLoading} />
                  )}
                </div>
              </motion.div>
            </div>

            {/* AI Prediction Alerts */}
            <div className="col-span-12 sm:col-span-6 lg:col-span-4">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.16 }}
                className="h-full min-h-[220px]"
              >
                <PredictionAlertsWidget />
              </motion.div>
            </div>

            {/* Market Pulse */}
            <div className="col-span-12 lg:col-span-4">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.18 }}
              >
                <div className="hud-panel p-4 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/8 rounded-full blur-3xl pointer-events-none" />
                  <div className="flex items-center gap-2 mb-4">
                    <Sparkles className="w-4 h-4 text-cyan-400" />
                    <h3 className="font-bold text-white text-sm">Market Pulse</h3>
                    <span className="px-1.5 py-0.5 text-[9px] bg-cyan-500/20 text-cyan-400 rounded font-bold">LIVE</span>
                  </div>

                  <div className="space-y-3">
                    {/* Breadth */}
                    <ProCard className="p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <Activity className="w-3.5 h-3.5 text-blue-400" />
                          <span className="text-[11px] font-bold text-white">Breadth</span>
                        </div>
                        <span className={`text-[11px] font-bold font-mono ${breadthColor}`}>
                          {breadthTone}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700"
                            style={{
                              width: moversLoading
                                ? '50%'
                                : `${Math.round(
                                    ((movers?.gainers?.length || 0) /
                                      Math.max(
                                        1,
                                        (movers?.gainers?.length || 0) + (movers?.losers?.length || 0)
                                      )) *
                                      100
                                  )}%`,
                            }}
                          />
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono shrink-0">
                          {movers?.gainers?.length || 0}↑ {movers?.losers?.length || 0}↓
                        </span>
                      </div>
                    </ProCard>

                    {/* Sector leader */}
                    <ProCard className="p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <BarChart3 className="w-3.5 h-3.5 text-green-400" />
                        <span className="text-[11px] font-bold text-white">Sector Leader</span>
                      </div>
                      {sectorsLoading ? (
                        <div className="h-4 w-24 bg-slate-800/60 rounded animate-pulse" />
                      ) : sectors.length > 0 ? (
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-slate-300">{sectors[0]?.sector}</span>
                          <span
                            className={`text-[11px] font-mono font-bold ${
                              sectors[0]?.change_percent >= 0 ? 'text-emerald-400' : 'text-red-400'
                            }`}
                          >
                            {sectors[0]?.change_percent >= 0 ? '+' : ''}
                            {formatPercent(sectors[0]?.change_percent, 2)}
                          </span>
                        </div>
                      ) : null}
                    </ProCard>

                    {/* Quick links */}
                    <div className="grid grid-cols-2 gap-1.5 mt-1">
                      {[
                        { label: 'Ideas Lab', href: '/ideas-lab', icon: Sparkles, color: 'text-violet-400' },
                        { label: 'Global Monitor', href: '/monitor', icon: Globe, color: 'text-sky-400' },
                        { label: 'Backtesting', href: '/backtest', icon: ShieldAlert, color: 'text-amber-400' },
                        { label: 'Markets', href: '/markets', icon: Zap, color: 'text-yellow-400' },
                      ].map(({ label, href, icon: Icon, color }) => (
                        <Link
                          key={href}
                          href={href}
                          className="flex items-center gap-1.5 px-2.5 py-2 rounded border border-slate-700/60 bg-slate-900/60 hover:border-slate-600 hover:bg-slate-800/60 transition-all group"
                        >
                          <Icon className={`w-3 h-3 ${color}`} />
                          <span className="text-[10px] text-slate-400 group-hover:text-white transition-colors font-medium">
                            {label}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>

            {/* IPO Radar — full width */}
            <div className="col-span-12">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.2 }}
              >
                <IpoRadarWidget />
              </motion.div>
            </div>
          </div>
        </div>

        {/* Bottom sections */}
        <div className="px-4 pb-6 space-y-4">
          <LiveNewsChannelPanel />
          <MarketNewsGrid />
        </div>
      </div>
    </AppLayout>
  )
}

export default function Home() {
  return (
    <>
      <div className="hidden md:block">
        <DesktopHome />
      </div>
      <div className="md:hidden">
        <MobileLayout>
          <MobileDashboard />
        </MobileLayout>
      </div>
    </>
  )
}
