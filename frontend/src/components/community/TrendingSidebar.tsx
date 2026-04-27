'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  TrendingUp,
  Users,
  Flame,
  BarChart3,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  BookOpen,
  HelpCircle,
  FileText,
  Loader2,
} from 'lucide-react'
import {
  fetchCommunities,
  fetchTrendingTickers,
  fetchMarketMood,
  fetchQuote,
  joinCommunity,
  leaveCommunity,
  type Community,
  type QuoteData,
} from '@/lib/api'

interface TrendingTicker {
  symbol: string
  mention_count: number
}

// Fallback popular tickers when API returns empty
const FALLBACK_TICKERS = ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN', 'GOOGL', 'META', 'SPY']

export default function TrendingSidebar() {
  const [tickers, setTickers] = useState<TrendingTicker[]>([])
  const [tickerQuotes, setTickerQuotes] = useState<Record<string, QuoteData>>({})
  const [loading, setLoading] = useState(true)
  const [popularCommunities, setPopularCommunities] = useState<Community[]>([])
  const [joiningSlug, setJoiningSlug] = useState<string | null>(null)
  const [mood, setMood] = useState<{
    mood: string
    bullish_pct: number
    bearish_pct: number
    total_posts: number
  } | null>(null)
  const quoteFetchedRef = useRef<Set<string>>(new Set())

  const fetchQuotesForSymbols = useCallback(async (symbols: string[]) => {
    const newSymbols = symbols.filter((s) => !quoteFetchedRef.current.has(s))
    if (newSymbols.length === 0) return

    newSymbols.forEach((s) => quoteFetchedRef.current.add(s))
    const quotes = await Promise.all(
      newSymbols.map((s) => fetchQuote(s, 'normal').catch(() => null))
    )
    setTickerQuotes((prev) => {
      const next = { ...prev }
      newSymbols.forEach((s, i) => {
        if (quotes[i]) next[s] = quotes[i]!
      })
      return next
    })
  }, [])

  const loadTrending = useCallback(async () => {
    try {
      const data = await fetchTrendingTickers(24, 10)
      const fetched = data.tickers || []

      if (fetched.length > 0) {
        setTickers(fetched)
        await fetchQuotesForSymbols(fetched.map((t) => t.symbol))
      } else {
        // Use fallback tickers when no community mentions exist
        const fallbackTickers = FALLBACK_TICKERS.map((s) => ({
          symbol: s,
          mention_count: 0,
        }))
        setTickers(fallbackTickers)
        await fetchQuotesForSymbols(FALLBACK_TICKERS)
      }
    } catch {
      // On error, use fallback tickers
      const fallbackTickers = FALLBACK_TICKERS.map((s) => ({
        symbol: s,
        mention_count: 0,
      }))
      setTickers(fallbackTickers)
      await fetchQuotesForSymbols(FALLBACK_TICKERS)
    } finally {
      setLoading(false)
    }
  }, [fetchQuotesForSymbols])

  useEffect(() => {
    loadTrending()
    const interval = setInterval(loadTrending, 60_000)
    return () => clearInterval(interval)
  }, [loadTrending])

  useEffect(() => {
    fetchMarketMood(24)
      .then((data) => {
        if (data) setMood(data)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchCommunities()
      .then((data) => {
        const sorted = (data.communities || []).sort(
          (a, b) => b.member_count - a.member_count
        )
        setPopularCommunities(sorted.slice(0, 5))
      })
      .catch(() => setPopularCommunities([]))
  }, [])

  const handleJoinLeave = useCallback(async (community: Community) => {
    setJoiningSlug(community.slug)
    try {
      if (community.is_member) {
        const ok = await leaveCommunity(community.slug)
        if (ok) {
          setPopularCommunities((prev) =>
            prev.map((c) =>
              c.slug === community.slug
                ? { ...c, is_member: false, member_count: Math.max(0, c.member_count - 1) }
                : c
            )
          )
        }
      } else {
        const ok = await joinCommunity(community.slug)
        if (ok) {
          setPopularCommunities((prev) =>
            prev.map((c) =>
              c.slug === community.slug
                ? { ...c, is_member: true, member_count: c.member_count + 1 }
                : c
            )
          )
        }
      }
    } catch {
      // silent
    } finally {
      setJoiningSlug(null)
    }
  }, [])

  return (
    <div className="space-y-3 pl-1">
      {/* Market Mood */}
      {mood && mood.total_posts > 0 && (
        <div className="bg-surface-raised rounded-xl border border-line-subtle overflow-hidden">
          <div className="px-4 py-3 border-b border-line-subtle bg-gradient-to-r from-purple-500/5 to-transparent">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-purple-400" />
              <h3 className="text-xs font-semibold text-fg-secondary uppercase tracking-wider">
                Market Mood
              </h3>
            </div>
          </div>
          <div className="p-4">
            <div className="text-center mb-3">
              <span
                className={`text-lg font-bold ${
                  mood.mood === 'bullish'
                    ? 'text-emerald-400'
                    : mood.mood === 'bearish'
                      ? 'text-red-400'
                      : 'text-fg-muted'
                }`}
              >
                {mood.mood === 'bullish'
                  ? 'Bullish'
                  : mood.mood === 'bearish'
                    ? 'Bearish'
                    : 'Neutral'}
              </span>
            </div>
            <div className="flex h-2 rounded-full overflow-hidden bg-surface-raised mb-2">
              <motion.div
                className="bg-emerald-500"
                initial={{ width: 0 }}
                animate={{ width: `${mood.bullish_pct}%` }}
                transition={{ duration: 0.8 }}
              />
              <motion.div
                className="bg-red-500"
                initial={{ width: 0 }}
                animate={{ width: `${mood.bearish_pct}%` }}
                transition={{ duration: 0.8, delay: 0.1 }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-fg-muted">
              <span className="text-emerald-400/70">Bullish {mood.bullish_pct}%</span>
              <span>{mood.total_posts} posts analyzed</span>
              <span className="text-red-400/70">Bearish {mood.bearish_pct}%</span>
            </div>
          </div>
        </div>
      )}

      {/* Trending Tickers */}
      <div className="bg-surface-raised rounded-xl border border-line-subtle overflow-hidden">
        <div className="px-4 py-3 border-b border-line-subtle bg-gradient-to-r from-orange-500/5 to-transparent">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-orange-400" />
            <h3 className="text-xs font-semibold text-fg-secondary uppercase tracking-wider">
              Trending Tickers
            </h3>
          </div>
        </div>
        <div className="p-2">
          {loading ? (
            <div className="space-y-1 p-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 bg-surface-raised rounded animate-pulse" />
                    <div className="h-4 w-12 bg-surface-raised rounded animate-pulse" />
                  </div>
                  <div className="h-4 w-16 bg-surface-raised/50 rounded animate-pulse" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-0">
              {tickers.map((ticker, i) => {
                const quote = tickerQuotes[ticker.symbol]
                const isPositive = quote && quote.change_percent > 0
                const isNegative = quote && quote.change_percent < 0
                return (
                  <Link
                    key={ticker.symbol}
                    href={`/research?symbol=${ticker.symbol}`}
                    className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-surface-hover transition-colors group"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-[10px] text-fg-muted w-4 text-right tabular-nums font-medium">
                        {i + 1}
                      </span>
                      <div>
                        <span className="text-sm font-mono font-semibold text-cyan-400 group-hover:text-cyan-300 transition-colors">
                          ${ticker.symbol}
                        </span>
                        {ticker.mention_count > 0 && (
                          <span className="text-[10px] text-fg-muted ml-1.5">
                            {ticker.mention_count}{' '}
                            {ticker.mention_count === 1 ? 'mention' : 'mentions'}
                          </span>
                        )}
                      </div>
                    </div>
                    {quote && quote.price > 0 ? (
                      <div className="text-right flex items-center gap-1.5">
                        <div>
                          <div className="text-[11px] text-fg-secondary tabular-nums font-medium">
                            ${quote.price.toFixed(2)}
                          </div>
                          <div
                            className={`text-[10px] tabular-nums font-medium flex items-center gap-0.5 justify-end ${
                              isPositive
                                ? 'text-emerald-400'
                                : isNegative
                                  ? 'text-red-400'
                                  : 'text-fg-muted'
                            }`}
                          >
                            {isPositive ? (
                              <ArrowUpRight className="w-3 h-3" />
                            ) : isNegative ? (
                              <ArrowDownRight className="w-3 h-3" />
                            ) : (
                              <Minus className="w-3 h-3" />
                            )}
                            {quote.change_percent >= 0 ? '+' : ''}
                            {quote.change_percent.toFixed(2)}%
                          </div>
                        </div>
                      </div>
                    ) : (
                      <span className="text-[11px] text-fg-muted tabular-nums">--</span>
                    )}
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Popular Communities */}
      {popularCommunities.length > 0 && (
        <div className="bg-surface-raised rounded-xl border border-line-subtle overflow-hidden">
          <div className="px-4 py-3 border-b border-line-subtle bg-gradient-to-r from-blue-500/5 to-transparent">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-400" />
              <h3 className="text-xs font-semibold text-fg-secondary uppercase tracking-wider">
                Popular Communities
              </h3>
            </div>
          </div>
          <div className="p-2">
            {popularCommunities.map((community) => (
              <div
                key={community.slug}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-surface-hover transition-colors group"
              >
                <Link
                  href={`/community/${community.slug}`}
                  className="flex items-center gap-2.5 flex-1 min-w-0"
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center text-xs font-bold text-blue-400 shrink-0">
                    {community.icon || community.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-fg-secondary truncate group-hover:text-fg-primary transition-colors">
                      c/{community.name}
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-fg-muted">
                      <Users className="w-2.5 h-2.5" />
                      {community.member_count.toLocaleString()} members
                    </div>
                  </div>
                </Link>
                <button
                  onClick={() => handleJoinLeave(community)}
                  disabled={joiningSlug === community.slug}
                  className={`shrink-0 px-2.5 py-1 text-[10px] font-semibold rounded-full border transition-all duration-150 disabled:opacity-50 ${
                    community.is_member
                      ? 'border-line-default text-fg-muted hover:border-red-500/40 hover:text-red-400 hover:bg-red-500/10'
                      : 'border-blue-500/30 text-blue-400 hover:bg-blue-500/10'
                  }`}
                >
                  {joiningSlug === community.slug ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : community.is_member ? (
                    'Joined'
                  ) : (
                    'Join'
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Links */}
      <div className="bg-surface-raised rounded-xl border border-line-subtle overflow-hidden">
        <div className="px-4 py-3 border-b border-line-subtle">
          <h3 className="text-xs font-semibold text-fg-secondary uppercase tracking-wider">
            Quick Links
          </h3>
        </div>
        <div className="p-3 space-y-0.5">
          <Link
            href="/community/discover"
            className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-[13px] text-fg-muted hover:text-fg-secondary hover:bg-surface-hover transition-colors"
          >
            <BookOpen className="w-4 h-4 text-fg-muted" />
            Discover Communities
          </Link>
          <Link
            href="/research"
            className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-[13px] text-fg-muted hover:text-fg-secondary hover:bg-surface-hover transition-colors"
          >
            <BarChart3 className="w-4 h-4 text-fg-muted" />
            Research Hub
          </Link>
          <Link
            href="/help"
            className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-[13px] text-fg-muted hover:text-fg-secondary hover:bg-surface-hover transition-colors"
          >
            <HelpCircle className="w-4 h-4 text-fg-muted" />
            Help Center
          </Link>
          <Link
            href="/about"
            className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-[13px] text-fg-muted hover:text-fg-secondary hover:bg-surface-hover transition-colors"
          >
            <FileText className="w-4 h-4 text-fg-muted" />
            About QuantTrade
          </Link>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="px-3 py-2">
        <p className="text-[10px] text-fg-muted leading-relaxed">
          Community discussion only. Not financial advice. Always do your own research before making investment decisions.
        </p>
      </div>
    </div>
  )
}
