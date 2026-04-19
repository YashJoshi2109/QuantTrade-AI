'use client'

import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search,
  Users,
  MessageSquare,
  TrendingUp,
  Clock,
  Flame,
  Loader2,
  Hash,
  ChevronLeft,
} from 'lucide-react'
import Link from 'next/link'
import {
  fetchCommunities,
  joinCommunity,
  leaveCommunity,
  type Community,
} from '@/lib/api'

type Category = 'all' | 'stocks' | 'options' | 'crypto' | 'forex' | 'macro' | 'education'
type SortKey = 'popular' | 'new' | 'active'

const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'stocks', label: 'Stocks' },
  { key: 'options', label: 'Options' },
  { key: 'crypto', label: 'Crypto' },
  { key: 'forex', label: 'Forex' },
  { key: 'macro', label: 'Macro' },
  { key: 'education', label: 'Education' },
]

const SORT_OPTIONS: { key: SortKey; label: string; icon: typeof Flame }[] = [
  { key: 'popular', label: 'Popular', icon: Flame },
  { key: 'new', label: 'New', icon: Clock },
  { key: 'active', label: 'Active', icon: TrendingUp },
]

const CATEGORY_COLORS: Record<string, string> = {
  stocks: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  options: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  crypto: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  forex: 'bg-green-500/15 text-green-400 border-green-500/30',
  macro: 'bg-red-500/15 text-red-400 border-red-500/30',
  education: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
}

function getCategoryColor(category: string) {
  return CATEGORY_COLORS[category.toLowerCase()] || 'bg-slate-500/15 text-slate-400 border-slate-500/30'
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export default function DiscoverPage() {
  const [communities, setCommunities] = useState<Community[]>([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState<Category>('all')
  const [sortKey, setSortKey] = useState<SortKey>('popular')
  const [search, setSearch] = useState('')
  const [joiningSlug, setJoiningSlug] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    const cat = category === 'all' ? undefined : category
    fetchCommunities(cat)
      .then((d) => setCommunities(d.communities || []))
      .catch(() => setCommunities([]))
      .finally(() => setLoading(false))
  }, [category])

  const filtered = useMemo(() => {
    let list = [...communities]

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.description?.toLowerCase().includes(q) ||
          c.ticker_focus?.toLowerCase().includes(q)
      )
    }

    // Sort
    switch (sortKey) {
      case 'popular':
        list.sort((a, b) => (b.member_count ?? 0) - (a.member_count ?? 0))
        break
      case 'new':
        list.sort((a, b) => {
          const da = a.created_at ? new Date(a.created_at).getTime() : 0
          const db = b.created_at ? new Date(b.created_at).getTime() : 0
          return db - da
        })
        break
      case 'active':
        list.sort((a, b) => (b.post_count ?? 0) - (a.post_count ?? 0))
        break
    }

    return list
  }, [communities, search, sortKey])

  const handleToggleMembership = async (community: Community) => {
    setJoiningSlug(community.slug)
    const wasMember = community.is_member

    // Optimistic update
    setCommunities((prev) =>
      prev.map((c) =>
        c.slug === community.slug
          ? {
              ...c,
              is_member: !wasMember,
              member_count: c.member_count + (wasMember ? -1 : 1),
            }
          : c
      )
    )

    try {
      const ok = wasMember
        ? await leaveCommunity(community.slug)
        : await joinCommunity(community.slug)

      if (!ok) {
        // Revert on failure
        setCommunities((prev) =>
          prev.map((c) =>
            c.slug === community.slug
              ? {
                  ...c,
                  is_member: wasMember,
                  member_count: c.member_count + (wasMember ? 1 : -1),
                }
              : c
          )
        )
      }
    } catch {
      // Revert on error
      setCommunities((prev) =>
        prev.map((c) =>
          c.slug === community.slug
            ? {
                ...c,
                is_member: wasMember,
                member_count: c.member_count + (wasMember ? 1 : -1),
              }
            : c
        )
      )
    } finally {
      setJoiningSlug(null)
    }
  }

  return (
    <div className="min-h-screen pb-safe">
      <div className="max-w-[1200px] mx-auto px-3 sm:px-6 py-4 sm:py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link
            href="/community"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.05] transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-100">Discover Communities</h1>
            <p className="text-sm text-slate-500 mt-1">
              Find communities that match your trading interests
            </p>
          </div>
        </div>

        {/* Search + Sort Row */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search communities..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[#0D1117] border border-white/[0.06] rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500/40 transition-colors"
            />
          </div>
          <div className="flex gap-1 bg-[#0D1117] border border-white/[0.06] rounded-xl p-1">
            {SORT_OPTIONS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setSortKey(key)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  sortKey === key
                    ? 'bg-white/[0.06] text-slate-100'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1 scrollbar-hide">
          {CATEGORIES.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setCategory(key)}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors border ${
                category === key
                  ? 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                  : 'bg-[#0D1117] text-slate-400 border-white/[0.06] hover:text-slate-200 hover:border-white/[0.12]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-3 sm:p-5 animate-pulse"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-slate-800 rounded-xl" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-4 w-32 bg-slate-800 rounded" />
                    <div className="h-3 w-16 bg-slate-800 rounded" />
                  </div>
                </div>
                <div className="space-y-1.5 mb-4">
                  <div className="h-3 w-full bg-slate-800 rounded" />
                  <div className="h-3 w-2/3 bg-slate-800 rounded" />
                </div>
                <div className="flex gap-3">
                  <div className="h-4 w-20 bg-slate-800 rounded" />
                  <div className="h-4 w-20 bg-slate-800 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-12 text-center"
          >
            <Search className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-300 mb-2">No communities found</h3>
            <p className="text-sm text-slate-500">
              {search
                ? `No results for "${search}". Try a different search term.`
                : 'No communities in this category yet.'}
            </p>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            <AnimatePresence mode="popLayout">
              {filtered.map((community, i) => (
                <motion.div
                  key={community.slug}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2, delay: i * 0.03 }}
                  className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-3 sm:p-5 hover:border-white/[0.12] transition-colors group"
                >
                  {/* Community Header */}
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border border-white/[0.06] flex items-center justify-center text-lg shrink-0">
                      {community.icon || community.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/community?c=${community.slug}`}
                        className="text-sm font-semibold text-slate-100 hover:text-blue-400 transition-colors truncate block"
                      >
                        c/{community.name}
                      </Link>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium border ${getCategoryColor(
                            community.category
                          )}`}
                        >
                          {community.category}
                        </span>
                        {community.ticker_focus && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-mono font-medium bg-white/[0.04] text-slate-300 border border-white/[0.06]">
                            <Hash className="w-2.5 h-2.5" />
                            {community.ticker_focus}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Description */}
                  <p className="text-xs text-slate-400 leading-relaxed mb-4 line-clamp-2">
                    {community.description || 'A community for traders to share ideas and analysis.'}
                  </p>

                  {/* Stats Row */}
                  <div className="flex items-center gap-4 mb-4 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" />
                      {formatCount(community.member_count)} members
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageSquare className="w-3.5 h-3.5" />
                      {formatCount(community.post_count ?? 0)} posts
                    </span>
                  </div>

                  {/* Join / Leave Button */}
                  <button
                    onClick={() => handleToggleMembership(community)}
                    disabled={joiningSlug === community.slug}
                    className={`w-full py-2.5 sm:py-2 rounded-lg text-xs font-medium transition-all border min-h-[44px] sm:min-h-0 ${
                      community.is_member
                        ? 'bg-white/[0.04] text-slate-300 border-white/[0.08] hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30'
                        : 'bg-blue-500/15 text-blue-400 border-blue-500/30 hover:bg-blue-500/25'
                    } disabled:opacity-50`}
                  >
                    {joiningSlug === community.slug ? (
                      <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                    ) : community.is_member ? (
                      'Joined'
                    ) : (
                      'Join Community'
                    )}
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </div>
  )
}
