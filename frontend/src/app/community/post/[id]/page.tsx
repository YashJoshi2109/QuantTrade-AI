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
  ExternalLink,
  Share2,
  Home,
  ChevronRight,
  Image as ImageIcon,
  Play,
} from 'lucide-react'
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import CommentTree, { type Comment } from '@/components/community/CommentTree'
import CommentComposer from '@/components/community/CommentComposer'
import {
  fetchPost,
  fetchComments,
  createComment,
  votePost,
  resolveMediaUrl,
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

// ── Skeleton ────────────────────────────────────────────────────

function PostSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="flex gap-4">
        <div className="hidden sm:flex flex-col items-center gap-2 w-10">
          <div className="h-8 w-8 bg-slate-800 rounded-lg" />
          <div className="h-4 w-6 bg-slate-800 rounded" />
          <div className="h-8 w-8 bg-slate-800 rounded-lg" />
        </div>
        <div className="flex-1 space-y-3">
          <div className="h-3 w-32 bg-slate-800 rounded" />
          <div className="h-7 w-3/4 bg-slate-800 rounded" />
          <div className="flex gap-2">
            <div className="h-5 w-20 bg-slate-800 rounded-full" />
            <div className="h-5 w-16 bg-slate-800 rounded-full" />
          </div>
          <div className="h-32 w-full bg-slate-800 rounded-xl" />
        </div>
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
  const config: Record<string, { icon: typeof TrendingUp; colors: string; label: string; dot: string }> = {
    bullish: {
      icon: TrendingUp,
      colors: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
      label: 'Bullish',
      dot: 'bg-emerald-400',
    },
    bearish: {
      icon: TrendingDown,
      colors: 'bg-red-500/10 text-red-400 border-red-500/25',
      label: 'Bearish',
      dot: 'bg-red-400',
    },
    neutral: {
      icon: Minus,
      colors: 'bg-amber-500/10 text-amber-300 border-amber-500/25',
      label: 'Neutral',
      dot: 'bg-amber-400',
    },
  }
  const c = config[sentiment]
  if (!c) return null
  const Icon = c.icon
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${c.colors}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      <Icon className="w-3 h-3" />
      {c.label}
    </span>
  )
}

// ── Breadcrumb ────────────────────────────────────────────────

function Breadcrumb({ post }: { post: CommunityPost | null }) {
  return (
    <nav className="flex items-center gap-1 text-xs text-slate-500 mb-4 flex-wrap">
      <Link href="/community" className="flex items-center gap-1 hover:text-slate-300 transition-colors">
        <Home className="w-3 h-3" />
        <span>Community</span>
      </Link>
      {post?.community && (
        <>
          <ChevronRight className="w-3 h-3 text-slate-700" />
          <Link
            href={`/community/${post.community.slug}`}
            className="hover:text-slate-300 transition-colors font-medium text-slate-400"
          >
            c/{post.community.name}
          </Link>
        </>
      )}
      {post && (
        <>
          <ChevronRight className="w-3 h-3 text-slate-700" />
          <span className="text-slate-600 truncate max-w-[200px]">{post.title}</span>
        </>
      )}
    </nav>
  )
}

// ── Media Gallery ────────────────────────────────────────────

function MediaGallery({ urls }: { urls: string[] }) {
  const [active, setActive] = useState(0)
  const [imgError, setImgError] = useState<Set<number>>(new Set())

  if (!urls || urls.length === 0) return null

  const validUrls = urls.filter((_, i) => !imgError.has(i))
  if (validUrls.length === 0) return null

  const currentUrl = resolveMediaUrl(urls[active] || '')
  const isVideo = currentUrl?.match(/\.(mp4|webm|ogg)(\?|$)/i)

  return (
    <div className="mb-5">
      {/* Main media */}
      <div className="relative rounded-xl overflow-hidden bg-[#0d1117] border border-white/[0.06]">
        {isVideo ? (
          <video
            src={currentUrl}
            className="w-full max-h-[480px] object-contain"
            controls
            playsInline
            preload="metadata"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentUrl}
            alt={`Media ${active + 1}`}
            className="w-full max-h-[480px] object-contain"
            onError={() => setImgError((prev) => { const n = new Set(prev); n.add(active); return n })}
          />
        )}

        {/* Media type badge */}
        <div className="absolute top-2 left-2">
          {isVideo ? (
            <span className="flex items-center gap-1 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-full font-medium">
              <Play className="w-2.5 h-2.5" /> Video
            </span>
          ) : (
            <span className="flex items-center gap-1 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-full font-medium">
              <ImageIcon className="w-2.5 h-2.5" /> Image
            </span>
          )}
        </div>
      </div>

      {/* Thumbnails strip for multiple media */}
      {urls.length > 1 && (
        <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
          {urls.map((url, i) => {
            if (imgError.has(i)) return null
            return (
              <button
                key={i}
                onClick={() => setActive(i)}
                className={`shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-colors ${
                  i === active ? 'border-blue-500' : 'border-transparent hover:border-white/20'
                }`}
              >
                {url.match(/\.(mp4|webm|ogg)(\?|$)/i) ? (
                  <div className="w-full h-full bg-slate-800 flex items-center justify-center">
                    <Play className="w-4 h-4 text-slate-400" />
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={resolveMediaUrl(url)}
                    alt={`Thumb ${i + 1}`}
                    className="w-full h-full object-cover"
                    onError={() => setImgError((prev) => { const n = new Set(prev); n.add(i); return n })}
                  />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Vote Column (desktop left sidebar) ───────────────────────

function VoteColumn({
  voteCount,
  userVote,
  onVote,
  disabled,
}: {
  voteCount: number
  userVote: number | null
  onVote: (dir: 1 | -1) => void
  disabled: boolean
}) {
  return (
    <div className="hidden sm:flex flex-col items-center gap-1 pt-1">
      <button
        onClick={() => onVote(1)}
        disabled={disabled}
        className={`p-2 rounded-lg transition-all group ${
          userVote === 1
            ? 'bg-orange-500/15 text-orange-400'
            : 'text-slate-500 hover:text-orange-400 hover:bg-orange-500/10'
        } disabled:opacity-30 disabled:cursor-not-allowed`}
        title="Upvote"
      >
        <ChevronUp className={`w-5 h-5 transition-transform group-hover:-translate-y-0.5 ${userVote === 1 ? '' : ''}`} />
      </button>
      <span className={`text-sm font-bold font-mono tabular-nums ${
        voteCount > 0 ? 'text-orange-400' : voteCount < 0 ? 'text-blue-400' : 'text-slate-500'
      }`}>
        {voteCount > 999 ? `${(voteCount / 1000).toFixed(1)}k` : voteCount}
      </span>
      <button
        onClick={() => onVote(-1)}
        disabled={disabled}
        className={`p-2 rounded-lg transition-all group ${
          userVote === -1
            ? 'bg-blue-500/15 text-blue-400'
            : 'text-slate-500 hover:text-blue-400 hover:bg-blue-500/10'
        } disabled:opacity-30 disabled:cursor-not-allowed`}
        title="Downvote"
      >
        <ChevronDown className="w-5 h-5 transition-transform group-hover:translate-y-0.5" />
      </button>
    </div>
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
  const [shareConfirm, setShareConfirm] = useState(false)

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
      const rawList = (data as any)?.items || (data as any)?.comments || (Array.isArray(data) ? data : [])
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

  // ── Comment handlers ────────────────────────────────────────

  const handleCommentSubmit = useCallback(async (body: string, parentId?: number | null) => {
    if (!postId || !user) return
    const optimisticComment: Comment = {
      id: -Date.now(),
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
    if (post) setPost(prev => prev ? { ...prev, comment_count: (prev.comment_count || 0) + 1 } : prev)
    try {
      await createComment(postId, body, parentId ?? undefined)
    } catch {
      setComments(prev => prev.filter(c => c.id !== optimisticComment.id))
      if (post) setPost(prev => prev ? { ...prev, comment_count: Math.max((prev.comment_count || 1) - 1, 0) } : prev)
      return
    }
    loadComments()
  }, [postId, user, post, loadComments])

  const handleReplySubmit = useCallback(async (body: string, parentId: number) => {
    await createComment(postId, body, parentId)
    loadComments()
  }, [postId, loadComments])

  const handleShare = useCallback(() => {
    const url = typeof window !== 'undefined' ? window.location.href : `/community/post/${postId}`
    navigator.clipboard.writeText(url).then(() => {
      setShareConfirm(true)
      setTimeout(() => setShareConfirm(false), 2000)
    }).catch(() => {})
  }, [postId])

  // ── Render ─────────────────────────────────────────────────

  const content = (
    <div className="min-h-screen pb-safe">
      {/* Mobile Header */}
      <header className="md:hidden sticky top-0 z-30 bg-[#0A0E1A]/95 backdrop-blur-xl border-b border-white/[0.06] px-3 py-2.5 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="p-1.5 -ml-1.5 rounded-full text-slate-400 hover:text-white transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-bold text-white leading-tight truncate">
            {postLoading ? 'Loading…' : post?.title || 'Post'}
          </span>
          {post?.community && (
            <span className="text-[10px] text-slate-500 leading-none">c/{post.community.name}</span>
          )}
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-3 py-4 sm:px-4 sm:py-6">

        {/* Desktop back + breadcrumb */}
        <div className="hidden md:block mb-4">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors mb-3 group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
            Back
          </button>
          {!postLoading && <Breadcrumb post={post} />}
        </div>

        {/* Loading */}
        {postLoading && (
          <div className="bg-[#0D1117] border border-white/[0.06] rounded-2xl p-5">
            <PostSkeleton />
          </div>
        )}

        {/* Error */}
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

        {/* Post Card — Reddit-style */}
        {post && !postLoading && (
          <motion.article
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="bg-[#0D1117] border border-white/[0.06] rounded-2xl overflow-hidden mb-4"
          >
            {/* Hero image for news posts */}
            {post.post_type === 'news' && post.media_urls && post.media_urls.length > 0 && (
              <div className="relative w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={resolveMediaUrl(post.media_urls[0])}
                  alt={post.title}
                  className="w-full max-h-64 sm:max-h-80 object-cover"
                  onError={(e) => { (e.target as HTMLElement).parentElement!.style.display = 'none' }}
                />
                <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#0D1117] to-transparent" />
                <div className="absolute top-3 left-3">
                  <span className="bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                    News
                  </span>
                </div>
              </div>
            )}

            <div className="flex gap-0 sm:gap-4 p-4 sm:p-5">
              {/* Left vote column (desktop) */}
              <VoteColumn
                voteCount={voteCount}
                userVote={userVote}
                onVote={handlePostVote}
                disabled={!isAuthenticated || voteLoading}
              />

              {/* Post content */}
              <div className="flex-1 min-w-0">
                {/* Meta: community + author + time */}
                <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-2 flex-wrap">
                  {post.community?.slug && (
                    <Link
                      href={`/community/${post.community.slug}`}
                      className="flex items-center gap-1 font-semibold text-slate-300 hover:text-white transition-colors"
                    >
                      <Users className="w-3 h-3" />
                      c/{post.community.name}
                    </Link>
                  )}
                  <span className="text-slate-700">·</span>
                  <span>Posted by</span>
                  <Link
                    href={post.author?.username ? `/community/user/${post.author.username}` : '#'}
                    className="text-slate-400 hover:text-blue-400 transition-colors font-medium"
                  >
                    {post.author?.username || 'Anonymous'}
                  </Link>
                  <span className="text-slate-700">·</span>
                  <span
                    className="flex items-center gap-1 text-slate-500"
                    title={formatFullDate(post.created_at)}
                  >
                    <Clock className="w-3 h-3" />
                    {formatRelativeTime(post.created_at)}
                  </span>
                </div>

                {/* Title */}
                <h1 className="text-lg sm:text-xl font-bold text-white leading-snug mb-3 break-words">
                  {post.title}
                </h1>

                {/* Badges: sentiment + tickers */}
                {(post.sentiment || (post.tickers && post.tickers.length > 0)) && (
                  <div className="flex items-center gap-2 flex-wrap mb-3">
                    <SentimentBadge sentiment={post.sentiment} />
                    {post.tickers?.map((ticker) => (
                      <Link
                        key={ticker}
                        href={`/research?symbol=${ticker}`}
                        className="inline-flex items-center text-[11px] font-mono font-bold
                          px-2.5 py-1 rounded-full border
                          bg-cyan-500/8 text-cyan-400 border-cyan-500/20
                          hover:bg-cyan-500/15 transition-colors"
                      >
                        ${ticker}
                      </Link>
                    ))}
                  </div>
                )}

                {/* Media gallery (uploaded images/videos) — non-news posts */}
                {post.post_type !== 'news' && post.media_urls && post.media_urls.length > 0 && (
                  <MediaGallery urls={post.media_urls} />
                )}

                {/* Post body */}
                {post.body && (
                  <div className="text-sm sm:text-[15px] text-slate-300 leading-relaxed whitespace-pre-wrap break-words mb-4 overflow-x-hidden">
                    {post.body}
                  </div>
                )}

                {/* News source link */}
                {post.source_url && (
                  <a
                    href={post.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-blue-400 transition-colors mb-4 bg-[#131820] border border-white/[0.06] rounded-lg px-3 py-2 hover:border-blue-500/30"
                  >
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">
                      {(() => {
                        try { return new URL(post.source_url).hostname.replace('www.', '') } catch { return post.source_url }
                      })()}
                    </span>
                    <span className="text-slate-600 ml-auto shrink-0">Read article →</span>
                  </a>
                )}

                {/* Action bar */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Mobile vote buttons */}
                  <div className="flex items-center gap-1 sm:hidden">
                    <button
                      onClick={() => handlePostVote(1)}
                      disabled={!isAuthenticated}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors min-h-[36px] ${
                        userVote === 1
                          ? 'bg-orange-500/15 text-orange-400'
                          : 'bg-[#131820] text-slate-400 hover:text-orange-400 hover:bg-orange-500/10'
                      } disabled:opacity-40`}
                    >
                      <ChevronUp className="w-4 h-4" />
                      <span>{voteCount}</span>
                    </button>
                    <button
                      onClick={() => handlePostVote(-1)}
                      disabled={!isAuthenticated}
                      className={`p-1.5 rounded-full transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center ${
                        userVote === -1
                          ? 'bg-blue-500/15 text-blue-400'
                          : 'bg-[#131820] text-slate-400 hover:text-blue-400 hover:bg-blue-500/10'
                      } disabled:opacity-40`}
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>

                  <button className="flex items-center gap-1.5 px-3 py-1.5 bg-[#131820] hover:bg-[#1a2130] rounded-full text-xs text-slate-400 hover:text-white transition-colors min-h-[36px]">
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>{post.comment_count} {post.comment_count === 1 ? 'comment' : 'comments'}</span>
                  </button>

                  <button
                    onClick={handleShare}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#131820] hover:bg-[#1a2130] rounded-full text-xs transition-colors min-h-[36px] text-slate-400 hover:text-white"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>{shareConfirm ? 'Copied!' : 'Share'}</span>
                  </button>
                </div>
              </div>
            </div>
          </motion.article>
        )}

        {/* Comment Composer */}
        {post && !postLoading && (
          <div className="mb-4">
            {isAuthenticated ? (
              <CommentComposer
                postId={postId}
                onSubmit={handleCommentSubmit}
              />
            ) : (
              <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-4 text-center">
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

        {/* Comments Section */}
        {post && !postLoading && (
          <section>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                  {comments.length > 0 ? `${comments.length} Comment${comments.length !== 1 ? 's' : ''}` : 'Comments'}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-600 uppercase tracking-wider">Sort</span>
                <select
                  value={commentSort}
                  onChange={(e) => setCommentSort(e.target.value)}
                  className="bg-[#0D1117] border border-white/[0.06] rounded-lg px-2.5 py-1.5 text-xs text-slate-400 focus:outline-none focus:border-blue-500/30 cursor-pointer"
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
            ) : comments.length === 0 ? (
              <div className="py-12 text-center">
                <MessageSquare className="w-8 h-8 text-slate-700 mx-auto mb-3" />
                <p className="text-sm text-slate-600">No comments yet. Be the first!</p>
              </div>
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
