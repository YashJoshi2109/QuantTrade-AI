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
} from 'lucide-react'
import PostCard from '@/components/community/PostCard'
import AppLayout from '@/components/AppLayout'
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

const BADGE_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  verified_trader: { label: 'Verified Trader', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  top_analyst: { label: 'Top Analyst', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
  early_adopter: { label: 'Early Adopter', color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20' },
  contributor: { label: 'Contributor', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
  moderator: { label: 'Moderator', color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/20' },
  pro: { label: 'Pro', color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20' },
}

/* ── Helpers ───────────────────────────────────────────────── */

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

function getInitials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/* ── Tab Types ─────────────────────────────────────────────── */

type ProfileTab = 'posts' | 'comments' | 'communities'

const PROFILE_TABS: { key: ProfileTab; label: string; icon: typeof MessageSquare }[] = [
  { key: 'posts', label: 'Posts', icon: BarChart3 },
  { key: 'comments', label: 'Comments', icon: MessageSquare },
  { key: 'communities', label: 'Communities', icon: Users },
]

/* ── Main Component ────────────────────────────────────────── */

export default function UserProfilePage() {
  const params = useParams()
  const username = params.username as string

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [tab, setTab] = useState<ProfileTab>('posts')
  const [following, setFollowing] = useState(false)
  const [followLoading, setFollowLoading] = useState(false)

  // Posts
  const [posts, setPosts] = useState<CommunityPost[]>([])
  const [postsLoading, setPostsLoading] = useState(false)
  const [postsCursor, setPostsCursor] = useState<number | undefined>(undefined)
  const [hasMorePosts, setHasMorePosts] = useState(true)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Comments
  const [comments, setComments] = useState<any[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)

  // Load profile
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchUserProfile(username).then((data) => {
      if (cancelled) return
      if (!data) {
        setNotFound(true)
      } else {
        setProfile(data)
        setFollowing(data.is_following)
      }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [username])

  // Load posts
  const loadPosts = useCallback(
    async (reset?: boolean) => {
      if (postsLoading) return
      setPostsLoading(true)
      try {
        const cursor = reset ? undefined : postsCursor
        const data = await fetchUserPosts(username, cursor)
        const newPosts = data.posts || []
        if (reset) {
          setPosts(newPosts)
        } else {
          setPosts((prev) => [...prev, ...newPosts])
        }
        setPostsCursor(data.next_cursor ?? undefined)
        setHasMorePosts(!!data.next_cursor)
      } catch {
        // silent
      } finally {
        setPostsLoading(false)
      }
    },
    [username, postsCursor, postsLoading]
  )

  // Load posts on tab switch
  useEffect(() => {
    if (tab === 'posts' && posts.length === 0 && profile) {
      loadPosts(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, profile])

  // Load comments on tab switch
  useEffect(() => {
    if (tab === 'comments' && profile?.id) {
      setCommentsLoading(true)
      fetchUserComments(profile.id)
        .then(data => setComments(data.comments || []))
        .catch(() => setComments([]))
        .finally(() => setCommentsLoading(false))
    }
  }, [tab, profile?.id])

  // Infinite scroll for posts
  useEffect(() => {
    if (tab !== 'posts' || !sentinelRef.current) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMorePosts && !postsLoading) {
          loadPosts(false)
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(sentinelRef.current)
    return () => observer.disconnect()
  }, [tab, hasMorePosts, postsLoading, loadPosts])

  // Follow/Unfollow
  const handleFollowToggle = async () => {
    if (!profile || followLoading) return
    setFollowLoading(true)
    const ok = following
      ? await unfollowUser(profile.id)
      : await followUser(profile.id)
    if (ok) {
      setFollowing(!following)
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              followers_count: prev.followers_count + (following ? -1 : 1),
              is_following: !following,
            }
          : prev
      )
    }
    setFollowLoading(false)
  }

  /* ── Loading State ───────────────────────────────────────── */

  if (loading) {
    return (
      <AppLayout>
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
      </div>
      </AppLayout>
    )
  }

  /* ── Not Found ───────────────────────────────────────────── */

  if (notFound || !profile) {
    return (
      <AppLayout>
      <div className="min-h-screen flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-[#0D1117] border border-white/[0.06] rounded-2xl p-12 text-center max-w-md"
        >
          <Users className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-100 mb-2">User Not Found</h2>
          <p className="text-sm text-slate-500">
            The user <span className="text-slate-300">@{username}</span> does not exist or has been removed.
          </p>
        </motion.div>
      </div>
      </AppLayout>
    )
  }

  /* ── Profile Render ──────────────────────────────────────── */

  return (
    <AppLayout>
    <div className="min-h-screen pb-safe">
      <div className="max-w-3xl mx-auto px-3 sm:px-6 py-4 sm:py-8">
        {/* Profile Card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-5 sm:p-6 mb-6"
        >
          {/* Top row */}
          <div className="flex flex-col sm:flex-row items-start gap-4">
            {/* Avatar */}
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-white/[0.08] flex items-center justify-center flex-shrink-0">
              {profile.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={profile.display_name}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <span className="text-2xl font-bold text-slate-300">
                  {getInitials(profile.display_name || profile.username)}
                </span>
              )}
            </div>

            {/* Name + Follow */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-1">
                <div>
                  <h1 className="text-xl font-bold text-slate-100">
                    {profile.display_name || profile.username}
                  </h1>
                  <p className="text-sm text-slate-500">@{profile.username}</p>
                </div>
                <div className="sm:ml-auto">
                  <button
                    onClick={handleFollowToggle}
                    disabled={followLoading}
                    className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors min-h-[44px] ${
                      following
                        ? 'bg-white/[0.06] text-slate-300 border border-white/[0.08] hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20'
                        : 'bg-blue-500/15 text-blue-400 border border-blue-500/30 hover:bg-blue-500/25'
                    }`}
                  >
                    {followLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : following ? (
                      <UserMinus className="w-4 h-4" />
                    ) : (
                      <UserPlus className="w-4 h-4" />
                    )}
                    {following ? 'Following' : 'Follow'}
                  </button>
                </div>
              </div>

              {/* Bio */}
              {profile.bio && (
                <p className="text-sm text-slate-300 mt-2 leading-relaxed">{profile.bio}</p>
              )}

              {/* Meta info */}
              <div className="flex flex-wrap items-center gap-3 sm:gap-4 mt-3 text-xs text-slate-500">
                {profile.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" />
                    {profile.location}
                  </span>
                )}
                {profile.trading_style && (
                  <span className="flex items-center gap-1">
                    <TrendingUp className="w-3.5 h-3.5" />
                    {profile.trading_style}
                  </span>
                )}
                {profile.experience_level && (
                  <span className="flex items-center gap-1">
                    <Briefcase className="w-3.5 h-3.5" />
                    {profile.experience_level}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  Joined {formatDate(profile.joined_at)}
                </span>
              </div>

              {/* Badges */}
              {profile.badges.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {profile.badges.map((badge) => {
                    const style = BADGE_STYLES[badge] || {
                      label: badge.replace(/_/g, ' '),
                      color: 'text-slate-400',
                      bg: 'bg-slate-500/10 border-slate-500/20',
                    }
                    return (
                      <span
                        key={badge}
                        className={`flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-md border ${style.bg} ${style.color}`}
                      >
                        <Award className="w-3 h-3" />
                        {style.label}
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-3 mt-5 pt-4 border-t border-white/[0.06]">
            {[
              { label: 'Posts', value: profile.posts_count },
              { label: 'Reputation', value: profile.reputation, icon: Star },
              { label: 'Followers', value: profile.followers_count },
              { label: 'Following', value: profile.following_count },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="text-lg font-bold text-slate-100 tabular-nums">
                  {formatCount(stat.value)}
                </p>
                <p className="text-xs text-slate-500 mt-0.5 flex items-center justify-center gap-1">
                  {stat.icon && <stat.icon className="w-3 h-3 text-amber-400" />}
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Tabs */}
        <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-1.5 mb-4 flex gap-1">
          {PROFILE_TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex-1 justify-center min-h-[44px] ${
                tab === key
                  ? 'bg-white/[0.06] text-slate-100'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <AnimatePresence mode="wait">
          {tab === 'posts' && (
            <motion.div
              key="posts"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {postsLoading && posts.length === 0 ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-4 animate-pulse">
                      <div className="flex gap-3">
                        <div className="w-9 space-y-2">
                          <div className="h-5 w-5 bg-slate-800 rounded mx-auto" />
                          <div className="h-4 w-6 bg-slate-800 rounded mx-auto" />
                        </div>
                        <div className="flex-1 space-y-2">
                          <div className="h-3 w-48 bg-slate-800 rounded" />
                          <div className="h-5 w-3/4 bg-slate-800 rounded" />
                          <div className="h-4 w-full bg-slate-800 rounded" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : posts.length === 0 ? (
                <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-12 text-center">
                  <BarChart3 className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                  <p className="text-sm text-slate-500">No posts yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {posts.map((post, i) => (
                    <PostCard key={post.id} post={post} index={i} />
                  ))}
                </div>
              )}

              <div ref={sentinelRef} className="h-px" />

              {postsLoading && posts.length > 0 && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
                </div>
              )}

              {!hasMorePosts && posts.length > 0 && (
                <p className="text-center text-sm text-slate-600 py-8">
                  No more posts
                </p>
              )}
            </motion.div>
          )}

          {tab === 'comments' && (
            <motion.div
              key="comments"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {commentsLoading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-4 animate-pulse">
                      <div className="h-4 w-48 bg-slate-800 rounded mb-3" />
                      <div className="h-3 w-full bg-slate-800/50 rounded mb-2" />
                      <div className="h-3 w-2/3 bg-slate-800/50 rounded" />
                    </div>
                  ))}
                </div>
              ) : comments.length === 0 ? (
                <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-12 text-center">
                  <MessageSquare className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                  <p className="text-sm text-slate-500">No comments yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {comments.map((comment: any) => (
                    <Link
                      key={comment.id}
                      href={`/community/post/${comment.post_id}`}
                      className="block bg-[#0D1117] border border-white/[0.06] rounded-xl p-4 hover:border-white/[0.12] transition-colors"
                    >
                      {comment.post_title && (
                        <div className="text-xs text-slate-500 mb-2">
                          Commented on: <span className="text-slate-400">{comment.post_title}</span>
                        </div>
                      )}
                      <p className="text-sm text-slate-300 line-clamp-3">{comment.body}</p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                        <span>{comment.upvote_count - comment.downvote_count} points</span>
                        <span>{comment.created_at ? new Date(comment.created_at).toLocaleDateString() : ''}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {tab === 'communities' && (
            <motion.div
              key="communities"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {profile.communities && profile.communities.length > 0 ? (
                <div className="space-y-2">
                  {profile.communities.map((c) => (
                    <Link
                      key={c.slug}
                      href={`/community/${c.slug}`}
                      className="block bg-[#0D1117] border border-white/[0.06] rounded-xl p-4 hover:border-white/[0.12] transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500/15 to-blue-500/15 border border-white/[0.06] flex items-center justify-center">
                          <Users className="w-5 h-5 text-cyan-400" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-200">c/{c.name}</p>
                          <p className="text-xs text-slate-500">{c.slug}</p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-12 text-center">
                  <Users className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                  <p className="text-sm text-slate-500">Not a member of any communities yet</p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
    </AppLayout>
  )
}
