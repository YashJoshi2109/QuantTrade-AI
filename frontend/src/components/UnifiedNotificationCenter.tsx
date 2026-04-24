'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import {
  Bell,
  MessageSquare,
  ArrowUp,
  AtSign,
  UserPlus,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  CheckCheck,
  X,
  ChevronRight,
  Zap,
  MessageCircle,
  Newspaper,
  Users,
} from 'lucide-react'
import {
  fetchUnreadCount,
  fetchNotifications,
  fetchPredictionAlerts,
  markAllNotificationsRead,
  type Notification,
  type PredictionAlert,
} from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useCommunityWS } from '@/hooks/useCommunityWS'

type TabId = 'all' | 'community' | 'signals'

function relativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Math.max(0, now - then)
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}

const COMM_ICONS: Record<string, typeof MessageSquare> = {
  reply: MessageSquare,
  upvote: ArrowUp,
  mention: AtSign,
  follow: UserPlus,
  alert: AlertCircle,
  dm: MessageCircle,
  follow_post: Newspaper,
  community_post: Users,
}

const COMM_COLORS: Record<string, string> = {
  reply: 'text-blue-400 bg-blue-500/15',
  upvote: 'text-emerald-400 bg-emerald-500/15',
  mention: 'text-violet-400 bg-violet-500/15',
  follow: 'text-cyan-400 bg-cyan-500/15',
  alert: 'text-amber-400 bg-amber-500/15',
  dm: 'text-blue-300 bg-blue-400/15',
  follow_post: 'text-orange-400 bg-orange-500/15',
  community_post: 'text-teal-400 bg-teal-500/15',
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

export default function UnifiedNotificationCenter() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<TabId>('all')
  const [unreadComm, setUnreadComm] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const { user } = useAuth()

  // Poll community unread count
  const pollUnread = useCallback(async () => {
    try {
      const data = await fetchUnreadCount()
      setUnreadComm(data.count ?? 0)
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    pollUnread()
    const iv = setInterval(pollUnread, 30_000)
    return () => clearInterval(iv)
  }, [pollUnread])

  // WebSocket real-time community updates + sound
  const handleWSMessage = useCallback((msg: { type: string }) => {
    if (
      msg.type === 'new_comment' ||
      msg.type === 'mention' ||
      msg.type === 'new_post' ||
      msg.type === 'dm.new' ||
      msg.type === 'notification'
    ) {
      setUnreadComm((prev) => prev + 1)
      playNotificationSound()
    }
  }, [])
  useCommunityWS(user?.id ? `user:${user.id}` : null, handleWSMessage)

  // Fetch community notifications when open
  const { data: communityNotifs = [] } = useQuery({
    queryKey: ['notifications-panel'],
    queryFn: async () => {
      const data = await fetchNotifications(20)
      return data.notifications || []
    },
    enabled: open,
    refetchInterval: open ? 30_000 : false,
    staleTime: 15_000,
  })

  // Fetch prediction alerts
  const { data: predAlerts = [] } = useQuery<PredictionAlert[]>({
    queryKey: ['predictionAlerts'],
    queryFn: () => fetchPredictionAlerts(0.65, 2.0),
    refetchInterval: 90_000,
    staleTime: 45_000,
  })

  const signalCount = predAlerts.length
  const totalBadge = unreadComm + signalCount

  // Close on click outside
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const handleMarkAllRead = async () => {
    setUnreadComm(0)
    try {
      await markAllNotificationsRead()
    } catch { /* silent */ }
  }

  const tabs: { id: TabId; label: string; count: number }[] = useMemo(() => [
    { id: 'all', label: 'All', count: totalBadge },
    { id: 'community', label: 'Social', count: unreadComm },
    { id: 'signals', label: 'Signals', count: signalCount },
  ], [totalBadge, unreadComm, signalCount])

  return (
    <div ref={panelRef} className="relative">
      {/* Single unified bell */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-lg text-slate-400 hover:text-cyan-300 hover:bg-slate-800/60 border border-transparent hover:border-slate-700/50 transition-colors"
        aria-label={totalBadge > 0 ? `${totalBadge} notifications` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Bell className="w-5 h-5" aria-hidden />
        {totalBadge > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center px-1 rounded-full text-[10px] font-bold bg-red-500 text-white border-2 border-[#0d1321] leading-none animate-in fade-in">
            {totalBadge > 99 ? '99+' : totalBadge}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-[380px] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-700/70 bg-[#0c1018]/98 shadow-2xl shadow-black/40 backdrop-blur-xl z-[60] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 bg-gradient-to-r from-slate-900/80 to-slate-800/40">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-100">Notifications</span>
              {totalBadge > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  {totalBadge}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadComm > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="p-1.5 rounded-md text-slate-500 hover:text-cyan-300 hover:bg-slate-800/60 transition-colors"
                  title="Mark all read"
                >
                  <CheckCheck className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-md text-slate-500 hover:text-slate-200 hover:bg-slate-800/60 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-slate-800/60 bg-[#080c14]/80">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex-1 px-3 py-2 text-[11px] font-medium transition-all relative ${
                  tab === t.id
                    ? 'text-cyan-300'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {t.label}
                {t.count > 0 && (
                  <span className={`ml-1 px-1 py-px rounded text-[9px] font-bold ${
                    tab === t.id
                      ? 'bg-cyan-500/20 text-cyan-300'
                      : 'bg-slate-800 text-slate-500'
                  }`}>
                    {t.count > 99 ? '99+' : t.count}
                  </span>
                )}
                {tab === t.id && (
                  <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-cyan-400 rounded-full" />
                )}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="max-h-[400px] overflow-y-auto overscroll-contain">
            {/* Community notifications */}
            {(tab === 'all' || tab === 'community') && communityNotifs.length > 0 && (
              <div>
                {tab === 'all' && (
                  <div className="px-3 pt-2.5 pb-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                      Community
                    </span>
                  </div>
                )}
                {communityNotifs.slice(0, tab === 'all' ? 5 : 15).map((n: Notification) => {
                  const Icon = COMM_ICONS[n.type] || Bell
                  const colorCls = COMM_COLORS[n.type] || 'text-slate-400 bg-slate-500/15'
                  return (
                    <Link
                      key={n.id}
                      href={n.action_url || '/notifications'}
                      onClick={() => setOpen(false)}
                      className={`flex items-start gap-2.5 px-3 py-2.5 hover:bg-slate-800/40 transition-colors border-b border-slate-800/30 ${
                        !n.is_read ? 'bg-cyan-500/[0.03]' : ''
                      }`}
                    >
                      <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${colorCls}`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-[12px] leading-snug ${!n.is_read ? 'text-slate-100 font-medium' : 'text-slate-400'}`}>
                          {n.title}
                        </p>
                        {n.body && (
                          <p className="text-[11px] text-slate-600 truncate mt-0.5">{n.body}</p>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-600 shrink-0 mt-0.5">
                        {relativeTime(n.created_at)}
                      </span>
                      {!n.is_read && (
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0 mt-1.5" />
                      )}
                    </Link>
                  )
                })}
              </div>
            )}

            {/* Prediction signal alerts */}
            {(tab === 'all' || tab === 'signals') && predAlerts.length > 0 && (
              <div>
                {tab === 'all' && (
                  <div className="px-3 pt-2.5 pb-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                      ML Signals
                    </span>
                  </div>
                )}
                {predAlerts.slice(0, tab === 'all' ? 5 : 15).map((a, i) => {
                  const isUp = String(a.direction ?? '').trim().toUpperCase() === 'UP'
                  return (
                    <Link
                      key={`${a.symbol}-${a.timeframe}-${a.direction}-${i}`}
                      href={`/research?symbol=${a.symbol}`}
                      onClick={() => setOpen(false)}
                      className="flex items-start gap-2.5 px-3 py-2.5 hover:bg-slate-800/40 transition-colors border-b border-slate-800/30"
                    >
                      <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${
                        isUp ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                      }`}>
                        {isUp ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px] font-bold text-slate-100">{a.symbol}</span>
                          <span className={`text-[9px] px-1 py-px rounded font-semibold ${
                            a.severity === 'high'
                              ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                              : a.severity === 'medium'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-slate-700/50 text-slate-400 border border-slate-600/30'
                          }`}>
                            {a.severity.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{a.message}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`text-[11px] font-mono font-bold ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                          {a.expected_return > 0 ? '+' : ''}{a.expected_return.toFixed(1)}%
                        </span>
                        <div className="text-[9px] text-slate-600 mt-0.5">
                          {(a.confidence * 100).toFixed(0)}% conf
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}

            {/* Empty state */}
            {((tab === 'all' && communityNotifs.length === 0 && predAlerts.length === 0) ||
              (tab === 'community' && communityNotifs.length === 0) ||
              (tab === 'signals' && predAlerts.length === 0)) && (
              <div className="py-10 text-center">
                <Bell className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                <p className="text-xs text-slate-500">No notifications yet</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-slate-800/60 bg-[#080c14]/80">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-1 px-3 py-2.5 text-[11px] font-medium text-slate-400 hover:text-cyan-300 transition-colors"
            >
              View all notifications
              <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
