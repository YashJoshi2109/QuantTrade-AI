'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { TrendingUp, Users, Flame, BarChart3, Activity } from 'lucide-react'
import { fetchCommunities, fetchTrendingTickers, fetchMarketMood, type Community } from '@/lib/api'

interface TrendingTicker {
  symbol: string
  mention_count: number
}

export default function TrendingSidebar() {
  const [tickers, setTickers] = useState<TrendingTicker[]>([])
  const [loading, setLoading] = useState(true)
  const [popularCommunities, setPopularCommunities] = useState<Community[]>([])
  const [mood, setMood] = useState<{ mood: string; bullish_pct: number; bearish_pct: number; total_posts: number } | null>(null)

  const loadTrending = useCallback(async () => {
    try {
      const data = await fetchTrendingTickers(24, 10)
      setTickers(data.tickers || [])
    } catch {
      // keep existing data on error
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTrending()
    // Poll every 60 seconds
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
        setPopularCommunities(sorted.slice(0, 5))
      })
      .catch(() => setPopularCommunities([]))
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className="space-y-4"
    >
      {/* Market Mood */}
      {mood && mood.total_posts > 0 && (
        <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
              Market Mood
            </h3>
          </div>
          <div className="text-center mb-3">
            <span className={`text-2xl font-bold ${
              mood.mood === 'bullish' ? 'text-emerald-400' :
              mood.mood === 'bearish' ? 'text-red-400' : 'text-slate-400'
            }`}>
              {mood.mood === 'bullish' ? '\u{1F7E2} Bullish' : mood.mood === 'bearish' ? '\u{1F534} Bearish' : '\u26AA Neutral'}
            </span>
          </div>
          {/* Sentiment bar */}
          <div className="flex h-2 rounded-full overflow-hidden bg-slate-800 mb-2">
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
      <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Flame className="w-4 h-4 text-orange-400" />
          <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
            Trending Tickers
          </h3>
        </div>
        {loading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center justify-between px-2 py-2">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-12 bg-slate-800 rounded animate-pulse" />
                  <div className="h-3 w-16 bg-slate-800/50 rounded animate-pulse" />
                </div>
                <div className="h-4 w-8 bg-slate-800 rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : tickers.length === 0 ? (
          <div className="flex flex-col items-center py-4 text-center">
            <BarChart3 className="w-8 h-8 text-slate-600 mb-2" />
            <p className="text-xs text-slate-500">No trending tickers yet</p>
            <p className="text-xs text-slate-600 mt-1">Post about stocks to see them here</p>
          </div>
        ) : (
          <div className="space-y-1">
            {tickers.map((ticker, i) => (
              <Link
                key={ticker.symbol}
                href={`/research?symbol=${ticker.symbol}`}
                className="flex items-center justify-between px-2 py-2 rounded-lg hover:bg-white/[0.03] transition-colors group"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-600 w-4 text-right tabular-nums font-medium">
                    {i + 1}
                  </span>
                  <span className="text-sm font-mono font-semibold text-cyan-400 group-hover:text-cyan-300">
                    ${ticker.symbol}
                  </span>
                </div>
                <span className="text-xs text-slate-500 tabular-nums">
                  {ticker.mention_count} {ticker.mention_count === 1 ? 'mention' : 'mentions'}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Popular Communities */}
      {popularCommunities.length > 0 && (
        <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
              Popular Communities
            </h3>
          </div>
          <div className="space-y-1">
            {popularCommunities.map((community, i) => (
              <Link
                key={community.slug}
                href={`/community/${community.slug}`}
                className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-white/[0.03] transition-colors"
              >
                <span className="text-xs text-slate-600 w-4 text-right tabular-nums font-medium">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-300 truncate">{community.name}</div>
                </div>
                <div className="flex items-center gap-1 text-xs text-slate-500">
                  <Users className="w-3 h-3" />
                  <span>{community.member_count.toLocaleString()}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Quick Links */}
      <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-4">
        <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-3">
          Quick Links
        </h3>
        <div className="space-y-1.5 text-sm">
          <Link href="/community/discover" className="block text-slate-400 hover:text-slate-200 transition-colors">
            Discover Communities
          </Link>
          <Link href="/community" className="block text-slate-400 hover:text-slate-200 transition-colors">
            Community Feed
          </Link>
          <Link href="/help" className="block text-slate-400 hover:text-slate-200 transition-colors">
            Help Center
          </Link>
        </div>
      </div>
    </motion.div>
  )
}
