'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Plus,
  Users,
  ChevronRight,
  Loader2,
  Home,
  Flame,
  Compass,
  TrendingUp,
  Bookmark,
} from 'lucide-react'
import { fetchCommunities, type Community } from '@/lib/api'

const NAV_ITEMS = [
  { href: '/community', label: 'Home', icon: Home },
  { href: '/community?sort=hot', label: 'Popular', icon: Flame },
  { href: '/community/discover', label: 'Explore', icon: Compass },
  { href: '/community?sort=rising', label: 'Rising', icon: TrendingUp },
]

export default function CommunitySidebar() {
  const pathname = usePathname()
  const [communities, setCommunities] = useState<Community[]>([])
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)

  // Refetch on pathname change (catches create, join, leave navigations)
  useEffect(() => {
    fetchCommunities()
      .then((data) => setCommunities(data.communities || []))
      .catch(() => setCommunities([]))
      .finally(() => setLoading(false))
  }, [pathname])

  const myCommunities = communities.filter((c) => c.is_member)
  const suggested = communities.filter((c) => !c.is_member).slice(0, 5)
  const visibleMy = showAll ? myCommunities : myCommunities.slice(0, 7)

  return (
    <nav className="space-y-1">
      {/* Navigation */}
      <div className="pb-3 mb-3 border-b border-white/[0.06]">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={label}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-white/[0.06] text-white font-medium'
                  : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
              }`}
            >
              <Icon className="w-[18px] h-[18px]" />
              {label}
            </Link>
          )
        })}
      </div>

      {/* My Communities */}
      <div className="pb-3 mb-3 border-b border-white/[0.06]">
        <div className="flex items-center justify-between px-3 mb-2">
          <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">
            Your Communities
          </h3>
          <Link
            href="/community/create"
            className="p-1 rounded text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
            title="Create Community"
          >
            <Plus className="w-3.5 h-3.5" />
          </Link>
        </div>

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
                className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 transition-colors group"
              >
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center text-[10px] font-bold text-cyan-400 shrink-0">
                  {community.name.charAt(0).toUpperCase()}
                </div>
                <span className="truncate flex-1 text-[13px]">c/{community.name}</span>
                <ChevronRight className="w-3 h-3 text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
            ))}
            {myCommunities.length > 7 && (
              <button
                onClick={() => setShowAll(!showAll)}
                className="w-full text-left px-3 py-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                {showAll ? 'Show less' : `See all (${myCommunities.length})`}
              </button>
            )}
          </>
        )}
      </div>

      {/* Discover */}
      {suggested.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest px-3 mb-2">
            Communities
          </h3>
          {suggested.map((community) => (
            <Link
              key={community.slug}
              href={`/community/${community.slug}`}
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 transition-colors"
            >
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center text-[10px] font-bold text-purple-400 shrink-0">
                {community.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="truncate text-[13px]">c/{community.name}</div>
                <div className="text-[10px] text-slate-600">{community.member_count.toLocaleString()} members</div>
              </div>
            </Link>
          ))}
          <Link
            href="/community/discover"
            className="block px-3 py-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            Browse all communities
          </Link>
        </div>
      )}
    </nav>
  )
}
