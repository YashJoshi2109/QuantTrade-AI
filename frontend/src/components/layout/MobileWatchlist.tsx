'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Search,
  Trash2,
  Loader2,
  LogIn,
  ArrowUpRight,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Briefcase,
  Link2,
  Unlink,
  Filter,
  Sparkles,
  ChevronDown,
  ChevronUp,
  PieChart,
  BarChart3,
  Building2,
  Layers,
  X,
  Check,
  AlertTriangle,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  addToWatchlist,
  getWatchlist,
  removeFromWatchlist,
  searchSymbols,
  syncSymbol,
  WatchlistItem,
  SearchResult,
  fetchQuote,
  QuoteData,
} from '@/lib/api'
import { formatNumber, formatPercent, isNumber } from '@/lib/format'

interface WatchlistQuote extends QuoteData {
  name?: string | null
}

type ActiveTab = 'watchlist' | 'portfolio'
type PortfolioFilter = 'all' | 'sector' | 'brokerage' | 'performance'

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

export default function MobileWatchlist() {
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const queryClient = useQueryClient()

  const [filter, setFilter] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [addQuery, setAddQuery] = useState('')
  const [activeTab, setActiveTab] = useState<ActiveTab>('watchlist')
  const [showBrokerConnect, setShowBrokerConnect] = useState(false)
  const [brokers, setBrokers] = useState<BrokerConnection[]>(
    SUPPORTED_BROKERS.map(b => ({ ...b, connected: false, accountCount: 0, totalValue: 0 }))
  )
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([])
  const [portfolioFilter, setPortfolioFilter] = useState<PortfolioFilter>('all')
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [selectedBrokerFilter, setSelectedBrokerFilter] = useState<string | null>(null)
  const [selectedSectorFilter, setSelectedSectorFilter] = useState<string | null>(null)
  const [showOptimizer, setShowOptimizer] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [optimizeResult, setOptimizeResult] = useState<null | { score: number; suggestions: string[] }>(null)

  const { data: items = [], isLoading, refetch } = useQuery<WatchlistItem[]>({
    queryKey: ['watchlist'],
    queryFn: getWatchlist,
    enabled: isAuthenticated,
    staleTime: 30000,
  })

  const symbols = useMemo(() => items.map((i) => i.symbol), [items])

  const { data: quotes = [], isLoading: quotesLoading } = useQuery<WatchlistQuote[]>({
    queryKey: ['watchlist.quotes', symbols.join(',')],
    queryFn: async () => {
      const quoteList = await Promise.all(
        symbols.map(async (s) => {
          const q = await fetchQuote(s, 'normal')
          const item = items.find((i) => i.symbol === s)
          return { ...q, name: item?.name ?? null }
        })
      )
      return quoteList
    },
    enabled: isAuthenticated && symbols.length > 0,
    refetchInterval: 10000,
    staleTime: 5000,
  })

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return quotes
    return quotes.filter(
      (x) => x.symbol.toLowerCase().includes(q) || (x.name || '').toLowerCase().includes(q)
    )
  }, [filter, quotes])

  const stats = useMemo(() => {
    const gainers = quotes.filter(q => isNumber(q.change_percent) && q.change_percent > 0).length
    const losers = quotes.filter(q => isNumber(q.change_percent) && q.change_percent < 0).length
    const topGainer = quotes.reduce((max, q) =>
      (q.change_percent || 0) > (max?.change_percent || -Infinity) ? q : max, quotes[0])
    const topLoser = quotes.reduce((min, q) =>
      (q.change_percent || 0) < (min?.change_percent || Infinity) ? q : min, quotes[0])
    const avgChange = quotes.length > 0
      ? quotes.reduce((sum, q) => sum + (q.change_percent || 0), 0) / quotes.length
      : 0
    return { gainers, losers, topGainer, topLoser, avgChange }
  }, [quotes])

  const connectedBrokers = brokers.filter(b => b.connected)
  const hasPortfolio = connectedBrokers.length > 0

  const sectors = useMemo(() => Array.from(new Set(holdings.map(h => h.sector))), [holdings])
  const brokerNames = useMemo(() => Array.from(new Set(holdings.map(h => h.broker))), [holdings])

  const filteredHoldings = useMemo(() => {
    let filtered = holdings
    if (selectedBrokerFilter) {
      filtered = filtered.filter(h => h.broker === selectedBrokerFilter)
    }
    if (selectedSectorFilter) {
      filtered = filtered.filter(h => h.sector === selectedSectorFilter)
    }
    if (portfolioFilter === 'performance') {
      filtered = [...filtered].sort((a, b) => b.pnlPercent - a.pnlPercent)
    }
    return filtered
  }, [holdings, selectedBrokerFilter, selectedSectorFilter, portfolioFilter])

  const portfolioStats = useMemo(() => {
    const totalValue = filteredHoldings.reduce((s, h) => s + h.marketValue, 0)
    const totalPnl = filteredHoldings.reduce((s, h) => s + h.pnl, 0)
    const totalCost = filteredHoldings.reduce((s, h) => s + (h.avgCost * h.shares), 0)
    const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0
    return { totalValue, totalPnl, totalPnlPercent, holdingCount: filteredHoldings.length }
  }, [filteredHoldings])

  const addMutation = useMutation({
    mutationFn: async (symbol: string) => {
      await syncSymbol(symbol)
      return addToWatchlist({ symbol })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['watchlist'] })
    },
  })

  const removeMutation = useMutation({
    mutationFn: removeFromWatchlist,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['watchlist'] })
    },
  })

  const { data: searchResults = [], isLoading: searching } = useQuery<SearchResult[]>({
    queryKey: ['watchlist.search', addQuery],
    queryFn: () => searchSymbols(addQuery, 10),
    enabled: showAdd && addQuery.trim().length > 0,
    staleTime: 0,
  })

  const handleConnectBroker = (brokerId: string) => {
    // TODO: Integrate with real broker OAuth flow (e.g. Plaid)
    setBrokers(prev => prev.map(b =>
      b.id === brokerId
        ? { ...b, connected: !b.connected, accountCount: b.connected ? 0 : 1, totalValue: 0 }
        : b
    ))
    const broker = brokers.find(b => b.id === brokerId)
    if (broker?.connected) {
      setHoldings(prev => prev.filter(h => h.broker !== broker.name))
    }
  }

  const handleOptimize = async () => {
    if (holdings.length === 0) return
    setOptimizing(true)
    // TODO: Call real portfolio optimization API endpoint
    setOptimizing(false)
  }

  if (!authLoading && !isAuthenticated) {
    return (
      <div className="space-y-4">
        <header className="sticky top-0 z-30 bg-[#0A0E1A]/95 backdrop-blur-xl border-b border-white/10 pt-safe pb-2 px-1">
          <h1 className="text-xl font-semibold text-white">Watchlist</h1>
          <p className="text-[11px] text-slate-400">Save symbols and track them in real time.</p>
        </header>
        <div className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-5 text-center">
          <LogIn className="w-10 h-10 text-[#00D9FF] mx-auto mb-3" />
          <h2 className="text-[15px] font-semibold text-white">Sign in to use Watchlist</h2>
          <p className="text-[11px] text-slate-400 mt-1">
            Your watchlist is tied to your account so it syncs across devices.
          </p>
          <Link
            href="/auth"
            className="inline-flex items-center justify-center mt-4 w-full h-11 rounded-full bg-[#00D9FF] text-[#0A0E1A] font-semibold text-[13px]"
          >
            Sign In / Register
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3 pb-4">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[#0A0E1A]/95 backdrop-blur-xl border-b border-white/10 pt-safe pb-2 px-1">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-white">Watchlist</h1>
            <p className="text-[11px] text-slate-400">
              {items.length} symbols • quotes refresh every 10s
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { refetch(); queryClient.invalidateQueries({ queryKey: ['watchlist.quotes'] }) }}
              disabled={isLoading}
              className="h-9 w-9 rounded-full bg-[#1A2332] border border-white/10 text-slate-300 flex items-center justify-center active:scale-95 disabled:opacity-50"
              aria-label="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="h-9 px-3 rounded-full bg-[#00D9FF] text-[#0A0E1A] text-[12px] font-semibold inline-flex items-center gap-2 active:scale-[0.98]"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex gap-1 mt-3 bg-[#1A2332]/60 rounded-xl p-1">
          <button
            onClick={() => setActiveTab('watchlist')}
            className={`flex-1 h-8 rounded-lg text-[12px] font-semibold transition-all ${
              activeTab === 'watchlist'
                ? 'bg-[#00D9FF]/20 text-[#00D9FF] border border-[#00D9FF]/30'
                : 'text-slate-400'
            }`}
          >
            Watchlist
          </button>
          <button
            onClick={() => setActiveTab('portfolio')}
            className={`flex-1 h-8 rounded-lg text-[12px] font-semibold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'portfolio'
                ? 'bg-[#00D9FF]/20 text-[#00D9FF] border border-[#00D9FF]/30'
                : 'text-slate-400'
            }`}
          >
            <Briefcase className="w-3.5 h-3.5" />
            Portfolio
          </button>
        </div>
      </header>

      {/* ─── WATCHLIST TAB ─── */}
      {activeTab === 'watchlist' && (
        <>
          {/* KPI Stats Cards */}
          {quotes.length > 0 && (
            <section className="px-1">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-3">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">Total Symbols</p>
                  <p className="text-[20px] font-bold text-white mt-0.5">{quotes.length}</p>
                  <p className="text-[10px] text-slate-400">{stats.gainers} up, {stats.losers} down</p>
                </div>
                <div className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-3">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">Avg Change</p>
                  <p className={`text-[20px] font-bold mt-0.5 ${stats.avgChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {stats.avgChange >= 0 ? '+' : ''}{stats.avgChange.toFixed(2)}%
                  </p>
                  <p className="text-[10px] text-slate-400">Across {quotes.length} symbols</p>
                </div>
                <div className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-3">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">Top Gainer</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                    <p className="text-[16px] font-bold text-emerald-400">{stats.topGainer?.symbol || '—'}</p>
                  </div>
                  <p className="text-[10px] text-emerald-400/70">
                    {isNumber(stats.topGainer?.change_percent) ? `+${stats.topGainer!.change_percent.toFixed(2)}%` : '—'}
                  </p>
                </div>
                <div className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-3">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">Top Loser</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <TrendingDown className="w-4 h-4 text-red-400" />
                    <p className="text-[16px] font-bold text-red-400">{stats.topLoser?.symbol || '—'}</p>
                  </div>
                  <p className="text-[10px] text-red-400/70">
                    {isNumber(stats.topLoser?.change_percent) ? `${stats.topLoser!.change_percent.toFixed(2)}%` : '—'}
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* Search Filter */}
          <section className="px-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search watchlist..."
                className="w-full h-10 rounded-full bg-[#1A2332] border border-white/10 pl-9 pr-3 text-[13px] text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-[#00D9FF]/60"
              />
            </div>
          </section>

          {/* Watchlist Cards */}
          <section className="px-1 space-y-2">
            {(isLoading || quotesLoading) &&
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-20 rounded-2xl bg-[#1A2332]/80 border border-white/10 animate-pulse" />
              ))}

            {!isLoading && items.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-700 p-6 text-center">
                <p className="text-[13px] text-slate-300">No stocks in your watchlist</p>
                <p className="text-[11px] text-slate-500 mt-1">Add your first symbol to begin tracking.</p>
                <button
                  type="button"
                  onClick={() => setShowAdd(true)}
                  className="mt-4 w-full h-11 rounded-full bg-[#00D9FF] text-[#0A0E1A] font-semibold text-[13px]"
                >
                  Add your first stock
                </button>
              </div>
            )}

            {!quotesLoading &&
              filtered.map((q) => {
                const isUp = isNumber(q.change_percent) && q.change_percent >= 0
                return (
                  <div
                    key={q.symbol}
                    className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-4 flex items-center justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/research?symbol=${encodeURIComponent(q.symbol)}`}
                          className="text-[16px] font-semibold text-white"
                        >
                          {q.symbol}
                        </Link>
                        <ArrowUpRight className="w-4 h-4 text-slate-500" />
                      </div>
                      <p className="text-[11px] text-slate-500 truncate max-w-[220px]">
                        {q.name || '—'}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-[14px] font-mono text-white">
                          ${formatNumber(q.price, 2)}
                        </p>
                        <p className={`text-[11px] font-mono ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                          {isUp ? '+' : ''}
                          {formatPercent(q.change_percent, 2)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeMutation.mutate(q.symbol)}
                        disabled={removeMutation.isPending}
                        className="h-9 w-9 rounded-full bg-[#0A0E1A] border border-white/10 text-slate-300 flex items-center justify-center active:scale-95 disabled:opacity-60"
                        aria-label={`Remove ${q.symbol}`}
                      >
                        {removeMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                )
              })}
          </section>
        </>
      )}

      {/* ─── PORTFOLIO TAB ─── */}
      {activeTab === 'portfolio' && (
        <>
          {/* Connect Brokers Banner */}
          {!hasPortfolio && (
            <section className="px-1">
              <div className="rounded-2xl bg-gradient-to-br from-[#00D9FF]/10 to-purple-500/10 border border-[#00D9FF]/20 p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#00D9FF]/20 flex items-center justify-center flex-shrink-0">
                    <Link2 className="w-5 h-5 text-[#00D9FF]" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-[14px] font-semibold text-white">Connect Your Brokerage</h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Import your portfolio from Robinhood, Fidelity, Schwab, and more to get AI-powered optimization insights.
                    </p>
                    <button
                      onClick={() => setShowBrokerConnect(true)}
                      className="mt-3 h-9 px-4 rounded-full bg-[#00D9FF] text-[#0A0E1A] text-[12px] font-semibold inline-flex items-center gap-2 active:scale-[0.98]"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      Connect Broker
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Portfolio Stats (when connected) */}
          {hasPortfolio && (
            <>
              <section className="px-1">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-3">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Total Value</p>
                    <p className="text-[18px] font-bold text-white mt-0.5">
                      {holdings.length > 0 ? `$${(portfolioStats.totalValue / 1000).toFixed(1)}K` : '—'}
                    </p>
                    <p className="text-[10px] text-slate-400">{portfolioStats.holdingCount} holdings</p>
                  </div>
                  <div className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-3">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Total P&L</p>
                    {holdings.length > 0 ? (
                      <>
                        <p className={`text-[18px] font-bold mt-0.5 ${portfolioStats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {portfolioStats.totalPnl >= 0 ? '+' : ''}${(portfolioStats.totalPnl / 1000).toFixed(1)}K
                        </p>
                        <p className={`text-[10px] ${portfolioStats.totalPnlPercent >= 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                          {portfolioStats.totalPnlPercent >= 0 ? '+' : ''}{portfolioStats.totalPnlPercent.toFixed(2)}%
                        </p>
                      </>
                    ) : (
                      <p className="text-[18px] font-bold text-white mt-0.5">—</p>
                    )}
                  </div>
                </div>
              </section>

              {/* Connected Brokers */}
              <section className="px-1">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Connected Accounts</p>
                  <button
                    onClick={() => setShowBrokerConnect(true)}
                    className="text-[11px] text-[#00D9FF] font-medium"
                  >
                    + Add More
                  </button>
                </div>
                <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
                  {connectedBrokers.map(b => (
                    <div key={b.id} className="flex-shrink-0 rounded-xl bg-[#1A2332]/90 border border-white/10 px-3 py-2 flex items-center gap-2">
                      <span className="text-lg">{b.icon}</span>
                      <div>
                        <p className="text-[11px] font-semibold text-white">{b.name}</p>
                        <p className="text-[10px] text-slate-500">Connected</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Filters */}
              <section className="px-1">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowFilterMenu(!showFilterMenu)}
                    className={`h-8 px-3 rounded-full text-[11px] font-semibold inline-flex items-center gap-1.5 border transition-all ${
                      showFilterMenu || selectedBrokerFilter || selectedSectorFilter
                        ? 'bg-[#00D9FF]/20 text-[#00D9FF] border-[#00D9FF]/30'
                        : 'bg-[#1A2332] text-slate-400 border-white/10'
                    }`}
                  >
                    <Filter className="w-3.5 h-3.5" />
                    Filters
                    {(selectedBrokerFilter || selectedSectorFilter) && (
                      <span className="w-4 h-4 rounded-full bg-[#00D9FF] text-[#0A0E1A] text-[9px] flex items-center justify-center font-bold">
                        {(selectedBrokerFilter ? 1 : 0) + (selectedSectorFilter ? 1 : 0)}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => setPortfolioFilter(portfolioFilter === 'performance' ? 'all' : 'performance')}
                    className={`h-8 px-3 rounded-full text-[11px] font-semibold inline-flex items-center gap-1.5 border transition-all ${
                      portfolioFilter === 'performance'
                        ? 'bg-[#00D9FF]/20 text-[#00D9FF] border-[#00D9FF]/30'
                        : 'bg-[#1A2332] text-slate-400 border-white/10'
                    }`}
                  >
                    <BarChart3 className="w-3.5 h-3.5" />
                    By P&L
                  </button>
                  <button
                    onClick={() => { setShowOptimizer(true); setOptimizeResult(null) }}
                    className="h-8 px-3 rounded-full text-[11px] font-semibold inline-flex items-center gap-1.5 bg-gradient-to-r from-purple-500/20 to-[#00D9FF]/20 border border-purple-500/30 text-purple-300 ml-auto"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Optimize
                  </button>
                </div>

                {/* Filter Dropdowns */}
                {showFilterMenu && (
                  <div className="mt-2 rounded-2xl bg-[#1A2332]/95 border border-white/10 p-3 space-y-3">
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                        <Building2 className="w-3 h-3" /> Brokerage
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          onClick={() => setSelectedBrokerFilter(null)}
                          className={`h-7 px-2.5 rounded-full text-[10px] font-medium border transition-all ${
                            !selectedBrokerFilter ? 'bg-[#00D9FF]/20 text-[#00D9FF] border-[#00D9FF]/30' : 'text-slate-400 border-white/10'
                          }`}
                        >
                          All
                        </button>
                        {brokerNames.map(bn => (
                          <button
                            key={bn}
                            onClick={() => setSelectedBrokerFilter(selectedBrokerFilter === bn ? null : bn)}
                            className={`h-7 px-2.5 rounded-full text-[10px] font-medium border transition-all ${
                              selectedBrokerFilter === bn ? 'bg-[#00D9FF]/20 text-[#00D9FF] border-[#00D9FF]/30' : 'text-slate-400 border-white/10'
                            }`}
                          >
                            {bn}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                        <Layers className="w-3 h-3" /> Sector
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          onClick={() => setSelectedSectorFilter(null)}
                          className={`h-7 px-2.5 rounded-full text-[10px] font-medium border transition-all ${
                            !selectedSectorFilter ? 'bg-[#00D9FF]/20 text-[#00D9FF] border-[#00D9FF]/30' : 'text-slate-400 border-white/10'
                          }`}
                        >
                          All
                        </button>
                        {sectors.map(s => (
                          <button
                            key={s}
                            onClick={() => setSelectedSectorFilter(selectedSectorFilter === s ? null : s)}
                            className={`h-7 px-2.5 rounded-full text-[10px] font-medium border transition-all ${
                              selectedSectorFilter === s ? 'bg-[#00D9FF]/20 text-[#00D9FF] border-[#00D9FF]/30' : 'text-slate-400 border-white/10'
                            }`}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                    {(selectedBrokerFilter || selectedSectorFilter) && (
                      <button
                        onClick={() => { setSelectedBrokerFilter(null); setSelectedSectorFilter(null) }}
                        className="text-[10px] text-red-400 font-medium flex items-center gap-1"
                      >
                        <X className="w-3 h-3" /> Clear all filters
                      </button>
                    )}
                  </div>
                )}
              </section>

              {/* Holdings List */}
              <section className="px-1 space-y-2">
                {holdings.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-700 p-6 text-center">
                    <Briefcase className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                    <p className="text-[13px] text-slate-300">No holdings imported yet</p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Holdings will appear here once broker integration is live.
                    </p>
                    <p className="text-[10px] text-slate-600 mt-2">
                      Connected: {connectedBrokers.map(b => b.name).join(', ')}
                    </p>
                  </div>
                ) : (
                  filteredHoldings.map(h => {
                    const isUp = h.pnlPercent >= 0
                    return (
                      <div key={h.symbol} className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-4">
                        <div className="flex items-center justify-between">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Link href={`/research?symbol=${encodeURIComponent(h.symbol)}`} className="text-[15px] font-semibold text-white">
                                {h.symbol}
                              </Link>
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/5 text-slate-500 border border-white/5">
                                {h.sector}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 truncate max-w-[200px]">{h.name}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[14px] font-mono text-white">${h.currentPrice.toFixed(2)}</p>
                            <p className={`text-[11px] font-mono ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                              {isUp ? '+' : ''}{h.pnlPercent.toFixed(2)}%
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5">
                          <div className="flex items-center gap-3 text-[10px] text-slate-500">
                            <span>{h.shares} shares</span>
                            <span>Avg ${h.avgCost.toFixed(2)}</span>
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5">{h.broker}</span>
                          </div>
                          <p className={`text-[11px] font-mono font-semibold ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                            {isUp ? '+' : ''}${h.pnl.toFixed(0)}
                          </p>
                        </div>
                      </div>
                    )
                  })
                )}
              </section>
            </>
          )}
        </>
      )}

      {/* ─── BROKER CONNECT MODAL ─── */}
      {showBrokerConnect && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end"
          onClick={(e) => { if (e.target === e.currentTarget) setShowBrokerConnect(false) }}
        >
          <div className="w-full max-w-md mx-auto rounded-t-3xl bg-[#0A0E1A]/95 border-t border-white/10 pb-safe animate-slide-in-bottom">
            <div className="px-4 pt-3 pb-2">
              <div className="mx-auto h-1 w-10 rounded-full bg-slate-600 mb-3" />
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">Connect Brokerage</h3>
                  <p className="text-[11px] text-slate-400">Link your accounts to import holdings.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowBrokerConnect(false)}
                  className="h-8 w-8 rounded-full bg-[#1A2332] border border-white/10 text-slate-300 flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="px-4 pb-4 max-h-[60vh] overflow-y-auto scrollbar-hide space-y-2">
              {brokers.map(b => (
                <div key={b.id} className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{b.icon}</span>
                    <div>
                      <p className="text-[13px] font-semibold text-white">{b.name}</p>
                      {b.connected && (
                        <p className="text-[10px] text-emerald-400">Connected</p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleConnectBroker(b.id)}
                    className={`h-8 px-3 rounded-full text-[11px] font-semibold inline-flex items-center gap-1.5 active:scale-95 ${
                      b.connected
                        ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                        : 'bg-[#00D9FF]/10 text-[#00D9FF] border border-[#00D9FF]/30'
                    }`}
                  >
                    {b.connected ? (
                      <><Unlink className="w-3 h-3" /> Disconnect</>
                    ) : (
                      <><Link2 className="w-3 h-3" /> Connect</>
                    )}
                  </button>
                </div>
              ))}
              <div className="rounded-2xl border border-dashed border-slate-700 p-3 text-center">
                <p className="text-[11px] text-slate-500">More brokerages coming soon</p>
                <p className="text-[10px] text-slate-600 mt-0.5">Merrill Lynch, Ally Invest, SoFi, and more</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── PORTFOLIO OPTIMIZER MODAL ─── */}
      {showOptimizer && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end"
          onClick={(e) => { if (e.target === e.currentTarget) setShowOptimizer(false) }}
        >
          <div className="w-full max-w-md mx-auto rounded-t-3xl bg-[#0A0E1A]/95 border-t border-white/10 pb-safe animate-slide-in-bottom max-h-[85vh] overflow-y-auto">
            <div className="px-4 pt-3 pb-2 sticky top-0 bg-[#0A0E1A]/95 z-10">
              <div className="mx-auto h-1 w-10 rounded-full bg-slate-600 mb-3" />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-500/20 to-[#00D9FF]/20 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-purple-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Portfolio Optimizer</h3>
                    <p className="text-[10px] text-slate-400">AI-powered portfolio analysis</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowOptimizer(false)}
                  className="h-8 w-8 rounded-full bg-[#1A2332] border border-white/10 text-slate-300 flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="px-4 pb-4">
              <div className="space-y-4 mt-3">
                <div className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-4">
                  <h4 className="text-[12px] font-semibold text-white mb-2">What the optimizer does</h4>
                  <ul className="space-y-2 text-[11px] text-slate-400">
                    <li className="flex items-start gap-2">
                      <PieChart className="w-3.5 h-3.5 text-[#00D9FF] mt-0.5 flex-shrink-0" />
                      Analyzes sector diversification & concentration risk
                    </li>
                    <li className="flex items-start gap-2">
                      <BarChart3 className="w-3.5 h-3.5 text-purple-400 mt-0.5 flex-shrink-0" />
                      Evaluates risk-adjusted returns & portfolio beta
                    </li>
                    <li className="flex items-start gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                      Suggests rebalancing moves for better performance
                    </li>
                    <li className="flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                      Identifies tax-loss harvesting opportunities
                    </li>
                  </ul>
                </div>

                {holdings.length === 0 ? (
                  <div className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-5 text-center">
                    <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
                    <p className="text-[13px] text-white font-medium">No holdings to optimize</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Connect a brokerage and import holdings to run portfolio optimization.
                    </p>
                  </div>
                ) : (
                  <button
                    onClick={handleOptimize}
                    disabled={optimizing}
                    className="w-full h-11 rounded-full bg-gradient-to-r from-purple-500 to-[#00D9FF] text-white font-semibold text-[13px] inline-flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
                  >
                    {optimizing ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing...</>
                    ) : (
                      <><Sparkles className="w-4 h-4" /> Run Optimization Analysis</>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── ADD SYMBOL MODAL ─── */}
      {showAdd && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end md:hidden"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAdd(false)
          }}
        >
          <div className="w-full max-w-md mx-auto rounded-t-3xl bg-[#0A0E1A]/95 border-t border-white/10 pb-safe animate-slide-in-bottom">
            <div className="px-4 pt-3 pb-2">
              <div className="mx-auto h-1 w-10 rounded-full bg-slate-600 mb-3" />
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">Add to Watchlist</h3>
                  <p className="text-[11px] text-slate-400">Search tickers or company names.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="h-8 w-8 rounded-full bg-[#1A2332] border border-white/10 text-slate-300 flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="relative mt-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  value={addQuery}
                  onChange={(e) => setAddQuery(e.target.value)}
                  placeholder="e.g. NVDA, Booking, Tesla..."
                  className="w-full h-10 rounded-full bg-[#1A2332] border border-white/10 pl-9 pr-3 text-[13px] text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-[#00D9FF]/60"
                  autoFocus
                />
              </div>
            </div>

            <div className="px-4 pb-4 max-h-[55vh] overflow-y-auto scrollbar-hide">
              {searching && (
                <div className="py-6 text-center text-[11px] text-slate-500">
                  Searching…
                </div>
              )}
              {!searching && addQuery.trim() && searchResults.length === 0 && (
                <div className="py-6 text-center text-[11px] text-slate-500">
                  No matches. Try a different query.
                </div>
              )}
              <div className="space-y-2">
                {searchResults.map((r) => {
                  const disabled =
                    addMutation.isPending || items.some((i) => i.symbol === r.symbol)
                  return (
                    <button
                      key={r.symbol}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        addMutation.mutate(r.symbol)
                        setShowAdd(false)
                        setAddQuery('')
                      }}
                      className="w-full rounded-2xl bg-[#1A2332]/90 border border-white/10 p-3 text-left active:scale-[0.98] disabled:opacity-60"
                    >
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-white">{r.symbol}</p>
                          <p className="text-[11px] text-slate-500 truncate">{r.name}</p>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#00D9FF]/10 text-[#00D9FF] border border-[#00D9FF]/30">
                          Add
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>

              {addMutation.isPending && (
                <div className="mt-3 text-[11px] text-slate-500 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Adding…
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
