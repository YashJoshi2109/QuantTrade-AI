'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { Users, Shield, ArrowLeft, Calendar, Settings, Flame, Clock, TrendingUp, Zap } from 'lucide-react'
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import { fetchCommunity, joinCommunity, leaveCommunity, normalizePosts, type Community, type CommunityPost } from '@/lib/api'
import PostCard from '@/components/community/PostCard'
import { FeedSkeleton } from '@/components/community/Skeletons'

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

type SortTab = 'hot' | 'new' | 'top' | 'rising'

const SORT_TABS: { key: SortTab; label: string; icon: typeof Flame }[] = [
  { key: 'hot', label: 'Hot', icon: Flame },
  { key: 'new', label: 'New', icon: Clock },
  { key: 'top', label: 'Top', icon: TrendingUp },
  { key: 'rising', label: 'Rising', icon: Zap },
]

const TIME_OPTIONS = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'year', label: 'This Year' },
  { value: 'all', label: 'All Time' },
]

export default function CommunityDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [community, setCommunity] = useState<Community | null>(null)
  const [posts, setPosts] = useState<CommunityPost[]>([])
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)

  const sort = (searchParams.get('sort') as SortTab) || 'hot'
  const time = searchParams.get('time') || 'all'

  const updateParams = useCallback((newSort: SortTab, newTime?: string) => {
    const params = new URLSearchParams()
    params.set('sort', newSort)
    if (newSort === 'top' && newTime) params.set('time', newTime)
    router.replace(`/community/${slug}?${params.toString()}`, { scroll: false })
  }, [router, slug])

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    const params = new URLSearchParams({ sort, limit: '20' })
    if (sort === 'top') params.set('time', time)
    Promise.all([
      fetchCommunity(slug),
      fetch(`${API_URL}/api/v1/communities/${slug}/posts?${params}`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : { items: [] })
        .catch(() => ({ items: [] }))
    ]).then(([comm, feedData]) => {
      setCommunity(comm)
      setPosts(normalizePosts(feedData.posts || feedData.items || []))
    }).finally(() => setLoading(false))
  }, [slug, sort, time])

  const handleJoinLeave = async () => {
    if (!community || joining) return
    setJoining(true)
    const wasMember = community.is_member
    // Optimistic update — instant UI feedback
    setCommunity({
      ...community,
      is_member: !wasMember,
      member_count: community.member_count + (wasMember ? -1 : 1),
    })
    try {
      if (wasMember) {
        await leaveCommunity(community.slug)
      } else {
        await joinCommunity(community.slug)
      }
    } catch {
      // Revert on failure
      setCommunity({
        ...community,
        is_member: wasMember,
        member_count: community.member_count,
      })
    }
    setJoining(false)
  }

  if (loading) {
    const loadingContent = (
      <div className="min-h-screen pb-safe">
        <div className="max-w-4xl mx-auto px-4 py-8"><FeedSkeleton /></div>
      </div>
    )
    return (
      <>
        <div className="hidden md:block"><AppLayout>{loadingContent}</AppLayout></div>
        <div className="md:hidden"><MobileLayout>{loadingContent}</MobileLayout></div>
      </>
    )
  }

  if (!community) {
    const notFoundContent = (
      <div className="min-h-screen flex items-center justify-center pb-safe">
        <div className="text-center">
          <h2 className="text-xl font-bold text-fg-primary mb-2">Community not found</h2>
          <Link href="/community" className="text-cyan-400 hover:text-cyan-300 text-sm">Back to feed</Link>
        </div>
      </div>
    )
    return (
      <>
        <div className="hidden md:block"><AppLayout>{notFoundContent}</AppLayout></div>
        <div className="md:hidden"><MobileLayout>{notFoundContent}</MobileLayout></div>
      </>
    )
  }

  const content = (
    <div className="min-h-screen pb-safe">
      
      {/* ── Mobile Header ── */}
      <header className="md:hidden sticky top-0 z-30 bg-surface-base/95 backdrop-blur-xl border-b border-line-subtle px-3 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => router.back()}
            className="p-1.5 -ml-1.5 rounded-full text-fg-muted hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex flex-col">
            <span className="text-sm font-bold text-white leading-tight">c/{community.name}</span>
          </div>
        </div>
        <button
          onClick={handleJoinLeave}
          disabled={joining}
          className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all ${
            community.is_member
              ? 'bg-surface-raised text-fg-secondary border border-line-subtle'
              : 'bg-blue-500 text-white'
          }`}
        >
          {joining ? '...' : community.is_member ? 'Joined' : 'Join'}
        </button>
      </header>

      {/* Banner */}
      <div className="h-20 sm:h-28 bg-gradient-to-r from-cyan-900/20 to-blue-900/20 relative">
        {community.banner_url && (
          <img src={community.banner_url} alt="" className="w-full h-full object-cover" />
        )}
      </div>

      <div className="max-w-5xl mx-auto px-3 sm:px-4 -mt-6">
        <div className="flex flex-col lg:flex-row gap-5">
          {/* Main Feed */}
          <div className="flex-1 min-w-0">
            {/* Community Header Card */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-surface-raised rounded-2xl p-3 sm:p-5 mb-3"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {/* Desktop breadcrumb */}
                  <nav className="hidden md:flex items-center gap-1 text-xs text-fg-muted mb-3">
                    <Link href="/community" className="hover:text-fg-muted transition-colors">Community</Link>
                    <span>›</span>
                    <span className="text-fg-muted">{community.name}</span>
                  </nav>
                  <div className="flex items-center gap-3 mb-2">
                    <Link href="/community" className="hidden md:block text-fg-muted hover:text-fg-secondary transition-colors">
                      <ArrowLeft className="w-4 h-4" />
                    </Link>
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500/30 to-blue-500/30 flex items-center justify-center text-lg font-bold text-cyan-400 shrink-0">
                      {community.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h1 className="text-lg sm:text-xl font-bold text-white break-words">c/{community.name}</h1>
                      <div className="flex items-center gap-2 sm:gap-3 text-xs text-fg-muted mt-0.5 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {community.member_count.toLocaleString()} members
                        </span>
                        <span className="px-1.5 py-0.5 bg-surface-raised/60 rounded text-[10px]">{community.category}</span>
                        {community.ticker_focus && (
                          <span className="text-cyan-400 font-mono font-semibold">${community.ticker_focus}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {community.description && (
                    <p className="text-sm text-fg-muted mt-2 ml-0 sm:ml-[52px]">{community.description}</p>
                  )}
                </div>
                <button
                  onClick={handleJoinLeave}
                  disabled={joining}
                  className={`hidden md:block px-5 py-2 rounded-full text-sm font-medium transition-all shrink-0 ${
                    community.is_member
                      ? 'bg-surface-raised text-fg-secondary hover:bg-red-500/15 hover:text-red-400 border border-line-subtle'
                      : 'bg-blue-500 text-white hover:bg-blue-400'
                  }`}
                >
                  {joining ? '...' : community.is_member ? 'Joined' : 'Join'}
                </button>
              </div>
            </motion.div>

            {/* Sort Tabs */}
            <div className="bg-surface-raised rounded-2xl p-1 mb-3 flex gap-0.5 overflow-x-auto scrollbar-none">
              {SORT_TABS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => {
                    updateParams(key, key === 'top' ? time : undefined)
                  }}
                  className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl text-xs sm:text-sm font-medium transition-colors flex-1 justify-center whitespace-nowrap min-w-0 ${
                    sort === key
                      ? 'bg-surface-active text-fg-primary'
                      : 'text-fg-muted hover:text-fg-secondary hover:bg-surface-hover'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>

            {/* Time filter for Top sort */}
            {sort === 'top' && (
              <div className="flex items-center gap-2 mb-3 px-1">
                <span className="text-[11px] text-fg-muted uppercase tracking-wider">Period</span>
                <select
                  value={time}
                  onChange={(e) => updateParams('top', e.target.value)}
                  className="bg-surface-raised border border-line-subtle rounded-lg px-3 py-1.5 text-xs text-fg-muted focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                >
                  {TIME_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Posts */}
            {posts.length === 0 ? (
              <div className="text-center py-16 text-fg-muted bg-surface-raised rounded-2xl">
                <p className="text-sm">No posts yet in this community</p>
                <p className="text-xs text-fg-muted mt-1">Be the first to share something</p>
              </div>
            ) : (
              <div className="space-y-2">
                {posts.map(post => (
                  <PostCard key={post.id} post={post} />
                ))}
              </div>
            )}
          </div>

          {/* Sidebar — below feed on mobile, right column on desktop */}
          <div className="w-full lg:w-[300px] shrink-0 space-y-4">
            {/* About */}
            <div className="bg-surface-raised rounded-2xl p-4">
              <h3 className="text-xs font-semibold text-fg-secondary uppercase tracking-wider mb-3 flex items-center gap-2">
                <Shield className="w-4 h-4 text-blue-400" /> About
              </h3>
              <p className="text-sm text-fg-muted mb-3">{community.description || 'No description'}</p>
              <div className="flex items-center gap-3 text-xs text-fg-muted mb-3">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  Created {community.created_at ? new Date(community.created_at).toLocaleDateString() : 'recently'}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-fg-muted pt-3 border-t border-line-subtle">
                <div className="flex-1 text-center">
                  <div className="text-lg font-bold text-fg-primary">{community.member_count.toLocaleString()}</div>
                  <div className="text-[10px] text-fg-muted">Members</div>
                </div>
                <div className="flex-1 text-center">
                  <div className="text-lg font-bold text-fg-primary">{posts.length}</div>
                  <div className="text-[10px] text-fg-muted">Posts</div>
                </div>
              </div>
            </div>

            {/* Links */}
            <div className="bg-surface-raised rounded-2xl p-4 space-y-1">
              <Link href={`/community/${slug}/members`} className="block text-sm text-fg-muted hover:text-fg-primary py-1.5 transition-colors">
                View Members
              </Link>
              {community.is_member && (community as any).user_role && ['admin', 'owner', 'moderator'].includes((community as any).user_role) && (
                <>
                  <Link href="/community/moderation" className="block text-sm text-fg-muted hover:text-fg-primary py-1.5 transition-colors">
                    Moderation
                  </Link>
                  <Link href={`/community/${slug}/settings`} className="flex items-center gap-2 text-sm text-fg-muted hover:text-fg-primary py-1.5 transition-colors">
                    <Settings className="w-3.5 h-3.5" /> Community Settings
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <>
      <div className="hidden md:block">
        <AppLayout>{content}</AppLayout>
      </div>
      <div className="md:hidden">
        <MobileLayout>{content}</MobileLayout>
      </div>
    </>
  )
}
