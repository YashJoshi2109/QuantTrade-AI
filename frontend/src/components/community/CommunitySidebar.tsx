'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus,
  Users,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  Home,
  Flame,
  Compass,
  TrendingUp,
  Bookmark,
  Newspaper,
  Star,
  LogIn,
  LogOut,
} from 'lucide-react'
import { fetchCommunities, joinCommunity, leaveCommunity, type Community } from '@/lib/api'

const NAV_ITEMS = [
  { href: '/community', label: 'Home', icon: Home, exact: true },
  { href: '/community?sort=hot', label: 'Popular', icon: Flame },
  { href: '/community/discover', label: 'Explore', icon: Compass },
  { href: '/community?sort=rising', label: 'Rising', icon: TrendingUp },
]

const RESOURCE_LINKS = [
  { href: '/research', label: 'Research Hub', icon: Newspaper },
  { href: '/monitor', label: 'World Monitor', icon: Star },
]

export default function CommunitySidebar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [communities, setCommunities] = useState<Community[]>([])
  const [loading, setLoading] = useState(true)
  const [showAllMy, setShowAllMy] = useState(false)
  const [showAllDiscover, setShowAllDiscover] = useState(false)
  const [joiningSlug, setJoiningSlug] = useState<string | null>(null)
  const [expandedSections, setExpandedSections] = useState({
    nav: true,
    myCommunities: true,
    discover: true,
    resources: false,
  })

  useEffect(() => {
    fetchCommunities()
      .then((data) => setCommunities(data.communities || []))
      .catch(() => setCommunities([]))
      .finally(() => setLoading(false))
  }, [pathname])

  const myCommunities = communities.filter((c) => c.is_member)
  const suggested = communities.filter((c) => !c.is_member)
  const visibleMy = showAllMy ? myCommunities : myCommunities.slice(0, 7)
  const visibleDiscover = showAllDiscover ? suggested : suggested.slice(0, 5)

  const toggleSection = (key: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleJoinLeave = useCallback(async (community: Community) => {
    setJoiningSlug(community.slug)
    try {
      if (community.is_member) {
        const ok = await leaveCommunity(community.slug)
        if (ok) {
          setCommunities((prev) =>
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
          setCommunities((prev) =>
            prev.map((c) =>
              c.slug === community.slug
                ? { ...c, is_member: true, member_count: c.member_count + 1 }
                : c
            )
          )
        }
      }
    } catch {
      // silent fail
    } finally {
      setJoiningSlug(null)
    }
  }, [])

  return (
    <nav className="space-y-0.5 pr-1">
      {/* Main Navigation */}
      <div className="pb-3 mb-1 border-b border-white/[0.06]">
        {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => {
          const currentSort = searchParams.get('sort')
          const active = exact
            ? pathname === '/community' && !currentSort
            : href.includes('?sort=')
              ? pathname === '/community' && currentSort === href.split('sort=')[1]
              : pathname === href
          return (
            <Link
              key={label}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-150 ${
                active
                  ? 'bg-white/[0.08] text-white font-medium'
                  : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
              }`}
            >
              <Icon className="w-5 h-5 shrink-0" />
              <span>{label}</span>
            </Link>
          )
        })}
      </div>

      {/* Your Communities */}
      <div className="pb-2 mb-1 border-b border-white/[0.06]">
        <button
          onClick={() => toggleSection('myCommunities')}
          className="flex items-center justify-between w-full px-3 py-2 group"
        >
          <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">
            Your Communities
          </h3>
          <div className="flex items-center gap-1">
            <Link
              href="/community/create"
              onClick={(e) => e.stopPropagation()}
              className="p-1 rounded text-slate-600 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
              title="Create Community"
            >
              <Plus className="w-3.5 h-3.5" />
            </Link>
            {expandedSections.myCommunities ? (
              <ChevronUp className="w-3.5 h-3.5 text-slate-600" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-slate-600" />
            )}
          </div>
        </button>

        <AnimatePresence initial={false}>
          {expandedSections.myCommunities && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              {loading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-4 h-4 text-slate-600 animate-spin" />
                </div>
              ) : myCommunities.length === 0 ? (
                <p className="text-xs text-slate-600 px-3 py-2">
                  You haven&apos;t joined any communities yet
                </p>
              ) : (
                <>
                  {visibleMy.map((community) => (
                    <Link
                      key={community.slug}
                      href={`/community/${community.slug}`}
                      className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-150 group ${
                        pathname === `/community/${community.slug}`
                          ? 'bg-white/[0.06] text-white'
                          : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                      }`}
                    >
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center text-[10px] font-bold text-cyan-400 shrink-0">
                        {community.icon || community.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="truncate flex-1 text-[13px]">c/{community.name}</span>
                      <ChevronRight className="w-3 h-3 text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </Link>
                  ))}
                  {myCommunities.length > 7 && (
                    <button
                      onClick={() => setShowAllMy(!showAllMy)}
                      className="w-full text-left px-3 py-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      {showAllMy ? 'Show less' : `See all (${myCommunities.length})`}
                    </button>
                  )}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Discover Communities */}
      {suggested.length > 0 && (
        <div className="pb-2 mb-1 border-b border-white/[0.06]">
          <button
            onClick={() => toggleSection('discover')}
            className="flex items-center justify-between w-full px-3 py-2 group"
          >
            <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">
              Discover
            </h3>
            {expandedSections.discover ? (
              <ChevronUp className="w-3.5 h-3.5 text-slate-600" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-slate-600" />
            )}
          </button>

          <AnimatePresence initial={false}>
            {expandedSections.discover && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                {visibleDiscover.map((community) => (
                  <div
                    key={community.slug}
                    className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:bg-white/[0.04] transition-colors group"
                  >
                    <Link
                      href={`/community/${community.slug}`}
                      className="flex items-center gap-2.5 flex-1 min-w-0"
                    >
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center text-[10px] font-bold text-purple-400 shrink-0">
                        {community.icon || community.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-[13px] text-slate-300 group-hover:text-white transition-colors">
                          c/{community.name}
                        </div>
                        <div className="text-[10px] text-slate-600">
                          {community.member_count.toLocaleString()} members
                        </div>
                      </div>
                    </Link>
                    <button
                      onClick={() => handleJoinLeave(community)}
                      disabled={joiningSlug === community.slug}
                      className="shrink-0 px-2 py-0.5 text-[10px] font-semibold rounded-full border transition-all duration-150 border-blue-500/30 text-blue-400 hover:bg-blue-500/10 disabled:opacity-50"
                    >
                      {joiningSlug === community.slug ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        'Join'
                      )}
                    </button>
                  </div>
                ))}
                {suggested.length > 5 && (
                  <button
                    onClick={() => setShowAllDiscover(!showAllDiscover)}
                    className="w-full text-left px-3 py-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    {showAllDiscover ? 'Show less' : `See all (${suggested.length})`}
                  </button>
                )}
                <Link
                  href="/community/discover"
                  className="block px-3 py-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Browse all communities
                </Link>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Resources */}
      <div>
        <button
          onClick={() => toggleSection('resources')}
          className="flex items-center justify-between w-full px-3 py-2 group"
        >
          <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">
            Resources
          </h3>
          {expandedSections.resources ? (
            <ChevronUp className="w-3.5 h-3.5 text-slate-600" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-slate-600" />
          )}
        </button>

        <AnimatePresence initial={false}>
          {expandedSections.resources && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              {RESOURCE_LINKS.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 transition-colors"
                >
                  <Icon className="w-[18px] h-[18px]" />
                  {label}
                </Link>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer */}
      <div className="pt-3 mt-2 border-t border-white/[0.06] px-3">
        <p className="text-[10px] text-slate-700 leading-relaxed">
          QuantTrade Community &middot; <Link href="/help" className="hover:text-slate-500 transition-colors">Help</Link> &middot; <Link href="/about" className="hover:text-slate-500 transition-colors">About</Link>
        </p>
      </div>
    </nav>
  )
}
