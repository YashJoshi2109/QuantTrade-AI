'use client'

import { useState, useCallback, useEffect, useRef, forwardRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowBigUp,
  ArrowBigDown,
  MessageSquare,
  Share2,
  Bookmark,
  Flag,
  Check,
  Pin,
  Lock,
  MoreHorizontal,
  Repeat,
} from 'lucide-react'
import { votePost, bookmarkPost, unbookmarkPost, addReaction, removeReaction, fetchReactions, resolveMediaUrl, type CommunityPost, type ReactionSummary } from '@/lib/api'
import ReportModal from '@/components/community/ReportModal'
import { useStockSnapshot } from '@/context/StockSnapshotContext'

/** Render simple markdown subset to HTML for post body previews */
function renderBodyMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-fg-secondary font-semibold">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="px-1 py-0.5 bg-surface-raised rounded text-cyan-400 text-xs">$1</code>')
    .replace(
      /\$([A-Z]{1,5})/g,
      '<span class="text-cyan-400 font-mono font-semibold">$$1</span>'
    )
    .replace(/---+/g, '')
    .replace(/\n/g, ' ')
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

const sentimentConfig: Record<string, { label: string; color: string; bg: string }> = {
  bullish: { label: 'Bullish', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  bearish: { label: 'Bearish', color: 'text-red-400', bg: 'bg-red-500/10' },
  neutral: { label: 'Neutral', color: 'text-amber-400', bg: 'bg-amber-500/10' },
}

const REACTION_EMOJIS: { key: string; icon: string }[] = [
  { key: 'bullish', icon: '\u{1F402}' },
  { key: 'bearish', icon: '\u{1F43B}' },
  { key: 'rocket', icon: '\u{1F680}' },
  { key: 'diamond_hands', icon: '\u{1F48E}' },
  { key: 'think', icon: '\u{1F914}' },
]

interface PostCardProps {
  post: CommunityPost
  index?: number
  focused?: boolean
  expanded?: boolean
  onVote?: (postId: number, direction: 1 | -1) => void
  toastFn?: (msg: string, type?: string) => void
}

const PostCard = forwardRef<HTMLDivElement, PostCardProps>(
  function PostCard({ post, index = 0, focused = false, expanded = false, onVote, toastFn }, ref) {
    const [voteCount, setVoteCount] = useState(post.vote_count)
    const [userVote, setUserVote] = useState<number | null>(post.user_vote)
    const [bookmarked, setBookmarked] = useState(false)
    const [shareConfirm, setShareConfirm] = useState(false)
    const [voteDirection, setVoteDirection] = useState<'up' | 'down' | null>(null)
    const [showReport, setShowReport] = useState(false)
    const [showMore, setShowMore] = useState(false)
    const [showShareMenu, setShowShareMenu] = useState(false)
    const router = useRouter()
    const { openSnapshot } = useStockSnapshot()
    const shareTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const shareMenuRef = useRef<HTMLDivElement>(null)

    // Sync vote state when post data changes (e.g. after page refresh / re-fetch)
    useEffect(() => {
      setUserVote(post.user_vote)
      setVoteCount(post.vote_count)
    }, [post.user_vote, post.vote_count])

    // Reactions state
    const [reactions, setReactions] = useState<ReactionSummary[]>([])
    const [reactionsLoaded, setReactionsLoaded] = useState(false)
    const reactionsRef = useRef<HTMLDivElement>(null)

    // Lazy-load reactions only when the card scrolls near the viewport
    useEffect(() => {
      const el = reactionsRef.current
      if (!el || reactionsLoaded) return
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            observer.disconnect()
            fetchReactions(post.id)
              .then((data) => { setReactions(data); setReactionsLoaded(true) })
              .catch(() => setReactionsLoaded(true))
          }
        },
        { rootMargin: '400px' }
      )
      observer.observe(el)
      return () => observer.disconnect()
    }, [post.id, reactionsLoaded])

    const notify = useCallback((msg: string, type?: string) => {
      toastFn?.(msg, type)
    }, [toastFn])

    const handleReaction = useCallback(async (emoji: string) => {
      const existing = reactions.find((r) => r.emoji === emoji)
      const wasReacted = existing?.reacted ?? false

      // Optimistic update
      setReactions((prev) => {
        const updated = prev.map((r) =>
          r.emoji === emoji
            ? { ...r, count: r.count + (wasReacted ? -1 : 1), reacted: !wasReacted }
            : r
        )
        // If emoji not in list yet, add it
        if (!prev.find((r) => r.emoji === emoji)) {
          updated.push({ emoji, count: 1, reacted: true })
        }
        return updated
      })

      const ok = wasReacted
        ? await removeReaction(post.id, emoji)
        : await addReaction(post.id, emoji)

      if (!ok) {
        // Revert
        setReactions((prev) =>
          prev.map((r) =>
            r.emoji === emoji
              ? { ...r, count: r.count + (wasReacted ? 1 : -1), reacted: wasReacted }
              : r
          ).filter((r) => r.count > 0)
        )
        notify('Reaction failed', 'error')
      }
    }, [reactions, post.id, notify])

    const handleVote = useCallback(async (direction: 1 | -1) => {
      const prevVote = userVote
      const prevCount = voteCount

      setVoteDirection(direction === 1 ? 'up' : 'down')
      setTimeout(() => setVoteDirection(null), 300)

      if (userVote === direction) {
        setUserVote(null)
        setVoteCount(voteCount - direction)
      } else {
        const delta = userVote ? direction * 2 : direction
        setUserVote(direction)
        setVoteCount(voteCount + delta)
      }

      onVote?.(post.id, direction)

      const ok = await votePost(post.id, direction)
      if (!ok) {
        setUserVote(prevVote)
        setVoteCount(prevCount)
        notify('Vote failed. Please try again.', 'error')
      }
    }, [userVote, voteCount, post.id, onVote, notify])

    const handleBookmark = useCallback(async () => {
      const next = !bookmarked
      setBookmarked(next)
      notify(next ? 'Saved to bookmarks' : 'Removed from saved', 'success')

      const ok = next
        ? await bookmarkPost(post.id)
        : await unbookmarkPost(post.id)
      if (!ok) {
        setBookmarked(!next)
        notify('Bookmark failed. Please try again.', 'error')
      }
    }, [bookmarked, notify, post.id])

    const postUrl = typeof window !== 'undefined'
      ? `${window.location.origin}/community/post/${post.id}`
      : `/community/post/${post.id}`

    const handleCopyLink = useCallback(() => {
      navigator.clipboard.writeText(postUrl).then(() => {
        setShareConfirm(true)
        setShowShareMenu(false)
        notify('Link copied to clipboard!', 'success')
        if (shareTimeoutRef.current) clearTimeout(shareTimeoutRef.current)
        shareTimeoutRef.current = setTimeout(() => setShareConfirm(false), 2000)
      }).catch(() => {
        notify('Failed to copy link', 'error')
      })
    }, [postUrl, notify])

    const handleShareTwitter = useCallback(() => {
      const text = encodeURIComponent(post.title)
      const url = encodeURIComponent(postUrl)
      window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank', 'noopener')
      setShowShareMenu(false)
    }, [post.title, postUrl])

    const handleShareReddit = useCallback(() => {
      const title = encodeURIComponent(post.title)
      const url = encodeURIComponent(postUrl)
      window.open(`https://www.reddit.com/submit?title=${title}&url=${url}`, '_blank', 'noopener')
      setShowShareMenu(false)
    }, [post.title, postUrl])

    const handleShareDM = useCallback(() => {
      router.push(`/community/messages/new?message=${encodeURIComponent(postUrl)}`)
      setShowShareMenu(false)
    }, [postUrl, router])

    const handleCrosspost = useCallback(() => {
      const title = post.title
      const body = `${post.body ? post.body + '\n\n' : ''}Crossposted from ${postUrl}`
      router.push(`/community?create=true&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`)
      setShowShareMenu(false)
    }, [post, postUrl, router])

    // Close share menu on outside click
    useEffect(() => {
      if (!showShareMenu) return
      const handleClickOutside = (e: MouseEvent) => {
        if (shareMenuRef.current && !shareMenuRef.current.contains(e.target as Node)) {
          setShowShareMenu(false)
        }
      }
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [showShareMenu])

    const sentiment = post.sentiment ? sentimentConfig[post.sentiment.toLowerCase()] : null

    return (
      <motion.div
        ref={ref}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, delay: index * 0.03 }}
        className={`relative bg-surface-raised rounded-2xl transition-colors duration-150 group ${
          focused
            ? 'ring-1 ring-blue-500/30 bg-surface-hover'
            : 'hover:bg-surface-hover'
        }`}
      >
        <div className="px-3 sm:px-4 pt-3 pb-1">
          {/* Meta line — community + author + time */}
          <div className="flex items-center gap-1.5 text-xs mb-2 flex-wrap">
            {post.community?.slug && (
              <>
                <Link
                  href={`/community/${post.community.slug}`}
                  className="font-semibold text-fg-secondary hover:text-fg-primary transition-colors"
                >
                  c/{post.community.name}
                </Link>
                <span className="text-fg-muted">·</span>
              </>
            )}
            <Link
              href={`/community/user/${post.author?.username ?? 'unknown'}`}
              className="text-fg-muted hover:text-fg-secondary transition-colors"
            >
              {post.author?.username ?? 'unknown'}
            </Link>
            <span className="text-fg-muted">·</span>
            <span className="text-fg-muted">{timeAgo(post.created_at)}</span>

            {/* Pinned badge */}
            {(post as any).is_pinned && (
              <>
                <span className="text-fg-muted">·</span>
                <span className="inline-flex items-center gap-0.5 text-emerald-400">
                  <Pin className="w-3 h-3" /> Pinned
                </span>
              </>
            )}

            {/* Locked badge */}
            {(post as any).is_locked && (
              <>
                <span className="text-fg-muted">·</span>
                <span className="inline-flex items-center gap-0.5 text-amber-400">
                  <Lock className="w-3 h-3" /> Locked
                </span>
              </>
            )}
          </div>

          {/* Title */}
          <Link href={`/community/post/${post.id}`} className="block">
            <h3 className="text-[15px] font-medium text-fg-primary leading-snug mb-1 group-hover:text-fg-primary transition-colors cursor-pointer">
              {post.title}
            </h3>
          </Link>

          {/* Body preview */}
          {post.body && (
            <div
              className="text-[13px] text-fg-secondary line-clamp-3 mb-2 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: renderBodyMarkdown(post.body) }}
            />
          )}

          {/* Media thumbnail(s) */}
          {post.media_urls && post.media_urls.length > 0 && (
            <Link href={`/community/post/${post.id}`} className="block mb-2 rounded-xl overflow-hidden">
              {post.media_urls[0].match(/\.(mp4|webm|ogg)(\?|$)/i) ? (
                <video
                  src={resolveMediaUrl(post.media_urls[0])}
                  className="w-full max-h-72 object-cover rounded-xl"
                  muted
                  playsInline
                  preload="metadata"
                />
              ) : (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={resolveMediaUrl(post.media_urls[0])}
                    alt="Post media"
                    className="w-full max-h-72 object-cover rounded-xl bg-surface-base"
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                  {post.media_urls.length > 1 && (
                    <span className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-0.5 rounded-full font-medium">
                      +{post.media_urls.length - 1} more
                    </span>
                  )}
                </div>
              )}
            </Link>
          )}

          {/* News source link */}
          {post.post_type === 'news' && post.source_url && (
            <a
              href={post.source_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-[11px] text-fg-muted hover:text-blue-400 transition-colors mb-2 truncate max-w-full"
            >
              <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
              <span className="truncate">{(() => { try { return new URL(post.source_url!).hostname.replace('www.', '') } catch { return post.source_url } })()}</span>
            </a>
          )}

          {/* Ticker + Sentiment chips */}
          {(post.tickers?.length || sentiment) && (
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              {post.tickers?.map((ticker) => (
                <button
                  key={ticker}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); openSnapshot({ symbol: ticker, name: ticker }) }}
                  className="px-2 py-0.5 text-[11px] font-mono font-bold text-cyan-400 bg-cyan-500/10 rounded-md hover:bg-cyan-500/20 transition-colors"
                >
                  ${ticker}
                </button>
              ))}
              {sentiment && (
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${sentiment.bg} ${sentiment.color}`}>
                  {post.sentiment === 'bullish' ? '\u{1F7E2}' : post.sentiment === 'bearish' ? '\u{1F534}' : '\u26AA'} {sentiment.label}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Action bar — Reddit-style pill buttons */}
        <div className="flex items-center gap-1 sm:gap-1 px-2 sm:px-2 pb-2 flex-wrap">
          {/* Upvote pill */}
          <button
            onClick={() => handleVote(1)}
            className={`flex items-center gap-1 px-3 sm:px-2.5 py-2 sm:py-1.5 rounded-full transition-colors min-h-[44px] sm:min-h-0 ${
              userVote === 1
                ? 'bg-orange-500/15 text-orange-400'
                : 'bg-surface-raised text-fg-muted hover:text-orange-400 hover:bg-orange-500/10'
            }`}
          >
            <ArrowBigUp className={`w-5 h-5 sm:w-4.5 sm:h-4.5 ${userVote === 1 ? 'fill-orange-400' : ''}`} />
            <span className="text-xs font-semibold tabular-nums">{post.upvote_count || 0}</span>
          </button>

          {/* Downvote pill */}
          <button
            onClick={() => handleVote(-1)}
            className={`flex items-center gap-1 px-3 sm:px-2.5 py-2 sm:py-1.5 rounded-full transition-colors min-h-[44px] sm:min-h-0 ${
              userVote === -1
                ? 'bg-blue-500/15 text-blue-400'
                : 'bg-surface-raised text-fg-muted hover:text-blue-400 hover:bg-blue-500/10'
            }`}
          >
            <ArrowBigDown className={`w-5 h-5 sm:w-4.5 sm:h-4.5 ${userVote === -1 ? 'fill-blue-400' : ''}`} />
            <span className="text-xs font-semibold tabular-nums">{post.downvote_count || 0}</span>
          </button>

          {/* Comments pill */}
          <Link
            href={`/community/post/${post.id}`}
            className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 bg-surface-raised rounded-full text-xs text-fg-muted hover:text-fg-primary hover:bg-surface-hover transition-colors min-h-[44px] sm:min-h-0"
          >
            <MessageSquare className="w-4 h-4" />
            <span>{post.comment_count}</span>
          </Link>

          {/* Share pill with dropdown */}
          <div className="relative" ref={shareMenuRef}>
            <button
              onClick={() => setShowShareMenu(!showShareMenu)}
              className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 bg-surface-raised rounded-full text-xs text-fg-muted hover:text-fg-primary hover:bg-surface-hover transition-colors min-h-[44px] sm:min-h-0"
            >
              {shareConfirm ? (
                <Check className="w-4 h-4 text-emerald-400" />
              ) : (
                <Share2 className="w-4 h-4" />
              )}
              <span className="hidden sm:inline">{shareConfirm ? 'Copied!' : 'Share'}</span>
            </button>
            {showShareMenu && (
              <div className="absolute left-0 bottom-[calc(100%+6px)] z-30 w-64 bg-surface-overlay border border-line-subtle rounded-2xl shadow-theme-lg overflow-hidden">
                {/* URL bar */}
                <div className="px-3 pt-3 pb-2">
                  <p className="text-[10px] font-semibold text-fg-muted uppercase tracking-wider mb-1.5">Share</p>
                  <div className="flex items-center gap-1.5 bg-surface-raised border border-line-subtle rounded-xl px-3 py-2">
                    <span className="text-[11px] text-fg-secondary truncate flex-1 font-mono">{postUrl}</span>
                    <button
                      onClick={handleCopyLink}
                      className="shrink-0 p-1 rounded-md hover:bg-surface-hover transition-colors text-fg-muted hover:text-white"
                      title="Copy link"
                    >
                      {shareConfirm
                        ? <Check className="w-3.5 h-3.5 text-emerald-400" />
                        : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                      }
                    </button>
                  </div>
                </div>
                <div className="h-px bg-white/[0.06] mx-3" />
                {/* Actions */}
                <div className="py-1.5">
                  <button onClick={handleShareDM} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-fg-secondary hover:text-fg-primary hover:bg-surface-hover transition-colors">
                    <div className="w-7 h-7 rounded-full bg-blue-500/15 flex items-center justify-center shrink-0">
                      <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
                    </div>
                    <span className="font-medium">Send via DM</span>
                  </button>
                  <button onClick={handleCrosspost} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-fg-secondary hover:text-fg-primary hover:bg-surface-hover transition-colors">
                    <div className="w-7 h-7 rounded-full bg-purple-500/15 flex items-center justify-center shrink-0">
                      <Repeat className="w-3.5 h-3.5 text-purple-400" />
                    </div>
                    <span className="font-medium">Crosspost</span>
                  </button>
                  <button onClick={handleShareTwitter} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-fg-secondary hover:text-fg-primary hover:bg-surface-hover transition-colors">
                    <div className="w-7 h-7 rounded-full bg-surface-raised flex items-center justify-center shrink-0">
                      <svg className="w-3.5 h-3.5 text-fg-secondary" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                    </div>
                    <span className="font-medium">Post to X</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Save pill */}
          <button
            onClick={handleBookmark}
            className={`flex items-center gap-1.5 px-3 py-2 sm:py-1.5 bg-surface-raised rounded-full text-xs transition-colors min-h-[44px] sm:min-h-0 ${
              bookmarked ? 'text-amber-400' : 'text-fg-muted hover:text-fg-primary hover:bg-surface-hover'
            }`}
          >
            <Bookmark className={`w-4 h-4 ${bookmarked ? 'fill-amber-400' : ''}`} />
            <span className="hidden sm:inline">{bookmarked ? 'Saved' : 'Save'}</span>
          </button>

          {/* More button */}
          <div className="relative ml-auto">
            <button
              onClick={() => setShowMore(!showMore)}
              className="p-2 sm:p-1.5 rounded-full text-fg-muted hover:text-fg-secondary hover:bg-surface-raised transition-colors min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {showMore && (
              <div
                className="absolute right-0 top-8 z-20 w-36 bg-surface-overlay border border-line-subtle rounded-xl shadow-theme-md py-1 text-xs"
                onMouseLeave={() => setShowMore(false)}
              >
                <button
                  onClick={() => { setShowReport(true); setShowMore(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-fg-muted hover:text-red-400 hover:bg-surface-hover transition-colors"
                >
                  <Flag className="w-3.5 h-3.5" />
                  Report
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Reaction bar */}
        <div ref={reactionsRef} className="flex items-center gap-1.5 sm:gap-1 px-3 pb-3 sm:pb-2 flex-wrap">
          {REACTION_EMOJIS.map(({ key, icon }) => {
            const r = reactions.find((rx) => rx.emoji === key)
            const count = r?.count ?? 0
            const reacted = r?.reacted ?? false
            return (
              <button
                key={key}
                onClick={() => handleReaction(key)}
                className={`flex items-center gap-1 px-2.5 sm:px-2 py-1.5 sm:py-1 rounded-full text-xs transition-colors min-h-[36px] sm:min-h-0 ${
                  reacted
                    ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                    : 'bg-surface-raised text-fg-muted hover:text-fg-secondary hover:bg-surface-hover border border-transparent'
                }`}
                title={key.replace('_', ' ')}
              >
                <span className="text-sm leading-none">{icon}</span>
                {count > 0 && <span className="tabular-nums">{count}</span>}
              </button>
            )
          })}
        </div>

        {/* Financial disclaimer — only on expanded/detail view */}
        {expanded && (
          <div className="px-4 pb-3">
            <p className="text-[10px] text-fg-muted leading-relaxed">
              This is community discussion, not financial advice. Always do your own research.
            </p>
          </div>
        )}

        <ReportModal
          isOpen={showReport}
          onClose={() => setShowReport(false)}
          targetId={post.id}
          targetType="post"
        />
      </motion.div>
    )
  }
)

export default PostCard
