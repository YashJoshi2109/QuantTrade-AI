'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { isStr, oneOf, usePersistentState } from '@/lib/persistentState'
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
  Filter,
  X,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import TickerLogo from '@/components/TickerLogo'
import { GitCompareArrows } from 'lucide-react'
import { compareHref } from '@/lib/compare'
import WatchlistPortfolioPanel from '@/components/portfolio/WatchlistPortfolioPanel'
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

export default function MobileWatchlist() {
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const queryClient = useQueryClient()

  const [filter, setFilter] = usePersistentState('watchlist.mobile.filter', '', { validate: isStr })
  const [showAdd, setShowAdd] = useState(false)
  const [addQuery, setAddQuery] = useState('')
  // View toggle persists per user, shared with the desktop view.
  const [activeTab, setActiveTab] = usePersistentState<ActiveTab>('watchlist.tab', 'watchlist', { version: 1, validate: oneOf(['watchlist', 'portfolio'] as const) })

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

  if (!authLoading && !isAuthenticated) {
    return (
      <div className="space-y-4">
        <header className="sticky top-0 z-30 bg-surface-base/95 backdrop-blur-xl border-b border-line-subtle pt-safe pb-2 px-1">
          <h1 className="text-xl font-semibold text-fg-primary">Watchlist</h1>
          <p className="text-[11px] text-fg-secondary">Save symbols and track them in real time.</p>
        </header>
        <div className="rounded-2xl bg-surface-raised border border-line-subtle p-5 text-center">
          <LogIn className="w-10 h-10 text-[#00D9FF] mx-auto mb-3" />
          <h2 className="text-[15px] font-semibold text-fg-primary">Sign in to use Watchlist</h2>
          <p className="text-[11px] text-fg-secondary mt-1">
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
      <header className="sticky top-0 z-30 bg-surface-base/95 backdrop-blur-xl border-b border-line-subtle pt-safe pb-2 px-1">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-fg-primary">Watchlist</h1>
            <p className="text-[11px] text-fg-secondary">
              {items.length} symbols • quotes refresh every 10s
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { refetch(); queryClient.invalidateQueries({ queryKey: ['watchlist.quotes'] }) }}
              disabled={isLoading}
              className="h-9 w-9 rounded-full bg-surface-raised border border-line-subtle text-fg-secondary flex items-center justify-center active:scale-95 disabled:opacity-50"
              aria-label="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            {items.length >= 2 && (
              <Link
                href={compareHref(items.slice(0, 4).map((w) => w.symbol))}
                className="h-9 w-9 rounded-full bg-surface-raised border border-line-subtle text-fg-secondary flex items-center justify-center active:scale-95"
                aria-label="Compare watchlist symbols"
              >
                <GitCompareArrows className="w-4 h-4" />
              </Link>
            )}
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
        <div className="flex gap-1 mt-3 bg-surface-raised rounded-xl p-1">
          <button
            onClick={() => setActiveTab('watchlist')}
            className={`flex-1 h-8 rounded-lg text-[12px] font-semibold transition-all ${
              activeTab === 'watchlist'
                ? 'bg-[#00D9FF]/20 text-[#00D9FF] border border-[#00D9FF]/30'
                : 'text-fg-secondary'
            }`}
          >
            Watchlist
          </button>
          <button
            onClick={() => setActiveTab('portfolio')}
            className={`flex-1 h-8 rounded-lg text-[12px] font-semibold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'portfolio'
                ? 'bg-[#00D9FF]/20 text-[#00D9FF] border border-[#00D9FF]/30'
                : 'text-fg-secondary'
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
                <div className="rounded-2xl bg-surface-raised border border-line-subtle p-3">
                  <p className="text-[10px] text-fg-muted uppercase tracking-wider">Total Symbols</p>
                  <p className="text-[20px] font-bold text-fg-primary mt-0.5">{quotes.length}</p>
                  <p className="text-[10px] text-fg-secondary">{stats.gainers} up, {stats.losers} down</p>
                </div>
                <div className="rounded-2xl bg-surface-raised border border-line-subtle p-3">
                  <p className="text-[10px] text-fg-muted uppercase tracking-wider">Avg Change</p>
                  <p className={`text-[20px] font-bold mt-0.5 ${stats.avgChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {stats.avgChange >= 0 ? '+' : ''}{stats.avgChange.toFixed(2)}%
                  </p>
                  <p className="text-[10px] text-fg-secondary">Across {quotes.length} symbols</p>
                </div>
                <div className="rounded-2xl bg-surface-raised border border-line-subtle p-3">
                  <p className="text-[10px] text-fg-muted uppercase tracking-wider">Top Gainer</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                    <p className="text-[16px] font-bold text-emerald-400">{stats.topGainer?.symbol || '—'}</p>
                  </div>
                  <p className="text-[10px] text-emerald-400/70">
                    {isNumber(stats.topGainer?.change_percent) ? `+${stats.topGainer!.change_percent.toFixed(2)}%` : '—'}
                  </p>
                </div>
                <div className="rounded-2xl bg-surface-raised border border-line-subtle p-3">
                  <p className="text-[10px] text-fg-muted uppercase tracking-wider">Top Loser</p>
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
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-muted" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search watchlist..."
                aria-label="Search watchlist"
                className="w-full h-10 rounded-full bg-surface-raised border border-line-subtle pl-9 pr-3 text-[13px] text-fg-primary placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-[#00D9FF]/60"
              />
            </div>
          </section>

          {/* Watchlist Cards */}
          <section className="px-1 space-y-2">
            {(isLoading || quotesLoading) &&
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-20 rounded-2xl bg-surface-raised border border-line-subtle animate-pulse" />
              ))}

            {!isLoading && items.length === 0 && (
              <div className="rounded-2xl border border-dashed border-line-default p-6 text-center">
                <p className="text-[13px] text-fg-secondary">No stocks in your watchlist</p>
                <p className="text-[11px] text-fg-muted mt-1">Add your first symbol to begin tracking.</p>
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
                    className="rounded-2xl bg-surface-raised border border-line-subtle p-4 flex items-center justify-between"
                  >
                    <div className="min-w-0 flex items-center gap-3">
                      <TickerLogo symbol={q.symbol} companyName={q.name} size={40} className="shrink-0" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/research?symbol=${encodeURIComponent(q.symbol)}`}
                            className="text-[16px] font-semibold text-fg-primary"
                          >
                            {q.symbol}
                          </Link>
                          <ArrowUpRight className="w-4 h-4 text-fg-muted" />
                        </div>
                        <p className="text-[11px] text-fg-muted truncate max-w-[200px]">
                          {q.name || '—'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-[14px] font-mono text-fg-primary">
                          ${formatNumber(q.price, 2)}
                        </p>
                        <p className={`text-[11px] font-mono ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                          {isUp ? '+' : ''}
                          {formatPercent(q.change_percent, 2)}
                        </p>
                      </div>
                      <Link
                        href={compareHref([q.symbol])}
                        className="h-9 w-9 rounded-full bg-surface-base border border-line-subtle text-fg-secondary flex items-center justify-center active:scale-95"
                        aria-label={`Compare ${q.symbol}`}
                      >
                        <GitCompareArrows className="w-4 h-4" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => removeMutation.mutate(q.symbol)}
                        disabled={removeMutation.isPending}
                        className="h-9 w-9 rounded-full bg-surface-base border border-line-subtle text-fg-secondary flex items-center justify-center active:scale-95 disabled:opacity-60"
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

      {/* ─── PORTFOLIO TAB: summary of the real /portfolio data ─── */}
      {activeTab === 'portfolio' && <WatchlistPortfolioPanel variant="mobile" />}

      {/* ─── ADD SYMBOL MODAL ─── */}
      {showAdd && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end md:hidden"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAdd(false)
          }}
        >
          <div className="w-full max-w-md mx-auto rounded-t-3xl bg-surface-base/95 border-t border-line-subtle pb-safe animate-slide-in-bottom">
            <div className="px-4 pt-3 pb-2">
              <div className="mx-auto h-1 w-10 rounded-full bg-surface-raised mb-3" />
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-fg-primary">Add to Watchlist</h3>
                  <p className="text-[11px] text-fg-secondary">Search tickers or company names.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="h-8 w-8 rounded-full bg-surface-raised border border-line-subtle text-fg-secondary flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="relative mt-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-muted" />
                <input
                  value={addQuery}
                  onChange={(e) => setAddQuery(e.target.value)}
                  placeholder="e.g. NVDA, Booking, Tesla..."
                  className="w-full h-10 rounded-full bg-surface-raised border border-line-subtle pl-9 pr-3 text-[13px] text-fg-primary placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-[#00D9FF]/60"
                  autoFocus
                />
              </div>
            </div>

            <div className="px-4 pb-4 max-h-[55vh] overflow-y-auto scrollbar-hide">
              {searching && (
                <div className="py-6 text-center text-[11px] text-fg-muted">
                  Searching…
                </div>
              )}
              {!searching && addQuery.trim() && searchResults.length === 0 && (
                <div className="py-6 text-center text-[11px] text-fg-muted">
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
                      className="w-full rounded-2xl bg-surface-raised border border-line-subtle p-3 text-left active:scale-[0.98] disabled:opacity-60"
                    >
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-fg-primary">{r.symbol}</p>
                          <p className="text-[11px] text-fg-muted truncate">{r.name}</p>
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
                <div className="mt-3 text-[11px] text-fg-muted flex items-center gap-2">
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
