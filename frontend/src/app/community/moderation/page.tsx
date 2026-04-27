'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Check,
  X,
  AlertTriangle,
  Loader2,
  Clock,
  ChevronDown,
  ChevronRight,
  Filter,
  Eye,
  Trash2,
  Ban,
} from 'lucide-react'
import { fetchModerationQueue, moderationAction } from '@/lib/api'
import AppLayout from '@/components/AppLayout'

/* ── Types ─────────────────────────────────────────────────── */

interface ReportedItem {
  id: number
  target_type: 'post' | 'comment'
  target_id: number
  content_preview: string
  reason: string
  description?: string
  risk_score: number
  flags: string[]
  reporter: { id: number; username: string }
  author: { id: number; username: string }
  status: 'pending' | 'approved' | 'removed' | 'warned'
  reviewed_by?: string
  reviewed_at?: string
  created_at: string
}

interface AuditEntry {
  id: number
  report_id: number
  action: string
  moderator: string
  reason?: string
  created_at: string
}

/* ── Constants ─────────────────────────────────────────────── */

type TabKey = 'pending' | 'reviewed' | 'all'

const TABS: { key: TabKey; label: string; icon: typeof ShieldAlert }[] = [
  { key: 'pending', label: 'Pending', icon: ShieldAlert },
  { key: 'reviewed', label: 'Reviewed', icon: ShieldCheck },
  { key: 'all', label: 'All', icon: Shield },
]

const FLAG_STYLES: Record<string, { bg: string; text: string }> = {
  spam: { bg: 'bg-surface-raised border-line-subtle', text: 'text-fg-secondary' },
  misinformation: { bg: 'bg-red-500/15 border-red-500/25', text: 'text-red-400' },
  manipulation: { bg: 'bg-purple-500/15 border-purple-500/25', text: 'text-purple-400' },
  harassment: { bg: 'bg-orange-500/15 border-orange-500/25', text: 'text-orange-400' },
  other: { bg: 'bg-surface-raised border-line-subtle', text: 'text-fg-muted' },
}

const FLAG_TYPES = ['spam', 'misinformation', 'manipulation', 'harassment'] as const

/* ── Risk Score Bar ────────────────────────────────────────── */

function RiskBar({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const color =
    score < 0.3 ? 'bg-emerald-500' : score < 0.7 ? 'bg-amber-500' : 'bg-red-500'
  const textColor =
    score < 0.3 ? 'text-emerald-400' : score < 0.7 ? 'text-amber-400' : 'text-red-400'

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-surface-raised rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className={`h-full rounded-full ${color}`}
        />
      </div>
      <span className={`text-xs font-mono font-semibold tabular-nums ${textColor}`}>
        {pct}%
      </span>
    </div>
  )
}

/* ── Time Ago ──────────────────────────────────────────────── */

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/* ── Main Component ────────────────────────────────────────── */

export default function ModerationDashboard() {
  const [tab, setTab] = useState<TabKey>('pending')
  const [items, setItems] = useState<ReportedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const [filterFlag, setFilterFlag] = useState<string | ''>('')
  const [expandedAudit, setExpandedAudit] = useState<number | null>(null)
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const [stats, setStats] = useState({ pending: 0, reviewedToday: 0, autoRemoved: 0 })

  const loadQueue = useCallback(async (status: TabKey) => {
    setLoading(true)
    try {
      const data = await fetchModerationQueue(status)
      if (data.access_denied) {
        setAccessDenied(true)
        return
      }
      setItems(data.items || [])
      if (data.stats) {
        setStats({
          pending: data.stats.pending ?? 0,
          reviewedToday: data.stats.reviewed_today ?? 0,
          autoRemoved: data.stats.auto_removed_today ?? 0,
        })
      }
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadQueue(tab)
  }, [tab, loadQueue])

  const handleAction = async (reportId: number, action: string) => {
    setActionLoading(reportId)
    const ok = await moderationAction(reportId, action)
    if (ok) {
      setItems((prev) => prev.filter((i) => i.id !== reportId))
      setStats((prev) => ({
        ...prev,
        pending: Math.max(0, prev.pending - 1),
        reviewedToday: prev.reviewedToday + 1,
      }))
    }
    setActionLoading(null)
  }

  const filteredItems = filterFlag
    ? items.filter((i) => i.flags.includes(filterFlag))
    : items

  /* ── Access Denied ───────────────────────────────────────── */

  if (accessDenied) {
    return (
      <AppLayout>
      <div className="min-h-screen flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-surface-base border border-line-subtle rounded-2xl p-12 text-center max-w-md"
        >
          <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Ban className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-xl font-bold text-fg-primary mb-2">Access Denied</h2>
          <p className="text-sm text-fg-muted">
            You do not have moderator or admin privileges to view this dashboard.
          </p>
        </motion.div>
      </div>
      </AppLayout>
    )
  }

  /* ── Main Render ─────────────────────────────────────────── */

  return (
    <AppLayout>
    <div className="min-h-screen pb-safe">
      <div className="max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <Shield className="w-6 h-6 text-blue-400" />
            <h1 className="text-2xl font-bold text-fg-primary">Moderation Dashboard</h1>
          </div>
          <p className="text-sm text-fg-muted">Review flagged content and take action</p>
        </div>

        {/* Stats Bar */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-3 gap-3 sm:gap-4 mb-6"
        >
          {[
            { label: 'Pending Review', value: stats.pending, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
            { label: 'Reviewed Today', value: stats.reviewedToday, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
            { label: 'Auto-Removed', value: stats.autoRemoved, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
          ].map((stat) => (
            <div
              key={stat.label}
              className={`${stat.bg} border ${stat.border} rounded-xl p-3 sm:p-4 text-center`}
            >
              <p className={`text-xl sm:text-2xl font-bold tabular-nums ${stat.color}`}>
                {stat.value}
              </p>
              <p className="text-xs text-fg-muted mt-0.5">{stat.label}</p>
            </div>
          ))}
        </motion.div>

        {/* Tabs + Filter */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-4">
          <div className="bg-surface-base border border-line-subtle rounded-xl p-1.5 flex gap-1 flex-1 w-full sm:w-auto">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex-1 justify-center min-h-[44px] ${
                  tab === key
                    ? 'bg-surface-active text-fg-primary'
                    : 'text-fg-muted hover:text-fg-secondary hover:bg-surface-hover'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          {/* Filter */}
          <div className="relative">
            <Filter className="w-4 h-4 text-fg-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select
              value={filterFlag}
              onChange={(e) => setFilterFlag(e.target.value)}
              className="bg-surface-base border border-line-subtle rounded-xl pl-9 pr-8 py-2 text-sm text-fg-secondary appearance-none cursor-pointer focus:outline-none focus:border-blue-500/40 min-h-[44px]"
            >
              <option value="">All flags</option>
              {FLAG_TYPES.map((f) => (
                <option key={f} value={f}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-fg-muted absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-surface-base border border-line-subtle rounded-xl p-4 animate-pulse">
                <div className="flex gap-3">
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-32 bg-surface-raised rounded" />
                    <div className="h-5 w-3/4 bg-surface-raised rounded" />
                    <div className="h-2 w-full bg-surface-raised rounded" />
                    <div className="flex gap-2 mt-2">
                      <div className="h-6 w-16 bg-surface-raised rounded-md" />
                      <div className="h-6 w-16 bg-surface-raised rounded-md" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-surface-base border border-line-subtle rounded-xl p-12 text-center"
          >
            <ShieldCheck className="w-12 h-12 text-emerald-500/50 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-fg-secondary mb-2">All clear</h3>
            <p className="text-sm text-fg-muted">No items to review in this queue.</p>
          </motion.div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {filteredItems.map((item, i) => (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -40 }}
                  transition={{ duration: 0.25, delay: i * 0.03 }}
                  className="bg-surface-base border border-line-subtle rounded-xl overflow-hidden"
                >
                  <div className="p-4">
                    {/* Top row: meta + timestamp */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 text-xs text-fg-muted">
                        <span className="px-2 py-0.5 rounded bg-surface-raised border border-line-subtle text-fg-muted font-medium uppercase tracking-wider text-[10px]">
                          {item.target_type}
                        </span>
                        <span>
                          by <span className="text-fg-secondary">{item.author.username}</span>
                        </span>
                        <span className="text-fg-muted">|</span>
                        <span>
                          reported by <span className="text-fg-secondary">{item.reporter.username}</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-fg-muted">
                        <Clock className="w-3 h-3" />
                        {timeAgo(item.created_at)}
                      </div>
                    </div>

                    {/* Content preview */}
                    <p className="text-sm text-fg-primary mb-3 line-clamp-3 leading-relaxed">
                      {item.content_preview}
                    </p>

                    {/* Risk score */}
                    <div className="mb-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] text-fg-muted uppercase tracking-wider font-medium">AI Risk Score</span>
                      </div>
                      <RiskBar score={item.risk_score} />
                    </div>

                    {/* Flags */}
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      {item.flags.map((flag) => {
                        const style = FLAG_STYLES[flag] || FLAG_STYLES.other
                        return (
                          <span
                            key={flag}
                            className={`px-2 py-0.5 text-xs font-medium rounded-md border ${style.bg} ${style.text}`}
                          >
                            {flag}
                          </span>
                        )
                      })}
                    </div>

                    {/* Actions */}
                    {item.status === 'pending' ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleAction(item.id, 'approve')}
                          disabled={actionLoading === item.id}
                          className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 rounded-lg text-xs font-medium hover:bg-emerald-500/25 transition-colors disabled:opacity-40 min-h-[44px]"
                        >
                          {actionLoading === item.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Check className="w-3.5 h-3.5" />
                          )}
                          Approve
                        </button>
                        <button
                          onClick={() => handleAction(item.id, 'remove')}
                          disabled={actionLoading === item.id}
                          className="flex items-center gap-1.5 px-3 py-2 bg-red-500/15 text-red-400 border border-red-500/25 rounded-lg text-xs font-medium hover:bg-red-500/25 transition-colors disabled:opacity-40 min-h-[44px]"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Remove
                        </button>
                        <button
                          onClick={() => handleAction(item.id, 'warn')}
                          disabled={actionLoading === item.id}
                          className="flex items-center gap-1.5 px-3 py-2 bg-amber-500/15 text-amber-400 border border-amber-500/25 rounded-lg text-xs font-medium hover:bg-amber-500/25 transition-colors disabled:opacity-40 min-h-[44px]"
                        >
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Warn User
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-xs text-fg-muted">
                        <span className={`px-2 py-0.5 rounded-md font-medium ${
                          item.status === 'approved'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : item.status === 'removed'
                              ? 'bg-red-500/10 text-red-400'
                              : 'bg-amber-500/10 text-amber-400'
                        }`}>
                          {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                        </span>
                        {item.reviewed_by && (
                          <span>
                            by {item.reviewed_by}
                          </span>
                        )}
                        {item.reviewed_at && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {timeAgo(item.reviewed_at)}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Audit log toggle */}
                    <button
                      onClick={() =>
                        setExpandedAudit(expandedAudit === item.id ? null : item.id)
                      }
                      className="mt-3 flex items-center gap-1 text-xs text-fg-muted hover:text-fg-secondary transition-colors min-h-[44px]"
                    >
                      {expandedAudit === item.id ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                      <Eye className="w-3.5 h-3.5" />
                      Audit Log
                    </button>
                  </div>

                  {/* Expanded audit log */}
                  <AnimatePresence>
                    {expandedAudit === item.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-line-subtle bg-surface-base px-4 py-3">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-fg-muted uppercase tracking-wider">
                                <th className="text-left pb-2 font-medium">Action</th>
                                <th className="text-left pb-2 font-medium">Moderator</th>
                                <th className="text-left pb-2 font-medium">Reason</th>
                                <th className="text-right pb-2 font-medium">Time</th>
                              </tr>
                            </thead>
                            <tbody className="text-fg-muted">
                              {item.status !== 'pending' ? (
                                <tr>
                                  <td className="py-1.5 pr-3">
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                      item.status === 'approved'
                                        ? 'bg-emerald-500/10 text-emerald-400'
                                        : item.status === 'removed'
                                          ? 'bg-red-500/10 text-red-400'
                                          : 'bg-amber-500/10 text-amber-400'
                                    }`}>
                                      {item.status}
                                    </span>
                                  </td>
                                  <td className="py-1.5 pr-3 text-fg-secondary">
                                    {item.reviewed_by || 'System'}
                                  </td>
                                  <td className="py-1.5 pr-3">{item.description || '-'}</td>
                                  <td className="py-1.5 text-right">
                                    {item.reviewed_at ? timeAgo(item.reviewed_at) : '-'}
                                  </td>
                                </tr>
                              ) : (
                                <tr>
                                  <td colSpan={4} className="py-3 text-center text-fg-muted">
                                    No actions recorded yet
                                  </td>
                                </tr>
                              )}
                              <tr>
                                <td className="py-1.5 pr-3">
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-400">
                                    reported
                                  </span>
                                </td>
                                <td className="py-1.5 pr-3 text-fg-secondary">
                                  {item.reporter.username}
                                </td>
                                <td className="py-1.5 pr-3">{item.flags.join(', ')}</td>
                                <td className="py-1.5 text-right">{timeAgo(item.created_at)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
    </AppLayout>
  )
}
