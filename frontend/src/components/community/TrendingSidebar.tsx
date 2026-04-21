'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { TrendingUp, Users, Flame, BarChart3, Activity } from 'lucide-react'
import { fetchCommunities, fetchTrendingTickers, fetchMarketMood, fetchQuote, type Community, type QuoteData } from '@/lib/api'

interface TrendingTicker {
  symbol: string
  mention_count: number
}

export default function TrendingSidebar() {
  const [tickers, setTickers] = useState<TrendingTicker[]>([])
  const [tickerQuotes, setTickerQuotes] = useState<Record<string, QuoteData>>({})
  const [loading, setLoading] = useState(true)
  const [popularCommunities, setPopularCommunities] = useState<Community[]>([])
  const [mood, setMood] = useState<{ mood: string; bullish_pct: number; bearish_pct: number; total_posts: number } | null>(null)
  const quoteFetchedRef = useRef<Set<string>>(new Set())

  const loadTrending = useCallback(async () => {
    try {
      const data = await fetchTrendingTickers(24, 10)
      const fetched = data.tickers || []
      setTickers(fetched)

      // Fetch quotes for any new tickers we haven't fetched yet
      const newSymbols = fetched
        .map((t) => t.symbol)
        .filter((s) => !quoteFetchedRef.current.has(s))
      if (newSymbols.length > 0) {
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
      }
    } catch {
      // keep existing data on error
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTrending()
    const interval = setInterval(loadTrending, 60_000)
    return () => clearInterval(interval)
  }, [loadTrending])

  useEffect(() => {
    fetchMarketMood(24).then(data => { if (data) setMood(data) }).catch(() => {})
  }, [])

  useEffect(() => {
    fetchCommunities()
      .then((data) => {
        const sorted = (data.communities || []).sort((a, b) => b.member_count - a.member_count)
        setPopularCommunities(sorted.slice(0, 8))
      })
      .catch(() => setPopularCommunities([]))
  }, [])

  return (
    <div className="space-y-4">
      {/* Market Mood */}
      {mood && mood.total_posts > 0 && (
        <div className="bg-[#131820] rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-purple-400" />
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Market Mood
            </h3>
          </div>
          <div className="text-center mb-3">
            <span className={`text-lg font-bold ${
              mood.mood === 'bullish' ? 'text-emerald-400' :
              mood.mood === 'bearish' ? 'text-red-400' : 'text-slate-400'
            }`}>
              {mood.mood === 'bullish' ? '\u{1F7E2} Bullish' : mood.mood === 'bearish' ? '\u{1F534} Bearish' : '\u26AA Neutral'}
            </span>
          </div>
          <div className="flex h-1.5 rounded-full overflow-hidden bg-slate-800 mb-2">
            <div className="bg-emerald-500 transition-all" style={{ width: `${mood.bullish_pct}%` }} />
            <div className="bg-red-500 transition-all" style={{ width: `${mood.bearish_pct}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>Bullish {mood.bullish_pct}%</span>
            <span>{mood.total_posts} posts</span>
            <span>Bearish {mood.bearish_pct}%</span>
          </div>
        </div>
      )}

      {/* Trending Tickers */}
      <div className="bg-[#131820] rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Flame className="w-4 h-4 text-orange-400" />
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
            Trending Tickers
          </h3>
        </div>
        {loading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center justify-between py-1.5">
                <div className="h-4 w-12 bg-slate-800 rounded animate-pulse" />
                <div className="h-3 w-16 bg-slate-800/50 rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : tickers.length === 0 ? (
          <div className="flex flex-col items-center py-4 text-center">
            <BarChart3 className="w-6 h-6 text-slate-700 mb-2" />
            <p className="text-xs text-slate-500">No trending tickers yet</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {tickers.map((ticker, i) => {
              const quote = tickerQuotes[ticker.symbol]
              const changeColor = quote
                ? quote.change_percent > 0
                  ? 'text-emerald-400'
                  : quote.change_percent < 0
                    ? 'text-red-400'
                    : 'text-slate-500'
                : ''
              return (
                <Link
                  key={ticker.symbol}
                  href={`/research?symbol=${ticker.symbol}`}
                  className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors group"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-600 w-3 text-right tabular-nums">
                      {i + 1}
                    </span>
                    <div>
                      <span className="text-sm font-mono font-semibold text-cyan-400 group-hover:text-cyan-300">
                        ${ticker.symbol}
                      </span>
                      <span className="text-[10px] text-slate-600 ml-1.5">
                        {ticker.mention_count} {ticker.mention_count === 1 ? 'mention' : 'mentions'}
                      </span>
                    </div>
                  </div>
                  {quote && quote.price > 0 ? (
                    <div className="text-right">
                      <div className="text-[11px] text-slate-300 tabular-nums font-medium">
                        ${quote.price.toFixed(2)}
                      </div>
                      <div className={`text-[10px] tabular-nums ${changeColor}`}>
                        {quote.change_percent >= 0 ? '+' : ''}{quote.change_percent.toFixed(2)}%
                      </div>
                    </div>
                  ) : (
                    <span className="text-[11px] text-slate-600 tabular-nums">--</span>
                  )}
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {/* Popular Communities */}
      {popularCommunities.length > 0 && (
        <div className="bg-[#131820] rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-blue-400" />
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Popular Communities
            </h3>
          </div>
          <div className="space-y-0.5">
            {popularCommunities.map((community, i) => (
              <Link
                key={community.slug}
                href={`/community/${community.slug}`}
                className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors group"
              >
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center text-[10px] font-bold text-blue-400 shrink-0">
                  {community.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-slate-300 truncate group-hover:text-white transition-colors">
                    c/{community.name}
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-slate-600">
                    <Users className="w-2.5 h-2.5" />
                    {community.member_count.toLocaleString()} members
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Quick Links */}
      <div className="bg-[#131820] rounded-2xl p-4">
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
          Quick Links
        </h3>
        <div className="space-y-1 text-[13px]">
          <Link href="/community/discover" className="block text-slate-400 hover:text-slate-200 transition-colors py-1">
            Discover Communities
          </Link>
          <Link href="/community" className="block text-slate-400 hover:text-slate-200 transition-colors py-1">
            Community Feed
          </Link>
          <Link href="/help" className="block text-slate-400 hover:text-slate-200 transition-colors py-1">
            Help Center
          </Link>
        </div>
      </div>
    </div>
  )
}
