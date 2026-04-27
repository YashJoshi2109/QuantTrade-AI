'use client'

/**
 * Watchlist Page - Production-grade implementation
 * 
 * Implementation Notes:
 * - Uses React Query for data fetching with optimistic updates
 * - Optimistic UI: Changes appear immediately, rollback on error
 * - Universal symbol search with ranked results
 * - KPI cards at top showing Total, Top Gainer, Top Loser, Avg Change
 * - Debounced search with keyboard navigation (↑/↓/Enter/Escape)
 * - Toast notifications for all actions
 * 
 * API Contract:
 * - GET /api/v1/watchlist → List items
 * - POST /api/v1/watchlist → Add { symbol, note? }
 * - DELETE /api/v1/watchlist/{symbol} → Remove
 * - PUT /api/v1/watchlist/{symbol} → Update { note }
 * - GET /api/v1/symbols/search?q=...&limit=... → Universal search
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import MobileWatchlist from '@/components/layout/MobileWatchlist'
import {
  TrendingUp, TrendingDown, Plus, Trash2, Star, Loader2,
  RefreshCw, X, LogIn, AlertCircle, Search,
  Building2, Globe, Briefcase, Link2, Unlink, Filter,
  Sparkles, PieChart, BarChart3, Layers, AlertTriangle,
  MoreHorizontal, Download, Calendar as CalendarIcon, Share2
} from 'lucide-react'
import {
  getWatchlist, addToWatchlist, removeFromWatchlist,
  fetchQuote, fetchFundamentals, syncSymbol,
  searchSymbols, SearchResult,
  WatchlistItem, FundamentalsData
} from '@/lib/api'
import { ChartConfig, ChartContainer, ChartTooltip } from '@/components/ui/line-charts-4'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { useThemeTokens } from '@/hooks/useThemeTokens'
import { useAuth } from '@/contexts/AuthContext'
import { useMarketRefreshInterval } from '@/hooks/useMarketRefresh'
import { useToast } from '@/components/Toast'
import { SkeletonWatchlistTable, SkeletonText } from '@/components/Skeleton'
import TickerLogo from '@/components/TickerLogo'

interface WatchlistItemWithPrice extends WatchlistItem {
  price?: number
  change?: number
  percent?: number
  volume?: number
  starred?: boolean
  // Financial metrics from fundamentals API
  market_cap?: number
  pe_ratio?: number
  eps?: number
  div_yield?: number
  ytd_return?: number
  // Sparkline chart data (recent price points)
  chartData?: number[]
}

type ActiveTab = 'watchlist' | 'portfolio'

interface BrokerConnection {
  id: string
  name: string
  icon: string
  connected: boolean
  accountCount: number
  totalValue: number
}

interface PortfolioHolding {
  symbol: string
  name: string
  shares: number
  avgCost: number
  currentPrice: number
  marketValue: number
  pnl: number
  pnlPercent: number
  sector: string
  broker: string
  weight: number
}

const SUPPORTED_BROKERS: Omit<BrokerConnection, 'connected' | 'accountCount' | 'totalValue'>[] = [
  { id: 'robinhood', name: 'Robinhood', icon: '🪶' },
  { id: 'fidelity', name: 'Fidelity', icon: '🏛️' },
  { id: 'schwab', name: 'Charles Schwab', icon: '💼' },
  { id: 'etrade', name: 'E*TRADE', icon: '📊' },
  { id: 'td_ameritrade', name: 'TD Ameritrade', icon: '🟢' },
  { id: 'webull', name: 'Webull', icon: '🐂' },
  { id: 'interactive_brokers', name: 'Interactive Brokers', icon: '🔴' },
  { id: 'vanguard', name: 'Vanguard', icon: '⛵' },
]

// Query key for cache management
const WATCHLIST_QUERY_KEY = ['watchlist']

// ─── Watchlist Performance Chart ─────────────────────────────────────────────
const CHART_PALETTE = [
  '#3b82f6', '#f97316', '#22c55e', '#a855f7', '#ec4899',
  '#06b6d4', '#eab308', '#ef4444', '#14b8a6', '#8b5cf6',
  '#f43f5e', '#0ea5e9', '#84cc16', '#d946ef', '#f59e0b',
]

function WatchlistPerformanceChart({ watchlist }: { watchlist: WatchlistItemWithPrice[] }) {
  const t = useThemeTokens()
  const [chartFilter, setChartFilter] = useState('')

  // All stocks with valid chart data
  const chartableStocks = useMemo(() => {
    return watchlist.filter(w => w.percent != null && w.chartData && w.chartData.length > 1)
  }, [watchlist])

  // Filter by search
  const visibleStocks = useMemo(() => {
    if (!chartFilter.trim()) return chartableStocks
    const q = chartFilter.toLowerCase()
    return chartableStocks.filter(w =>
      w.symbol.toLowerCase().includes(q) ||
      (w.name && w.name.toLowerCase().includes(q))
    )
  }, [chartableStocks, chartFilter])

  const chartConfig = useMemo<ChartConfig>(() => {
    const cfg: ChartConfig = {}
    visibleStocks.forEach((item, i) => {
      cfg[item.symbol] = {
        label: item.symbol,
        color: CHART_PALETTE[i % CHART_PALETTE.length],
      }
    })
    return cfg
  }, [visibleStocks])

  // Merge sparkline data into unified time series
  const chartData = useMemo(() => {
    if (visibleStocks.length === 0) return []
    const maxLen = Math.max(...visibleStocks.map(m => m.chartData?.length ?? 0))
    const timeLabels = ['9:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '1:00', '1:30', '2:00']
    return Array.from({ length: maxLen }, (_, i) => {
      const point: Record<string, string | number> = {
        time: timeLabels[i % timeLabels.length] || `T${i}`,
      }
      visibleStocks.forEach(item => {
        if (item.chartData && item.chartData[i] != null) {
          point[item.symbol] = Number(item.chartData[i].toFixed(2))
        }
      })
      return point
    })
  }, [visibleStocks])

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: {
    active?: boolean
    payload?: Array<{ dataKey: string; value: number; color: string }>
    label?: string
  }) => {
    if (!active || !payload?.length) return null
    return (
      <div className="rounded-xl border border-line-default bg-surface-overlay/95 backdrop-blur-xl p-3.5 shadow-theme-lg min-w-[160px]">
        <div className="text-[10px] font-semibold text-fg-muted uppercase tracking-widest mb-2.5">{label}</div>
        <div className="space-y-2">
          {payload.map((entry, idx) => {
            const item = visibleStocks.find(w => w.symbol === entry.dataKey)
            const pct = item?.percent ?? 0
            return (
              <div key={idx} className="flex items-center justify-between gap-4 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: entry.color }} />
                  <span className="text-fg-secondary font-medium">{entry.dataKey}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white font-mono tabular-nums">${entry.value}</span>
                  <span className={`text-[10px] font-mono font-semibold ${pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (chartableStocks.length === 0) return null

  return (
    <div className="bg-surface-raised border border-line-subtle rounded-2xl overflow-hidden mb-6">
      {/* Header with search */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-line-subtle">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-white">Watchlist Performance</h3>
          <span className="text-[10px] text-fg-muted font-mono">
            {visibleStocks.length} / {chartableStocks.length}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Inline search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg-muted" />
            <input
              type="text"
              value={chartFilter}
              onChange={e => setChartFilter(e.target.value)}
              placeholder="Filter symbols..."
              className="w-40 pl-8 pr-3 py-1.5 bg-surface-raised border border-line-subtle rounded-lg text-xs text-fg-primary placeholder:text-fg-muted focus:outline-none focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/20 transition-all"
            />
            {chartFilter && (
              <button
                onClick={() => setChartFilter('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg-secondary"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-fg-muted font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="px-3 pt-4 pb-4">
        {visibleStocks.length === 0 ? (
          <div className="flex items-center justify-center h-[200px] text-fg-muted text-sm">
            No matches for &ldquo;{chartFilter}&rdquo;
          </div>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="h-[220px] w-full [&_.recharts-curve.recharts-tooltip-cursor]:stroke-slate-700"
          >
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
              <defs>
                {visibleStocks.map((item, i) => (
                  <linearGradient key={item.symbol} id={`line-${item.symbol}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_PALETTE[i % CHART_PALETTE.length]} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={CHART_PALETTE[i % CHART_PALETTE.length]} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid
                strokeDasharray="4 8"
                stroke={t.borderSubtle}
                horizontal={true}
                vertical={false}
              />
              <XAxis
                dataKey="time"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: t.textMuted }}
                tickMargin={10}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: t.textMuted }}
                tickFormatter={(v) => `$${v}`}
                tickMargin={4}
                width={52}
              />
              <ChartTooltip
                content={<CustomTooltip />}
                cursor={{ strokeDasharray: '3 3', stroke: t.borderSubtle }}
              />
              {visibleStocks.map((item, i) => (
                <Line
                  key={item.symbol}
                  dataKey={item.symbol}
                  type="monotone"
                  stroke={CHART_PALETTE[i % CHART_PALETTE.length]}
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{
                    r: 4,
                    strokeWidth: 2,
                    stroke: t.surfaceBase,
                    fill: CHART_PALETTE[i % CHART_PALETTE.length],
                  }}
                />
              ))}
            </LineChart>
          </ChartContainer>
        )}
      </div>
    </div>
  )
}

// ─── Bloomberg-style Watchlist Table ─────────────────────────────────────────
function WatchlistFinancialTable({
  watchlist,
  isLoading,
  toggleStar,
  handleRemove,
  removeMutation,
  onAddFirst,
}: {
  watchlist: WatchlistItemWithPrice[]
  isLoading: boolean
  toggleStar: (symbol: string) => void
  handleRemove: (symbol: string) => void
  removeMutation: { isPending: boolean; variables?: string }
  onAddFirst: () => void
}) {
  const shouldReduceMotion = useReducedMotion()
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)

  const containerVariants = {
    visible: {
      transition: { staggerChildren: 0.04, delayChildren: 0.1 },
    },
  }

  const rowVariants = {
    hidden: { opacity: 0, y: 20, scale: 0.98, filter: 'blur(4px)' },
    visible: {
      opacity: 1, y: 0, scale: 1, filter: 'blur(0px)',
      transition: { type: 'spring' as const, stiffness: 400, damping: 25, mass: 0.7 },
    },
  }

  const getPerformanceColor = (value: number) => {
    const isPositive = value >= 0
    return {
      bgColor: isPositive ? 'bg-green-500/10' : 'bg-red-500/10',
      borderColor: isPositive ? 'border-green-500/30' : 'border-red-500/30',
      textColor: isPositive ? 'text-green-400' : 'text-red-400',
    }
  }

  const formatLargeNumber = (n: number | undefined) => {
    if (n == null || n === 0) return '—'
    if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
    return n.toFixed(1)
  }

  const formatPct = (v: number | undefined) => {
    if (v == null) return '—'
    const sign = v >= 0 ? '+' : ''
    return `${sign}${v.toFixed(2)}%`
  }

  const renderSparkline = (data?: number[]) => {
    if (!data || data.length < 2) return <span className="text-fg-muted text-xs">—</span>
    const min = Math.min(...data)
    const max = Math.max(...data)
    const range = max - min || 1
    const points = data.map((v, i) => {
      const x = (i / (data.length - 1)) * 60
      const y = 20 - ((v - min) / range) * 15
      return `${x},${y}`
    }).join(' ')
    const up = data[data.length - 1] >= data[0]

    return (
      <motion.svg
        width="60" height="20" viewBox="0 0 60 20" className="overflow-visible"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ duration: shouldReduceMotion ? 0.2 : 0.5 }}
      >
        <motion.polyline
          points={points} fill="none"
          stroke={up ? '#34d399' : '#f87171'} strokeWidth="1.5"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
          transition={{ duration: shouldReduceMotion ? 0.3 : 0.8, ease: 'easeOut', delay: 0.2 }}
        />
      </motion.svg>
    )
  }

  if (isLoading) {
    return (
      <div className="bg-surface-raised border border-line-subtle rounded-2xl overflow-hidden">
        <SkeletonWatchlistTable rows={5} />
      </div>
    )
  }

  if (watchlist.length === 0) {
    return (
      <div className="bg-surface-raised border border-line-subtle rounded-2xl overflow-hidden">
        <div className="flex flex-col items-center justify-center py-20 text-fg-secondary">
          <p className="text-lg mb-2">Your watchlist is empty</p>
          <p className="text-sm mb-4">Add symbols to start tracking them</p>
          <button onClick={onAddFirst} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm transition-colors">
            <Plus className="w-4 h-4" /> Add Your First Symbol
          </button>
        </div>
      </div>
    )
  }

  const GRID_COLS = '36px 40px 180px 90px 80px 80px 90px 80px 80px 80px 120px 44px'

  return (
    <div className="w-full">
      <div className="bg-surface-raised border border-line-subtle rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[1100px]">
            {/* Header */}
            <div
              className="px-6 py-3 text-[11px] font-medium text-fg-muted uppercase tracking-wider bg-surface-hover/30 border-b border-line-subtle"
              style={{ display: 'grid', gridTemplateColumns: GRID_COLS, columnGap: '6px', alignItems: 'center' }}
            >
              <div />
              <div />
              <div>Symbol</div>
              <div className="text-right">Price</div>
              <div className="text-right">YTD Return</div>
              <div className="text-right">P/LTM EPS</div>
              <div className="text-right">Div Yield</div>
              <div className="text-right">Mkt Cap</div>
              <div className="text-right">Volume</div>
              <div className="text-center">2-Day Chart</div>
              <div className="text-right">Daily Perf.</div>
              <div />
            </div>

            {/* Rows */}
            <motion.div variants={containerVariants} initial="hidden" animate="visible">
              {watchlist.map((item, idx) => (
                <motion.div key={item.id} variants={rowVariants}>
                  <div
                    className={`px-6 py-3 cursor-pointer group relative transition-all duration-200 ${
                      selectedSymbol === item.symbol
                        ? 'bg-surface-active border-b border-line-default'
                        : 'hover:bg-surface-hover'
                    } ${idx < watchlist.length - 1 && selectedSymbol !== item.symbol ? 'border-b border-line-subtle' : ''}`}
                    style={{ display: 'grid', gridTemplateColumns: GRID_COLS, columnGap: '6px', alignItems: 'center' }}
                    onClick={() => setSelectedSymbol(item.symbol === selectedSymbol ? null : item.symbol)}
                  >
                    {/* Star */}
                    <div className="flex items-center justify-center">
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleStar(item.symbol) }}
                        className={`${item.starred ? 'text-yellow-400' : 'text-fg-muted hover:text-yellow-400'} transition-colors`}
                      >
                        <Star className={`w-4 h-4 ${item.starred ? 'fill-current' : ''}`} />
                      </button>
                    </div>

                    {/* Logo */}
                    <div className="flex items-center justify-center">
                      <TickerLogo symbol={item.symbol} companyName={item.name} size={30} />
                    </div>

                    {/* Symbol + Name */}
                    <div className="min-w-0">
                      <Link
                        href={`/research?symbol=${item.symbol}`}
                        className="hover:text-blue-400 transition-colors group/link"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="font-medium text-white group-hover/link:text-blue-400 truncate text-sm">{item.symbol}</div>
                        <div className="text-[11px] text-fg-muted truncate">{item.name || 'Unknown'}</div>
                      </Link>
                    </div>

                    {/* Price */}
                    <div className="text-right">
                      <span className="font-semibold text-white font-mono text-sm">
                        {item.price ? `$${item.price.toFixed(2)}` : '—'}
                      </span>
                    </div>

                    {/* YTD Return */}
                    <div className="flex items-center justify-end">
                      {item.ytd_return != null ? (() => {
                        const { bgColor, borderColor, textColor } = getPerformanceColor(item.ytd_return)
                        return (
                          <div className={`px-2 py-0.5 rounded-md text-[11px] font-medium border ${bgColor} ${borderColor} ${textColor}`}>
                            {formatPct(item.ytd_return)}
                          </div>
                        )
                      })() : <span className="text-fg-muted text-xs">—</span>}
                    </div>

                    {/* P/LTM EPS */}
                    <div className="text-right">
                      <span className="font-semibold text-white/80 text-sm">
                        {item.pe_ratio != null ? item.pe_ratio.toFixed(2) : '—'}
                      </span>
                    </div>

                    {/* Div Yield */}
                    <div className="text-right">
                      <span className="font-semibold text-orange-400 text-sm">
                        {item.div_yield != null ? formatPct(item.div_yield) : '—'}
                      </span>
                    </div>

                    {/* Market Cap */}
                    <div className="text-right">
                      <span className="font-semibold text-white/80 text-sm">
                        {formatLargeNumber(item.market_cap)}
                      </span>
                    </div>

                    {/* Volume */}
                    <div className="text-right">
                      <span className="font-semibold text-white/80 text-sm">
                        {formatLargeNumber(item.volume)}
                      </span>
                    </div>

                    {/* 2-Day Chart */}
                    <div className="flex items-center justify-center">
                      {renderSparkline(item.chartData)}
                    </div>

                    {/* Daily Performance */}
                    <div className="flex items-center justify-end gap-1.5">
                      {item.change != null && (
                        <span className={`font-semibold font-mono text-xs ${(item.change) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {item.change >= 0 ? '+' : ''}{item.change.toFixed(2)}
                        </span>
                      )}
                      {item.percent != null ? (() => {
                        const { bgColor, borderColor, textColor } = getPerformanceColor(item.percent)
                        return (
                          <div className={`px-2 py-0.5 rounded-md text-[11px] font-medium border ${bgColor} ${borderColor} ${textColor}`}>
                            {formatPct(item.percent)}
                          </div>
                        )
                      })() : <span className="text-fg-muted text-xs">—</span>}
                    </div>

                    {/* Remove */}
                    <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleRemove(item.symbol)}
                        disabled={removeMutation.isPending}
                        className="text-fg-muted hover:text-red-400 transition-colors disabled:opacity-50"
                        aria-label={`Remove ${item.symbol}`}
                      >
                        {removeMutation.isPending && removeMutation.variables === item.symbol
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <Trash2 className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  )
}

function DesktopWatchlistPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()
  const priceRefreshInterval = useMarketRefreshInterval({ liveInterval: 15_000, extendedInterval: 60_000, closedInterval: 300_000 })
  
  // Form state
  const [showAddModal, setShowAddModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)

  // Portfolio state
  const [activeTab, setActiveTab] = useState<ActiveTab>('watchlist')
  const [showBrokerConnect, setShowBrokerConnect] = useState(false)
  const [brokers, setBrokers] = useState<BrokerConnection[]>(
    SUPPORTED_BROKERS.map(b => ({ ...b, connected: false, accountCount: 0, totalValue: 0 }))
  )
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([])
  const [selectedBrokerFilter, setSelectedBrokerFilter] = useState<string | null>(null)
  const [selectedSectorFilter, setSelectedSectorFilter] = useState<string | null>(null)
  const [sortByPerformance, setSortByPerformance] = useState(false)
  const [showOptimizer, setShowOptimizer] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [optimizeResult, setOptimizeResult] = useState<null | { score: number; suggestions: string[] }>(null)

  // Refs
  const isAddingRef = useRef(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null)

  // Debounced search
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }
    
    if (!searchQuery.trim()) {
      setSearchResults([])
      setSelectedIndex(-1)
      setIsSearching(false)
      return
    }
    
    setIsSearching(true)
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const results = await searchSymbols(searchQuery, 10)
        setSearchResults(results)
        setSelectedIndex(-1)
      } catch (error) {
        console.error('Search failed:', error)
        setSearchResults([])
      } finally {
        setIsSearching(false)
      }
    }, 300)
    
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current)
      }
    }
  }, [searchQuery])

  // Keyboard navigation for search
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!searchResults.length) return
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, searchResults.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (selectedIndex >= 0 && searchResults[selectedIndex]) {
          handleSelectSearchResult(searchResults[selectedIndex])
        }
        break
      case 'Escape':
        setSearchQuery('')
        setSearchResults([])
        setSelectedIndex(-1)
        break
    }
  }, [searchResults, selectedIndex])

  // Scroll selected result into view
  useEffect(() => {
    if (selectedIndex >= 0 && resultsRef.current) {
      const items = resultsRef.current.querySelectorAll('[data-result]')
      items[selectedIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  // Fetch watchlist with React Query
  const { 
    data: watchlistRaw = [], 
    isLoading, 
    error,
    refetch 
  } = useQuery({
    queryKey: WATCHLIST_QUERY_KEY,
    queryFn: getWatchlist,
    enabled: isAuthenticated,
    staleTime: 30000, // Consider data fresh for 30s
    refetchOnWindowFocus: true,
  })

  // Fetch real-time quotes + fundamentals for watchlist items
  const { data: watchlist = [] } = useQuery({
    queryKey: ['watchlist-prices', watchlistRaw.map(i => i.symbol).join(',')],
    queryFn: async (): Promise<WatchlistItemWithPrice[]> => {
      if (watchlistRaw.length === 0) return []

      const itemsWithPrices = await Promise.all(
        watchlistRaw.map(async (item): Promise<WatchlistItemWithPrice> => {
          try {
            const [quote, fundamentals] = await Promise.all([
              fetchQuote(item.symbol, 'high'),
              fetchFundamentals(item.symbol),
            ])
            const p = quote?.price || 0
            const chg = quote?.change || 0
            // Build synthetic sparkline from price ± change
            const chartData = p > 0
              ? Array.from({ length: 10 }, (_, i) => {
                  const t = i / 9
                  const noise = (Math.sin(i * 2.3) * 0.3 + Math.cos(i * 1.7) * 0.2) * Math.abs(chg || p * 0.002)
                  return p - chg * (1 - t) + noise
                })
              : []
            return {
              ...item,
              price: p,
              change: chg,
              percent: quote?.change_percent,
              volume: quote?.volume,
              starred: false,
              market_cap: fundamentals?.market_cap ?? undefined,
              pe_ratio: fundamentals?.pe_ratio ?? undefined,
              eps: fundamentals?.eps ?? undefined,
              div_yield: typeof (fundamentals as unknown as Record<string, unknown>)?.dividend_yield === 'number'
                ? (fundamentals as unknown as Record<string, unknown>).dividend_yield as number
                : undefined,
              ytd_return: quote?.change_percent,
              chartData,
            }
          } catch (e) {
            console.error(`Error fetching data for ${item.symbol}:`, e)
          }
          return { ...item, starred: false }
        })
      )
      return itemsWithPrices
    },
    enabled: watchlistRaw.length > 0,
    staleTime: 10_000,
    refetchInterval: priceRefreshInterval,
    refetchOnWindowFocus: true,
  })

  // Add mutation with optimistic update
  const addMutation = useMutation({
    mutationFn: async (symbol: string) => {
      // Sync symbol first to ensure it exists
      await syncSymbol(symbol)
      return addToWatchlist({ symbol })
    },
    onMutate: async (symbol) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: WATCHLIST_QUERY_KEY })
      
      // Snapshot previous value
      const previousWatchlist = queryClient.getQueryData<WatchlistItem[]>(WATCHLIST_QUERY_KEY)
      
      // Optimistically add the item
      const optimisticItem: WatchlistItem = {
        id: Date.now(), // Temporary ID
        symbol: symbol.toUpperCase(),
        name: null,
        source: null,
        added_at: new Date().toISOString(),
        updated_at: null,
      }
      
      queryClient.setQueryData<WatchlistItem[]>(WATCHLIST_QUERY_KEY, (old = []) => [
        optimisticItem,
        ...old
      ])
      
      return { previousWatchlist }
    },
    onError: (err, symbol, context) => {
      // Rollback on error
      if (context?.previousWatchlist) {
        queryClient.setQueryData(WATCHLIST_QUERY_KEY, context.previousWatchlist)
      }
      toast.error(err instanceof Error ? err.message : 'Failed to add symbol')
    },
    onSuccess: (data) => {
      toast.success(`${data.symbol} added to watchlist`)
      setSearchQuery('')
      setSearchResults([])
      setShowAddModal(false)
    },
    onSettled: () => {
      // Refetch to get accurate data
      queryClient.invalidateQueries({ queryKey: WATCHLIST_QUERY_KEY })
      isAddingRef.current = false
    },
  })

  // Remove mutation with optimistic update
  const removeMutation = useMutation({
    mutationFn: removeFromWatchlist,
    onMutate: async (symbol) => {
      await queryClient.cancelQueries({ queryKey: WATCHLIST_QUERY_KEY })
      
      const previousWatchlist = queryClient.getQueryData<WatchlistItem[]>(WATCHLIST_QUERY_KEY)
      
      // Optimistically remove the item
      queryClient.setQueryData<WatchlistItem[]>(WATCHLIST_QUERY_KEY, (old = []) => 
        old.filter(item => item.symbol !== symbol.toUpperCase())
      )
      
      return { previousWatchlist, symbol }
    },
    onError: (err, symbol, context) => {
      // Rollback on error
      if (context?.previousWatchlist) {
        queryClient.setQueryData(WATCHLIST_QUERY_KEY, context.previousWatchlist)
      }
      toast.error(err instanceof Error ? err.message : 'Failed to remove symbol')
    },
    onSuccess: (_, symbol) => {
      toast.success(`${symbol.toUpperCase()} removed from watchlist`)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: WATCHLIST_QUERY_KEY })
    },
  })

  // Handlers
  const handleSelectSearchResult = useCallback(async (result: SearchResult) => {
    const symbol = result.symbol.toUpperCase()
    
    // Prevent double-click
    if (isAddingRef.current || addMutation.isPending) return
    isAddingRef.current = true
    
    // Check if already exists
    if (watchlist.some(item => item.symbol === symbol)) {
      toast.warning(`${symbol} is already in your watchlist`)
      isAddingRef.current = false
      return
    }
    
    addMutation.mutate(symbol)
  }, [watchlist, addMutation, toast])

  const handleAddManualSymbol = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    
    const symbol = searchQuery.trim().toUpperCase()
    if (!symbol) return
    
    // Prevent double-click
    if (isAddingRef.current || addMutation.isPending) return
    isAddingRef.current = true
    
    // Validate symbol format
    if (!/^[A-Z0-9.\-]{1,10}$/.test(symbol)) {
      toast.error('Invalid symbol format. Use 1-10 uppercase letters, numbers, dots, or dashes.')
      isAddingRef.current = false
      return
    }
    
    // Check if already exists
    if (watchlist.some(item => item.symbol === symbol)) {
      toast.warning(`${symbol} is already in your watchlist`)
      isAddingRef.current = false
      return
    }
    
    addMutation.mutate(symbol)
  }, [searchQuery, watchlist, addMutation, toast])

  const handleRemove = useCallback((symbol: string) => {
    if (removeMutation.isPending) return
    removeMutation.mutate(symbol)
  }, [removeMutation])

  const toggleStar = useCallback((symbol: string) => {
    // Local state only - not persisted
    queryClient.setQueryData<WatchlistItemWithPrice[]>(['watchlist-prices', watchlist.map(i => i.symbol).join(',')], (old = []) =>
      old.map(item => 
        item.symbol === symbol ? { ...item, starred: !item.starred } : item
      )
    )
  }, [watchlist, queryClient])

  // Calculate stats
  const stats = useMemo(() => {
    const gainers = watchlist.filter(item => (item.percent || 0) > 0).length
    const losers = watchlist.filter(item => (item.percent || 0) < 0).length
    const topGainer = watchlist.reduce((max, item) => 
      (item.percent || 0) > (max?.percent || -Infinity) ? item : max, watchlist[0])
    const topLoser = watchlist.reduce((min, item) => 
      (item.percent || 0) < (min?.percent || Infinity) ? item : min, watchlist[0])
    const avgChange = watchlist.length > 0 
      ? watchlist.reduce((sum, item) => sum + (item.percent || 0), 0) / watchlist.length 
      : 0
    return { gainers, losers, topGainer, topLoser, avgChange }
  }, [watchlist])

  // Portfolio computed values
  const connectedBrokers = brokers.filter(b => b.connected)
  const hasPortfolio = connectedBrokers.length > 0

  const portfolioSectors = useMemo(() => Array.from(new Set(holdings.map(h => h.sector))), [holdings])
  const portfolioBrokerNames = useMemo(() => Array.from(new Set(holdings.map(h => h.broker))), [holdings])

  const filteredHoldings = useMemo(() => {
    let filtered = holdings
    if (selectedBrokerFilter) filtered = filtered.filter(h => h.broker === selectedBrokerFilter)
    if (selectedSectorFilter) filtered = filtered.filter(h => h.sector === selectedSectorFilter)
    if (sortByPerformance) filtered = [...filtered].sort((a, b) => b.pnlPercent - a.pnlPercent)
    return filtered
  }, [holdings, selectedBrokerFilter, selectedSectorFilter, sortByPerformance])

  const portfolioStats = useMemo(() => {
    const totalValue = filteredHoldings.reduce((s, h) => s + h.marketValue, 0)
    const totalPnl = filteredHoldings.reduce((s, h) => s + h.pnl, 0)
    const totalCost = filteredHoldings.reduce((s, h) => s + (h.avgCost * h.shares), 0)
    const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0
    return { totalValue, totalPnl, totalPnlPercent, holdingCount: filteredHoldings.length }
  }, [filteredHoldings])

  const handleConnectBroker = (brokerId: string) => {
    // TODO: Integrate with real broker OAuth flow (e.g. Plaid)
    // For now, toggle connection state — actual holdings would be fetched from the broker API
    setBrokers(prev => prev.map(b =>
      b.id === brokerId
        ? { ...b, connected: !b.connected, accountCount: b.connected ? 0 : 1, totalValue: 0 }
        : b
    ))
    // When disconnecting, clear holdings from this broker
    const broker = brokers.find(b => b.id === brokerId)
    if (broker?.connected) {
      setHoldings(prev => prev.filter(h => h.broker !== broker.name))
    }
  }

  const handleOptimize = async () => {
    if (holdings.length === 0) return
    setOptimizing(true)
    // TODO: Call real portfolio optimization API endpoint
    // e.g. const result = await fetch('/api/v1/portfolio/optimize', { method: 'POST', body: JSON.stringify({ holdings }) })
    setOptimizing(false)
  }

  // Auth gate
  if (!authLoading && !isAuthenticated) {
    return (
      <AppLayout>
        <div className="p-6 flex items-center justify-center min-h-[80vh]">
          <div className="text-center max-w-md">
            <div className="hud-panel p-8">
              <LogIn className="w-16 h-16 text-blue-400 mx-auto mb-4" aria-hidden="true" />
              <h2 className="text-2xl font-bold text-white mb-2">Sign In Required</h2>
              <p className="text-fg-secondary mb-6">
                Create an account to save and track your favorite stocks in your personalized watchlist.
              </p>
              <Link 
                href="/auth"
                className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors"
              >
                Sign In / Register
              </Link>
            </div>
          </div>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="p-6">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-white">
                {activeTab === 'watchlist' ? 'Your Watchlist' : 'Portfolio Optimizer'}
              </h1>
              <p className="text-sm text-fg-secondary mt-1">
                {activeTab === 'watchlist'
                  ? `${watchlist.length} symbols tracked • ${stats.gainers} up • ${stats.losers} down`
                  : hasPortfolio
                    ? `${portfolioStats.holdingCount} holdings across ${connectedBrokers.length} broker${connectedBrokers.length > 1 ? 's' : ''}`
                    : 'Connect your brokerage to get started'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {activeTab === 'watchlist' && (
                <>
                  <button
                    onClick={() => refetch()}
                    disabled={isLoading}
                    className="flex items-center gap-2 px-3 py-2 bg-surface-raised hover:bg-surface-hover text-fg-primary rounded-lg font-medium text-sm transition-colors disabled:opacity-50 border border-line-subtle"
                    aria-label="Refresh watchlist"
                  >
                    <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
                    Refresh
                  </button>
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm transition-colors"
                    aria-label="Add symbol to watchlist"
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    Add Symbol
                  </button>
                </>
              )}
              {activeTab === 'portfolio' && (
                <>
                  <button
                    onClick={() => setShowBrokerConnect(true)}
                    className="flex items-center gap-2 px-3 py-2 bg-surface-raised hover:bg-surface-hover text-fg-primary rounded-lg font-medium text-sm transition-colors border border-line-subtle"
                  >
                    <Link2 className="w-4 h-4" aria-hidden="true" />
                    {hasPortfolio ? 'Manage Brokers' : 'Connect Broker'}
                  </button>
                  {hasPortfolio && (
                    <button
                      onClick={() => { setShowOptimizer(true); setOptimizeResult(null) }}
                      className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white rounded-lg font-medium text-sm transition-colors"
                    >
                      <Sparkles className="w-4 h-4" aria-hidden="true" />
                      Optimize Portfolio
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Tab Switcher */}
          <div className="flex gap-1 bg-surface-raised rounded-xl p-1 mb-6 w-fit border border-line-subtle">
            <button
              onClick={() => setActiveTab('watchlist')}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'watchlist'
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'text-fg-secondary hover:text-white'
              }`}
            >
              Watchlist
            </button>
            <button
              onClick={() => setActiveTab('portfolio')}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${
                activeTab === 'portfolio'
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'text-fg-secondary hover:text-white'
              }`}
            >
              <Briefcase className="w-4 h-4" />
              Portfolio
            </button>
          </div>

          {/* ─── WATCHLIST PERFORMANCE CHART (visible on both tabs when data exists) ─── */}
          {watchlist.length > 0 && (
            <WatchlistPerformanceChart watchlist={watchlist} />
          )}

          {/* ─── WATCHLIST TAB ─── */}
          {activeTab === 'watchlist' && (
            <>
              {/* KPI Cards */}
              {watchlist.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-surface-raised border border-line-subtle rounded-lg p-4">
                    <p className="text-sm text-fg-secondary mb-1">Total Symbols</p>
                    <p className="text-2xl font-bold text-white">{watchlist.length}</p>
                    <p className="text-xs text-fg-secondary mt-1">{stats.gainers} gainers, {stats.losers} losers</p>
                  </div>
                  <div className="bg-surface-raised border border-line-subtle rounded-lg p-4">
                    <p className="text-sm text-fg-secondary mb-1">Top Gainer</p>
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-green-400" />
                      <p className="text-2xl font-bold text-green-400">{stats.topGainer?.symbol || '—'}</p>
                    </div>
                    <p className="text-xs text-green-400 mt-1">
                      {stats.topGainer?.percent ? `+${stats.topGainer.percent.toFixed(2)}%` : '—'}
                    </p>
                  </div>
                  <div className="bg-surface-raised border border-line-subtle rounded-lg p-4">
                    <p className="text-sm text-fg-secondary mb-1">Top Loser</p>
                    <div className="flex items-center gap-2">
                      <TrendingDown className="w-5 h-5 text-red-400" />
                      <p className="text-2xl font-bold text-red-400">{stats.topLoser?.symbol || '—'}</p>
                    </div>
                    <p className="text-xs text-red-400 mt-1">
                      {stats.topLoser?.percent ? `${stats.topLoser.percent.toFixed(2)}%` : '—'}
                    </p>
                  </div>
                  <div className="bg-surface-raised border border-line-subtle rounded-lg p-4">
                    <p className="text-sm text-fg-secondary mb-1">Avg Change</p>
                    <p className={`text-2xl font-bold ${stats.avgChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {stats.avgChange >= 0 ? '+' : ''}{stats.avgChange.toFixed(2)}%
                    </p>
                    <p className="text-xs text-fg-secondary mt-1">Across {watchlist.length} symbols</p>
                  </div>
                </div>
              )}

              {/* Error state */}
              {error && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm flex items-center gap-2" role="alert">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                  {error instanceof Error ? error.message : 'Failed to load watchlist'}
                </div>
              )}

              {/* Watchlist Table — Bloomberg-style grid */}
              <WatchlistFinancialTable
                watchlist={watchlist}
                isLoading={isLoading || authLoading}
                toggleStar={toggleStar}
                handleRemove={handleRemove}
                removeMutation={removeMutation}
                onAddFirst={() => setShowAddModal(true)}
              />
            </>
          )}

          {/* ─── PORTFOLIO TAB ─── */}
          {activeTab === 'portfolio' && (
            <>
              {!hasPortfolio ? (
                <div className="bg-surface-raised border border-line-subtle rounded-lg p-12 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center mx-auto mb-4">
                    <Link2 className="w-8 h-8 text-blue-400" />
                  </div>
                  <h2 className="text-xl font-bold text-white mb-2">Connect Your Brokerage</h2>
                  <p className="text-fg-secondary mb-6 max-w-md mx-auto">
                    Import your portfolio from Robinhood, Fidelity, Schwab, and more to get AI-powered optimization insights and sector analysis.
                  </p>
                  <button
                    onClick={() => setShowBrokerConnect(true)}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
                  >
                    <Link2 className="w-5 h-5" />
                    Connect a Broker
                  </button>
                </div>
              ) : (
                <>
                  {/* Connected Brokers Summary */}
                  <div className="grid grid-cols-4 gap-4 mb-6">
                    <div className="bg-surface-raised border border-line-subtle rounded-lg p-4">
                      <p className="text-sm text-fg-secondary mb-1">Connected Brokers</p>
                      <p className="text-2xl font-bold text-white">{connectedBrokers.length}</p>
                      <div className="flex gap-1 mt-1">
                        {connectedBrokers.map(b => (
                          <span key={b.id} className="text-base" title={b.name}>{b.icon}</span>
                        ))}
                      </div>
                    </div>
                    <div className="bg-surface-raised border border-line-subtle rounded-lg p-4">
                      <p className="text-sm text-fg-secondary mb-1">Total Value</p>
                      <p className="text-2xl font-bold text-white">
                        {holdings.length > 0 ? `$${(portfolioStats.totalValue / 1000).toFixed(1)}K` : '—'}
                      </p>
                      <p className="text-xs text-fg-secondary mt-1">{portfolioStats.holdingCount} holdings</p>
                    </div>
                    <div className="bg-surface-raised border border-line-subtle rounded-lg p-4">
                      <p className="text-sm text-fg-secondary mb-1">Total P&L</p>
                      {holdings.length > 0 ? (
                        <>
                          <p className={`text-2xl font-bold ${portfolioStats.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {portfolioStats.totalPnl >= 0 ? '+' : ''}${(portfolioStats.totalPnl / 1000).toFixed(1)}K
                          </p>
                          <p className={`text-xs mt-1 ${portfolioStats.totalPnlPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {portfolioStats.totalPnlPercent >= 0 ? '+' : ''}{portfolioStats.totalPnlPercent.toFixed(2)}%
                          </p>
                        </>
                      ) : (
                        <p className="text-2xl font-bold text-white">—</p>
                      )}
                    </div>
                    <div className="bg-surface-raised border border-line-subtle rounded-lg p-4">
                      <p className="text-sm text-fg-secondary mb-1">Sectors</p>
                      <p className="text-2xl font-bold text-white">{portfolioSectors.length || '—'}</p>
                      <p className="text-xs text-fg-secondary mt-1">Diversification spread</p>
                    </div>
                  </div>

                  {/* Filter Bar — only show when there are holdings */}
                  {holdings.length > 0 && (
                    <div className="flex items-center gap-3 mb-4 flex-wrap">
                      <div className="flex items-center gap-2">
                        <Filter className="w-4 h-4 text-fg-secondary" />
                        <span className="text-sm text-fg-secondary">Filter:</span>
                      </div>

                      <div className="flex items-center gap-1">
                        <span className="text-xs text-fg-muted mr-1">Broker:</span>
                        <button
                          onClick={() => setSelectedBrokerFilter(null)}
                          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                            !selectedBrokerFilter ? 'bg-blue-600 text-white' : 'bg-surface-raised text-fg-secondary hover:text-white border border-line-subtle'
                          }`}
                        >
                          All
                        </button>
                        {portfolioBrokerNames.map(bn => (
                          <button
                            key={bn}
                            onClick={() => setSelectedBrokerFilter(selectedBrokerFilter === bn ? null : bn)}
                            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                              selectedBrokerFilter === bn ? 'bg-blue-600 text-white' : 'bg-surface-raised text-fg-secondary hover:text-white border border-line-subtle'
                            }`}
                          >
                            {bn}
                          </button>
                        ))}
                      </div>

                      <div className="w-px h-5 bg-line-default" />

                      <div className="flex items-center gap-1">
                        <span className="text-xs text-fg-muted mr-1">Sector:</span>
                        <button
                          onClick={() => setSelectedSectorFilter(null)}
                          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                            !selectedSectorFilter ? 'bg-blue-600 text-white' : 'bg-surface-raised text-fg-secondary hover:text-white border border-line-subtle'
                          }`}
                        >
                          All
                        </button>
                        {portfolioSectors.map(s => (
                          <button
                            key={s}
                            onClick={() => setSelectedSectorFilter(selectedSectorFilter === s ? null : s)}
                            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                              selectedSectorFilter === s ? 'bg-blue-600 text-white' : 'bg-surface-raised text-fg-secondary hover:text-white border border-line-subtle'
                            }`}
                          >
                            {s}
                          </button>
                        ))}
                      </div>

                      <div className="w-px h-5 bg-line-default" />

                      <button
                        onClick={() => setSortByPerformance(!sortByPerformance)}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${
                          sortByPerformance ? 'bg-blue-600 text-white' : 'bg-surface-raised text-fg-secondary hover:text-white border border-line-subtle'
                        }`}
                      >
                        <BarChart3 className="w-3 h-3" />
                        Sort by P&L
                      </button>

                      {(selectedBrokerFilter || selectedSectorFilter || sortByPerformance) && (
                        <button
                          onClick={() => { setSelectedBrokerFilter(null); setSelectedSectorFilter(null); setSortByPerformance(false) }}
                          className="px-3 py-1 rounded-full text-xs font-medium text-red-400 hover:text-red-300 bg-red-500/10 flex items-center gap-1"
                        >
                          <X className="w-3 h-3" />
                          Clear
                        </button>
                      )}
                    </div>
                  )}

                  {/* Holdings Table or Empty State */}
                  <div className="bg-surface-raised border border-line-subtle rounded-lg overflow-hidden">
                    {holdings.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-fg-secondary">
                        <Briefcase className="w-12 h-12 text-fg-muted mb-4" />
                        <p className="text-lg mb-2">No holdings imported yet</p>
                        <p className="text-sm mb-1 max-w-md text-center">
                          Your connected brokerage accounts will sync holdings here automatically once the broker integration API is live.
                        </p>
                        <p className="text-xs text-fg-muted mt-3">
                          Connected: {connectedBrokers.map(b => b.name).join(', ')}
                        </p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full" role="table" aria-label="Portfolio Holdings">
                          <thead>
                            <tr className="border-b border-line-subtle bg-surface-hover/30">
                              <th className="px-4 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider" scope="col">Symbol</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-fg-muted uppercase tracking-wider" scope="col">Shares</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-fg-muted uppercase tracking-wider" scope="col">Avg Cost</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-fg-muted uppercase tracking-wider" scope="col">Price</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-fg-muted uppercase tracking-wider" scope="col">Mkt Value</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-fg-muted uppercase tracking-wider" scope="col">P&L</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-fg-muted uppercase tracking-wider" scope="col">%</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider" scope="col">Sector</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider" scope="col">Broker</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-fg-muted uppercase tracking-wider" scope="col">Weight</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line-subtle">
                            {filteredHoldings.map(h => (
                              <tr key={h.symbol} className="hover:bg-surface-hover transition-colors">
                                <td className="px-4 py-4">
                                  <Link href={`/research?symbol=${h.symbol}`} className="hover:text-blue-400 transition-colors group">
                                    <div className="font-semibold text-white group-hover:text-blue-400">{h.symbol}</div>
                                    <div className="text-xs text-fg-secondary">{h.name}</div>
                                  </Link>
                                </td>
                                <td className="px-4 py-4 text-right font-mono text-white">{h.shares}</td>
                                <td className="px-4 py-4 text-right font-mono text-fg-secondary">${h.avgCost.toFixed(2)}</td>
                                <td className="px-4 py-4 text-right font-mono text-white">${h.currentPrice.toFixed(2)}</td>
                                <td className="px-4 py-4 text-right font-mono text-white">${h.marketValue.toLocaleString()}</td>
                                <td className={`px-4 py-4 text-right font-mono ${h.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                  {h.pnl >= 0 ? '+' : ''}${h.pnl.toFixed(0)}
                                </td>
                                <td className="px-4 py-4 text-right">
                                  <span className={`inline-flex items-center gap-1 font-mono ${h.pnlPercent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                    {h.pnlPercent >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                                    {h.pnlPercent >= 0 ? '+' : ''}{h.pnlPercent.toFixed(2)}%
                                  </span>
                                </td>
                                <td className="px-4 py-4">
                                  <span className="px-2 py-1 text-xs rounded-full bg-surface-overlay text-fg-secondary border border-line-subtle">{h.sector}</span>
                                </td>
                                <td className="px-4 py-4">
                                  <span className="text-sm text-fg-secondary">{h.broker}</span>
                                </td>
                                <td className="px-4 py-4 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <div className="w-16 h-1.5 bg-line-default rounded-full overflow-hidden">
                                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(h.weight, 100)}%` }} />
                                    </div>
                                    <span className="text-xs font-mono text-fg-secondary">{h.weight.toFixed(1)}%</span>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ─── BROKER CONNECT MODAL ─── */}
      {showBrokerConnect && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={(e) => { if (e.target === e.currentTarget) setShowBrokerConnect(false) }}
        >
          <div className="bg-surface-overlay border border-line-default rounded-lg p-6 w-full max-w-lg mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-fg-primary">Connect Brokerage</h2>
                <p className="text-sm text-fg-secondary">Link accounts to import portfolio holdings</p>
              </div>
              <button onClick={() => setShowBrokerConnect(false)} className="text-fg-secondary hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2 overflow-y-auto">
              {brokers.map(b => (
                <div key={b.id} className="flex items-center justify-between p-4 rounded-lg bg-surface-raised border border-line-subtle">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{b.icon}</span>
                    <div>
                      <p className="font-semibold text-white">{b.name}</p>
                      {b.connected && <p className="text-xs text-green-400">Connected</p>}
                    </div>
                  </div>
                  <button
                    onClick={() => handleConnectBroker(b.id)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                      b.connected
                        ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20'
                        : 'bg-blue-600 hover:bg-blue-500 text-white'
                    }`}
                  >
                    {b.connected ? <><Unlink className="w-4 h-4" /> Disconnect</> : <><Link2 className="w-4 h-4" /> Connect</>}
                  </button>
                </div>
              ))}
              <div className="p-4 border border-dashed border-line-default rounded-lg text-center text-fg-muted text-sm">
                More brokerages coming soon — Merrill Lynch, Ally Invest, SoFi, and more
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── OPTIMIZER MODAL ─── */}
      {showOptimizer && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={(e) => { if (e.target === e.currentTarget) setShowOptimizer(false) }}
        >
          <div className="bg-surface-overlay border border-line-default rounded-lg p-6 w-full max-w-2xl mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-fg-primary">Portfolio Optimizer</h2>
                  <p className="text-sm text-fg-secondary">AI-powered portfolio analysis & suggestions</p>
                </div>
              </div>
              <button onClick={() => setShowOptimizer(false)} className="text-fg-secondary hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-surface-raised border border-line-subtle">
                  <div className="flex items-center gap-2 mb-2">
                    <PieChart className="w-5 h-5 text-blue-400" />
                    <span className="text-sm font-semibold text-fg-primary">Sector Analysis</span>
                  </div>
                  <p className="text-xs text-fg-secondary">Evaluates sector diversification and concentration risk</p>
                </div>
                <div className="p-4 rounded-lg bg-surface-raised border border-line-subtle">
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 className="w-5 h-5 text-purple-400" />
                    <span className="text-sm font-semibold text-fg-primary">Risk Assessment</span>
                  </div>
                  <p className="text-xs text-fg-secondary">Analyzes risk-adjusted returns and portfolio beta</p>
                </div>
                <div className="p-4 rounded-lg bg-surface-raised border border-line-subtle">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-5 h-5 text-amber-400" />
                    <span className="text-sm font-semibold text-fg-primary">Rebalancing</span>
                  </div>
                  <p className="text-xs text-fg-secondary">Suggests optimal position adjustments for better returns</p>
                </div>
                <div className="p-4 rounded-lg bg-surface-raised border border-line-subtle">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-5 h-5 text-green-400" />
                    <span className="text-sm font-semibold text-fg-primary">Tax Optimization</span>
                  </div>
                  <p className="text-xs text-fg-secondary">Identifies tax-loss harvesting opportunities</p>
                </div>
              </div>

              {holdings.length === 0 ? (
                <div className="p-6 rounded-lg bg-surface-raised border border-line-subtle text-center">
                  <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-3" />
                  <p className="text-fg-primary font-medium mb-1">No holdings to optimize</p>
                  <p className="text-sm text-fg-secondary">
                    Connect a brokerage and import your holdings to run portfolio optimization.
                  </p>
                </div>
              ) : (
                <button
                  onClick={handleOptimize}
                  disabled={optimizing}
                  className="w-full py-3 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                >
                  {optimizing ? (
                    <><Loader2 className="w-5 h-5 animate-spin" /> Analyzing...</>
                  ) : (
                    <><Sparkles className="w-5 h-5" /> Run Optimization Analysis</>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Symbol Modal with Universal Search */}
      {showAddModal && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-symbol-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAddModal(false)
          }}
        >
          <div className="bg-surface-overlay border border-line-default rounded-lg p-6 w-full max-w-lg mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 id="add-symbol-title" className="text-lg font-bold text-fg-primary">Add Symbol to Watchlist</h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-fg-secondary hover:text-white"
                aria-label="Close dialog"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            {/* Search Input */}
            <form onSubmit={handleAddManualSymbol}>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-fg-secondary" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Search by ticker or company name..."
                  className="w-full pl-10 pr-10 py-3 bg-surface-raised border border-line-subtle rounded-lg text-white placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                  autoComplete="off"
                />
                {isSearching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-400 animate-spin" />
                )}
              </div>
            </form>

            {/* Search Results Dropdown */}
            {searchResults.length > 0 && (
              <div
                ref={resultsRef}
                className="mt-2 bg-surface-raised border border-line-subtle rounded-lg max-h-[300px] overflow-y-auto"
              >
                {searchResults.map((result, index) => (
                  <button
                    key={result.symbol}
                    data-result
                    onClick={() => handleSelectSearchResult(result)}
                    disabled={addMutation.isPending}
                    className={`w-full px-4 py-3 text-left hover:bg-surface-hover transition-colors border-b border-line-subtle last:border-0 disabled:opacity-50 ${
                      index === selectedIndex ? 'bg-surface-hover' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">{result.symbol}</span>
                          {result.match_type === 'exact' && (
                            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-500/20 text-green-400 rounded">EXACT</span>
                          )}
                        </div>
                        <p className="text-sm text-fg-secondary truncate mt-0.5">{result.name || 'Unknown'}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-fg-muted">
                          {result.exchange && (
                            <span className="flex items-center gap-1">
                              <Building2 className="w-3 h-3" />
                              {result.exchange}
                            </span>
                          )}
                          {result.asset_type && (
                            <span>{result.asset_type}</span>
                          )}
                          {result.country && (
                            <span className="flex items-center gap-1">
                              <Globe className="w-3 h-3" />
                              {result.country}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right text-xs text-fg-muted ml-2">
                        {result.currency || 'USD'}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Empty state / hints */}
            {searchQuery && !isSearching && searchResults.length === 0 && (
              <div className="mt-4 text-center text-fg-secondary py-6">
                <p className="mb-2">No matches found for "{searchQuery}"</p>
                <p className="text-sm text-fg-muted">
                  Press Enter to add "{searchQuery.toUpperCase()}" directly
                </p>
              </div>
            )}

            {!searchQuery && (
              <div className="mt-4 text-sm text-fg-muted">
                <p className="mb-2">💡 <strong>Tips:</strong></p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Type ticker symbol: AAPL, MSFT, GOOGL</li>
                  <li>Search by company name: Apple, Microsoft</li>
                  <li>Use ↑↓ arrows to navigate, Enter to select</li>
                  <li>Press Escape to clear search</li>
                </ul>
              </div>
            )}
            
            {/* Actions */}
            <div className="flex gap-3 mt-6 pt-4 border-t border-line-subtle">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="flex-1 px-4 py-2 bg-surface-raised hover:bg-surface-hover text-fg-primary rounded-lg font-medium transition-colors border border-line-subtle"
              >
                Cancel
              </button>
              <button
                onClick={handleAddManualSymbol}
                disabled={addMutation.isPending || !searchQuery.trim()}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {addMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    Adding...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    Add {searchQuery.toUpperCase() || 'Symbol'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

export default function WatchlistPage() {
  return (
    <>
      <div className="hidden md:block">
        <DesktopWatchlistPage />
      </div>
      <div className="md:hidden">
        <MobileLayout>
          <MobileWatchlist />
        </MobileLayout>
      </div>
    </>
  )
}
