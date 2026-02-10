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

export default function MobileWatchlist() {
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const queryClient = useQueryClient()

  const [filter, setFilter] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [addQuery, setAddQuery] = useState('')

  const { data: items = [], isLoading } = useQuery<WatchlistItem[]>({
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
    <div className="space-y-4 pb-4">
      <header className="sticky top-0 z-30 bg-[#0A0E1A]/95 backdrop-blur-xl border-b border-white/10 pt-safe pb-2 px-1 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Watchlist</h1>
          <p className="text-[11px] text-slate-400">
            {items.length} symbols • quotes refresh every 10s
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="h-9 px-3 rounded-full bg-[#00D9FF] text-[#0A0E1A] text-[12px] font-semibold inline-flex items-center gap-2 active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          Add
        </button>
      </header>

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

      <section className="px-1 space-y-2">
        {(isLoading || quotesLoading) &&
          Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-20 rounded-2xl bg-[#1A2332]/80 border border-white/10 animate-pulse"
            />
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
                    <p
                      className={`text-[11px] font-mono ${
                        isUp ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
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

      {/* Add modal (bottom sheet) */}
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
                  className="h-8 w-8 rounded-full bg-[#1A2332] border border-white/10 text-slate-300"
                >
                  ✕
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

