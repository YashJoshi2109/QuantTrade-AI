'use client'

import { useState, useEffect, useCallback } from 'react'
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
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type Notification,
} from '@/lib/api'

type Filter = 'all' | 'unread'

const TYPE_ICONS: Record<string, typeof MessageSquare> = {
  reply: MessageSquare,
  upvote: ArrowUp,
  mention: AtSign,
  follow: UserPlus,
  alert: AlertCircle,
}

const TYPE_COLORS: Record<string, string> = {
  reply: 'text-blue-400 bg-blue-500/15',
  upvote: 'text-green-400 bg-green-500/15',
  mention: 'text-purple-400 bg-purple-500/15',
  follow: 'text-cyan-400 bg-cyan-500/15',
  alert: 'text-amber-400 bg-amber-500/15',
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
  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks}w ago`
  return new Date(dateStr).toLocaleDateString()
}

export default function NotificationsPage() {
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [markingAll, setMarkingAll] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchNotifications(50)
      setNotifications(data.notifications || [])
    } catch {
      setNotifications([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const unreadCount = notifications.filter((n) => !n.is_read).length

  const displayed = filter === 'unread' ? notifications.filter((n) => !n.is_read) : notifications

  const handleClick = async (notification: Notification) => {
    if (!notification.is_read) {
      // Optimistic
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, is_read: true } : n))
      )
      try {
        await markNotificationRead(notification.id)
      } catch {
        // Revert
        setNotifications((prev) =>
          prev.map((n) => (n.id === notification.id ? { ...n, is_read: false } : n))
        )
      }
    }
    if (notification.action_url) {
      router.push(notification.action_url)
    }
  }

  const handleMarkAllRead = async () => {
    setMarkingAll(true)
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
    try {
      await markAllNotificationsRead()
    } catch {
      // Reload on failure
      load()
    } finally {
      setMarkingAll(false)
    }
  }

  return (
    <div className="min-h-screen pb-safe">
      <div className="max-w-[720px] mx-auto px-3 sm:px-6 py-4 sm:py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <Bell className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-100">Notifications</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
              </p>
            </div>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              disabled={markingAll}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-lg hover:bg-blue-500/20 transition-colors disabled:opacity-50 min-h-[44px] sm:min-h-0"
            >
              {markingAll ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCheck className="w-3.5 h-3.5" />
              )}
              Mark All Read
            </button>
          )}
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-1 bg-[#0D1117] border border-white/[0.06] rounded-xl p-1 mb-5">
          {(['all', 'unread'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-white/[0.06] text-slate-100'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {f === 'all' ? 'All' : 'Unread'}
              {f === 'unread' && unreadCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-400">
                  {unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Notification List */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-4 animate-pulse"
              >
                <div className="flex gap-3">
                  <div className="w-9 h-9 bg-slate-800 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 bg-slate-800 rounded" />
                    <div className="h-3 w-1/2 bg-slate-800 rounded" />
                  </div>
                  <div className="h-3 w-12 bg-slate-800 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : displayed.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-12 text-center"
          >
            <Inbox className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-300 mb-2">
              {filter === 'unread' ? 'No unread notifications' : "You're all caught up!"}
            </h3>
            <p className="text-sm text-slate-500">
              {filter === 'unread'
                ? 'Switch to "All" to see your notification history.'
                : 'When someone replies, mentions you, or upvotes your posts, you\'ll see it here.'}
            </p>
          </motion.div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {displayed.map((notification, i) => {
                const Icon = TYPE_ICONS[notification.type] || Bell
                const colorClass = TYPE_COLORS[notification.type] || 'text-slate-400 bg-slate-500/15'

                return (
                  <motion.button
                    key={notification.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.15, delay: i * 0.02 }}
                    onClick={() => handleClick(notification)}
                    className={`w-full text-left bg-[#0D1117] border rounded-xl p-3 sm:p-4 transition-colors group ${
                      notification.is_read
                        ? 'border-white/[0.06] hover:border-white/[0.1]'
                        : 'border-l-2 border-l-blue-500 border-t border-r border-b border-white/[0.08] bg-blue-500/[0.02]'
                    }`}
                  >
                    <div className="flex gap-3 items-start">
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${colorClass}`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm leading-snug ${
                            notification.is_read ? 'text-slate-300' : 'text-slate-100 font-medium'
                          }`}
                        >
                          {notification.title}
                        </p>
                        {notification.body && (
                          <p className="text-xs text-slate-500 mt-0.5 truncate">
                            {notification.body}
                          </p>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-600 whitespace-nowrap shrink-0 mt-0.5">
                        {relativeTime(notification.created_at)}
                      </span>
                    </div>
                  </motion.button>
                )
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}
