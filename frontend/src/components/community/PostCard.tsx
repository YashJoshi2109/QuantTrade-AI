'use client'

import { useState, useCallback, useRef, forwardRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import {
  ArrowBigUp,
  ArrowBigDown,
  MessageSquare,
  Share2,
  Bookmark,
  Clock,
  Flag,
  Check,
  Pin,
  Lock,
} from 'lucide-react'
import { votePost, bookmarkPost, unbookmarkPost, type CommunityPost } from '@/lib/api'
import ReportModal from '@/components/community/ReportModal'

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
  bullish: { label: 'Bullish', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  bearish: { label: 'Bearish', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
  neutral: { label: 'Neutral', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
}

interface PostCardProps {
  post: CommunityPost
  index?: number
  focused?: boolean
  onVote?: (postId: number, direction: 1 | -1) => void
  toastFn?: (msg: string, type?: string) => void
}

const PostCard = forwardRef<HTMLDivElement, PostCardProps>(
  function PostCard({ post, index = 0, focused = false, onVote, toastFn }, ref) {
    const [voteCount, setVoteCount] = useState(post.vote_count)
    const [userVote, setUserVote] = useState<number | null>(post.user_vote)
    const [bookmarked, setBookmarked] = useState(false)
    const [bookmarkAnimating, setBookmarkAnimating] = useState(false)
    const [shareConfirm, setShareConfirm] = useState(false)
    const [voteDirection, setVoteDirection] = useState<'up' | 'down' | null>(null)
    const [showReport, setShowReport] = useState(false)
    const shareTimeoutRef = useRef<NodeJS.Timeout | null>(null)

    const notify = useCallback((msg: string, type?: string) => {
      toastFn?.(msg, type)
    }, [toastFn])

    const handleVote = useCallback(async (direction: 1 | -1) => {
      const prevVote = userVote
      const prevCount = voteCount

      // Trigger animation
      setVoteDirection(direction === 1 ? 'up' : 'down')
      setTimeout(() => setVoteDirection(null), 300)

      // Optimistic update
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
      // Optimistic update
      setBookmarked(next)
      setBookmarkAnimating(true)
      setTimeout(() => setBookmarkAnimating(false), 400)
      notify(next ? 'Saved to bookmarks' : 'Removed from saved', 'success')

      const ok = next
        ? await bookmarkPost(post.id)
        : await unbookmarkPost(post.id)
      if (!ok) {
        // Revert on failure
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
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: index * 0.04 }}
        className={`bg-[#0D1117] border rounded-xl transition-all duration-200 group ${
          focused
            ? 'border-blue-500/40 shadow-lg shadow-blue-500/5 ring-1 ring-blue-500/20'
            : 'border-white/[0.06] hover:border-white/[0.12] hover:shadow-lg hover:shadow-blue-500/5 hover:-translate-y-0.5'
        }`}
      >
        <div className="flex gap-2 sm:gap-3 p-3 sm:p-4">
          {/* Vote column */}
          <div className="flex flex-col items-center gap-0.5 pt-1 min-w-[36px]">
            <motion.button
              onClick={() => handleVote(1)}
              whileTap={{ scale: 1.3 }}
              transition={{ type: 'spring', stiffness: 500, damping: 15 }}
              className={`p-1.5 sm:p-1 rounded transition-colors min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center ${
                userVote === 1
                  ? 'text-emerald-400 bg-emerald-500/15'
                  : 'text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10'
              }`}
            >
              <motion.div
                animate={
                  voteDirection === 'up'
                    ? { scale: [1, 1.3, 1], rotate: [0, -10, 0] }
                    : {}
                }
                transition={{ duration: 0.3 }}
              >
                <ArrowBigUp className={`w-5 h-5 ${userVote === 1 ? 'fill-emerald-400' : ''}`} />
              </motion.div>
            </motion.button>

            {/* Animated vote count */}
            <div className="relative h-5 overflow-hidden">
              <AnimatePresence mode="popLayout">
                <motion.span
                  key={voteCount}
                  initial={{ y: voteDirection === 'up' ? 16 : -16, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: voteDirection === 'up' ? -16 : 16, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className={`block text-sm font-semibold tabular-nums text-center ${
                    userVote === 1 ? 'text-emerald-400' : userVote === -1 ? 'text-red-400' : 'text-slate-300'
                  }`}
                >
                  {voteCount}
                </motion.span>
              </AnimatePresence>
            </div>

            <motion.button
              onClick={() => handleVote(-1)}
              whileTap={{ scale: 1.3 }}
              transition={{ type: 'spring', stiffness: 500, damping: 15 }}
              className={`p-1.5 sm:p-1 rounded transition-colors min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center ${
                userVote === -1
                  ? 'text-red-400 bg-red-500/15'
                  : 'text-slate-500 hover:text-red-400 hover:bg-red-500/10'
              }`}
            >
              <motion.div
                animate={
                  voteDirection === 'down'
                    ? { scale: [1, 1.3, 1], rotate: [0, 10, 0] }
                    : {}
                }
                transition={{ duration: 0.3 }}
              >
                <ArrowBigDown className={`w-5 h-5 ${userVote === -1 ? 'fill-red-400' : ''}`} />
              </motion.div>
            </motion.button>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Meta line */}
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1.5">
              <Link
                href={`/community/${post.community.slug}`}
                className="font-semibold text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                c/{post.community.name}
              </Link>
              <span className="text-slate-600">&middot;</span>
              <span>
                {post.author.username}
              </span>
              <span className="text-slate-600">&middot;</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {timeAgo(post.created_at)}
              </span>
            </div>

            {/* Pinned indicator */}
            {(post as any).is_pinned && (
              <div className="flex items-center gap-1 text-xs text-emerald-400 mb-1">
                <Pin className="w-3 h-3" />
                <span>Pinned</span>
              </div>
            )}

            {/* Title */}
            <Link href={`/community/post/${post.id}`}>
              <h3 className="text-[15px] font-semibold text-slate-100 leading-snug mb-1 group-hover:text-white transition-colors cursor-pointer break-words">
                {post.title}
              </h3>
            </Link>

            {/* Body preview */}
            {post.body && (
              <p className="text-sm text-slate-400 line-clamp-2 mb-2 leading-relaxed">
                {post.body}
              </p>
            )}

            {/* Chips row */}
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {post.tickers?.map((ticker) => (
                <Link
                  key={ticker}
                  href={`/research?symbol=${ticker}`}
                  className="px-2 py-0.5 text-xs font-mono font-semibold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded-md hover:bg-cyan-500/20 transition-colors"
                >
                  ${ticker}
                </Link>
              ))}
              {sentiment && (
                <span className={`px-2 py-0.5 text-xs font-medium rounded-md border ${sentiment.bg} ${sentiment.color}`}>
                  {sentiment.label}
                </span>
              )}
            </div>

            {/* Action bar */}
            <div className="flex items-center gap-3 sm:gap-4 text-slate-500">
              {/* Comments */}
              <Link
                href={`/community/post/${post.id}`}
                className="flex items-center gap-1 sm:gap-1.5 text-xs hover:text-blue-400 transition-colors min-h-[44px] sm:min-h-0"
              >
                <MessageSquare className="w-4 h-4" />
                <span>{post.comment_count} <span className="hidden sm:inline">{post.comment_count === 1 ? 'comment' : 'comments'}</span></span>
              </Link>

              {/* Locked indicator */}
              {(post as any).is_locked && (
                <div className="flex items-center gap-1 text-xs text-amber-400">
                  <Lock className="w-3 h-3" />
                  <span>Locked</span>
                </div>
              )}

              {/* Share with confirmation */}
              <motion.button
                onClick={handleShare}
                whileTap={{ scale: 0.92 }}
                className="flex items-center gap-1 sm:gap-1.5 text-xs hover:text-blue-400 transition-colors min-h-[44px] sm:min-h-0"
              >
                <AnimatePresence mode="wait">
                  {shareConfirm ? (
                    <motion.div
                      key="check"
                      initial={{ scale: 0, rotate: -90 }}
                      animate={{ scale: 1, rotate: 0 }}
                      exit={{ scale: 0, rotate: 90 }}
                      transition={{ duration: 0.2 }}
                    >
                      <Check className="w-4 h-4 text-emerald-400" />
                    </motion.div>
                  ) : (
                    <motion.div
                      key="share"
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      exit={{ scale: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <Share2 className="w-4 h-4" />
                    </motion.div>
                  )}
                </AnimatePresence>
                <span className="hidden sm:inline">
                  {shareConfirm ? 'Copied!' : 'Share'}
                </span>
              </motion.button>

              {/* Bookmark with fill animation */}
              <motion.button
                onClick={handleBookmark}
                whileTap={{ scale: 0.92 }}
                className={`flex items-center gap-1 sm:gap-1.5 text-xs transition-colors min-h-[44px] sm:min-h-0 ${
                  bookmarked ? 'text-amber-400' : 'hover:text-amber-400'
                }`}
              >
                <motion.div
                  animate={
                    bookmarkAnimating
                      ? { scale: [1, 1.4, 0.9, 1.1, 1], rotate: [0, -15, 10, -5, 0] }
                      : {}
                  }
                  transition={{ duration: 0.4 }}
                >
                  <Bookmark className={`w-4 h-4 transition-all duration-200 ${bookmarked ? 'fill-amber-400 text-amber-400' : ''}`} />
                </motion.div>
                <span className="hidden sm:inline">{bookmarked ? 'Saved' : 'Save'}</span>
              </motion.button>

              {/* Report */}
              <button
                onClick={() => setShowReport(true)}
                className="flex items-center gap-1 sm:gap-1.5 text-xs text-slate-500 hover:text-red-400 transition-colors min-h-[44px] sm:min-h-0"
              >
                <Flag className="w-4 h-4" />
                <span className="hidden sm:inline">Report</span>
              </button>
            </div>
          </div>
        </div>

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
