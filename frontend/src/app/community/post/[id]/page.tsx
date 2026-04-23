'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronUp,
  ChevronDown,
  ArrowLeft,
  MessageSquare,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  Users,
  Loader2,
  AlertTriangle,
} from 'lucide-react'
import AppLayout from '@/components/AppLayout'
import CommentTree, { type Comment } from '@/components/community/CommentTree'
import CommentComposer from '@/components/community/CommentComposer'
import {
  fetchPost,
  fetchComments,
  createComment,
  votePost,
  type CommunityPost,
} from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

// ── Helpers ────────────────────────────────────────────────────

function formatRelativeTime(iso: string): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diff = Math.max(0, now - then)
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// ── Skeleton Components ────────────────────────────────────────

function PostSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-4 w-24 bg-slate-800 rounded" />
      <div className="h-8 w-3/4 bg-slate-800 rounded" />
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 bg-slate-800 rounded-full" />
        <div className="h-3 w-32 bg-slate-800 rounded" />
        <div className="h-3 w-20 bg-slate-800 rounded" />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-full bg-slate-800 rounded" />
        <div className="h-3 w-full bg-slate-800 rounded" />
        <div className="h-3 w-2/3 bg-slate-800 rounded" />
      </div>
    </div>
  )
}

function CommentsSkeleton() {
  return (
    <div className="animate-pulse space-y-4 mt-6">
      {[1, 2, 3].map((i) => (
        <div key={i} className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-5 w-5 bg-slate-800 rounded-full" />
            <div className="h-3 w-24 bg-slate-800 rounded" />
          </div>
          <div className="h-3 w-full bg-slate-800 rounded ml-7" />
          <div className="h-3 w-3/4 bg-slate-800 rounded ml-7" />
        </div>
      ))}
    </div>
  )
}

// ── Sentiment Badge ────────────────────────────────────────────

function SentimentBadge({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return null
  const config: Record<string, { icon: typeof TrendingUp; colors: string; label: string }> = {
    bullish: {
      icon: TrendingUp,
      colors: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
      label: 'Bullish',
    },
    bearish: {
      icon: TrendingDown,
      colors: 'bg-red-500/10 text-red-400 border-red-500/25',
      label: 'Bearish',
    },
    neutral: {
      icon: Minus,
      colors: 'bg-amber-500/10 text-amber-300 border-amber-500/25',
      label: 'Neutral',
    },
  }
  const c = config[sentiment]
  if (!c) return null
  const Icon = c.icon
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md border ${c.colors}`}>
      <Icon className="w-3 h-3" />
      {c.label}
    </span>
  )
}

// ── Main Page Component ────────────────────────────────────────

export default function PostThreadPage() {
  const params = useParams()
  const router = useRouter()
  const postId = Number(params?.id)

  const { user, isAuthenticated } = useAuth()

  const [post, setPost] = useState<CommunityPost | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [postLoading, setPostLoading] = useState(true)
  const [commentsLoading, setCommentsLoading] = useState(true)
  const [postError, setPostError] = useState<string | null>(null)
  const [commentSort, setCommentSort] = useState<string>('best')

  // Post vote state (optimistic)
  const [voteCount, setVoteCount] = useState(0)
  const [userVote, setUserVote] = useState<number | null>(null)
  const [voteLoading, setVoteLoading] = useState(false)

  // ── Data fetching ──────────────────────────────────────────

  const loadPost = useCallback(async () => {
    if (!postId || isNaN(postId)) {
      setPostError('Invalid post ID')
      setPostLoading(false)
      return
    }
    setPostLoading(true)
    setPostError(null)
    try {
      const data = await fetchPost(postId)
      if (!data) {
        setPostError('Post not found')
      } else {
        setPost(data)
        setVoteCount(data.vote_count)
        setUserVote(data.user_vote)
      }
    } catch (err) {
      setPostError(err instanceof Error ? err.message : 'Failed to load post')
    } finally {
      setPostLoading(false)
    }
  }, [postId])

  const loadComments = useCallback(async () => {
    if (!postId || isNaN(postId)) return
    setCommentsLoading(true)
    try {
      const data = await fetchComments(postId, commentSort)
      // Backend returns { items: [...] } (PaginatedComments) or { comments: [...] }
      const rawList = (data as any)?.items || (data as any)?.comments || (Array.isArray(data) ? data : [])
      // Map backend author object → frontend author_display_name
      const mapComment = (c: any): Comment => ({
        ...c,
        author_display_name: c.author_display_name || c.author?.username || c.author?.full_name || 'Anonymous',
        author_avatar_url: c.author_avatar_url || c.author?.avatar_url || null,
        replies: (c.replies || []).map(mapComment),
      })
      setComments(rawList.map(mapComment))
    } catch (err) {
      console.error('Failed to load comments:', err)
      setComments([])
    } finally {
      setCommentsLoading(false)
    }
  }, [postId, commentSort])

  useEffect(() => {
    loadPost()
    loadComments()
  }, [loadPost, loadComments])

  // ── Vote handler ───────────────────────────────────────────

  const handlePostVote = useCallback(async (direction: 1 | -1) => {
    if (!isAuthenticated || voteLoading || !post) return
    setVoteLoading(true)

    const prevCount = voteCount
    const prevVote = userVote

    // Optimistic update
    if (userVote === direction) {
      setUserVote(null)
      setVoteCount((c) => c - direction)
    } else {
      if (userVote !== null) setVoteCount((c) => c - userVote)
      setUserVote(direction)
      setVoteCount((c) => c + direction)
    }

    try {
      await votePost(post.id, direction)
    } catch {
      setVoteCount(prevCount)
      setUserVote(prevVote)
    } finally {
      setVoteLoading(false)
    }
  }, [isAuthenticated, voteLoading, post, voteCount, userVote])

  // ── Comment submit handlers ────────────────────────────────

  const handleCommentSubmit = useCallback(async (body: string, parentId?: number | null) => {
    if (!postId || !user) return

    // Optimistically prepend the new comment to the list
    const optimisticComment: Comment = {
      id: -Date.now(), // temporary negative ID
      body,
      post_id: postId,
      parent_id: parentId ?? null,
      author_id: (user as any).id ?? 0,
      author_display_name: (user as any).username ?? (user as any).email ?? 'You',
      author_avatar_url: (user as any).avatar_url ?? undefined,
      depth: 0,
      upvote_count: 0,
      downvote_count: 0,
      reply_count: 0,
      is_removed: false,
      created_at: new Date().toISOString(),
      user_vote: null,
      replies: [],
    }

    setComments(prev => [optimisticComment, ...prev])

    // Also bump the comment count optimistically
    if (post) {
      setPost(prev => prev ? { ...prev, comment_count: (prev.comment_count || 0) + 1 } : prev)
    }

    try {
      await createComment(postId, body, parentId ?? undefined)
    } catch {
      // Rollback optimistic comment on failure
      setComments(prev => prev.filter(c => c.id !== optimisticComment.id))
      if (post) {
        setPost(prev => prev ? { ...prev, comment_count: Math.max((prev.comment_count || 1) - 1, 0) } : prev)
      }
      return
    }

    // Refresh comments in background to get real IDs and server state
    loadComments()
  }, [postId, user, post, loadComments])

  const handleReplySubmit = useCallback(async (body: string, parentId: number) => {
    await createComment(postId, body, parentId)
    // Refresh to show the new reply in the tree
    loadComments()
  }, [postId, loadComments])

  // ── Render ─────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="min-h-screen px-3 py-4 sm:p-6 lg:p-8 pb-safe">
        <div className="max-w-3xl mx-auto">

          {/* Back button */}
          <motion.button
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors mb-4 sm:mb-6 group min-h-[44px] sm:min-h-0"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
            Back
          </motion.button>

          {/* ── Post Card ─────────────────────────────────────── */}

          {postLoading && <PostSkeleton />}

          {postError && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-16 text-center"
            >
              <AlertTriangle className="w-12 h-12 text-amber-500/60 mb-4" />
              <p className="text-sm text-slate-400 mb-2">{postError}</p>
              <button
                onClick={() => router.back()}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                Go back
              </button>
            </motion.div>
          )}

          {post && !postLoading && (
            <motion.article
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              {/* Community link + timestamp */}
              <div className="flex items-center gap-2 text-xs text-slate-500 mb-2 sm:mb-3 flex-wrap">
                {post.community && (
                  <Link
                    href={`/community/${post.community.slug}`}
                    className="flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors font-medium"
                  >
                    <Users className="w-3 h-3" />
                    {post.community.name}
                  </Link>
                )}
                <span className="text-slate-700">&#183;</span>
                <span className="flex items-center gap-1" title={formatFullDate(post.created_at)}>
                  <Clock className="w-3 h-3" />
                  {formatRelativeTime(post.created_at)}
                </span>
              </div>

              {/* Title */}
              <h1 className="text-lg sm:text-2xl font-bold text-white leading-tight mb-2 sm:mb-3 break-words">
                {post.title}
              </h1>

              {/* Author */}
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500/40 to-purple-500/40 border border-white/10 flex items-center justify-center text-xs font-bold text-slate-200 shrink-0">
                  {post.author?.username?.[0]?.toUpperCase() || '?'}
                </div>
                <span className="text-sm font-semibold text-slate-200">
                  {post.author?.username || 'Anonymous'}
                </span>
              </div>

              {/* Badges row: sentiment + tickers */}
              <div className="flex items-center gap-2 flex-wrap mb-4">
                <SentimentBadge sentiment={post.sentiment} />

                {post.tickers?.map((ticker) => (
                  <Link
                    key={ticker}
                    href={`/research?symbol=${ticker}`}
                    className="inline-flex items-center text-[11px] font-mono font-semibold
                      px-2 py-0.5 rounded-md border
                      bg-cyan-500/8 text-cyan-400 border-cyan-500/20
                      hover:bg-cyan-500/15 transition-colors"
                  >
                    ${ticker}
                  </Link>
                ))}
              </div>

              {/* Post body */}
              <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap break-words mb-4 sm:mb-5 overflow-x-hidden">
                {post.body}
              </div>

              {/* Financial disclaimer */}
              <p className="text-[10px] text-slate-600 leading-relaxed mb-4">
                This is community discussion, not financial advice. Always do your own research.
              </p>

              {/* Vote bar + stats */}
              <div className="flex items-center gap-3 sm:gap-4 py-3 border-t border-b border-white/[0.04]">
                {/* Vote buttons */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handlePostVote(1)}
                    disabled={!isAuthenticated}
                    className={`p-2 sm:p-1.5 rounded-md transition-colors min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center ${
                      userVote === 1
                        ? 'text-blue-400 bg-blue-500/10'
                        : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]'
                    } disabled:opacity-30 disabled:cursor-not-allowed`}
                    title={isAuthenticated ? 'Upvote' : 'Login to vote'}
                  >
                    <ChevronUp className="w-5 h-5" />
                  </button>
                  <span className={`text-sm font-semibold font-mono min-w-[28px] text-center ${
                    voteCount > 0 ? 'text-blue-400' : voteCount < 0 ? 'text-red-400' : 'text-slate-500'
                  }`}>
                    {voteCount}
                  </span>
                  <button
                    onClick={() => handlePostVote(-1)}
                    disabled={!isAuthenticated}
                    className={`p-2 sm:p-1.5 rounded-md transition-colors min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center ${
                      userVote === -1
                        ? 'text-red-400 bg-red-500/10'
                        : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]'
                    } disabled:opacity-30 disabled:cursor-not-allowed`}
                    title={isAuthenticated ? 'Downvote' : 'Login to vote'}
                  >
                    <ChevronDown className="w-5 h-5" />
                  </button>
                </div>

                {/* Comment count */}
                <div className="flex items-center gap-1.5 text-sm text-slate-500">
                  <MessageSquare className="w-4 h-4" />
                  <span>{post.comment_count} {post.comment_count === 1 ? 'comment' : 'comments'}</span>
                </div>
              </div>
            </motion.article>
          )}

          {/* ── Comment Composer (top level) ─────────────────── */}

          {post && !postLoading && (
            <div className="mt-6 mb-6">
              {isAuthenticated ? (
                <CommentComposer
                  postId={postId}
                  onSubmit={handleCommentSubmit}
                />
              ) : (
                <div className="bg-[#0D1117] border border-white/[0.06] rounded-lg p-4 text-center">
                  <p className="text-sm text-slate-500">
                    <Link href="/login" className="text-blue-400 hover:text-blue-300 transition-colors font-medium">
                      Sign in
                    </Link>
                    {' '}to join the discussion
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Comments Section ──────────────────────────────── */}

          {post && !postLoading && (
            <section>
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider">
                    Comments
                  </h2>
                  {!commentsLoading && comments.length > 0 && (
                    <span className="text-[10px] text-slate-600 bg-slate-800/50 px-1.5 py-0.5 rounded font-mono">
                      {comments.length}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 uppercase tracking-wider">Sort by</span>
                  <select
                    value={commentSort}
                    onChange={(e) => setCommentSort(e.target.value)}
                    className="bg-slate-800/50 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                  >
                    <option value="best">Best</option>
                    <option value="top">Top</option>
                    <option value="new">New</option>
                    <option value="controversial">Controversial</option>
                  </select>
                </div>
              </div>

              {commentsLoading ? (
                <CommentsSkeleton />
              ) : (
                <CommentTree
                  comments={comments}
                  postId={postId}
                  isAuthenticated={isAuthenticated}
                  onReplySubmit={handleReplySubmit}
                />
              )}
            </section>
          )}

        </div>
      </div>
    </AppLayout>
  )
}
