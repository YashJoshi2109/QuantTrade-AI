'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { TrendingUp, Users, Flame } from 'lucide-react'
import { fetchCommunities, type Community } from '@/lib/api'

interface TrendingTicker {
  symbol: string
  price: number
  change_percent: number
  mentions: number
}

// Client-side placeholder until a real trending endpoint exists
const PLACEHOLDER_TICKERS: TrendingTicker[] = [
  { symbol: 'NVDA', price: 875.28, change_percent: 3.42, mentions: 142 },
  { symbol: 'AAPL', price: 198.11, change_percent: -0.87, mentions: 98 },
  { symbol: 'TSLA', price: 241.37, change_percent: 2.15, mentions: 87 },
  { symbol: 'AMD', price: 164.92, change_percent: 1.63, mentions: 73 },
  { symbol: 'SPY', price: 523.45, change_percent: 0.34, mentions: 64 },
]

export default function TrendingSidebar() {
  const [tickers] = useState<TrendingTicker[]>(PLACEHOLDER_TICKERS)
  const [popularCommunities, setPopularCommunities] = useState<Community[]>([])

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
      {/* Trending Tickers */}
      <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Flame className="w-4 h-4 text-orange-400" />
          <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
            Trending Tickers
          </h3>
        </div>
        <div className="space-y-1">
          {tickers.map((ticker) => (
            <Link
              key={ticker.symbol}
              href={`/research?symbol=${ticker.symbol}`}
              className="flex items-center justify-between px-2 py-2 rounded-lg hover:bg-white/[0.03] transition-colors group"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono font-semibold text-cyan-400 group-hover:text-cyan-300">
                  ${ticker.symbol}
                </span>
                <span className="text-xs text-slate-500">{ticker.mentions} posts</span>
              </div>
              <div className="text-right">
                <div className="text-sm text-slate-300 tabular-nums">
                  ${ticker.price.toFixed(2)}
                </div>
                <div className={`text-xs tabular-nums font-medium ${
                  ticker.change_percent >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  {ticker.change_percent >= 0 ? '+' : ''}{ticker.change_percent.toFixed(2)}%
                </div>
              </div>
            </Link>
          ))}
        </div>
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
          <Link href="/community/rules" className="block text-slate-400 hover:text-slate-200 transition-colors">
            Community Guidelines
          </Link>
          <Link href="/community/create" className="block text-slate-400 hover:text-slate-200 transition-colors">
            Create a Community
          </Link>
          <Link href="/help" className="block text-slate-400 hover:text-slate-200 transition-colors">
            Help Center
          </Link>
        </div>
      </div>
    </motion.div>
  )
}
