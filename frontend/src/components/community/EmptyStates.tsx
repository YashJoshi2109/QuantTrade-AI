'use client'

import { motion } from 'framer-motion'
import { Search, Hammer, BellOff, MessageCircle, Lock, AlertTriangle } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────

interface EmptyStateProps {
  variant:
    | 'no-posts'
    | 'no-communities'
    | 'no-notifications'
    | 'no-comments'
    | 'auth-required'
    | 'error'
  ctaLabel?: string
  onCta?: () => void
  className?: string
}

// ── Config ────────────────────────────────────────────────────────

const STATES: Record<
  EmptyStateProps['variant'],
  {
    icon: typeof Search
    emoji: string
    title: string
    description: string
    defaultCta: string
    gradient: string
  }
> = {
  'no-posts': {
    icon: Search,
    emoji: '\uD83D\uDD0D',
    title: 'No posts yet',
    description: 'Be the first to share your analysis!',
    defaultCta: 'Create a post',
    gradient: 'from-blue-500/20 to-cyan-500/20',
  },
  'no-communities': {
    icon: Hammer,
    emoji: '\uD83C\uDFD7\uFE0F',
    title: 'No communities found',
    description: 'Create one to get started!',
    defaultCta: 'Create community',
    gradient: 'from-purple-500/20 to-pink-500/20',
  },
  'no-notifications': {
    icon: BellOff,
    emoji: '\uD83D\uDCED',
    title: "You're all caught up!",
    description: 'Check back later for new notifications.',
    defaultCta: 'Go to feed',
    gradient: 'from-emerald-500/20 to-teal-500/20',
  },
  'no-comments': {
    icon: MessageCircle,
    emoji: '\uD83D\uDCAC',
    title: 'No comments yet',
    description: 'Share your thoughts on this post!',
    defaultCta: 'Write a comment',
    gradient: 'from-amber-500/20 to-orange-500/20',
  },
  'auth-required': {
    icon: Lock,
    emoji: '\uD83D\uDD10',
    title: 'Sign in to join',
    description: 'Sign in to join the conversation and interact with the community.',
    defaultCta: 'Sign in',
    gradient: 'from-indigo-500/20 to-violet-500/20',
  },
  error: {
    icon: AlertTriangle,
    emoji: '\u26A0\uFE0F',
    title: 'Something went wrong',
    description: 'An error occurred. Try refreshing the page.',
    defaultCta: 'Refresh',
    gradient: 'from-red-500/20 to-rose-500/20',
  },
}

// ── Component ─────────────────────────────────────────────────────

export default function EmptyState({
  variant,
  ctaLabel,
  onCta,
  className = '',
}: EmptyStateProps) {
  const state = STATES[variant]
  const Icon = state.icon

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
      className={`bg-[#0D1117] border border-white/[0.06] rounded-xl p-10 sm:p-12 text-center ${className}`}
    >
      {/* Icon with gradient glow */}
      <motion.div
        initial={{ scale: 0.8 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.1, type: 'spring', stiffness: 260, damping: 20 }}
        className="relative mx-auto w-16 h-16 mb-5"
      >
        <div
          className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${state.gradient} blur-lg opacity-60`}
        />
        <div className="relative w-16 h-16 rounded-2xl bg-[#161b22] border border-white/[0.08] flex items-center justify-center">
          <Icon className="w-7 h-7 text-slate-400" />
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
      >
        <h3 className="text-lg font-semibold text-slate-200 mb-1.5">
          {state.emoji} {state.title}
        </h3>
        <p className="text-sm text-slate-500 mb-5 max-w-sm mx-auto leading-relaxed">
          {state.description}
        </p>
      </motion.div>

      {onCta && (
        <motion.button
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          onClick={onCta}
          className="px-5 py-2.5 bg-blue-500/15 text-blue-400 border border-blue-500/30 rounded-xl text-sm font-medium hover:bg-blue-500/25 transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          {ctaLabel || state.defaultCta}
        </motion.button>
      )}
    </motion.div>
  )
}
