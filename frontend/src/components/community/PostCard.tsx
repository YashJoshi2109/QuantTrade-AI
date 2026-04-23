'use client'

import { useState, useCallback, useEffect, useRef, forwardRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
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
} from 'lucide-react'
import { votePost, bookmarkPost, unbookmarkPost, addReaction, removeReaction, fetchReactions, type CommunityPost, type ReactionSummary } from '@/lib/api'
import ReportModal from '@/components/community/ReportModal'

/** Render simple markdown subset to HTML for post body previews */
function renderBodyMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-slate-200 font-semibold">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="px-1 py-0.5 bg-slate-800 rounded text-cyan-400 text-xs">$1</code>')
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
    const shareTimeoutRef = useRef<NodeJS.Timeout | null>(null)

    // Reactions state
    const [reactions, setReactions] = useState<ReactionSummary[]>([])
    const [reactionsLoaded, setReactionsLoaded] = useState(false)

    // Load reactions on mount
    useEffect(() => {
      fetchReactions(post.id).then((data) => {
        setReactions(data)
        setReactionsLoaded(true)
      }).catch(() => setReactionsLoaded(true))
    }, [post.id])

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

    const handleShare = useCallback(() => {
      const url = `${window.location.origin}/community/post/${post.id}`
      navigator.clipboard.writeText(url).then(() => {
        setShareConfirm(true)
        notify('Link copied to clipboard!', 'success')
        if (shareTimeoutRef.current) clearTimeout(shareTimeoutRef.current)
        shareTimeoutRef.current = setTimeout(() => setShareConfirm(false), 2000)
      }).catch(() => {
        notify('Failed to copy link', 'error')
      })
    }, [post.id, notify])

    const sentiment = post.sentiment ? sentimentConfig[post.sentiment.toLowerCase()] : null

    return (
      <motion.div
        ref={ref}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, delay: index * 0.03 }}
        className={`relative bg-[#131820] rounded-2xl transition-colors duration-150 group ${
          focused
            ? 'ring-1 ring-blue-500/30 bg-[#161d27]'
            : 'hover:bg-[#161d27]'
        }`}
      >
        <div className="px-4 pt-3 pb-1">
          {/* Meta line — community + author + time */}
          <div className="flex items-center gap-1.5 text-xs mb-2">
            <Link
              href={`/community/${post.community.slug}`}
              className="font-semibold text-slate-300 hover:text-white transition-colors"
            >
              c/{post.community.name}
            </Link>
            <span className="text-slate-600">·</span>
            <span className="text-slate-500">{post.author.username}</span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-500">{timeAgo(post.created_at)}</span>

            {/* Pinned badge */}
            {(post as any).is_pinned && (
              <>
                <span className="text-slate-600">·</span>
                <span className="inline-flex items-center gap-0.5 text-emerald-400">
                  <Pin className="w-3 h-3" /> Pinned
                </span>
              </>
            )}

            {/* Locked badge */}
            {(post as any).is_locked && (
              <>
                <span className="text-slate-600">·</span>
                <span className="inline-flex items-center gap-0.5 text-amber-400">
                  <Lock className="w-3 h-3" /> Locked
                </span>
              </>
            )}
          </div>

          {/* Title */}
          <Link href={`/community/post/${post.id}`} className="block">
            <h3 className="text-[15px] font-medium text-slate-100 leading-snug mb-1 group-hover:text-white transition-colors cursor-pointer">
              {post.title}
            </h3>
          </Link>

          {/* Body preview */}
          {post.body && (
            <div
              className="text-[13px] text-slate-400 line-clamp-3 mb-2 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: renderBodyMarkdown(post.body) }}
            />
          )}

          {/* Ticker + Sentiment chips */}
          {(post.tickers?.length || sentiment) && (
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              {post.tickers?.map((ticker) => (
                <Link
                  key={ticker}
                  href={`/research?symbol=${ticker}`}
                  className="px-2 py-0.5 text-[11px] font-mono font-bold text-cyan-400 bg-cyan-500/10 rounded-md hover:bg-cyan-500/20 transition-colors"
                >
                  ${ticker}
                </Link>
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
        <div className="flex items-center gap-1 px-2 pb-2">
          {/* Upvote pill */}
          <button
            onClick={() => handleVote(1)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full transition-colors ${
              userVote === 1
                ? 'bg-orange-500/15 text-orange-400'
                : 'bg-[#1a2130] text-slate-400 hover:text-orange-400 hover:bg-orange-500/10'
            }`}
          >
            <ArrowBigUp className={`w-4.5 h-4.5 ${userVote === 1 ? 'fill-orange-400' : ''}`} />
            <span className="text-xs font-semibold tabular-nums">{post.upvote_count || 0}</span>
          </button>

          {/* Downvote pill */}
          <button
            onClick={() => handleVote(-1)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full transition-colors ${
              userVote === -1
                ? 'bg-blue-500/15 text-blue-400'
                : 'bg-[#1a2130] text-slate-400 hover:text-blue-400 hover:bg-blue-500/10'
            }`}
          >
            <ArrowBigDown className={`w-4.5 h-4.5 ${userVote === -1 ? 'fill-blue-400' : ''}`} />
            <span className="text-xs font-semibold tabular-nums">{post.downvote_count || 0}</span>
          </button>

          {/* Comments pill */}
          <Link
            href={`/community/post/${post.id}`}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a2130] rounded-full text-xs text-slate-400 hover:text-white hover:bg-[#1f2937] transition-colors"
          >
            <MessageSquare className="w-4 h-4" />
            <span>{post.comment_count}</span>
          </Link>

          {/* Share pill */}
          <button
            onClick={handleShare}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a2130] rounded-full text-xs text-slate-400 hover:text-white hover:bg-[#1f2937] transition-colors"
          >
            {shareConfirm ? (
              <Check className="w-4 h-4 text-emerald-400" />
            ) : (
              <Share2 className="w-4 h-4" />
            )}
            <span className="hidden sm:inline">{shareConfirm ? 'Copied!' : 'Share'}</span>
          </button>

          {/* Save pill */}
          <button
            onClick={handleBookmark}
            className={`flex items-center gap-1.5 px-3 py-1.5 bg-[#1a2130] rounded-full text-xs transition-colors ${
              bookmarked ? 'text-amber-400' : 'text-slate-400 hover:text-white hover:bg-[#1f2937]'
            }`}
          >
            <Bookmark className={`w-4 h-4 ${bookmarked ? 'fill-amber-400' : ''}`} />
            <span className="hidden sm:inline">{bookmarked ? 'Saved' : 'Save'}</span>
          </button>

          {/* More button */}
          <div className="relative ml-auto">
            <button
              onClick={() => setShowMore(!showMore)}
              className="p-1.5 rounded-full text-slate-500 hover:text-slate-300 hover:bg-[#1a2130] transition-colors"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {showMore && (
              <div
                className="absolute right-0 top-8 z-20 w-36 bg-[#1a2130] border border-white/10 rounded-xl shadow-xl py-1 text-xs"
                onMouseLeave={() => setShowMore(false)}
              >
                <button
                  onClick={() => { setShowReport(true); setShowMore(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-slate-400 hover:text-red-400 hover:bg-white/5 transition-colors"
                >
                  <Flag className="w-3.5 h-3.5" />
                  Report
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Reaction bar */}
        <div className="flex items-center gap-1 px-3 pb-2">
          {REACTION_EMOJIS.map(({ key, icon }) => {
            const r = reactions.find((rx) => rx.emoji === key)
            const count = r?.count ?? 0
            const reacted = r?.reacted ?? false
            return (
              <button
                key={key}
                onClick={() => handleReaction(key)}
                className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-colors ${
                  reacted
                    ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                    : 'bg-[#1a2130] text-slate-500 hover:text-slate-300 hover:bg-[#1f2937] border border-transparent'
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
            <p className="text-[10px] text-slate-600 leading-relaxed">
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
