'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  MapPin,
  Calendar,
  TrendingUp,
  Users,
  MessageSquare,
  Star,
  Award,
  Loader2,
  UserPlus,
  UserMinus,
  BarChart3,
  Briefcase,
  Settings,
  Share2,
  ChevronRight,
  Home,
} from 'lucide-react'
import PostCard from '@/components/community/PostCard'
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import {
  fetchUserProfile,
  fetchUserPosts,
  fetchUserComments,
  followUser,
  unfollowUser,
  type CommunityPost,
} from '@/lib/api'

/* ── Types ─────────────────────────────────────────────────── */

interface UserProfile {
  id: number
  username: string
  display_name: string
  avatar_url?: string
  bio?: string
  location?: string
  trading_style?: string
  experience_level?: string
  reputation: number
  posts_count: number
  followers_count: number
  following_count: number
  badges: string[]
  is_following: boolean
  joined_at: string
  communities?: { slug: string; name: string }[]
}

/* ── Badge Config ──────────────────────────────────────────── */

const BADGE_CONFIG: Record<string, { label: string; emoji: string; color: string; bg: string }> = {
  verified_trader: { label: 'Verified Trader', emoji: '✓', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
  top_analyst: { label: 'Top Analyst', emoji: '📊', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30' },
  early_adopter: { label: 'Early Adopter', emoji: '🚀', color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/30' },
  contributor: { label: 'Contributor', emoji: '⭐', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' },
  moderator: { label: 'Moderator', emoji: '🛡️', color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/30' },
  pro: { label: 'Pro Trader', emoji: '💎', color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30' },
}

/* ── Helpers ───────────────────────────────────────────────── */

function accountAge(joined: string): string {
  const months = Math.floor((Date.now() - new Date(joined).getTime()) / (1000 * 60 * 60 * 24 * 30))
  if (months < 1) return 'New'
  if (months < 12) return `${months}mo`
  const years = Math.floor(months / 12)
  return `${years}yr`
}

function formatJoined(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function getInitials(name: string): string {
  return name.split(/[\s_-]+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/** Generate a unique gradient per username */
function usernameGradient(username: string): string {
  const hash = username.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  const gradients = [
    'from-blue-600/80 via-cyan-600/60 to-blue-900',
    'from-emerald-600/80 via-teal-600/60 to-slate-900',
    'from-violet-600/80 via-purple-600/60 to-slate-900',
    'from-orange-600/80 via-amber-600/60 to-slate-900',
    'from-rose-600/80 via-pink-600/60 to-slate-900',
    'from-cyan-600/80 via-blue-600/60 to-slate-900',
    'from-indigo-600/80 via-blue-600/60 to-slate-900',
  ]
  return gradients[hash % gradients.length]
}

type ProfileTab = 'overview' | 'posts' | 'comments'

/* ── Main Component ────────────────────────────────────────── */

export default function UserProfilePage() {
  const params = useParams()
  const username = params.username as string

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [tab, setTab] = useState<ProfileTab>('overview')
  const [following, setFollowing] = useState(false)
  const [followLoading, setFollowLoading] = useState(false)
  const [shareConfirm, setShareConfirm] = useState(false)

  const [posts, setPosts] = useState<CommunityPost[]>([])
  const [postsLoading, setPostsLoading] = useState(false)
  const [postsCursor, setPostsCursor] = useState<number | undefined>(undefined)
  const [hasMorePosts, setHasMorePosts] = useState(true)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const [comments, setComments] = useState<any[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchUserProfile(username).then((data) => {
      if (cancelled) return
      if (!data) { setNotFound(true) } else { setProfile(data); setFollowing(data.is_following) }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [username])

  const loadPosts = useCallback(async (reset?: boolean) => {
    if (postsLoading) return
    setPostsLoading(true)
    try {
      const cursor = reset ? undefined : postsCursor
      const data = await fetchUserPosts(username, cursor)
      const newPosts = data.posts || []
      reset ? setPosts(newPosts) : setPosts((prev) => [...prev, ...newPosts])
      setPostsCursor(data.next_cursor ?? undefined)
      setHasMorePosts(!!data.next_cursor)
    } catch { /* ignore */ } finally { setPostsLoading(false) }
  }, [username, postsCursor, postsLoading])

  useEffect(() => {
    if ((tab === 'posts' || tab === 'overview') && posts.length === 0 && profile) loadPosts(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, profile])

  useEffect(() => {
    if (tab === 'comments' && profile?.id) {
      setCommentsLoading(true)
      fetchUserComments(profile.id)
        .then(d => setComments(d.comments || []))
        .catch(() => setComments([]))
        .finally(() => setCommentsLoading(false))
    }
  }, [tab, profile?.id])

  useEffect(() => {
    if (tab !== 'posts' || !sentinelRef.current) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting && hasMorePosts && !postsLoading) loadPosts(false) },
      { rootMargin: '200px' }
    )
    observer.observe(sentinelRef.current)
    return () => observer.disconnect()
  }, [tab, hasMorePosts, postsLoading, loadPosts])

  const handleFollowToggle = async () => {
    if (!profile || followLoading) return
    setFollowLoading(true)
    const ok = following ? await unfollowUser(profile.id) : await followUser(profile.id)
    if (ok) {
      setFollowing(!following)
      setProfile(prev => prev ? { ...prev, followers_count: prev.followers_count + (following ? -1 : 1), is_following: !following } : prev)
    }
    setFollowLoading(false)
  }

  const handleShare = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.href).then(() => {
        setShareConfirm(true)
        setTimeout(() => setShareConfirm(false), 2000)
      })
    }
  }

  /* ── Loading ── */
  if (loading) {
    const lc = (
      <div className="min-h-screen flex items-center justify-center pb-safe">
        <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
      </div>
    )
    return (
      <>
        <div className="hidden md:block"><AppLayout>{lc}</AppLayout></div>
        <div className="md:hidden"><MobileLayout>{lc}</MobileLayout></div>
      </>
    )
  }

  /* ── Not Found ── */
  if (notFound || !profile) {
    const nf = (
      <div className="min-h-screen flex items-center justify-center p-4 pb-safe">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="bg-[#0D1117] border border-white/[0.06] rounded-2xl p-12 text-center max-w-md">
          <Users className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-100 mb-2">User Not Found</h2>
          <p className="text-sm text-slate-500">The user <span className="text-slate-300">@{username}</span> does not exist.</p>
        </motion.div>
      </div>
    )
    return (
      <>
        <div className="hidden md:block"><AppLayout>{nf}</AppLayout></div>
        <div className="md:hidden"><MobileLayout>{nf}</MobileLayout></div>
      </>
    )
  }

  const grad = usernameGradient(profile.username)
  const TABS: { key: ProfileTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'posts', label: 'Posts' },
    { key: 'comments', label: 'Comments' },
  ]

  const content = (
    <div className="min-h-screen pb-safe">
      {/* Mobile Header */}
      <header className="md:hidden sticky top-0 z-30 bg-[#0A0E1A]/95 backdrop-blur-xl border-b border-white/[0.06] px-3 py-2.5 flex items-center gap-3">
        <button onClick={() => window.history.back()}
          className="p-1.5 -ml-1.5 rounded-full text-slate-400 hover:text-white transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <span className="text-sm font-bold text-white truncate">{profile.display_name || profile.username}</span>
      </header>

      {/* ── Banner ── */}
      <div className={`relative w-full h-28 sm:h-36 bg-gradient-to-r ${grad} overflow-hidden`}>
        {/* Grid overlay */}
        <div className="absolute inset-0 opacity-20"
          style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.08) 1px,transparent 1px)', backgroundSize: '32px 32px' }} />
        {/* Noise overlay */}
        <div className="absolute inset-0 opacity-30 mix-blend-overlay"
          style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\' opacity=\'0.4\'/%3E%3C/svg%3E")' }} />
      </div>

      <div className="max-w-4xl mx-auto px-3 sm:px-6">
        {/* ── Profile header card ── */}
        <div className="relative bg-[#0D1117] border border-white/[0.06] rounded-2xl -mt-6 mb-4 overflow-hidden">
          {/* Avatar row */}
          <div className="flex items-end gap-4 px-4 sm:px-6 pt-0 pb-4">
            {/* Avatar — overlaps the banner */}
            <div className="-mt-10 sm:-mt-12 shrink-0">
              <div className={`w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-gradient-to-br ${grad} border-4 border-[#0D1117] flex items-center justify-center overflow-hidden ring-2 ring-white/10 shadow-2xl`}>
                {profile.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={profile.avatar_url} alt={profile.username} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-2xl sm:text-3xl font-black text-white">{getInitials(profile.display_name || profile.username)}</span>
                )}
              </div>
            </div>

            {/* Name + actions */}
            <div className="flex-1 min-w-0 pt-2 sm:pt-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                <div className="min-w-0">
                  <h1 className="text-lg sm:text-xl font-black text-white truncate">
                    {profile.display_name || profile.username}
                    {profile.badges.includes('verified_trader') && (
                      <span className="ml-1.5 inline-flex items-center justify-center w-4.5 h-4.5 bg-blue-500 rounded-full text-[10px] text-white font-bold">✓</span>
                    )}
                  </h1>
                  <p className="text-sm text-slate-500">u/{profile.username}</p>
                </div>
                <div className="flex items-center gap-2 sm:ml-auto">
                  <button
                    onClick={handleFollowToggle}
                    disabled={followLoading}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold transition-all min-h-[36px] ${
                      following
                        ? 'bg-white/[0.08] text-slate-300 border border-white/[0.10] hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20'
                        : 'bg-blue-500 text-white hover:bg-blue-400 shadow-lg shadow-blue-500/20'
                    } disabled:opacity-50`}
                  >
                    {followLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : following ? <UserMinus className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
                    {following ? 'Following' : 'Follow'}
                  </button>
                  <Link
                    href={`/community/messages/new?new=${profile.username}`}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold bg-white/[0.06] text-slate-200 border border-white/[0.08] hover:bg-white/[0.12] hover:text-white transition-colors min-h-[36px]"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Message</span>
                  </Link>
                  <button
                    onClick={handleShare}
                    className="p-2 rounded-full bg-white/[0.06] border border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/[0.12] transition-colors"
                    title={shareConfirm ? 'Copied!' : 'Share profile'}
                  >
                    <Share2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Bio */}
              {profile.bio && (
                <p className="text-sm text-slate-300 mt-2 leading-relaxed">{profile.bio}</p>
              )}

              {/* Meta info chips */}
              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                {profile.location && (
                  <span className="flex items-center gap-1 text-xs text-slate-500">
                    <MapPin className="w-3 h-3" /> {profile.location}
                  </span>
                )}
                {profile.trading_style && (
                  <span className="flex items-center gap-1 text-xs text-slate-500">
                    <TrendingUp className="w-3 h-3" /> {profile.trading_style}
                  </span>
                )}
                {profile.experience_level && (
                  <span className="flex items-center gap-1 text-xs text-slate-500">
                    <Briefcase className="w-3 h-3" /> {profile.experience_level}
                  </span>
                )}
                <span className="flex items-center gap-1 text-xs text-slate-500">
                  <Calendar className="w-3 h-3" /> Joined {formatJoined(profile.joined_at)}
                </span>
              </div>
            </div>
          </div>

          {/* Stats bar */}
          <div className="grid grid-cols-4 divide-x divide-white/[0.05] border-t border-white/[0.05]">
            {[
              { label: 'Posts', value: profile.posts_count, sub: 'karma' },
              { label: 'Reputation', value: profile.reputation, sub: 'pts', accent: true },
              { label: 'Followers', value: profile.followers_count, sub: 'members' },
              { label: 'Acct Age', value: accountAge(profile.joined_at), sub: formatJoined(profile.joined_at), isStr: true },
            ].map((s) => (
              <div key={s.label} className="flex flex-col items-center py-3 px-2">
                <span className={`text-base sm:text-lg font-black tabular-nums ${s.accent ? 'text-amber-400' : 'text-white'}`}>
                  {s.isStr ? s.value : formatCount(s.value as number)}
                </span>
                <span className="text-[10px] text-slate-500 font-medium mt-0.5">{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Desktop layout: two-column ── */}
        <div className="flex gap-5 pb-8">
          {/* ── Main content ── */}
          <div className="flex-1 min-w-0">
            {/* Desktop breadcrumb */}
            <nav className="hidden md:flex items-center gap-1 text-xs text-slate-600 mb-3">
              <Link href="/community" className="hover:text-slate-400 transition-colors flex items-center gap-1">
                <Home className="w-3 h-3" /> Community
              </Link>
              <ChevronRight className="w-3 h-3 text-slate-700" />
              <span className="text-slate-400">u/{profile.username}</span>
            </nav>

            {/* Tabs */}
            <div className="flex items-center gap-1 mb-4 border-b border-white/[0.05] pb-0">
              {TABS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`relative px-4 py-2.5 text-sm font-semibold transition-colors ${
                    tab === key ? 'text-white' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {label}
                  {tab === key && (
                    <motion.div layoutId="tab-indicator"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-full" />
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <AnimatePresence mode="wait">
              {(tab === 'overview' || tab === 'posts') && (
                <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  {postsLoading && posts.length === 0 ? (
                    <div className="space-y-3">
                      {[1,2,3].map(i => (
                        <div key={i} className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-4 animate-pulse h-24" />
                      ))}
                    </div>
                  ) : posts.length === 0 ? (
                    <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-12 text-center">
                      <BarChart3 className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                      <p className="text-sm text-slate-500">No posts yet</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {posts.map((post, i) => (
                        <PostCard key={post.id} post={post} index={i} />
                      ))}
                    </div>
                  )}
                  <div ref={tab === 'posts' ? sentinelRef : undefined} className="h-px" />
                  {postsLoading && posts.length > 0 && (
                    <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 text-slate-500 animate-spin" /></div>
                  )}
                  {!hasMorePosts && posts.length > 0 && (
                    <p className="text-center text-xs text-slate-600 py-6">All posts loaded</p>
                  )}
                </motion.div>
              )}

              {tab === 'comments' && (
                <motion.div key="comments" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  {commentsLoading ? (
                    <div className="space-y-3">
                      {[1,2,3].map(i => <div key={i} className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-4 animate-pulse h-20" />)}
                    </div>
                  ) : comments.length === 0 ? (
                    <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-12 text-center">
                      <MessageSquare className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                      <p className="text-sm text-slate-500">No comments yet</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {comments.map((comment: any) => (
                        <Link key={comment.id} href={`/community/post/${comment.post_id}`}
                          className="block bg-[#0D1117] border border-white/[0.06] rounded-xl p-4 hover:border-white/[0.12] transition-colors group">
                          {comment.post_title && (
                            <div className="text-xs text-slate-500 mb-2 flex items-center gap-1">
                              <MessageSquare className="w-3 h-3" />
                              Commented on: <span className="text-blue-400 group-hover:text-blue-300 transition-colors ml-1">{comment.post_title}</span>
                            </div>
                          )}
                          <p className="text-sm text-slate-300 line-clamp-3 leading-relaxed">{comment.body}</p>
                          <div className="flex items-center gap-3 mt-2 text-xs text-slate-600">
                            <span className={`font-medium ${(comment.upvote_count - comment.downvote_count) > 0 ? 'text-orange-400' : 'text-slate-500'}`}>
                              {comment.upvote_count - comment.downvote_count} pts
                            </span>
                            <span>{comment.created_at ? new Date(comment.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Desktop Sidebar ── */}
          <div className="hidden lg:flex flex-col gap-3 w-72 shrink-0">
            {/* Profile card */}
            <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl overflow-hidden">
              <div className={`h-10 bg-gradient-to-r ${grad}`} />
              <div className="px-4 pb-4 pt-2">
                <p className="text-xs font-bold text-white uppercase tracking-widest mb-3">About</p>
                <p className="text-sm text-slate-400 leading-relaxed mb-4">
                  {profile.bio || `Trading on QuantTrade since ${formatJoined(profile.joined_at)}.`}
                </p>

                <div className="space-y-2.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Reputation</span>
                    <span className="font-bold text-amber-400 flex items-center gap-1">
                      <Star className="w-3.5 h-3.5" /> {formatCount(profile.reputation)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Followers</span>
                    <span className="font-semibold text-white">{formatCount(profile.followers_count)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Following</span>
                    <span className="font-semibold text-white">{formatCount(profile.following_count)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Acct Age</span>
                    <span className="font-semibold text-white">{accountAge(profile.joined_at)}</span>
                  </div>
                  {profile.trading_style && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Style</span>
                      <span className="font-semibold text-cyan-400">{profile.trading_style}</span>
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-4 border-t border-white/[0.05]">
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Joined</p>
                  <p className="text-sm text-white">{new Date(profile.joined_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                </div>
              </div>
            </div>

            {/* Achievements / Badges */}
            {profile.badges.length > 0 && (
              <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-4">
                <p className="text-xs font-bold text-white uppercase tracking-widest mb-3 flex items-center gap-2">
                  <Award className="w-3.5 h-3.5 text-amber-400" /> Achievements
                </p>
                <div className="space-y-2">
                  {profile.badges.map((badge) => {
                    const cfg = BADGE_CONFIG[badge] || { label: badge.replace(/_/g, ' '), emoji: '🏅', color: 'text-slate-400', bg: 'bg-slate-500/10 border-slate-500/20' }
                    return (
                      <div key={badge} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border ${cfg.bg}`}>
                        <span className="text-base leading-none">{cfg.emoji}</span>
                        <span className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Communities */}
            {profile.communities && profile.communities.length > 0 && (
              <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-4">
                <p className="text-xs font-bold text-white uppercase tracking-widest mb-3 flex items-center gap-2">
                  <Users className="w-3.5 h-3.5 text-cyan-400" /> Communities
                </p>
                <div className="space-y-1.5">
                  {profile.communities.slice(0, 6).map((c) => (
                    <Link key={c.slug} href={`/community/${c.slug}`}
                      className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors group">
                      <span className="text-sm text-slate-300 group-hover:text-white transition-colors">c/{c.name}</span>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 transition-colors" />
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Settings shortcuts (only shown for own profile) */}
            <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-4">
              <p className="text-xs font-bold text-white uppercase tracking-widest mb-3 flex items-center gap-2">
                <Settings className="w-3.5 h-3.5 text-slate-400" /> Profile
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between text-slate-400">
                  <span>Curate your profile</span>
                  <Link href="/settings/profile" className="text-xs text-blue-400 hover:text-blue-300 transition-colors font-semibold">Update</Link>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">Manage what others see when they visit your profile.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile: badges + communities below posts */}
        <div className="lg:hidden space-y-3 pb-8">
          {profile.badges.length > 0 && (
            <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-4">
              <p className="text-xs font-bold text-white uppercase tracking-widest mb-3 flex items-center gap-2">
                <Award className="w-3.5 h-3.5 text-amber-400" /> Achievements
              </p>
              <div className="flex flex-wrap gap-2">
                {profile.badges.map((badge) => {
                  const cfg = BADGE_CONFIG[badge] || { label: badge.replace(/_/g, ' '), emoji: '🏅', color: 'text-slate-400', bg: 'bg-slate-500/10 border-slate-500/20' }
                  return (
                    <span key={badge} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold ${cfg.bg} ${cfg.color}`}>
                      <span>{cfg.emoji}</span> {cfg.label}
                    </span>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <>
      <div className="hidden md:block"><AppLayout>{content}</AppLayout></div>
      <div className="md:hidden"><MobileLayout>{content}</MobileLayout></div>
    </>
  )
}
