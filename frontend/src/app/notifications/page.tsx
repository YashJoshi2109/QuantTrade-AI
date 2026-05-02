'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import AppLayout from '@/components/AppLayout'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bell,
  MessageSquare,
  ArrowUp,
  AtSign,
  UserPlus,
  AlertCircle,
  CheckCheck,
  Loader2,
  Inbox,
  MessageCircle,
  Newspaper,
  Users,
  ChevronRight,
  TrendingUp,
  Settings2,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useCommunityWS } from '@/hooks/useCommunityWS'
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  type Notification,
} from '@/lib/api'

const SOCIAL_TYPES = new Set(['reply', 'upvote', 'mention', 'follow', 'dm', 'follow_post', 'community_post'])
const TRADING_TYPES = new Set(['alert', 'price_alert', 'portfolio', 'trade'])

type Category = 'all' | 'unread' | 'social' | 'trading' | 'system'

const CATEGORIES: { id: Category; label: string; icon: typeof Bell }[] = [
  { id: 'all',     label: 'All',     icon: Bell },
  { id: 'unread',  label: 'Unread',  icon: Bell },
  { id: 'social',  label: 'Social',  icon: Users },
  { id: 'trading', label: 'Trading', icon: TrendingUp },
  { id: 'system',  label: 'System',  icon: Settings2 },
]

const TYPE_ICONS: Record<string, typeof MessageSquare> = {
  reply:          MessageSquare,
  upvote:         ArrowUp,
  mention:        AtSign,
  follow:         UserPlus,
  alert:          AlertCircle,
  price_alert:    AlertCircle,
  dm:             MessageCircle,
  follow_post:    Newspaper,
  community_post: Users,
}

const TYPE_COLORS: Record<string, string> = {
  reply:          'text-blue-500 bg-blue-500/10',
  upvote:         'text-emerald-500 bg-emerald-500/10',
  mention:        'text-purple-500 bg-purple-500/10',
  follow:         'text-cyan-500 bg-cyan-500/10',
  alert:          'text-amber-500 bg-amber-500/10',
  price_alert:    'text-amber-500 bg-amber-500/10',
  dm:             'text-blue-400 bg-blue-400/10',
  follow_post:    'text-orange-500 bg-orange-500/10',
  community_post: 'text-teal-500 bg-teal-500/10',
}

const TYPE_LABELS: Record<string, string> = {
  reply:          'Reply',
  upvote:         'Upvote',
  mention:        'Mention',
  follow:         'Follow',
  alert:          'Alert',
  price_alert:    'Price Alert',
  dm:             'Message',
  follow_post:    'New Post',
  community_post: 'Community',
}

function relativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = Math.max(0, now - then)
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.12)
    gain.gain.setValueAtTime(0.18, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.35)
  } catch { /* AudioContext not available */ }
}

function filterByCategory(notifications: Notification[], category: Category): Notification[] {
  switch (category) {
    case 'unread':  return notifications.filter((n) => !n.is_read)
    case 'social':  return notifications.filter((n) => SOCIAL_TYPES.has(n.type))
    case 'trading': return notifications.filter((n) => TRADING_TYPES.has(n.type))
    case 'system':  return notifications.filter((n) => !SOCIAL_TYPES.has(n.type) && !TRADING_TYPES.has(n.type))
    default:        return notifications
  }
}

const PAGE_SIZE = 20

export default function NotificationsPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [allNotifications, setAllNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [hasMore, setHasMore] = useState(false)
  const [category, setCategory] = useState<Category>('all')
  const [markingAll, setMarkingAll] = useState(false)
  const lastCountRef = useRef(0)

  const load = useCallback(async (lim: number, silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await fetchNotifications(lim)
      const items: Notification[] = data.notifications || []
      setAllNotifications(items)
      setHasMore(items.length === lim)
    } catch {
      setAllNotifications([])
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    load(limit)
  }, [load, limit])

  const handleLoadMore = () => {
    setLoadingMore(true)
    const next = limit + PAGE_SIZE
    setLimit(next)
  }

  // Real-time updates via WS
  const handleWS = useCallback((msg: { type: string }) => {
    const relevant = ['dm.new', 'new_comment', 'mention', 'new_post', 'notification']
    if (relevant.includes(msg.type)) {
      fetchNotifications(limit).then((data) => {
        const fresh: Notification[] = data.notifications || []
        const newUnread = fresh.filter((n) => !n.is_read).length
        if (newUnread > lastCountRef.current) playNotificationSound()
        lastCountRef.current = newUnread
        setAllNotifications(fresh)
      }).catch(() => {})
    }
  }, [limit])

  useCommunityWS(user?.id ? `user:${user.id}` : null, handleWS)

  useEffect(() => {
    lastCountRef.current = allNotifications.filter((n) => !n.is_read).length
  }, [allNotifications])

  const displayed = filterByCategory(allNotifications, category)
  const unreadCount = allNotifications.filter((n) => !n.is_read).length

  // Per-category unread counts
  const counts: Record<Category, number> = {
    all:     unreadCount,
    unread:  unreadCount,
    social:  filterByCategory(allNotifications, 'social').filter((n) => !n.is_read).length,
    trading: filterByCategory(allNotifications, 'trading').filter((n) => !n.is_read).length,
    system:  filterByCategory(allNotifications, 'system').filter((n) => !n.is_read).length,
  }

  const handleClick = async (notification: Notification) => {
    if (!notification.is_read) {
      setAllNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, is_read: true } : n))
      )
      try {
        await markNotificationRead(notification.id)
      } catch {
        setAllNotifications((prev) =>
          prev.map((n) => (n.id === notification.id ? { ...n, is_read: false } : n))
        )
      }
    }
    if (notification.action_url) router.push(notification.action_url)
  }

  const handleMarkOneRead = async (e: React.MouseEvent, notification: Notification) => {
    e.stopPropagation()
    if (notification.is_read) return
    setAllNotifications((prev) =>
      prev.map((n) => (n.id === notification.id ? { ...n, is_read: true } : n))
    )
    try {
      await markNotificationRead(notification.id)
    } catch {
      setAllNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, is_read: false } : n))
      )
    }
  }

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation()
    setAllNotifications((prev) => prev.filter((n) => n.id !== id))
    try {
      await deleteNotification(id)
    } catch {
      load(limit)
    }
  }

  const handleMarkAllRead = async () => {
    setMarkingAll(true)
    setAllNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
    try {
      await markAllNotificationsRead()
    } catch {
      load(limit)
    } finally {
      setMarkingAll(false)
    }
  }

  return (
    <AppLayout>
      <div className="min-h-screen pb-safe">
        <div className="max-w-[760px] mx-auto px-3 sm:px-6 py-4 sm:py-6">

          {/* Breadcrumb */}
          <nav className="flex items-center gap-1.5 text-xs text-fg-muted mb-4">
            <Link href="/" className="hover:text-fg-primary transition-colors">Home</Link>
            <ChevronRight className="w-3 h-3 opacity-40" />
            <span className="text-fg-primary font-medium">Notifications</span>
          </nav>

          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                <Bell className="w-5 h-5 text-indigo-500" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-fg-primary">Notifications</h1>
                <p className="text-xs text-fg-muted mt-0.5">
                  {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => load(limit, true)}
                className="p-2 rounded-lg text-fg-muted hover:text-fg-primary hover:bg-surface-raised transition-colors"
                title="Refresh"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  disabled={markingAll}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-indigo-600 bg-indigo-500/10 border border-indigo-500/20 rounded-lg hover:bg-indigo-500/20 transition-colors disabled:opacity-50"
                >
                  {markingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
                  Mark all read
                </button>
              )}
            </div>
          </div>

          {/* Category Tabs */}
          <div className="flex gap-1 bg-surface-base border border-line-subtle rounded-xl p-1 mb-5 overflow-x-auto">
            {CATEGORIES.map((cat) => {
              const badge = counts[cat.id]
              return (
                <button
                  key={cat.id}
                  onClick={() => setCategory(cat.id)}
                  className={`flex items-center gap-1.5 flex-shrink-0 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    category === cat.id
                      ? 'bg-indigo-500/12 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20'
                      : 'text-fg-muted hover:text-fg-primary hover:bg-surface-raised/60'
                  }`}
                >
                  {cat.label}
                  {badge > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
                      {badge}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* List */}
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="hud-card p-4 animate-pulse">
                  <div className="flex gap-3">
                    <div className="w-9 h-9 bg-surface-raised rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-3/4 bg-surface-raised rounded" />
                      <div className="h-3 w-1/2 bg-surface-raised rounded" />
                    </div>
                    <div className="h-3 w-12 bg-surface-raised rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : displayed.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="hud-card p-12 text-center"
            >
              <Inbox className="w-12 h-12 text-fg-muted mx-auto mb-4 opacity-50" />
              <h3 className="text-base font-semibold text-fg-primary mb-1">
                {category === 'unread' ? 'No unread notifications' : `No ${category === 'all' ? '' : category + ' '}notifications yet`}
              </h3>
              <p className="text-sm text-fg-muted max-w-xs mx-auto">
                {category === 'social'
                  ? 'Replies, mentions, follows, and community activity will appear here.'
                  : category === 'trading'
                  ? 'Price alerts and portfolio notifications will appear here.'
                  : category === 'unread'
                  ? 'Switch to "All" to see your notification history.'
                  : "When someone replies, messages, follows you, or upvotes your posts, you'll see it here."}
              </p>
            </motion.div>
          ) : (
            <>
              <div className="space-y-2">
                <AnimatePresence initial={false}>
                  {displayed.map((notification, i) => {
                    const Icon = TYPE_ICONS[notification.type] || Bell
                    const colorClass = TYPE_COLORS[notification.type] || 'text-fg-muted bg-surface-raised'
                    const typeLabel = TYPE_LABELS[notification.type] || notification.type

                    return (
                      <motion.div
                        key={notification.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.15, delay: Math.min(i, 10) * 0.025 }}
                        onClick={() => handleClick(notification)}
                        className={`relative rounded-xl transition-all group border cursor-pointer ${
                          notification.is_read
                            ? 'bg-surface-raised/60 border-line-subtle hover:bg-surface-raised hover:border-line-default'
                            : 'bg-indigo-500/[0.04] border-l-2 border-l-indigo-500 border-t border-r border-b border-indigo-500/20'
                        }`}
                      >
                        <div className="flex gap-3 items-start p-3 sm:p-4">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${colorClass}`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted opacity-70">
                                {typeLabel}
                              </span>
                              {!notification.is_read && (
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                              )}
                            </div>
                            <p className={`text-sm leading-snug ${notification.is_read ? 'text-fg-secondary' : 'text-fg-primary font-medium'}`}>
                              {notification.title}
                            </p>
                            {notification.body && (
                              <p className="text-xs text-fg-muted mt-0.5 line-clamp-2">
                                {notification.body}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className="text-[11px] text-fg-muted whitespace-nowrap">
                              {relativeTime(notification.created_at)}
                            </span>
                            <ChevronRight className="w-3.5 h-3.5 text-fg-muted opacity-0 group-hover:opacity-60 transition-opacity" />
                          </div>
                        </div>
                        {/* Action buttons — visible on hover */}
                        <div
                          className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {!notification.is_read && (
                            <button
                              type="button"
                              onClick={(e) => handleMarkOneRead(e, notification)}
                              title="Mark as read"
                              className="p-1.5 rounded-lg text-fg-muted hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors"
                            >
                              <CheckCheck className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => handleDelete(e, notification.id)}
                            title="Delete notification"
                            className="p-1.5 rounded-lg text-fg-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              </div>

              {/* Pagination / Load More */}
              {hasMore && (
                <div className="mt-4 flex justify-center">
                  <button
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 rounded-xl hover:bg-indigo-500/15 transition-colors disabled:opacity-50"
                  >
                    {loadingMore ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Loading...</>
                    ) : (
                      <><RefreshCw className="w-4 h-4" /> Load more</>
                    )}
                  </button>
                </div>
              )}

              <p className="mt-3 text-center text-xs text-fg-muted">
                Showing {displayed.length} notification{displayed.length !== 1 ? 's' : ''}
              </p>
            </>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
