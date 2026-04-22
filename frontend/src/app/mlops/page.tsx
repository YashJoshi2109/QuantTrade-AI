'use client'

/**
 * QuantTrade AI — MLOps Command Center
 * Production-grade ML lifecycle dashboard: training runs, model registry,
 * drift monitoring, feature store, and pipeline configuration.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import {
  Brain, Activity, Database, AlertTriangle, BarChart3,
  ChevronRight, ChevronDown, Cpu, Layers, Play, Shield,
  Eye, CheckCircle, Loader2, TrendingUp,
  GitBranch, Package, Terminal, ArrowUpRight,
  ArrowDownRight, Hash,
  Rocket, Target,
  SlidersHorizontal, Sparkles,
} from 'lucide-react'
import AppLayout from '@/components/AppLayout'

const API = process.env.NEXT_PUBLIC_API_URL || ''

// ── Types ────────────────────────────────────────────────────────────────────

interface OverviewData {
  models: { registered: number; production: Record<string, any> }
  experiments: { total_runs: number }
  feature_store: { symbols: number; schema_version: string }
  predictions: Record<string, any>
  alerts: number
}

interface TrainingRun {
  run_id: string
  status: string
  started_at: string
  finished_at?: string
  total_symbols: number
  symbols_completed: number
  symbols_failed: number
  shards?: any[]
  config?: any
  error?: string
  runtime_seconds?: number
}

interface ModelVersion {
  name: string
  version: number | string
  stage: string
  metrics?: Record<string, number>
  created_at?: string
  description?: string
}

interface Alert {
  id: string
  type: string
  severity: string
  message: string
  model_name?: string
  timestamp: string
  resolved?: boolean
}

interface PipelineHealth {
  status: string
  last_run?: string
  uptime_hours?: number
  active_runs?: number
  queue_depth?: number
}

interface MetricsSummary {
  total_runs: number
  successful_runs: number
  failed_runs: number
  avg_runtime_seconds: number
  total_symbols_trained: number
  avg_da?: number
  avg_ic?: number
  avg_sharpe?: number
}

interface PerformanceData {
  performance: Record<string, any>
  should_retrain: boolean
  retrain_reason?: string
}

interface DriftReport {
  symbol: string
  drift_detected: boolean
  drift_score?: number
  features_drifted?: string[]
  timestamp?: string
}

// ── Tab definition ───────────────────────────────────────────────────────────

type TabId = 'overview' | 'runs' | 'models' | 'monitoring' | 'config'

interface Tab {
  id: TabId
  label: string
  icon: LucideIcon
  badge?: number | string
}

// ── Utility helpers ──────────────────────────────────────────────────────────

function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '--'
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

function formatTimestamp(ts?: string): string {
  if (!ts) return '--'
  try {
    const d = new Date(ts)
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      hour12: false,
    })
  } catch { return ts }
}

function relativeTime(ts?: string): string {
  if (!ts) return '--'
  try {
    const diff = Date.now() - new Date(ts).getTime()
    if (diff < 60_000) return 'just now'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
    return `${Math.floor(diff / 86_400_000)}d ago`
  } catch { return '--' }
}

function metricColor(value: number, thresholds: [number, number] = [0.5, 0.7]): string {
  if (value >= thresholds[1]) return 'text-emerald-400'
  if (value >= thresholds[0]) return 'text-amber-400'
  return 'text-red-400'
}

// ── Shared fetch helper ──────────────────────────────────────────────────────

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      credentials: 'include',
      ...opts,
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// ── Skeleton / Loading Components ────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-slate-800/60 ${className}`} />
  )
}

function SkeletonCard() {
  return (
    <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-5 space-y-3">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-16" />
      <Skeleton className="h-3 w-32" />
    </div>
  )
}

function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  )
}

// ── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, size = 'sm' }: { status: string; size?: 'xs' | 'sm' }) {
  const normalized = status?.toLowerCase() || 'unknown'
  const config: Record<string, { bg: string; text: string; dot: string; label: string }> = {
    completed:  { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400', label: 'Completed' },
    success:    { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400', label: 'Success' },
    production: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400', label: 'Production' },
    healthy:    { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400', label: 'Healthy' },
    active:     { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400', label: 'Active' },
    running:    { bg: 'bg-amber-500/10',   text: 'text-amber-400',   dot: 'bg-amber-400',   label: 'Running' },
    training:   { bg: 'bg-amber-500/10',   text: 'text-amber-400',   dot: 'bg-amber-400',   label: 'Training' },
    staging:    { bg: 'bg-amber-500/10',   text: 'text-amber-400',   dot: 'bg-amber-400',   label: 'Staging' },
    pending:    { bg: 'bg-slate-500/10',   text: 'text-slate-400',   dot: 'bg-slate-400',   label: 'Pending' },
    queued:     { bg: 'bg-slate-500/10',   text: 'text-slate-400',   dot: 'bg-slate-400',   label: 'Queued' },
    archived:   { bg: 'bg-slate-500/10',   text: 'text-slate-400',   dot: 'bg-slate-400',   label: 'Archived' },
    none:       { bg: 'bg-slate-500/10',   text: 'text-slate-400',   dot: 'bg-slate-400',   label: 'None' },
    failed:     { bg: 'bg-red-500/10',     text: 'text-red-400',     dot: 'bg-red-400',     label: 'Failed' },
    error:      { bg: 'bg-red-500/10',     text: 'text-red-400',     dot: 'bg-red-400',     label: 'Error' },
    degraded:   { bg: 'bg-red-500/10',     text: 'text-red-400',     dot: 'bg-red-400',     label: 'Degraded' },
    critical:   { bg: 'bg-red-500/10',     text: 'text-red-400',     dot: 'bg-red-400',     label: 'Critical' },
    warning:    { bg: 'bg-amber-500/10',   text: 'text-amber-400',   dot: 'bg-amber-400',   label: 'Warning' },
    info:       { bg: 'bg-blue-500/10',    text: 'text-blue-400',    dot: 'bg-blue-400',    label: 'Info' },
  }
  const c = config[normalized] || { bg: 'bg-slate-500/10', text: 'text-slate-400', dot: 'bg-slate-400', label: status }
  const textSize = size === 'xs' ? 'text-[10px]' : 'text-xs'
  const dotSize = size === 'xs' ? 'w-1.5 h-1.5' : 'w-2 h-2'
  const px = size === 'xs' ? 'px-1.5 py-0.5' : 'px-2 py-0.5'

  return (
    <span className={`inline-flex items-center gap-1.5 ${px} rounded-full ${c.bg} ${c.text} ${textSize} font-medium`}>
      <span className={`${dotSize} rounded-full ${c.dot} ${normalized === 'running' || normalized === 'training' ? 'animate-pulse' : ''}`} />
      {c.label}
    </span>
  )
}

// ── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, color = 'text-cyan-400', trend, delay = 0 }: {
  icon: LucideIcon; label: string; value: string | number; sub?: string
  color?: string; trend?: 'up' | 'down' | null; delay?: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-4 hover:border-white/[0.12] transition-colors group"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center border border-white/[0.06] group-hover:border-white/[0.1] transition-colors`}>
            <Icon className={`w-4 h-4 ${color}`} />
          </div>
          <span className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">{label}</span>
        </div>
        {trend && (
          <div className={`flex items-center gap-0.5 ${trend === 'up' ? 'text-emerald-400' : 'text-red-400'}`}>
            {trend === 'up' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          </div>
        )}
      </div>
      <div className="text-2xl font-bold text-slate-100 font-mono tracking-tight">{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-1">{sub}</div>}
    </motion.div>
  )
}

// ── Panel wrapper ────────────────────────────────────────────────────────────

function Panel({ title, icon: Icon, children, className = '', actions, color = 'text-cyan-400' }: {
  title: string; icon: LucideIcon; children: React.ReactNode
  className?: string; actions?: React.ReactNode; color?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`bg-[#0D1117] border border-white/[0.06] rounded-xl overflow-hidden ${className}`}
    >
      <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Icon className={`w-4 h-4 ${color}`} />
          <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">{title}</h3>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div className="p-5">{children}</div>
    </motion.div>
  )
}

// ── Inline mini bar chart ────────────────────────────────────────────────────

function MiniBar({ value, max = 1, color = 'bg-cyan-500', width = 80 }: {
  value: number; max?: number; color?: string; width?: number
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden" style={{ width }}>
        <motion.div
          className={`h-full rounded-full ${color}`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
      <span className="text-[11px] text-slate-400 font-mono">{(value * 100).toFixed(1)}%</span>
    </div>
  )
}

// ── Metric pill ──────────────────────────────────────────────────────────────

function MetricPill({ label, value, thresholds }: {
  label: string; value?: number; thresholds?: [number, number]
}) {
  if (value === undefined || value === null) return null
  const color = metricColor(value, thresholds)
  return (
    <div className="flex flex-col items-center">
      <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">{label}</span>
      <span className={`text-sm font-bold font-mono ${color}`}>{value.toFixed(4)}</span>
    </div>
  )
}

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, message }: { icon: LucideIcon; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-slate-500">
      <Icon className="w-10 h-10 mb-3 opacity-40" />
      <p className="text-sm">{message}</p>
    </div>
  )
}

// ── Inline error ─────────────────────────────────────────────────────────────

function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-lg bg-red-500/5 border border-red-500/10">
      <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
      <p className="text-sm text-red-300 flex-1">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="text-xs text-red-400 hover:text-red-300 font-medium">
          Retry
        </button>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: OVERVIEW
// ══════════════════════════════════════════════════════════════════════════════

function OverviewTab() {
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [health, setHealth] = useState<PipelineHealth | null>(null)
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [latestRun, setLatestRun] = useState<TrainingRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchAll = useCallback(async () => {
    setError(null)
    try {
      const [ov, hl, mt, al, runs] = await Promise.all([
        apiFetch<OverviewData>('/api/v1/mlops/overview'),
        apiFetch<PipelineHealth>('/api/v1/internal/ml/health'),
        apiFetch<MetricsSummary>('/api/v1/internal/ml/metrics/summary?days=7'),
        apiFetch<{ alerts: Alert[] }>('/api/v1/mlops/monitoring/alerts'),
        apiFetch<{ runs: TrainingRun[] }>('/api/v1/internal/ml/runs?limit=1'),
      ])
      setOverview(ov)
      setHealth(hl)
      setMetrics(mt)
      setAlerts(al?.alerts || [])
      setLatestRun(runs?.runs?.[0] || null)
    } catch {
      setError('Failed to load overview data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
    intervalRef.current = setInterval(fetchAll, 30_000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [fetchAll])

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SkeletonTable rows={4} />
          <SkeletonTable rows={4} />
        </div>
      </div>
    )
  }

  if (error) return <InlineError message={error} onRetry={fetchAll} />

  const prodModels = overview?.models?.production || {}
  const prodCount = Object.keys(prodModels).length
  const successRate = metrics && metrics.total_runs > 0
    ? ((metrics.successful_runs / metrics.total_runs) * 100).toFixed(1)
    : '--'

  const activeAlerts = alerts.filter(a => !a.resolved)

  return (
    <div className="space-y-6">
      {/* Health Banner */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
          health?.status === 'healthy'
            ? 'bg-emerald-500/5 border-emerald-500/20'
            : health?.status === 'degraded'
            ? 'bg-amber-500/5 border-amber-500/20'
            : 'bg-red-500/5 border-red-500/20'
        }`}
      >
        <div className={`w-2.5 h-2.5 rounded-full ${
          health?.status === 'healthy' ? 'bg-emerald-400 animate-pulse' :
          health?.status === 'degraded' ? 'bg-amber-400 animate-pulse' :
          'bg-red-400 animate-pulse'
        }`} />
        <span className="text-sm font-medium text-slate-200">
          Pipeline {health?.status === 'healthy' ? 'Operational' : health?.status === 'degraded' ? 'Degraded' : 'Down'}
        </span>
        <span className="text-xs text-slate-500 ml-auto">
          {health?.uptime_hours ? `Uptime: ${health.uptime_hours.toFixed(1)}h` : ''}
          {health?.last_run ? ` | Last run: ${relativeTime(health.last_run)}` : ''}
        </span>
      </motion.div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard icon={Layers} label="Models" value={overview?.models?.registered || 0}
          sub={`${prodCount} in production`} color="text-purple-400" delay={0} />
        <StatCard icon={Play} label="Runs (7d)" value={metrics?.total_runs || 0}
          sub={`${successRate}% success rate`} color="text-blue-400" delay={0.05} />
        <StatCard icon={Database} label="Symbols" value={overview?.feature_store?.symbols || 0}
          sub={`Schema v${overview?.feature_store?.schema_version || '?'}`} color="text-cyan-400" delay={0.1} />
        <StatCard icon={Target} label="Avg DA" value={metrics?.avg_da ? metrics.avg_da.toFixed(4) : '--'}
          sub="Directional accuracy" color="text-emerald-400" delay={0.15} />
        <StatCard icon={TrendingUp} label="Avg Sharpe" value={metrics?.avg_sharpe ? metrics.avg_sharpe.toFixed(3) : '--'}
          sub="Risk-adj. return" color="text-amber-400" delay={0.2} />
        <StatCard icon={AlertTriangle} label="Alerts" value={activeAlerts.length}
          sub={activeAlerts.length > 0 ? 'Requires attention' : 'All clear'}
          color={activeAlerts.length > 0 ? 'text-red-400' : 'text-slate-500'} delay={0.25} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Latest Run Summary */}
        <Panel title="Latest Training Run" icon={Rocket} color="text-blue-400">
          {latestRun ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <code className="text-xs text-slate-400 font-mono bg-slate-800/40 px-2 py-1 rounded">
                    {latestRun.run_id?.slice(0, 12)}...
                  </code>
                  <StatusBadge status={latestRun.status} />
                </div>
                <span className="text-xs text-slate-500">{relativeTime(latestRun.started_at)}</span>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Symbols</div>
                  <div className="text-lg font-bold text-slate-200 font-mono">
                    {latestRun.symbols_completed}<span className="text-slate-500">/{latestRun.total_symbols}</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Failed</div>
                  <div className={`text-lg font-bold font-mono ${latestRun.symbols_failed > 0 ? 'text-red-400' : 'text-slate-400'}`}>
                    {latestRun.symbols_failed}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Runtime</div>
                  <div className="text-lg font-bold text-slate-200 font-mono">
                    {formatDuration(latestRun.runtime_seconds)}
                  </div>
                </div>
              </div>
              {latestRun.total_symbols > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">Progress</span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {((latestRun.symbols_completed / latestRun.total_symbols) * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <motion.div
                      className={`h-full rounded-full ${
                        latestRun.status === 'completed' ? 'bg-emerald-500' :
                        latestRun.status === 'failed' ? 'bg-red-500' : 'bg-amber-500'
                      }`}
                      initial={{ width: 0 }}
                      animate={{ width: `${(latestRun.symbols_completed / latestRun.total_symbols) * 100}%` }}
                      transition={{ duration: 0.8 }}
                    />
                  </div>
                </div>
              )}
              {latestRun.error && (
                <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/10">
                  <p className="text-xs text-red-300 font-mono">{latestRun.error}</p>
                </div>
              )}
            </div>
          ) : (
            <EmptyState icon={Rocket} message="No training runs recorded yet" />
          )}
        </Panel>

        {/* Production Models */}
        <Panel title="Production Models" icon={Cpu} color="text-emerald-400">
          {prodCount === 0 ? (
            <EmptyState icon={Cpu} message="No models in production" />
          ) : (
            <div className="space-y-3">
              {Object.entries(prodModels).map(([name, info]: [string, any]) => (
                <div key={name} className="p-3 bg-slate-800/20 rounded-lg border border-white/[0.04] hover:border-white/[0.08] transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Package className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-sm font-medium text-slate-200">{name}</span>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded-full font-mono">
                      v{info.version}
                    </span>
                  </div>
                  {info.metrics && (
                    <div className="flex items-center gap-4 mt-2">
                      {Object.entries(info.metrics).slice(0, 4).map(([k, v]: [string, any]) => (
                        <div key={k} className="text-center">
                          <div className="text-[10px] text-slate-500 uppercase">{k.replace(/_/g, ' ')}</div>
                          <div className="text-xs font-mono text-slate-300">{typeof v === 'number' ? v.toFixed(4) : v}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Active Alerts */}
        <Panel title="Active Alerts" icon={AlertTriangle} color={activeAlerts.length > 0 ? 'text-red-400' : 'text-slate-500'}
          actions={<span className="text-[10px] text-slate-500 font-mono">{activeAlerts.length} active</span>}
        >
          {activeAlerts.length === 0 ? (
            <div className="flex items-center gap-3 py-6 justify-center text-slate-500">
              <Shield className="w-5 h-5 opacity-40" />
              <span className="text-sm">No active alerts</span>
            </div>
          ) : (
            <div className="space-y-2 max-h-[240px] overflow-y-auto scrollbar-thin">
              {activeAlerts.slice(0, 10).map((alert, i) => (
                <motion.div
                  key={alert.id || i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className={`flex items-start gap-3 p-3 rounded-lg border ${
                    alert.severity === 'critical' ? 'bg-red-500/5 border-red-500/15' :
                    alert.severity === 'warning' ? 'bg-amber-500/5 border-amber-500/15' :
                    'bg-blue-500/5 border-blue-500/15'
                  }`}
                >
                  <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                    alert.severity === 'critical' ? 'text-red-400' :
                    alert.severity === 'warning' ? 'text-amber-400' : 'text-blue-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-200 leading-relaxed">{alert.message}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {alert.model_name && (
                        <span className="text-[10px] text-slate-500 font-mono">{alert.model_name}</span>
                      )}
                      <span className="text-[10px] text-slate-600">{relativeTime(alert.timestamp)}</span>
                    </div>
                  </div>
                  <StatusBadge status={alert.severity} size="xs" />
                </motion.div>
              ))}
            </div>
          )}
        </Panel>

        {/* Pipeline Stages */}
        <Panel title="Pipeline Health" icon={GitBranch} color="text-amber-400">
          <div className="space-y-3">
            {[
              { stage: 'Data Ingestion', icon: Database, desc: 'Market data fetch & validation' },
              { stage: 'Feature Engineering', icon: Sparkles, desc: 'Technical indicators & NLP features' },
              { stage: 'Drift Detection', icon: Eye, desc: 'Statistical distribution monitoring' },
              { stage: 'Model Training', icon: Brain, desc: 'LSTM & ensemble training pipeline' },
              { stage: 'Evaluation', icon: Target, desc: 'Out-of-sample performance metrics' },
              { stage: 'Model Registry', icon: Package, desc: 'Version control & promotion' },
            ].map((item, i) => (
              <motion.div
                key={item.stage}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06 }}
                className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/[0.02] transition-colors group"
              >
                <div className="w-7 h-7 rounded-lg bg-white/[0.04] flex items-center justify-center border border-white/[0.06] group-hover:border-white/[0.1] transition-colors">
                  <item.icon className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-300 transition-colors" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-slate-300">{item.stage}</div>
                  <div className="text-[10px] text-slate-600">{item.desc}</div>
                </div>
                <div className="w-2 h-2 rounded-full bg-emerald-500/40" />
              </motion.div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: TRAINING RUNS
// ══════════════════════════════════════════════════════════════════════════════

function TrainingRunsTab() {
  const [runs, setRuns] = useState<TrainingRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedRun, setExpandedRun] = useState<string | null>(null)
  const [shards, setShards] = useState<Record<string, any[]>>({})
  const [triggering, setTriggering] = useState(false)
  const [triggerMsg, setTriggerMsg] = useState<string | null>(null)

  const fetchRuns = useCallback(async () => {
    setError(null)
    try {
      const data = await apiFetch<{ runs: TrainingRun[] }>('/api/v1/internal/ml/runs?limit=20')
      setRuns(data?.runs || [])
    } catch {
      setError('Failed to load training runs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchRuns() }, [fetchRuns])

  const toggleExpand = async (runId: string) => {
    if (expandedRun === runId) {
      setExpandedRun(null)
      return
    }
    setExpandedRun(runId)
    if (!shards[runId]) {
      const data = await apiFetch<{ shards?: any[] }>(`/api/v1/internal/ml/runs/${runId}/shards`)
        || await apiFetch<any>(`/api/v1/internal/ml/runs/${runId}`)
      setShards(prev => ({ ...prev, [runId]: data?.shards || [] }))
    }
  }

  const triggerRun = async () => {
    setTriggering(true)
    setTriggerMsg(null)
    try {
      const res = await fetch(`${API}/api/v1/internal/ml/runs/nightly/trigger`, {
        method: 'POST', credentials: 'include',
      })
      if (res.ok) {
        setTriggerMsg('Training run triggered successfully')
        setTimeout(() => { setTriggerMsg(null); fetchRuns() }, 2000)
      } else {
        const body = await res.json().catch(() => ({}))
        setTriggerMsg(body.detail || 'Failed to trigger run')
      }
    } catch {
      setTriggerMsg('Network error triggering run')
    } finally {
      setTriggering(false)
    }
  }

  if (loading) return <SkeletonTable rows={8} />
  if (error) return <InlineError message={error} onRetry={fetchRuns} />

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-400">{runs.length} runs</span>
          {triggerMsg && (
            <motion.span
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className={`text-xs px-2 py-1 rounded-md ${
                triggerMsg.includes('success') ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
              }`}
            >
              {triggerMsg}
            </motion.span>
          )}
        </div>
        <button
          onClick={triggerRun}
          disabled={triggering}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/20 hover:border-cyan-500/30 transition-all disabled:opacity-40"
        >
          {triggering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {triggering ? 'Triggering...' : 'Trigger Nightly Run'}
        </button>
      </div>

      {/* Runs list */}
      {runs.length === 0 ? (
        <EmptyState icon={Play} message="No training runs found" />
      ) : (
        <div className="space-y-2">
          {runs.map((run, i) => (
            <motion.div
              key={run.run_id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <button
                onClick={() => toggleExpand(run.run_id)}
                className="w-full text-left p-4 bg-[#0D1117] border border-white/[0.06] rounded-xl hover:border-white/[0.12] transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className={`p-1.5 rounded-md ${
                    expandedRun === run.run_id ? 'bg-white/[0.06]' : 'bg-white/[0.03]'
                  }`}>
                    {expandedRun === run.run_id
                      ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                      : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                    }
                  </div>
                  <div className="flex-1 min-w-0 grid grid-cols-2 md:grid-cols-5 gap-3 items-center">
                    <div>
                      <code className="text-xs text-slate-300 font-mono">{run.run_id?.slice(0, 16)}</code>
                    </div>
                    <div>
                      <StatusBadge status={run.status} />
                    </div>
                    <div className="hidden md:block">
                      <span className="text-xs text-slate-400">{formatTimestamp(run.started_at)}</span>
                    </div>
                    <div className="hidden md:block">
                      <span className="text-xs text-slate-400 font-mono">
                        {run.symbols_completed}/{run.total_symbols} symbols
                      </span>
                    </div>
                    <div className="hidden md:block text-right">
                      <span className="text-xs text-slate-500 font-mono">{formatDuration(run.runtime_seconds)}</span>
                    </div>
                  </div>
                </div>
              </button>

              {/* Expanded shard details */}
              <AnimatePresence>
                {expandedRun === run.run_id && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="ml-12 mt-2 mb-2 p-4 bg-slate-900/40 border border-white/[0.04] rounded-lg space-y-3">
                      {/* Run details */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pb-3 border-b border-white/[0.04]">
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase mb-0.5">Started</div>
                          <div className="text-xs text-slate-300">{formatTimestamp(run.started_at)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase mb-0.5">Finished</div>
                          <div className="text-xs text-slate-300">{formatTimestamp(run.finished_at)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase mb-0.5">Failed Symbols</div>
                          <div className={`text-xs font-mono ${run.symbols_failed > 0 ? 'text-red-400' : 'text-slate-400'}`}>
                            {run.symbols_failed}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase mb-0.5">Runtime</div>
                          <div className="text-xs text-slate-300 font-mono">{formatDuration(run.runtime_seconds)}</div>
                        </div>
                      </div>

                      {run.error && (
                        <div className="p-2 rounded bg-red-500/5 border border-red-500/10">
                          <p className="text-[11px] text-red-300 font-mono">{run.error}</p>
                        </div>
                      )}

                      {/* Shards */}
                      <div>
                        <h4 className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Shards</h4>
                        {(!shards[run.run_id] || shards[run.run_id].length === 0) ? (
                          <p className="text-xs text-slate-600">No shard data available</p>
                        ) : (
                          <div className="space-y-1.5">
                            {shards[run.run_id].map((shard: any, si: number) => (
                              <div key={si} className="flex items-center gap-3 p-2 rounded bg-slate-800/20 border border-white/[0.03]">
                                <Hash className="w-3 h-3 text-slate-600" />
                                <span className="text-xs text-slate-400 font-mono flex-1">
                                  Shard {shard.shard_index ?? si}
                                </span>
                                <span className="text-[10px] text-slate-500 font-mono">
                                  {shard.symbols_count || shard.symbols?.length || '?'} sym
                                </span>
                                <StatusBadge status={shard.status || 'pending'} size="xs" />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: MODELS
// ══════════════════════════════════════════════════════════════════════════════

function ModelsTab() {
  const [models, setModels] = useState<Record<string, any>>({})
  const [versions, setVersions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedModel, setExpandedModel] = useState<string | null>(null)
  const [performance, setPerformance] = useState<Record<string, PerformanceData>>({})

  const fetchModels = useCallback(async () => {
    setError(null)
    try {
      const [modData, verData] = await Promise.all([
        apiFetch<{ models: Record<string, any> }>('/api/v1/mlops/models'),
        apiFetch<any>('/api/v1/internal/ml/models/versions'),
      ])
      setModels(modData?.models || {})
      setVersions(Array.isArray(verData) ? verData : verData?.versions || verData?.models || [])
    } catch {
      setError('Failed to load model data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchModels() }, [fetchModels])

  const toggleModel = async (name: string) => {
    if (expandedModel === name) {
      setExpandedModel(null)
      return
    }
    setExpandedModel(name)
    if (!performance[name]) {
      const data = await apiFetch<PerformanceData>(
        `/api/v1/mlops/monitoring/performance?model_name=${encodeURIComponent(name)}&window_days=30`
      )
      if (data) {
        setPerformance(prev => ({ ...prev, [name]: data }))
      }
    }
  }

  if (loading) return <SkeletonTable rows={6} />
  if (error) return <InlineError message={error} onRetry={fetchModels} />

  const modelEntries = Object.entries(models)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-400">{modelEntries.length} registered models</span>
      </div>

      {modelEntries.length === 0 ? (
        <EmptyState icon={Package} message="No models registered in the registry" />
      ) : (
        <div className="space-y-3">
          {modelEntries.map(([name, info], i) => (
            <motion.div
              key={name}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="bg-[#0D1117] border border-white/[0.06] rounded-xl overflow-hidden hover:border-white/[0.1] transition-colors"
            >
              {/* Model Header */}
              <button
                onClick={() => toggleModel(name)}
                className="w-full text-left p-5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/20 flex items-center justify-center">
                      <Brain className="w-5 h-5 text-purple-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-200">{name}</h3>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-[10px] text-slate-500">
                          {info.total_versions} version{info.total_versions !== 1 ? 's' : ''}
                        </span>
                        <span className="text-[10px] text-slate-600">|</span>
                        <span className="text-[10px] text-slate-500">
                          Latest: v{info.latest_version}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {info.production_version && (
                      <span className="text-[10px] px-2.5 py-1 bg-emerald-500/10 text-emerald-400 rounded-full font-mono border border-emerald-500/20">
                        prod: v{info.production_version}
                      </span>
                    )}
                    {expandedModel === name
                      ? <ChevronDown className="w-4 h-4 text-slate-500" />
                      : <ChevronRight className="w-4 h-4 text-slate-500" />
                    }
                  </div>
                </div>
              </button>

              {/* Expanded detail */}
              <AnimatePresence>
                {expandedModel === name && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-5 pt-2 border-t border-white/[0.04] space-y-4">
                      {/* Performance metrics */}
                      {performance[name] && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="text-[10px] text-slate-500 uppercase tracking-wider">Performance (30d)</h4>
                            {performance[name].should_retrain && (
                              <span className="text-[10px] px-2 py-0.5 bg-amber-500/10 text-amber-400 rounded-full border border-amber-500/20">
                                Retrain recommended
                              </span>
                            )}
                          </div>
                          {performance[name].retrain_reason && (
                            <div className="p-2 rounded bg-amber-500/5 border border-amber-500/10">
                              <p className="text-[11px] text-amber-300">{performance[name].retrain_reason}</p>
                            </div>
                          )}
                          {performance[name].performance && (
                            <div className="flex items-center gap-6 flex-wrap">
                              {Object.entries(performance[name].performance).map(([k, v]: [string, any]) => (
                                typeof v === 'number' && (
                                  <MetricPill key={k} label={k.replace(/_/g, ' ')} value={v} />
                                )
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Version list from /models endpoint */}
                      <div>
                        <h4 className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Version History</h4>
                        <div className="grid grid-cols-3 gap-2 text-[10px] text-slate-500 uppercase tracking-wider px-3 pb-1 border-b border-white/[0.04]">
                          <span>Version</span>
                          <span>Stage</span>
                          <span>Status</span>
                        </div>
                        {Array.from({ length: Math.min(info.total_versions || 1, 5) }).map((_, vi) => {
                          const ver = info.total_versions - vi
                          const stage = ver === info.production_version ? 'production'
                            : ver === info.latest_version ? 'staging' : 'archived'
                          return (
                            <div key={vi} className="grid grid-cols-3 gap-2 items-center px-3 py-2 hover:bg-white/[0.02] rounded transition-colors">
                              <span className="text-xs text-slate-300 font-mono">v{ver}</span>
                              <StatusBadge status={stage} size="xs" />
                              <div className="flex items-center gap-1.5">
                                {stage === 'production' && (
                                  <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                                    <CheckCircle className="w-3 h-3" /> Active
                                  </span>
                                )}
                                {stage === 'archived' && (
                                  <span className="text-[10px] text-slate-500">Superseded</span>
                                )}
                                {stage === 'staging' && (
                                  <span className="text-[10px] text-amber-400">Candidate</span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: MONITORING
// ══════════════════════════════════════════════════════════════════════════════

function MonitoringTab() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [symbols, setSymbols] = useState<string[]>([])
  const [driftReports, setDriftReports] = useState<Record<string, DriftReport>>({})
  const [perfData, setPerfData] = useState<PerformanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)
  const [driftLoading, setDriftLoading] = useState(false)

  const fetchMonitoring = useCallback(async () => {
    setError(null)
    try {
      const [al, sym, perf] = await Promise.all([
        apiFetch<{ alerts: Alert[] }>('/api/v1/mlops/monitoring/alerts'),
        apiFetch<{ symbols: string[] }>('/api/v1/mlops/features/symbols'),
        apiFetch<PerformanceData>('/api/v1/mlops/monitoring/performance?model_name=lstm_h1&window_days=30'),
      ])
      setAlerts(al?.alerts || [])
      setSymbols(sym?.symbols || [])
      setPerfData(perf)
    } catch {
      setError('Failed to load monitoring data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchMonitoring() }, [fetchMonitoring])

  const fetchDrift = async (symbol: string) => {
    setSelectedSymbol(symbol)
    if (driftReports[symbol]) return
    setDriftLoading(true)
    const data = await apiFetch<DriftReport>(`/api/v1/mlops/monitoring/drift/${encodeURIComponent(symbol)}`)
    if (data) {
      setDriftReports(prev => ({ ...prev, [symbol]: data }))
    }
    setDriftLoading(false)
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonTable rows={3} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SkeletonTable rows={4} />
          <SkeletonTable rows={4} />
        </div>
      </div>
    )
  }
  if (error) return <InlineError message={error} onRetry={fetchMonitoring} />

  const drift = selectedSymbol ? driftReports[selectedSymbol] : null

  return (
    <div className="space-y-6">
      {/* Performance overview */}
      <Panel title="Model Performance — lstm_h1 (30d)" icon={BarChart3} color="text-emerald-400"
        actions={
          perfData?.should_retrain ? (
            <span className="text-[10px] px-2 py-0.5 bg-amber-500/10 text-amber-400 rounded-full border border-amber-500/20 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Retrain recommended
            </span>
          ) : (
            <span className="text-[10px] text-emerald-400 flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> Model healthy
            </span>
          )
        }
      >
        {perfData ? (
          <div className="space-y-4">
            {perfData.retrain_reason && (
              <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/10">
                <p className="text-xs text-amber-300">{perfData.retrain_reason}</p>
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {perfData.performance && Object.entries(perfData.performance).map(([k, v]: [string, any]) => (
                typeof v === 'number' && (
                  <div key={k} className="text-center p-3 rounded-lg bg-slate-800/20 border border-white/[0.04]">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{k.replace(/_/g, ' ')}</div>
                    <div className={`text-lg font-bold font-mono ${metricColor(v)}`}>{v.toFixed(4)}</div>
                  </div>
                )
              ))}
            </div>
          </div>
        ) : (
          <EmptyState icon={BarChart3} message="No performance data available" />
        )}
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Drift detection */}
        <Panel title="Drift Detection" icon={Eye} color="text-violet-400"
          actions={<span className="text-[10px] text-slate-500 font-mono">{symbols.length} symbols</span>}
        >
          <div className="space-y-3">
            {/* Symbol selector */}
            <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto pb-2 scrollbar-thin">
              {symbols.slice(0, 30).map(sym => (
                <button
                  key={sym}
                  onClick={() => fetchDrift(sym)}
                  className={`text-[10px] px-2 py-1 rounded-md font-mono transition-all ${
                    selectedSymbol === sym
                      ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                      : 'bg-slate-800/30 text-slate-400 border border-white/[0.04] hover:border-white/[0.08]'
                  }`}
                >
                  {sym}
                </button>
              ))}
              {symbols.length > 30 && (
                <span className="text-[10px] text-slate-600 self-center ml-1">+{symbols.length - 30} more</span>
              )}
            </div>

            {/* Drift report */}
            {selectedSymbol && (
              <div className="pt-2 border-t border-white/[0.04]">
                {driftLoading ? (
                  <div className="flex items-center gap-2 py-4 justify-center">
                    <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />
                    <span className="text-xs text-slate-500">Checking drift for {selectedSymbol}...</span>
                  </div>
                ) : drift ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-200">{selectedSymbol}</span>
                      <StatusBadge status={drift.drift_detected ? 'warning' : 'healthy'} />
                    </div>
                    {drift.drift_score !== undefined && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-slate-500 uppercase">Drift Score</span>
                          <span className={`text-xs font-mono ${drift.drift_score > 0.5 ? 'text-red-400' : drift.drift_score > 0.3 ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {drift.drift_score.toFixed(4)}
                          </span>
                        </div>
                        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                          <motion.div
                            className={`h-full rounded-full ${
                              drift.drift_score > 0.5 ? 'bg-red-500' :
                              drift.drift_score > 0.3 ? 'bg-amber-500' : 'bg-emerald-500'
                            }`}
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(100, drift.drift_score * 100)}%` }}
                            transition={{ duration: 0.6 }}
                          />
                        </div>
                      </div>
                    )}
                    {drift.features_drifted && drift.features_drifted.length > 0 && (
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider">Drifted Features</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {drift.features_drifted.map(f => (
                            <span key={f} className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 font-mono">
                              {f}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 py-4 text-center">No drift data for {selectedSymbol}</p>
                )}
              </div>
            )}
          </div>
        </Panel>

        {/* Alerts */}
        <Panel title="All Alerts" icon={AlertTriangle} color="text-red-400"
          actions={<span className="text-[10px] text-slate-500 font-mono">{alerts.length} total</span>}
        >
          {alerts.length === 0 ? (
            <div className="flex items-center gap-3 py-8 justify-center text-slate-500">
              <Shield className="w-5 h-5 opacity-40" />
              <span className="text-sm">No alerts</span>
            </div>
          ) : (
            <div className="space-y-2 max-h-[320px] overflow-y-auto scrollbar-thin">
              {alerts.map((alert, i) => (
                <motion.div
                  key={alert.id || i}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className={`p-3 rounded-lg border ${
                    alert.resolved ? 'bg-slate-800/10 border-white/[0.03] opacity-60' :
                    alert.severity === 'critical' ? 'bg-red-500/5 border-red-500/15' :
                    alert.severity === 'warning' ? 'bg-amber-500/5 border-amber-500/15' :
                    'bg-blue-500/5 border-blue-500/15'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className={`w-3 h-3 mt-0.5 shrink-0 ${
                      alert.resolved ? 'text-slate-600' :
                      alert.severity === 'critical' ? 'text-red-400' :
                      alert.severity === 'warning' ? 'text-amber-400' : 'text-blue-400'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-300 leading-relaxed">{alert.message}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {alert.model_name && (
                          <span className="text-[10px] text-slate-500 font-mono">{alert.model_name}</span>
                        )}
                        <span className="text-[10px] text-slate-600">{relativeTime(alert.timestamp)}</span>
                        {alert.resolved && <span className="text-[10px] text-emerald-500">Resolved</span>}
                      </div>
                    </div>
                    <StatusBadge status={alert.severity} size="xs" />
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: CONFIG
// ══════════════════════════════════════════════════════════════════════════════

function ConfigTab() {
  const [config, setConfig] = useState<any>(null)
  const [shardPlan, setShardPlan] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [planLoading, setPlanLoading] = useState(false)

  const fetchConfig = useCallback(async () => {
    setError(null)
    try {
      const data = await apiFetch<any>('/api/v1/internal/ml/config/effective')
      setConfig(data)
    } catch {
      setError('Failed to load configuration')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchConfig() }, [fetchConfig])

  const runShardPlan = async () => {
    setPlanLoading(true)
    try {
      const res = await fetch(`${API}/api/v1/internal/ml/shards/plan`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (res.ok) {
        const data = await res.json()
        setShardPlan(data)
      }
    } catch {
      // silent
    } finally {
      setPlanLoading(false)
    }
  }

  if (loading) return <SkeletonTable rows={8} />
  if (error) return <InlineError message={error} onRetry={fetchConfig} />

  // Render nested config object as a structured view
  const renderConfigValue = (key: string, value: any, depth = 0): React.ReactNode => {
    if (value === null || value === undefined) {
      return (
        <div key={key} className="flex items-center justify-between py-1.5" style={{ paddingLeft: depth * 16 }}>
          <span className="text-xs text-slate-400">{key}</span>
          <span className="text-xs text-slate-600 font-mono">null</span>
        </div>
      )
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      return (
        <div key={key}>
          <div className="flex items-center gap-2 py-1.5" style={{ paddingLeft: depth * 16 }}>
            <ChevronRight className="w-3 h-3 text-slate-600" />
            <span className="text-xs font-medium text-slate-300">{key}</span>
          </div>
          {Object.entries(value).map(([k, v]) => renderConfigValue(k, v, depth + 1))}
        </div>
      )
    }
    if (Array.isArray(value)) {
      return (
        <div key={key} className="flex items-start justify-between py-1.5" style={{ paddingLeft: depth * 16 }}>
          <span className="text-xs text-slate-400">{key}</span>
          <span className="text-xs text-cyan-300 font-mono max-w-[60%] text-right truncate" title={JSON.stringify(value)}>
            [{value.length} items]
          </span>
        </div>
      )
    }
    return (
      <div key={key} className="flex items-center justify-between py-1.5" style={{ paddingLeft: depth * 16 }}>
        <span className="text-xs text-slate-400">{key}</span>
        <span className={`text-xs font-mono ${
          typeof value === 'boolean' ? (value ? 'text-emerald-400' : 'text-red-400') :
          typeof value === 'number' ? 'text-amber-300' : 'text-cyan-300'
        }`}>
          {String(value)}
        </span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Effective Config */}
      <Panel title="Effective Training Config" icon={Terminal} color="text-cyan-400">
        {config ? (
          <div className="divide-y divide-white/[0.04] max-h-[500px] overflow-y-auto scrollbar-thin">
            {Object.entries(config).map(([k, v]) => renderConfigValue(k, v))}
          </div>
        ) : (
          <EmptyState icon={Terminal} message="No configuration loaded" />
        )}
      </Panel>

      {/* Shard Planner */}
      <Panel title="Shard Plan Preview" icon={Layers} color="text-violet-400"
        actions={
          <button
            onClick={runShardPlan}
            disabled={planLoading}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium rounded-md bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 border border-violet-500/20 transition-all disabled:opacity-40"
          >
            {planLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            {planLoading ? 'Planning...' : 'Dry Run'}
          </button>
        }
      >
        {shardPlan ? (
          <div className="space-y-3">
            {/* Summary */}
            {shardPlan.total_shards !== undefined && (
              <div className="grid grid-cols-3 gap-4 pb-3 border-b border-white/[0.04]">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase mb-0.5">Total Shards</div>
                  <div className="text-lg font-bold text-slate-200 font-mono">{shardPlan.total_shards}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase mb-0.5">Total Symbols</div>
                  <div className="text-lg font-bold text-slate-200 font-mono">{shardPlan.total_symbols || '?'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase mb-0.5">Symbols/Shard</div>
                  <div className="text-lg font-bold text-slate-200 font-mono">{shardPlan.symbols_per_shard || '?'}</div>
                </div>
              </div>
            )}
            {/* Shard list */}
            {shardPlan.shards && Array.isArray(shardPlan.shards) && (
              <div className="space-y-1.5 max-h-[300px] overflow-y-auto scrollbar-thin">
                {shardPlan.shards.map((shard: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-800/20 border border-white/[0.04]">
                    <div className="w-6 h-6 rounded bg-violet-500/10 flex items-center justify-center">
                      <span className="text-[10px] font-bold text-violet-400">{i}</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex flex-wrap gap-1">
                        {(shard.symbols || []).slice(0, 8).map((s: string) => (
                          <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/40 text-slate-400 font-mono">{s}</span>
                        ))}
                        {(shard.symbols || []).length > 8 && (
                          <span className="text-[10px] text-slate-600">+{(shard.symbols || []).length - 8}</span>
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">{(shard.symbols || []).length} sym</span>
                  </div>
                ))}
              </div>
            )}
            {/* Raw fallback */}
            {!shardPlan.shards && (
              <pre className="text-[11px] text-slate-400 font-mono bg-slate-800/20 p-3 rounded-lg overflow-x-auto max-h-[300px]">
                {JSON.stringify(shardPlan, null, 2)}
              </pre>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-slate-500">
            <Layers className="w-8 h-8 mb-3 opacity-30" />
            <p className="text-sm mb-1">No shard plan computed yet</p>
            <p className="text-[11px] text-slate-600">Click "Dry Run" to preview how symbols will be distributed across shards</p>
          </div>
        )}
      </Panel>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════

export default function MLOpsDashboard() {
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [alertCount, setAlertCount] = useState(0)

  // Fetch alert count for badge
  useEffect(() => {
    apiFetch<{ alerts: Alert[] }>('/api/v1/mlops/monitoring/alerts').then(data => {
      if (data?.alerts) {
        setAlertCount(data.alerts.filter(a => !a.resolved).length)
      }
    })
  }, [])

  const tabs: Tab[] = useMemo(() => [
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'runs', label: 'Training Runs', icon: Play },
    { id: 'models', label: 'Models', icon: Package },
    { id: 'monitoring', label: 'Monitoring', icon: Eye, badge: alertCount > 0 ? alertCount : undefined },
    { id: 'config', label: 'Config', icon: SlidersHorizontal },
  ], [alertCount])

  return (
    <AppLayout>
      <div className="min-h-screen bg-[#0a0a0f]">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 sm:py-8">

          {/* ── Header ─────────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6"
          >
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-purple-600/30 to-cyan-600/30 border border-purple-500/20 flex items-center justify-center">
                <Brain className="w-6 h-6 text-purple-400" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-slate-100 tracking-tight">MLOps Command Center</h1>
                <p className="text-xs text-slate-500 mt-0.5">Model lifecycle, training pipeline, drift monitoring</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/40 border border-white/[0.06]">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[10px] text-slate-400 font-mono">LIVE</span>
              </div>
              <span className="text-[10px] text-slate-600">Auto-refresh 30s</span>
            </div>
          </motion.div>

          {/* ── Tab Navigation ─────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="mb-6"
          >
            <div className="flex items-center gap-1 p-1 bg-[#0D1117] border border-white/[0.06] rounded-xl overflow-x-auto scrollbar-thin">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'bg-white/[0.08] text-slate-100 shadow-lg shadow-black/20'
                      : 'text-slate-400 hover:text-slate-300 hover:bg-white/[0.03]'
                  }`}
                >
                  <tab.icon className={`w-4 h-4 ${activeTab === tab.id ? 'text-cyan-400' : ''}`} />
                  <span>{tab.label}</span>
                  {tab.badge !== undefined && (
                    <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-red-500/20 text-red-400 min-w-[18px] text-center">
                      {tab.badge}
                    </span>
                  )}
                  {activeTab === tab.id && (
                    <motion.div
                      layoutId="mlops-tab-indicator"
                      className="absolute inset-0 bg-white/[0.06] rounded-lg border border-white/[0.08]"
                      style={{ zIndex: -1 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                  )}
                </button>
              ))}
            </div>
          </motion.div>

          {/* ── Tab Content ─────────────────────────────────────────────── */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab === 'overview' && <OverviewTab />}
              {activeTab === 'runs' && <TrainingRunsTab />}
              {activeTab === 'models' && <ModelsTab />}
              {activeTab === 'monitoring' && <MonitoringTab />}
              {activeTab === 'config' && <ConfigTab />}
            </motion.div>
          </AnimatePresence>

        </div>
      </div>
    </AppLayout>
  )
}
