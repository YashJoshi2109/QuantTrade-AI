'use client'

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronUp,
  ChevronDown,
  MessageSquare,
  ChevronRight,
  Minus,
} from 'lucide-react'
import CommentComposer from './CommentComposer'
import { voteComment } from '@/lib/api'

// ── Types ──────────────────────────────────────────────────────

export interface Comment {
  id: number
  post_id: number
  parent_id: number | null
  author_id: number
  author_display_name: string
  author_avatar_url?: string
  body: string
  depth: number
  upvote_count: number
  downvote_count: number
  reply_count: number
  user_vote: number | null
  created_at: string
  is_removed: boolean
  replies: Comment[]
}

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

const DEPTH_COLORS = [
  'border-blue-500/40',    // depth 0
  'border-purple-500/40',  // depth 1
  'border-cyan-500/40',    // depth 2
  'border-line-subtle',    // depth 3+
]

function getDepthColor(depth: number): string {
  return DEPTH_COLORS[Math.min(depth, DEPTH_COLORS.length - 1)]
}

const MAX_VISIBLE_DEPTH = 2

// ── Single Comment Node ────────────────────────────────────────

interface CommentNodeProps {
  comment: Comment
  postId: number
  isAuthenticated: boolean
  onReplySubmit: (body: string, parentId: number) => Promise<void>
}

function CommentNode({ comment, postId, isAuthenticated, onReplySubmit }: CommentNodeProps) {
  const [collapsed, setCollapsed] = useState(comment.depth >= MAX_VISIBLE_DEPTH)
  const [showReply, setShowReply] = useState(false)
  const [upvotes, setUpvotes] = useState(comment.upvote_count)
  const [downvotes, setDownvotes] = useState(comment.downvote_count)
  const [userVote, setUserVote] = useState(comment.user_vote)
  const [voteLoading, setVoteLoading] = useState(false)

  const score = upvotes - downvotes

  const handleVote = useCallback(async (direction: 1 | -1) => {
    if (!isAuthenticated || voteLoading) return
    setVoteLoading(true)

    // Optimistic update
    const prevUp = upvotes
    const prevDown = downvotes
    const prevVote = userVote

    if (userVote === direction) {
      // Un-vote
      setUserVote(null)
      if (direction === 1) setUpvotes((u) => u - 1)
      else setDownvotes((d) => d - 1)
    } else {
      // New vote or switch
      if (userVote === 1) setUpvotes((u) => u - 1)
      if (userVote === -1) setDownvotes((d) => d - 1)
      setUserVote(direction)
      if (direction === 1) setUpvotes((u) => u + 1)
      else setDownvotes((d) => d + 1)
    }

    try {
      await voteComment(comment.id, direction)
    } catch {
      // Revert on failure
      setUpvotes(prevUp)
      setDownvotes(prevDown)
      setUserVote(prevVote)
    } finally {
      setVoteLoading(false)
    }
  }, [comment.id, isAuthenticated, voteLoading, upvotes, downvotes, userVote])

  const handleReplySubmit = async (body: string) => {
    await onReplySubmit(body, comment.id)
    setShowReply(false)
  }

  const totalReplies = comment.replies?.length || 0

  // Collapsed state for deep threads
  if (collapsed && comment.depth >= MAX_VISIBLE_DEPTH && totalReplies > 0) {
    return (
      <div className={`ml-2 sm:ml-3 md:ml-6 border-l-2 ${getDepthColor(comment.depth)}`}>
        <button
          onClick={() => setCollapsed(false)}
          className="flex items-center gap-2 text-fg-muted italic text-sm cursor-pointer
            hover:text-fg-secondary transition-colors py-2 pl-2 sm:pl-3 md:pl-4 min-h-[44px] sm:min-h-0"
        >
          <ChevronRight className="w-3.5 h-3.5" />
          <span>Show {totalReplies + 1} more {totalReplies === 0 ? 'reply' : 'replies'}</span>
        </button>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={`${comment.depth > 0 ? `ml-2 sm:ml-3 md:ml-6 border-l-2 ${getDepthColor(comment.depth)}` : ''}`}
    >
      <div className="group hover:bg-white/[0.02] rounded-r-lg transition-colors">
        <div className={`py-2.5 ${comment.depth > 0 ? 'pl-2 sm:pl-4' : ''} pr-2`}>
          {/* Author line */}
          <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
            {/* Avatar */}
            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500/30 to-purple-500/30 border border-line-subtle flex items-center justify-center text-[9px] font-bold text-fg-secondary shrink-0">
              {comment.author_display_name?.[0]?.toUpperCase() || '?'}
            </div>
            <span className="text-xs font-semibold text-fg-primary">
              {comment.author_display_name}
            </span>
            <span className="text-[10px] text-fg-muted">
              {formatRelativeTime(comment.created_at)}
            </span>

            {/* Collapse toggle */}
            {totalReplies > 0 && (
              <button
                onClick={() => setCollapsed(!collapsed)}
                className="ml-auto text-fg-muted hover:text-fg-secondary transition-colors p-0.5"
                title={collapsed ? 'Expand' : 'Collapse'}
              >
                <Minus className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Body */}
          {comment.is_removed ? (
            <p className="text-sm text-fg-muted italic">[removed]</p>
          ) : (
            <p className="text-sm text-fg-secondary leading-relaxed whitespace-pre-wrap break-words">
              {comment.body}
            </p>
          )}

          {/* Actions row */}
          {!comment.is_removed && (
            <div className="flex items-center gap-3 mt-1.5">
              {/* Vote buttons */}
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => handleVote(1)}
                  disabled={!isAuthenticated}
                  className={`p-1.5 sm:p-1 rounded transition-colors min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center ${
                    userVote === 1
                      ? 'text-blue-400'
                      : 'text-fg-muted hover:text-fg-secondary'
                  } disabled:opacity-30 disabled:cursor-not-allowed`}
                  title="Upvote"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <span className={`text-[11px] font-mono min-w-[16px] text-center ${
                  score > 0 ? 'text-blue-400' : score < 0 ? 'text-red-400' : 'text-fg-muted'
                }`}>
                  {score}
                </span>
                <button
                  onClick={() => handleVote(-1)}
                  disabled={!isAuthenticated}
                  className={`p-1.5 sm:p-1 rounded transition-colors min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center ${
                    userVote === -1
                      ? 'text-red-400'
                      : 'text-fg-muted hover:text-fg-secondary'
                  } disabled:opacity-30 disabled:cursor-not-allowed`}
                  title="Downvote"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Reply button */}
              {isAuthenticated && (
                <button
                  onClick={() => setShowReply(!showReply)}
                  className="flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg-secondary transition-colors px-2 py-1.5 sm:px-1.5 sm:py-0.5 rounded min-h-[44px] sm:min-h-0"
                >
                  <MessageSquare className="w-3 h-3" />
                  Reply
                </button>
              )}
            </div>
          )}

          {/* Inline reply composer */}
          <AnimatePresence>
            {showReply && (
              <div className="mt-2">
                <CommentComposer
                  postId={postId}
                  parentId={comment.id}
                  placeholder={`Reply to ${comment.author_display_name}...`}
                  autoFocus
                  isReply
                  onSubmit={handleReplySubmit}
                  onCancel={() => setShowReply(false)}
                />
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Recursive replies */}
      {!collapsed && comment.replies && comment.replies.length > 0 && (
        <div>
          {comment.replies.map((reply) => (
            <CommentNode
              key={reply.id}
              comment={reply}
              postId={postId}
              isAuthenticated={isAuthenticated}
              onReplySubmit={onReplySubmit}
            />
          ))}
        </div>
      )}
    </motion.div>
  )
}

// ── Comment Tree ───────────────────────────────────────────────

interface CommentTreeProps {
  comments: Comment[]
  postId: number
  isAuthenticated: boolean
  onReplySubmit: (body: string, parentId: number) => Promise<void>
}

export default function CommentTree({
  comments,
  postId,
  isAuthenticated,
  onReplySubmit,
}: CommentTreeProps) {
  if (!comments || comments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <MessageSquare className="w-10 h-10 text-fg-muted mb-3" />
        <p className="text-sm text-fg-muted font-medium">No comments yet</p>
        <p className="text-xs text-fg-muted mt-1">
          Be the first to share your analysis!
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {comments.map((comment) => (
        <CommentNode
          key={comment.id}
          comment={comment}
          postId={postId}
          isAuthenticated={isAuthenticated}
          onReplySubmit={onReplySubmit}
        />
      ))}
    </div>
  )
}
