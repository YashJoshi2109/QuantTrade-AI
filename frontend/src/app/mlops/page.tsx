'use client'

/**
 * QuantTrade AI — MLOps Command Center
 * Production-grade ML lifecycle dashboard: training runs, model registry,
 * drift monitoring, feature store, and pipeline configuration.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import {
  Brain, Activity, Database, AlertTriangle, BarChart3,
  ChevronRight, ChevronDown, Cpu, Layers, Play, Shield,
  Eye, CheckCircle, Loader2, TrendingUp,
  GitBranch, Package, Terminal, ArrowUpRight,
  ArrowDownRight, Hash,
  Rocket, Target, Lock,
  SlidersHorizontal, Sparkles, Search, X, ChevronUp,
  Crown, Archive, RefreshCw, Zap, Radio,
} from 'lucide-react'
import AppLayout from '@/components/AppLayout'
import MobileMLOps from '@/components/layout/MobileMLOps'
import { useAuth } from '@/contexts/AuthContext'

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
  run_type?: string
  status: string
  started_at: string
  finished_at?: string
  ended_at?: string
  total_symbols: number
  total_shards?: number
  symbols_completed: number
  symbols_failed: number
  success_shards?: number
  failed_shards?: number
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

interface MLStreamEvent {
  ts: string
  run?: {
    run_id: string
    status: string
    total_symbols: number
    total_shards: number
    success_shards: number
    failed_shards: number
    started_at?: string
  }
  shards?: Array<{
    shard_id: string
    shard_name: string
    status: string
    batch_job_id?: string
    runtime_seconds?: number
  }>
  batch?: { runnable: number; starting: number; running: number; succeeded: number; failed: number }
  sfn?: { name: string; status: string; start_date: string }
  logs?: Array<{ ts: number; msg: string }>
  models?: Array<{ model_version: string; avg_da?: number; avg_ic?: number; promoted_at?: string }>
  staging?: Array<{ model_version: string; avg_da?: number; avg_ic?: number; promoted_at?: string; symbol_count?: number }>
}

interface DashboardData {
  models_production: number
  runs_7d: number
  success_rate: number
  symbols_covered: number
  avg_da?: number
  avg_ic?: number
  latest_run?: { run_id: string; status: string; started_at?: string; total_symbols?: number; total_shards?: number; success_shards?: number; failed_shards?: number; ended_at?: string }
  prod_models?: Array<{ model_version: string; avg_da?: number; avg_ic?: number; promoted_at?: string }>
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
    <div className={`animate-pulse rounded bg-surface-raised ${className}`} />
  )
}

function SkeletonCard() {
  return (
    <div className="bg-surface-raised border border-line-subtle rounded-xl p-5 space-y-3">
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
    pending:    { bg: 'bg-surface-raised',   text: 'text-fg-muted',   dot: 'bg-line-strong',   label: 'Pending' },
    queued:     { bg: 'bg-surface-raised',   text: 'text-fg-muted',   dot: 'bg-line-strong',   label: 'Queued' },
    archived:   { bg: 'bg-surface-raised',   text: 'text-fg-muted',   dot: 'bg-line-strong',   label: 'Archived' },
    none:       { bg: 'bg-surface-raised',   text: 'text-fg-muted',   dot: 'bg-line-strong',   label: 'None' },
    failed:     { bg: 'bg-red-500/10',     text: 'text-red-400',     dot: 'bg-red-400',     label: 'Failed' },
    error:      { bg: 'bg-red-500/10',     text: 'text-red-400',     dot: 'bg-red-400',     label: 'Error' },
    degraded:   { bg: 'bg-red-500/10',     text: 'text-red-400',     dot: 'bg-red-400',     label: 'Degraded' },
    critical:   { bg: 'bg-red-500/10',     text: 'text-red-400',     dot: 'bg-red-400',     label: 'Critical' },
    warning:    { bg: 'bg-amber-500/10',   text: 'text-amber-400',   dot: 'bg-amber-400',   label: 'Warning' },
    info:       { bg: 'bg-blue-500/10',    text: 'text-blue-400',    dot: 'bg-blue-400',    label: 'Info' },
  }
  const c = config[normalized] || { bg: 'bg-surface-raised', text: 'text-fg-muted', dot: 'bg-line-strong', label: status }
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
      className="bg-surface-raised border border-line-subtle rounded-xl p-4 hover:border-line-default transition-colors group"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg bg-surface-hover flex items-center justify-center border border-line-subtle group-hover:border-line-default transition-colors`}>
            <Icon className={`w-4 h-4 ${color}`} />
          </div>
          <span className="text-[11px] text-fg-muted uppercase tracking-wider font-medium">{label}</span>
        </div>
        {trend && (
          <div className={`flex items-center gap-0.5 ${trend === 'up' ? 'text-emerald-400' : 'text-red-400'}`}>
            {trend === 'up' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          </div>
        )}
      </div>
      <div className="text-2xl font-bold text-fg-primary font-mono tracking-tight">{value}</div>
      {sub && <div className="text-[11px] text-fg-muted mt-1">{sub}</div>}
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
      className={`bg-surface-raised border border-line-subtle rounded-xl overflow-hidden ${className}`}
    >
      <div className="px-3 sm:px-5 py-3 sm:py-3.5 border-b border-line-subtle flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={`w-4 h-4 shrink-0 ${color}`} />
          <h3 className="text-xs sm:text-sm font-semibold text-fg-secondary uppercase tracking-wider truncate">{title}</h3>
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      <div className="p-3 sm:p-5">{children}</div>
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
      <div className="h-1.5 rounded-full bg-surface-raised overflow-hidden" style={{ width }}>
        <motion.div
          className={`h-full rounded-full ${color}`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
      <span className="text-[11px] text-fg-muted font-mono">{(value * 100).toFixed(1)}%</span>
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
      <span className="text-[10px] text-fg-muted uppercase tracking-wider mb-0.5">{label}</span>
      <span className={`text-sm font-bold font-mono ${color}`}>{value.toFixed(4)}</span>
    </div>
  )
}

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, message }: { icon: LucideIcon; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-fg-muted">
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

// ── SSE stream hook ──────────────────────────────────────────────────────────

function useMLStream() {
  const [event, setEvent] = useState<MLStreamEvent | null>(null)
  const [connected, setConnected] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const connect = () => {
      const es = new EventSource(`${API}/api/v1/internal/ml/stream`, { withCredentials: true })
      esRef.current = es
      es.onopen = () => setConnected(true)
      es.onmessage = (e) => {
        try { setEvent(JSON.parse(e.data)) } catch {}
      }
      es.onerror = () => {
        setConnected(false)
        es.close()
        setTimeout(connect, 5000)
      }
    }
    connect()
    return () => { esRef.current?.close() }
  }, [])

  return { event, connected }
}

// ── Live Event Feed component ────────────────────────────────────────────────

// Parse the most recent epoch/metrics from live CloudWatch log lines
function parseLogProgress(logs?: Array<{ ts: number; msg: string }>) {
  if (!logs?.length) return null
  for (let i = logs.length - 1; i >= 0; i--) {
    const msg = logs[i].msg
    // "[h=1] Epoch   7/40 | train=0.000498 val=0.000401 | DA=48.3% IC=-0.009 | lr=4.63e-04"
    const m = msg.match(/\[h=(\d+)\].*Epoch\s+(\d+)\/(\d+).*train=([\d.]+).*val=([\d.]+).*DA=([\d.]+)%.*IC=([-\d.]+)/)
    if (m) {
      return {
        horizon: parseInt(m[1]),
        epoch: parseInt(m[2]),
        totalEpochs: parseInt(m[3]),
        trainLoss: parseFloat(m[4]),
        valLoss: parseFloat(m[5]),
        da: parseFloat(m[6]) / 100,
        ic: parseFloat(m[7]),
      }
    }
  }
  return null
}

function PipelineFlowStrip({ sfn, batch, run, models, staging }: {
  sfn?: { name: string; status: string; start_date: string } | null
  batch?: { runnable: number; starting: number; running: number; succeeded: number; failed: number } | null
  run?: { status: string } | null
  models?: Array<any> | null   // production model versions
  staging?: Array<any> | null  // staging model versions
}) {
  const isRunning = (sfn?.status === 'RUNNING') || (batch?.running ?? 0) > 0
  const hasProd = (models?.length ?? 0) > 0
  const hasStaged = (staging?.length ?? 0) > 0
  const hasAnyModel = hasProd || hasStaged

  const stages = [
    { label: 'ECR', icon: Package, status: 'ok' as const, detail: 'Image ready' },
    {
      label: 'SFN', icon: GitBranch,
      status: (sfn
        ? (sfn.status === 'RUNNING' ? 'running' : sfn.status === 'SUCCEEDED' ? 'ok' : sfn.status === 'IDLE' ? 'idle' : 'error')
        : 'idle') as 'running' | 'ok' | 'error' | 'idle',
      detail: sfn ? sfn.status : 'Idle',
    },
    {
      label: 'Batch', icon: Cpu,
      status: ((batch?.running ?? 0) > 0 ? 'running' : (batch?.succeeded ?? 0) > 0 ? 'ok' : 'idle') as 'running' | 'ok' | 'idle',
      detail: batch ? `${batch.running}R ${batch.succeeded}✓ ${batch.failed}✗` : '—',
    },
    {
      label: 'Neon DB', icon: Database,
      status: ((batch?.running ?? 0) > 0
        ? 'running'
        : run
          ? (run.status === 'running' ? 'running' : run.status === 'completed' ? 'ok' : run.status === 'failed' ? 'error' : 'idle')
          : 'idle') as 'running' | 'ok' | 'error' | 'idle',
      detail: (batch?.running ?? 0) > 0 ? 'callback pending' : run ? run.status : 'No run',
    },
    {
      label: 'Lambda', icon: Zap,
      status: (isRunning ? 'idle' : hasAnyModel ? 'ok' : 'idle') as 'ok' | 'idle',
      detail: hasProd ? 'Promoted' : hasStaged ? 'Staged' : 'Aggregator',
    },
    {
      label: 'CF KV', icon: Radio,
      status: (hasProd ? 'ok' : hasStaged ? 'idle' : 'idle') as 'ok' | 'idle',
      detail: hasProd ? 'Model cached' : hasStaged ? 'Staging only' : 'No model',
    },
  ]

  const statusColors = {
    running: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    ok: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    error: 'text-red-400 bg-red-500/10 border-red-500/30',
    idle: 'text-fg-muted bg-surface-hover border-line-subtle',
  }

  return (
    <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto scrollbar-none pb-1">
      {stages.map((stage, i) => (
        <div key={stage.label} className="flex items-center gap-1 shrink-0">
          <div className={`flex flex-col items-center gap-1 px-2 sm:px-3 py-2 rounded-lg border ${statusColors[stage.status]} min-w-[52px] sm:min-w-[64px]`}>
            <stage.icon className={`w-3.5 h-3.5 ${stage.status === 'running' ? 'animate-pulse' : ''}`} />
            <span className="text-[9px] font-bold uppercase tracking-wider">{stage.label}</span>
            <span className="text-[8px] opacity-70 truncate max-w-[60px] text-center">{stage.detail}</span>
          </div>
          {i < stages.length - 1 && (
            <ChevronRight className={`w-3 h-3 shrink-0 ${isRunning && i < 3 ? 'text-amber-400/60' : 'text-fg-muted/30'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

function LiveTrainingCard({ logs, sfn, batch }: {
  logs?: Array<{ ts: number; msg: string }>
  sfn?: { name: string; status: string; start_date: string } | null
  batch?: { runnable: number; starting: number; running: number; succeeded: number; failed: number } | null
}) {
  const progress = parseLogProgress(logs)
  const isActive = (sfn?.status === 'RUNNING') || (batch?.running ?? 0) > 0
  if (!isActive && !progress) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5"
    >
      <div className="flex items-center gap-2 mb-3">
        <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
        <span className="text-sm font-medium text-amber-400">Training in Progress</span>
        {sfn?.name && (
          <code className="text-[10px] text-fg-muted font-mono ml-auto truncate max-w-[200px]">{sfn.name}</code>
        )}
      </div>

      {progress ? (
        <div className="space-y-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <div className="text-[10px] text-fg-muted uppercase tracking-wider">Horizon</div>
              <div className="text-xl font-bold font-mono text-amber-400">h={progress.horizon}</div>
            </div>
            <div>
              <div className="text-[10px] text-fg-muted uppercase tracking-wider">Epoch</div>
              <div className="text-xl font-bold font-mono text-fg-secondary">
                {progress.epoch}<span className="text-fg-muted text-sm">/{progress.totalEpochs}</span>
              </div>
            </div>
            <div>
              <div className="text-[10px] text-fg-muted uppercase tracking-wider">DA (live)</div>
              <div className={`text-xl font-bold font-mono ${metricColor(progress.da)}`}>
                {(progress.da * 100).toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-[10px] text-fg-muted uppercase tracking-wider">IC (live)</div>
              <div className={`text-xl font-bold font-mono ${metricColor(progress.ic, [-0.05, 0.05])}`}>
                {progress.ic.toFixed(3)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-fg-muted uppercase tracking-wider">Val Loss</div>
              <div className="text-sm font-mono text-fg-secondary">{progress.valLoss.toFixed(6)}</div>
            </div>
          </div>
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-[10px] text-fg-muted">Epoch progress</span>
              <span className="text-[10px] text-fg-muted font-mono">
                {((progress.epoch / progress.totalEpochs) * 100).toFixed(0)}%
              </span>
            </div>
            <div className="h-1.5 bg-surface-raised rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-amber-500"
                initial={{ width: 0 }}
                animate={{ width: `${(progress.epoch / progress.totalEpochs) * 100}%` }}
                transition={{ duration: 0.6 }}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex gap-4">
            {batch && (
              <>
                {batch.running > 0 && <div><div className="text-[10px] text-fg-muted">Running</div><div className="text-xl font-bold text-amber-400 font-mono">{batch.running}</div></div>}
                {batch.runnable > 0 && <div><div className="text-[10px] text-fg-muted">Queued</div><div className="text-xl font-bold text-fg-secondary font-mono">{batch.runnable}</div></div>}
              </>
            )}
          </div>
          <p className="text-xs text-fg-muted ml-auto">Waiting for first epoch log...</p>
        </div>
      )}
    </motion.div>
  )
}

function LiveEventFeed({ logs, connected }: { logs?: Array<{ ts: number; msg: string }>; connected: boolean }) {
  const [allLogs, setAllLogs] = useState<Array<{ ts: number; msg: string; id: number }>>([])
  const counterRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!logs?.length) return
    setAllLogs(prev => {
      const existing = new Set(prev.map(l => l.ts + l.msg))
      const newItems = logs
        .filter(l => !existing.has(l.ts + l.msg))
        .map(l => ({ ...l, id: ++counterRef.current }))
      if (!newItems.length) return prev
      const merged = [...prev, ...newItems].slice(-60)
      return merged
    })
  }, [logs])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [allLogs])

  const getLogClass = (msg: string) => {
    if (msg.includes('ERROR') || msg.includes('FAILED') || msg.includes('RuntimeError')) return 'text-red-400'
    if (msg.includes('completed') || msg.includes('DA=') || msg.includes('IC=')) return 'text-emerald-400'
    if (msg.includes('horizon') || msg.includes('Training h=') || msg.includes('phase')) return 'text-cyan-400'
    if (msg.includes('Epoch') || msg.includes('epoch')) return 'text-amber-400'
    return 'text-fg-muted'
  }

  const formatMsg = (msg: string) => {
    const stripped = msg.replace(/\[\d{2}:\d{2}:\d{2}\]\s+\w+\s+[\w.]+:\s*/, '')
    if (stripped.startsWith('{')) {
      try {
        const parsed = JSON.parse(stripped)
        const phase = parsed.phase || parsed.status || ''
        const h = parsed.horizon ? ` h=${parsed.horizon}` : ''
        const dur = parsed.duration_ms ? ` (${(parsed.duration_ms / 1000).toFixed(1)}s)` : ''
        return `${phase}${h}${dur}`.trim() || stripped.slice(0, 80)
      } catch {}
    }
    return stripped.slice(0, 120)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
        <span className="text-[10px] text-fg-muted uppercase tracking-wider">
          {connected ? 'Live' : 'Reconnecting...'}
        </span>
        <span className="text-[10px] text-fg-muted ml-auto">{allLogs.length} events</span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-0.5 min-h-0 max-h-48 font-mono text-[10px] leading-relaxed">
        {allLogs.length === 0 ? (
          <p className="text-fg-muted text-center py-4 text-xs">Waiting for training events...</p>
        ) : (
          allLogs.map(log => (
            <div key={log.id} className="flex gap-2 hover:bg-surface-hover px-1 rounded">
              <span className="text-fg-muted shrink-0 tabular-nums">
                {new Date(log.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className={getLogClass(log.msg)}>{formatMsg(log.msg)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: OVERVIEW
// ══════════════════════════════════════════════════════════════════════════════

function OverviewTab() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [health, setHealth] = useState<PipelineHealth | null>(null)
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const { event: streamEvent, connected: streamConnected } = useMLStream()

  const fetchAll = useCallback(async () => {
    setError(null)
    try {
      const [dash, hl, mt, al] = await Promise.all([
        apiFetch<DashboardData>('/api/v1/internal/ml/dashboard'),
        apiFetch<PipelineHealth>('/api/v1/internal/ml/health'),
        apiFetch<MetricsSummary>('/api/v1/internal/ml/metrics/summary?days=7'),
        apiFetch<{ alerts: Alert[] }>('/api/v1/mlops/monitoring/alerts'),
      ])
      setDashboard(dash)
      setHealth(hl)
      setMetrics(mt)
      setAlerts(al?.alerts || [])
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
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <SkeletonTable rows={4} />
          <SkeletonTable rows={4} />
        </div>
      </div>
    )
  }

  if (error) return <InlineError message={error} onRetry={fetchAll} />

  const successRate = dashboard
    ? `${dashboard.success_rate.toFixed(1)}%`
    : metrics && metrics.total_runs > 0
      ? `${((metrics.successful_runs / metrics.total_runs) * 100).toFixed(1)}%`
      : '--'

  const activeAlerts = alerts.filter(a => !a.resolved)

  // Use stream data for the latest run if available and more recent
  const liveRun = streamEvent?.run ?? dashboard?.latest_run ?? null
  const liveShards = streamEvent?.shards ?? []
  const liveBatch = streamEvent?.batch
  const liveSfn = streamEvent?.sfn

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
        <span className="text-sm font-medium text-fg-secondary">
          Pipeline {health?.status === 'healthy' ? 'Operational' : health?.status === 'degraded' ? 'Degraded' : 'Down'}
        </span>
        <span className="text-[10px] sm:text-xs text-fg-muted ml-auto hidden sm:inline">
          {health?.uptime_hours ? `Uptime: ${health.uptime_hours.toFixed(1)}h` : ''}
          {health?.last_run ? ` | Last run: ${relativeTime(health.last_run)}` : ''}
        </span>
      </motion.div>

      {/* Pipeline Flow */}
      <Panel title="Pipeline Flow" icon={GitBranch} color="text-cyan-400">
        <PipelineFlowStrip sfn={liveSfn} batch={liveBatch} run={liveRun} models={streamEvent?.models} staging={streamEvent?.staging} />
      </Panel>

      {/* Live Training Card — only shown when a run is active */}
      <LiveTrainingCard logs={streamEvent?.logs} sfn={liveSfn} batch={liveBatch} />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        <StatCard icon={Layers} label="Models" value={dashboard?.models_production ?? 0}
          sub="in production" color="text-purple-400" delay={0} />
        <StatCard icon={Play} label="Runs (7d)" value={dashboard?.runs_7d ?? metrics?.total_runs ?? 0}
          sub={`${successRate} success rate`} color="text-blue-400" delay={0.05} />
        <StatCard icon={Database} label="Symbols"
          value={dashboard?.symbols_covered || metrics?.total_symbols_trained || 0}
          sub="symbols covered" color="text-cyan-400" delay={0.1} />
        <StatCard icon={Target} label="Avg DA"
          value={(dashboard?.avg_da ?? metrics?.avg_da) ? ((dashboard?.avg_da ?? metrics?.avg_da) as number).toFixed(4) : '--'}
          sub="Directional accuracy" color="text-emerald-400" delay={0.15} />
        <StatCard icon={TrendingUp} label="Avg IC"
          value={(dashboard?.avg_ic ?? metrics?.avg_ic) ? ((dashboard?.avg_ic ?? metrics?.avg_ic) as number).toFixed(4) : '--'}
          sub="Information coeff." color="text-amber-400" delay={0.2} />
        <StatCard icon={AlertTriangle} label="Alerts" value={activeAlerts.length}
          sub={activeAlerts.length > 0 ? 'Requires attention' : 'All clear'}
          color={activeAlerts.length > 0 ? 'text-red-400' : 'text-fg-muted'} delay={0.25} />
      </div>

      {/* Live AWS Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Panel title="Batch Queue" icon={Zap} color="text-cyan-400">
          {liveBatch ? (() => {
            const total = liveBatch.runnable + liveBatch.starting + liveBatch.running + liveBatch.succeeded + liveBatch.failed
            if (total === 0) {
              return <p className="text-xs text-fg-muted py-2">Queue idle — no active or recent jobs</p>
            }
            return (
              <div className="flex flex-wrap gap-3">
                {[
                  { label: 'Runnable', val: liveBatch.runnable, color: 'text-fg-muted' },
                  { label: 'Starting', val: liveBatch.starting, color: 'text-amber-400' },
                  { label: 'Running', val: liveBatch.running, color: 'text-amber-400' },
                  { label: 'Succeeded', val: liveBatch.succeeded, color: 'text-emerald-400' },
                  { label: 'Failed', val: liveBatch.failed, color: 'text-red-400' },
                ].map(item => (
                  <div key={item.label} className="flex flex-col items-center min-w-[56px]">
                    <span className={`text-xl font-bold font-mono ${item.color}`}>{item.val}</span>
                    <span className="text-[10px] text-fg-muted uppercase tracking-wider">{item.label}</span>
                  </div>
                ))}
              </div>
            )
          })() : (
            <p className="text-xs text-fg-muted py-2">Connecting to stream...</p>
          )}
        </Panel>

        <Panel title="Step Functions" icon={Radio} color="text-purple-400">
          {liveSfn ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <StatusBadge status={liveSfn.status === 'IDLE' ? 'idle' : liveSfn.status === 'ERROR' ? 'error' : liveSfn.status.toLowerCase()} />
                {liveSfn.name ? (
                  <code className="text-[10px] text-fg-muted font-mono truncate">{liveSfn.name}</code>
                ) : (
                  <span className="text-[10px] text-fg-muted">{liveSfn.status === 'IDLE' ? 'No recent executions' : liveSfn.status === 'ERROR' ? 'AWS API error' : 'Unknown'}</span>
                )}
              </div>
              {liveSfn.start_date && (
                <p className="text-[10px] text-fg-muted">Started {relativeTime(liveSfn.start_date)}</p>
              )}
              {(liveSfn as any).error && (
                <p className="text-[10px] text-red-400 font-mono truncate">{(liveSfn as any).error}</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-fg-muted py-2">Connecting to stream...</p>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Latest Run Summary */}
        <Panel title="Latest Training Run" icon={Rocket} color="text-blue-400">
          {liveRun ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                  <code className="text-xs text-fg-muted font-mono bg-surface-hover px-2 py-1 rounded truncate">
                    {liveRun.run_id?.slice(0, 12)}...
                  </code>
                  <StatusBadge status={liveRun.status} />
                </div>
                <span className="text-xs text-fg-muted">{relativeTime(liveRun.started_at)}</span>
              </div>
              <div className="grid grid-cols-3 gap-3 sm:gap-4">
                <div>
                  <div className="text-[10px] text-fg-muted uppercase tracking-wider mb-1">Shards OK</div>
                  <div className="text-lg font-bold text-fg-secondary font-mono">
                    {liveRun.success_shards}<span className="text-fg-muted">/{liveRun.total_shards}</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-fg-muted uppercase tracking-wider mb-1">Failed</div>
                  <div className={`text-lg font-bold font-mono ${(liveRun.failed_shards ?? 0) > 0 ? 'text-red-400' : 'text-fg-secondary'}`}>
                    {liveRun.failed_shards ?? 0}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-fg-muted uppercase tracking-wider mb-1">Symbols</div>
                  <div className="text-lg font-bold text-fg-secondary font-mono">{liveRun.total_symbols}</div>
                </div>
              </div>
              {(liveRun.total_shards ?? 0) > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-fg-muted uppercase tracking-wider">Shard Progress</span>
                    <span className="text-[11px] text-fg-muted font-mono">
                      {(((liveRun.success_shards ?? 0) / (liveRun.total_shards ?? 1)) * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-2 bg-surface-raised rounded-full overflow-hidden">
                    <motion.div
                      className={`h-full rounded-full ${
                        liveRun.status === 'completed' ? 'bg-emerald-500' :
                        liveRun.status === 'failed' ? 'bg-red-500' : 'bg-amber-500'
                      }`}
                      initial={{ width: 0 }}
                      animate={{ width: `${((liveRun.success_shards ?? 0) / (liveRun.total_shards ?? 1)) * 100}%` }}
                      transition={{ duration: 0.8 }}
                    />
                  </div>
                </div>
              )}
              {/* Live shard breakdown */}
              {liveShards.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[10px] text-fg-muted uppercase tracking-wider mb-1">Shards</div>
                  {liveShards.map(s => (
                    <div key={s.shard_id} className="flex items-center gap-2">
                      <StatusBadge status={s.status} size="xs" />
                      <span className="text-[10px] text-fg-muted font-mono">{s.shard_name}</span>
                      {s.runtime_seconds !== undefined && s.runtime_seconds !== null && (
                        <span className="text-[10px] text-fg-muted ml-auto">{formatDuration(s.runtime_seconds)}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <EmptyState icon={Rocket} message="No training runs recorded yet" />
          )}
        </Panel>

        {/* Production / Staging Models (from dashboard/stream) */}
        <Panel title="Models" icon={Cpu} color="text-emerald-400">
          {(() => {
            const prodList = streamEvent?.models ?? dashboard?.prod_models ?? []
            const stagingList = streamEvent?.staging ?? []
            const allModels = [
              ...prodList.map(m => ({ ...m, tier: 'production' })),
              ...stagingList.map(m => ({ ...m, tier: 'staging' })),
            ]
            if (allModels.length === 0) return <EmptyState icon={Cpu} message="No models registered — trigger a training run" />
            return (
              <div className="space-y-2">
                {allModels.map((mv) => (
                  <div key={mv.model_version} className={`p-3 rounded-lg border transition-colors ${mv.tier === 'production' ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-surface-hover border-line-subtle hover:border-line-default'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Package className={`w-3.5 h-3.5 ${mv.tier === 'production' ? 'text-emerald-400' : 'text-amber-400'}`} />
                        <span className="text-sm font-medium text-fg-secondary font-mono">{mv.model_version}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider ${mv.tier === 'production' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
                          {mv.tier}
                        </span>
                      </div>
                      {mv.promoted_at && (
                        <span className="text-[10px] text-fg-muted">{relativeTime(mv.promoted_at)}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 flex-wrap">
                      {mv.avg_da != null && (
                        <div className="text-center">
                          <div className="text-[10px] text-fg-muted uppercase">DA</div>
                          <div className={`text-xs font-mono font-bold ${metricColor(mv.avg_da)}`}>{(mv.avg_da * 100).toFixed(1)}%</div>
                        </div>
                      )}
                      {mv.avg_ic != null && (
                        <div className="text-center">
                          <div className="text-[10px] text-fg-muted uppercase">IC</div>
                          <div className={`text-xs font-mono font-bold ${metricColor(mv.avg_ic, [0.05, 0.15])}`}>{mv.avg_ic.toFixed(4)}</div>
                        </div>
                      )}
                      {mv.symbol_count != null && (
                        <div className="text-center">
                          <div className="text-[10px] text-fg-muted uppercase">Symbols</div>
                          <div className="text-xs font-mono text-fg-secondary">{mv.symbol_count}</div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}
        </Panel>

        {/* Active Alerts */}
        <Panel title="Active Alerts" icon={AlertTriangle} color={activeAlerts.length > 0 ? 'text-red-400' : 'text-fg-muted'}
          actions={<span className="text-[10px] text-fg-muted font-mono">{activeAlerts.length} active</span>}
        >
          {activeAlerts.length === 0 ? (
            <div className="flex items-center gap-3 py-6 justify-center text-fg-muted">
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
                    <p className="text-xs text-fg-secondary leading-relaxed">{alert.message}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {alert.model_name && (
                        <span className="text-[10px] text-fg-muted font-mono">{alert.model_name}</span>
                      )}
                      <span className="text-[10px] text-fg-muted">{relativeTime(alert.timestamp)}</span>
                    </div>
                  </div>
                  <StatusBadge status={alert.severity} size="xs" />
                </motion.div>
              ))}
            </div>
          )}
        </Panel>

        {/* Live Training Log Feed */}
        <Panel title="Live Training Feed" icon={Terminal} color="text-cyan-400">
          <LiveEventFeed logs={streamEvent?.logs} connected={streamConnected} />
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
  const [stagingRun, setStagingRun] = useState<string | null>(null)
  const [stageMsg, setStageMsg] = useState<Record<string, string>>({})
  // Backfill modal
  const [showBackfill, setShowBackfill] = useState(false)
  const [bfSymbols, setBfSymbols] = useState('')
  const [bfHorizons, setBfHorizons] = useState('1,7,30')
  const [bfSubmitting, setBfSubmitting] = useState(false)
  const [bfMsg, setBfMsg] = useState<string | null>(null)
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

  // Live poll every 5s when any run is active
  useEffect(() => {
    const hasLive = runs.some(r => r.status === 'running')
    if (hasLive && !liveIntervalRef.current) {
      liveIntervalRef.current = setInterval(fetchRuns, 5000)
    } else if (!hasLive && liveIntervalRef.current) {
      clearInterval(liveIntervalRef.current)
      liveIntervalRef.current = null
    }
    return () => {
      if (liveIntervalRef.current) { clearInterval(liveIntervalRef.current); liveIntervalRef.current = null }
    }
  }, [runs, fetchRuns])

  const triggerBackfill = async () => {
    const symbols = bfSymbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    if (symbols.length === 0) { setBfMsg('Enter at least one symbol'); return }
    setBfSubmitting(true)
    setBfMsg(null)
    try {
      const horizons = bfHorizons.split(',').map(Number).filter(n => !isNaN(n) && n > 0)
      const res = await fetch(`${API}/api/v1/internal/ml/runs/backfill`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols, horizons }),
      })
      if (res.ok) {
        setBfMsg(`Backfill started for ${symbols.length} symbol${symbols.length > 1 ? 's' : ''}`)
        setTimeout(() => { setShowBackfill(false); setBfMsg(null); setBfSymbols(''); fetchRuns() }, 1800)
      } else {
        const body = await res.json().catch(() => ({}))
        setBfMsg(typeof body?.detail === 'string' ? body.detail : 'Failed to start backfill')
      }
    } catch {
      setBfMsg('Network error')
    } finally {
      setBfSubmitting(false)
    }
  }

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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_type: 'manual', symbol_tier: 'tier_2' }),
      })
      if (res.ok) {
        setTriggerMsg('Training run triggered successfully')
        setTimeout(() => { setTriggerMsg(null); fetchRuns() }, 2000)
      } else {
        const body = await res.json().catch(() => ({}))
        const msg = typeof body?.detail === 'string' ? body.detail : typeof body?.message === 'string' ? body.message : 'Failed to trigger run'
        setTriggerMsg(msg)
      }
    } catch {
      setTriggerMsg('Network error triggering run')
    } finally {
      setTriggering(false)
    }
  }

  const stageRun = async (runId: string) => {
    setStagingRun(runId)
    try {
      const res = await fetch(`${API}/api/v1/internal/ml/runs/${runId}/register-staging`, {
        method: 'POST', credentials: 'include',
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) {
        const msg = body.status === 'already_registered'
          ? `Already staged as ${body.model_version}`
          : `Staged as ${body.model_version} (DA=${body.avg_da?.toFixed?.(3)})`
        setStageMsg(prev => ({ ...prev, [runId]: `✓ ${msg}` }))
      } else {
        setStageMsg(prev => ({ ...prev, [runId]: body.detail || 'Staging failed' }))
      }
    } catch {
      setStageMsg(prev => ({ ...prev, [runId]: 'Network error' }))
    } finally {
      setStagingRun(null)
    }
  }

  if (loading) return <SkeletonTable rows={8} />
  if (error) return <InlineError message={error} onRetry={fetchRuns} />

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="text-sm text-fg-muted">{runs.length} runs</span>
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
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => setShowBackfill(true)}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 border border-violet-500/20 hover:border-violet-500/30 transition-all w-full sm:w-auto justify-center sm:justify-start"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Backfill Symbols
          </button>
          <button
            onClick={triggerRun}
            disabled={triggering}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/20 hover:border-cyan-500/30 transition-all disabled:opacity-40 w-full sm:w-auto justify-center sm:justify-start"
          >
            {triggering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {triggering ? 'Triggering...' : 'Trigger Run'}
          </button>
        </div>
      </div>

      {/* Backfill modal */}
      <AnimatePresence>
        {showBackfill && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setShowBackfill(false) }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              className="bg-surface-raised border border-line-default rounded-2xl p-6 max-w-md w-full shadow-2xl"
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
                    <RefreshCw className="w-4 h-4 text-violet-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-fg-primary">Trigger Backfill</h3>
                    <p className="text-[10px] text-fg-muted">Retrain specific symbols</p>
                  </div>
                </div>
                <button onClick={() => setShowBackfill(false)} className="p-1 rounded-md hover:bg-surface-hover text-fg-muted hover:text-fg-secondary transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] text-fg-muted uppercase tracking-wider block mb-1.5">Symbols (comma-separated)</label>
                  <textarea
                    value={bfSymbols}
                    onChange={e => setBfSymbols(e.target.value)}
                    placeholder="AAPL, TSLA, NVDA, MSFT"
                    rows={3}
                    className="w-full bg-surface-base border border-line-subtle rounded-lg px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:outline-none focus:border-violet-500/50 resize-none font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-fg-muted uppercase tracking-wider block mb-1.5">Horizons</label>
                  <select
                    value={bfHorizons}
                    onChange={e => setBfHorizons(e.target.value)}
                    className="w-full bg-surface-base border border-line-subtle rounded-lg px-3 py-2 text-sm text-fg-primary focus:outline-none focus:border-violet-500/50"
                  >
                    <option value="1">1-day only</option>
                    <option value="1,7">1-day + 7-day</option>
                    <option value="1,7,30">1-day + 7-day + 30-day</option>
                    <option value="7,30">7-day + 30-day</option>
                  </select>
                </div>

                {bfMsg && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className={`text-xs px-3 py-2 rounded-lg ${
                      bfMsg.includes('started') ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                    }`}
                  >
                    {bfMsg}
                  </motion.p>
                )}

                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => setShowBackfill(false)}
                    className="flex-1 py-2 text-xs font-medium rounded-lg bg-surface-hover text-fg-muted hover:text-fg-secondary border border-line-subtle hover:border-line-default transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={triggerBackfill}
                    disabled={bfSubmitting}
                    className="flex-1 py-2 text-xs font-semibold rounded-lg bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 border border-violet-500/30 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {bfSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    {bfSubmitting ? 'Starting...' : 'Start Backfill'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
                className="w-full text-left p-4 bg-surface-raised border border-line-subtle rounded-xl hover:border-line-default transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className={`p-1.5 rounded-md ${
                    expandedRun === run.run_id ? 'bg-surface-active' : 'bg-surface-hover'
                  }`}>
                    {expandedRun === run.run_id
                      ? <ChevronDown className="w-3.5 h-3.5 text-fg-muted" />
                      : <ChevronRight className="w-3.5 h-3.5 text-fg-muted" />
                    }
                  </div>
                  <div className="flex-1 min-w-0 grid grid-cols-2 md:grid-cols-5 gap-3 items-center">
                    <div className="flex items-center gap-2">
                      <code className="text-xs text-fg-secondary font-mono">{run.run_id?.slice(0, 14)}</code>
                      {run.status === 'running' && (
                        <span className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[9px] font-bold animate-pulse">
                          <span className="w-1 h-1 rounded-full bg-emerald-400" />LIVE
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {run.status === 'running' && <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />}
                      <StatusBadge status={run.status} />
                    </div>
                    <div className="hidden md:block">
                      <span className="text-xs text-fg-muted">{formatTimestamp(run.started_at)}</span>
                    </div>
                    <div className="hidden md:block">
                      <span className="text-xs text-fg-muted font-mono">
                        {run.success_shards ?? 0}/{run.total_shards ?? 1} shards · {run.total_symbols ?? 0} sym
                      </span>
                    </div>
                    <div className="hidden md:block text-right">
                      <span className="text-xs text-fg-muted font-mono">{formatDuration(run.runtime_seconds)}</span>
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
                    <div className="ml-2 sm:ml-12 mt-2 mb-2 p-3 sm:p-4 bg-surface-hover border border-line-subtle rounded-lg space-y-3">
                      {/* Run details */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pb-3 border-b border-line-subtle">
                        <div>
                          <div className="text-[10px] text-fg-muted uppercase mb-0.5">Started</div>
                          <div className="text-xs text-fg-secondary">{formatTimestamp(run.started_at)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-fg-muted uppercase mb-0.5">Finished</div>
                          <div className="text-xs text-fg-secondary">{formatTimestamp(run.finished_at)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-fg-muted uppercase mb-0.5">Failed Symbols</div>
                          <div className={`text-xs font-mono ${run.symbols_failed > 0 ? 'text-red-400' : 'text-fg-muted'}`}>
                            {run.symbols_failed}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-fg-muted uppercase mb-0.5">Runtime</div>
                          <div className="text-xs text-fg-secondary font-mono">{formatDuration(run.runtime_seconds)}</div>
                        </div>
                      </div>

                      {run.error && (
                        <div className="p-2 rounded bg-red-500/5 border border-red-500/10">
                          <p className="text-[11px] text-red-300 font-mono">{run.error}</p>
                        </div>
                      )}

                      {/* Stage model action for completed runs */}
                      {(run.status === 'completed' || run.status === 'partial_failure') && (
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => stageRun(run.run_id)}
                            disabled={stagingRun === run.run_id}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-md bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/20 hover:border-cyan-500/40 transition-all disabled:opacity-40"
                          >
                            {stagingRun === run.run_id
                              ? <><Loader2 className="w-3 h-3 animate-spin" /> Staging…</>
                              : <><Database className="w-3 h-3" /> Register as Staging Model</>
                            }
                          </button>
                          {stageMsg[run.run_id] && (
                            <span className={`text-xs ${stageMsg[run.run_id].startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>
                              {stageMsg[run.run_id]}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Shards */}
                      <div>
                        <h4 className="text-[10px] text-fg-muted uppercase tracking-wider mb-2">Shards</h4>
                        {(!shards[run.run_id] || shards[run.run_id].length === 0) ? (
                          <p className="text-xs text-fg-muted">No shard data available</p>
                        ) : (
                          <div className="space-y-1.5">
                            {shards[run.run_id].map((shard: any, si: number) => (
                              <div key={si} className="flex items-center gap-3 p-2 rounded bg-surface-hover border border-line-subtle">
                                <Hash className="w-3 h-3 text-fg-muted" />
                                <span className="text-xs text-fg-muted font-mono flex-1">
                                  Shard {shard.shard_index ?? si}
                                </span>
                                <span className="text-[10px] text-fg-muted font-mono">
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
  const [acting, setActing] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [symbolQuery, setSymbolQuery] = useState('')
  const [symbolHistory, setSymbolHistory] = useState<any[]>([])
  const [symNote, setSymNote] = useState<string | null>(null)
  const [symLoading, setSymLoading] = useState(false)

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
    if (expandedModel === name) { setExpandedModel(null); return }
    setExpandedModel(name)
    if (!performance[name]) {
      const data = await apiFetch<PerformanceData>(
        `/api/v1/mlops/monitoring/performance?model_name=${encodeURIComponent(name)}&window_days=30`
      )
      if (data) setPerformance(prev => ({ ...prev, [name]: data }))
    }
  }

  const promoteVersion = async (version: string) => {
    setActing(version)
    setActionMsg(null)
    try {
      const res = await fetch(`${API}/api/v1/internal/ml/models/versions/${encodeURIComponent(version)}/promote`, {
        method: 'POST', credentials: 'include',
      })
      const body = await res.json().catch(() => ({}))
      setActionMsg(res.ok ? `✓ ${version} promoted to production` : (body?.detail || 'Promotion failed'))
      if (res.ok) setTimeout(() => { setActionMsg(null); fetchModels() }, 2000)
    } catch { setActionMsg('Network error') }
    finally { setActing(null) }
  }

  const archiveVersion = async (version: string) => {
    setActing(version)
    setActionMsg(null)
    try {
      const res = await fetch(`${API}/api/v1/internal/ml/models/versions/${encodeURIComponent(version)}/archive`, {
        method: 'POST', credentials: 'include',
      })
      const body = await res.json().catch(() => ({}))
      setActionMsg(res.ok ? `✓ ${version} archived` : (body?.detail || 'Archive failed'))
      if (res.ok) setTimeout(() => { setActionMsg(null); fetchModels() }, 2000)
    } catch { setActionMsg('Network error') }
    finally { setActing(null) }
  }

  const searchSymbol = async () => {
    const sym = symbolQuery.trim().toUpperCase()
    if (!sym) return
    setSymLoading(true)
    setSymNote(null)
    const data = await apiFetch<{ history: any[]; note?: string; universal_model?: boolean }>(
      `/api/v1/internal/ml/symbols/${sym}/history?limit=20`
    )
    setSymbolHistory(data?.history || [])
    setSymNote(data?.note || null)
    setSymLoading(false)
  }

  if (loading) return <SkeletonTable rows={6} />
  if (error) return <InlineError message={error} onRetry={fetchModels} />

  const modelEntries = Object.entries(models)
  const prodVersions = versions.filter(v => v.promotion_status === 'production')
  const stagingVersions = versions.filter(v => v.promotion_status === 'staging')

  return (
    <div className="space-y-6">

      {/* DB Model Versions — real data */}
      {versions.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-fg-secondary uppercase tracking-wider flex items-center gap-2">
              <Database className="w-3.5 h-3.5 text-cyan-400" />
              Model Version Registry
              <span className="text-[10px] text-fg-muted font-normal normal-case">({versions.length} versions)</span>
            </h3>
            {actionMsg && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className={`text-xs px-2 py-0.5 rounded-md ${actionMsg.startsWith('✓') ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}
              >
                {actionMsg}
              </motion.span>
            )}
          </div>

          {/* Production Banner */}
          {prodVersions.length > 0 && (
            <div className="p-3 sm:p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/15">
              <div className="flex items-center gap-2 mb-2">
                <Crown className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Production</span>
              </div>
              <div className="space-y-2">
                {prodVersions.map(v => (
                  <div key={v.model_version} className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3">
                      <code className="text-sm font-bold text-fg-primary font-mono">{v.model_version}</code>
                      <span className="text-[10px] text-fg-muted">{v.symbol_count} symbols · promoted by {v.promoted_by || 'system'}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {v.avg_da != null && (
                        <div className="text-center">
                          <div className="text-[9px] text-fg-muted uppercase">DA</div>
                          <div className={`text-xs font-bold font-mono ${metricColor(v.avg_da)}`}>{(v.avg_da * 100).toFixed(1)}%</div>
                        </div>
                      )}
                      {v.avg_ic != null && (
                        <div className="text-center">
                          <div className="text-[9px] text-fg-muted uppercase">IC</div>
                          <div className={`text-xs font-bold font-mono ${metricColor(v.avg_ic, [0.02, 0.05])}`}>{v.avg_ic.toFixed(4)}</div>
                        </div>
                      )}
                      <button
                        onClick={() => archiveVersion(v.model_version)}
                        disabled={acting === v.model_version}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md bg-surface-hover text-fg-muted hover:text-red-400 border border-line-subtle hover:border-red-500/30 transition-all disabled:opacity-40"
                      >
                        {acting === v.model_version ? <Loader2 className="w-3 h-3 animate-spin" /> : <Archive className="w-3 h-3" />}
                        Archive
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Staging / other versions */}
          {stagingVersions.length > 0 && (
            <div className="space-y-2">
              <span className="text-[10px] text-fg-muted uppercase tracking-wider">Staging ({stagingVersions.length})</span>
              {stagingVersions.map((v, i) => (
                <motion.div
                  key={v.model_version}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg bg-surface-raised border border-line-subtle hover:border-line-default transition-colors flex-wrap"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-7 h-7 rounded-md bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                      <Package className="w-3.5 h-3.5 text-blue-400" />
                    </div>
                    <div>
                      <code className="text-sm font-semibold text-fg-primary font-mono">{v.model_version}</code>
                      <div className="text-[10px] text-fg-muted">{v.symbol_count ?? '--'} symbols · {formatTimestamp(v.created_at)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {v.avg_da != null && (
                      <div className="text-center hidden sm:block">
                        <div className="text-[9px] text-fg-muted">DA</div>
                        <div className={`text-xs font-mono font-bold ${metricColor(v.avg_da)}`}>{(v.avg_da * 100).toFixed(1)}%</div>
                      </div>
                    )}
                    {v.avg_ic != null && (
                      <div className="text-center hidden sm:block">
                        <div className="text-[9px] text-fg-muted">IC</div>
                        <div className={`text-xs font-mono font-bold ${metricColor(v.avg_ic, [0.02, 0.05])}`}>{v.avg_ic.toFixed(4)}</div>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => promoteVersion(v.model_version)}
                        disabled={acting === v.model_version}
                        className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold rounded-md bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 hover:border-emerald-500/30 transition-all disabled:opacity-40"
                      >
                        {acting === v.model_version ? <Loader2 className="w-3 h-3 animate-spin" /> : <Crown className="w-3 h-3" />}
                        Promote
                      </button>
                      <button
                        onClick={() => archiveVersion(v.model_version)}
                        disabled={acting === v.model_version}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md bg-surface-hover text-fg-muted hover:text-red-400 border border-line-subtle hover:border-red-500/30 transition-all disabled:opacity-40"
                      >
                        <Archive className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}

          {versions.length === 0 && (
            <EmptyState icon={Database} message="No model versions in registry — trigger a training run to populate" />
          )}
        </div>
      )}

      {/* Symbol Training History */}
      <div className="bg-surface-raised border border-line-subtle rounded-xl overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-line-subtle flex items-center gap-2">
          <Search className="w-4 h-4 text-violet-400" />
          <h3 className="text-xs font-semibold text-fg-secondary uppercase tracking-wider">Symbol Training History</h3>
        </div>
        <div className="p-4 sm:p-5 space-y-3">
          <div className="flex gap-2">
            <input
              value={symbolQuery}
              onChange={e => setSymbolQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchSymbol()}
              placeholder="Enter symbol (e.g. AAPL)"
              className="flex-1 bg-surface-base border border-line-subtle rounded-lg px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:outline-none focus:border-violet-500/50 font-mono uppercase"
            />
            <button
              onClick={searchSymbol}
              disabled={symLoading}
              className="px-3 py-2 text-xs font-medium rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 border border-violet-500/20 transition-all disabled:opacity-40 flex items-center gap-1.5"
            >
              {symLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              Search
            </button>
          </div>

          {symbolHistory.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-line-subtle">
                    {['Horizon', 'DA', 'IC', 'Sharpe', 'Version', 'Date'].map(h => (
                      <th key={h} className="text-left py-2 pr-4 text-[10px] text-fg-muted uppercase tracking-wider font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {symbolHistory.map((a: any, i: number) => (
                    <tr key={i} className="hover:bg-surface-hover transition-colors">
                      <td className="py-2 pr-4 font-mono text-fg-secondary">{a.horizon}d</td>
                      <td className={`py-2 pr-4 font-mono font-bold ${metricColor(a.directional_accuracy ?? 0)}`}>
                        {a.directional_accuracy != null ? `${(a.directional_accuracy * 100).toFixed(1)}%` : '--'}
                      </td>
                      <td className={`py-2 pr-4 font-mono font-bold ${metricColor(a.information_coefficient ?? 0, [0.02, 0.05])}`}>
                        {a.information_coefficient?.toFixed(4) ?? '--'}
                      </td>
                      <td className={`py-2 pr-4 font-mono ${a.hypothetical_sharpe > 1 ? 'text-emerald-400' : a.hypothetical_sharpe > 0.5 ? 'text-amber-400' : 'text-red-400'}`}>
                        {a.hypothetical_sharpe?.toFixed(2) ?? '--'}
                      </td>
                      <td className="py-2 pr-4 text-fg-muted font-mono">{a.model_version || '--'}</td>
                      <td className="py-2 text-fg-muted">{formatTimestamp(a.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {symNote && (
            <p className="text-xs text-amber-400/80 bg-amber-500/5 border border-amber-500/15 rounded-lg px-3 py-2">{symNote}</p>
          )}
          {!symLoading && symbolHistory.length === 0 && symbolQuery && !symNote && (
            <p className="text-xs text-fg-muted text-center py-4">No training history for {symbolQuery.toUpperCase()}</p>
          )}
        </div>
      </div>

      {/* File-based registry — shown only when populated */}
      {modelEntries.length === 0 && versions.length === 0 ? (
        <EmptyState icon={Package} message="No models registered — trigger a training run to populate" />
      ) : (
        <div className="space-y-3">
          {modelEntries.map(([name, info], i) => (
            <motion.div
              key={name}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="bg-surface-raised border border-line-subtle rounded-xl overflow-hidden hover:border-line-default transition-colors"
            >
              {/* Model Header */}
              <button
                onClick={() => toggleModel(name)}
                className="w-full text-left p-4 sm:p-5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 shrink-0 rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/20 flex items-center justify-center">
                      <Brain className="w-5 h-5 text-purple-400" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-fg-secondary truncate">{name}</h3>
                      <div className="flex items-center gap-2 sm:gap-3 mt-0.5 flex-wrap">
                        <span className="text-[10px] text-fg-muted">
                          {info.total_versions} version{info.total_versions !== 1 ? 's' : ''}
                        </span>
                        <span className="text-[10px] text-fg-muted hidden sm:inline">|</span>
                        <span className="text-[10px] text-fg-muted">
                          Latest: v{info.latest_version}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                    {info.production_version && (
                      <span className="text-[10px] px-2 sm:px-2.5 py-1 bg-emerald-500/10 text-emerald-400 rounded-full font-mono border border-emerald-500/20">
                        prod: v{info.production_version}
                      </span>
                    )}
                    {expandedModel === name
                      ? <ChevronDown className="w-4 h-4 text-fg-muted" />
                      : <ChevronRight className="w-4 h-4 text-fg-muted" />
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
                    <div className="px-4 sm:px-5 pb-4 sm:pb-5 pt-2 border-t border-line-subtle space-y-4">
                      {/* Performance metrics */}
                      {performance[name] && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="text-[10px] text-fg-muted uppercase tracking-wider">Performance (30d)</h4>
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
                        <h4 className="text-[10px] text-fg-muted uppercase tracking-wider mb-2">Version History</h4>
                        <div className="grid grid-cols-3 gap-2 text-[10px] text-fg-muted uppercase tracking-wider px-3 pb-1 border-b border-line-subtle">
                          <span>Version</span>
                          <span>Stage</span>
                          <span>Status</span>
                        </div>
                        {Array.from({ length: Math.min(info.total_versions || 1, 5) }).map((_, vi) => {
                          const ver = info.total_versions - vi
                          const stage = ver === info.production_version ? 'production'
                            : ver === info.latest_version ? 'staging' : 'archived'
                          return (
                            <div key={vi} className="grid grid-cols-3 gap-2 items-center px-3 py-2 hover:bg-surface-hover rounded transition-colors">
                              <span className="text-xs text-fg-secondary font-mono">v{ver}</span>
                              <StatusBadge status={stage} size="xs" />
                              <div className="flex items-center gap-1.5">
                                {stage === 'production' && (
                                  <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                                    <CheckCircle className="w-3 h-3" /> Active
                                  </span>
                                )}
                                {stage === 'archived' && (
                                  <span className="text-[10px] text-fg-muted">Superseded</span>
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
        {perfData?.performance?.status === 'no_data' || (perfData?.performance?.sample_size === 0) ? (
          <EmptyState icon={BarChart3} message={perfData?.performance?.message || 'No training artifacts yet — trigger a training run to populate metrics.'} />
        ) : perfData ? (
          <div className="space-y-4">
            {perfData.retrain_reason && (
              <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/10">
                <p className="text-xs text-amber-300">{perfData.retrain_reason}</p>
              </div>
            )}
            <div className="text-xs text-fg-muted mb-2">
              {perfData.performance?.sample_size} artifact{perfData.performance?.sample_size !== 1 ? 's' : ''} from horizons: {((perfData.performance as any)?.horizons_covered || []).join(', ')}d
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6">
              {[
                { k: 'directional_accuracy', v: perfData.performance?.directional_accuracy },
                { k: 'information_coefficient', v: perfData.performance?.information_coefficient },
                { k: 'hypothetical_sharpe', v: (perfData.performance as any)?.hypothetical_sharpe },
              ].map(({ k, v }) => v != null && (
                <div key={k} className="text-center p-3 rounded-lg bg-surface-hover border border-line-subtle">
                  <div className="text-[10px] text-fg-muted uppercase tracking-wider mb-1">{k.replace(/_/g, ' ')}</div>
                  <div className={`text-lg font-bold font-mono ${metricColor(v)}`}>{v.toFixed(4)}</div>
                </div>
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
          actions={<span className="text-[10px] text-fg-muted font-mono">{symbols.length} symbols</span>}
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
                      : 'bg-surface-hover text-fg-secondary border border-line-subtle hover:border-line-default'
                  }`}
                >
                  {sym}
                </button>
              ))}
              {symbols.length > 30 && (
                <span className="text-[10px] text-fg-muted self-center ml-1">+{symbols.length - 30} more</span>
              )}
            </div>

            {/* Drift report */}
            {selectedSymbol && (
              <div className="pt-2 border-t border-line-subtle">
                {driftLoading ? (
                  <div className="flex items-center gap-2 py-4 justify-center">
                    <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />
                    <span className="text-xs text-fg-muted">Checking drift for {selectedSymbol}...</span>
                  </div>
                ) : drift ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-fg-secondary">{selectedSymbol}</span>
                      <StatusBadge status={drift.drift_detected ? 'warning' : 'healthy'} />
                    </div>
                    {drift.drift_score !== undefined && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-fg-muted uppercase">Drift Score</span>
                          <span className={`text-xs font-mono ${drift.drift_score > 0.5 ? 'text-red-400' : drift.drift_score > 0.3 ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {drift.drift_score.toFixed(4)}
                          </span>
                        </div>
                        <div className="h-2 bg-surface-raised rounded-full overflow-hidden">
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
                        <span className="text-[10px] text-fg-muted uppercase tracking-wider">Drifted Features</span>
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
                  <p className="text-xs text-fg-muted py-4 text-center">No drift data for {selectedSymbol}</p>
                )}
              </div>
            )}
          </div>
        </Panel>

        {/* Alerts */}
        <Panel title="All Alerts" icon={AlertTriangle} color="text-red-400"
          actions={<span className="text-[10px] text-fg-muted font-mono">{alerts.length} total</span>}
        >
          {alerts.length === 0 ? (
            <div className="flex items-center gap-3 py-8 justify-center text-fg-muted">
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
                    alert.resolved ? 'bg-surface-hover border-line-subtle opacity-60' :
                    alert.severity === 'critical' ? 'bg-red-500/5 border-red-500/15' :
                    alert.severity === 'warning' ? 'bg-amber-500/5 border-amber-500/15' :
                    'bg-blue-500/5 border-blue-500/15'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className={`w-3 h-3 mt-0.5 shrink-0 ${
                      alert.resolved ? 'text-fg-muted' :
                      alert.severity === 'critical' ? 'text-red-400' :
                      alert.severity === 'warning' ? 'text-amber-400' : 'text-blue-400'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-fg-secondary leading-relaxed">{alert.message}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {alert.model_name && (
                          <span className="text-[10px] text-fg-muted font-mono">{alert.model_name}</span>
                        )}
                        <span className="text-[10px] text-fg-muted">{relativeTime(alert.timestamp)}</span>
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
          <span className="text-xs text-fg-secondary">{key}</span>
          <span className="text-xs text-fg-muted font-mono">null</span>
        </div>
      )
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      return (
        <div key={key}>
          <div className="flex items-center gap-2 py-1.5" style={{ paddingLeft: depth * 16 }}>
            <ChevronRight className="w-3 h-3 text-fg-muted" />
            <span className="text-xs font-medium text-fg-secondary">{key}</span>
          </div>
          {Object.entries(value).map(([k, v]) => renderConfigValue(k, v, depth + 1))}
        </div>
      )
    }
    if (Array.isArray(value)) {
      return (
        <div key={key} className="flex items-start justify-between py-1.5" style={{ paddingLeft: depth * 16 }}>
          <span className="text-xs text-fg-secondary">{key}</span>
          <span className="text-xs text-cyan-300 font-mono max-w-[60%] text-right truncate" title={JSON.stringify(value)}>
            [{value.length} items]
          </span>
        </div>
      )
    }
    return (
      <div key={key} className="flex items-center justify-between py-1.5" style={{ paddingLeft: depth * 16 }}>
        <span className="text-xs text-fg-secondary">{key}</span>
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
          <div className="divide-y divide-line-subtle max-h-[500px] overflow-y-auto scrollbar-thin">
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
              <div className="grid grid-cols-3 gap-3 sm:gap-4 pb-3 border-b border-line-subtle">
                <div>
                  <div className="text-[10px] text-fg-muted uppercase mb-0.5">Total Shards</div>
                  <div className="text-lg font-bold text-fg-secondary font-mono">{shardPlan.total_shards}</div>
                </div>
                <div>
                  <div className="text-[10px] text-fg-muted uppercase mb-0.5">Total Symbols</div>
                  <div className="text-lg font-bold text-fg-secondary font-mono">{shardPlan.total_symbols || '?'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-fg-muted uppercase mb-0.5">Symbols/Shard</div>
                  <div className="text-lg font-bold text-fg-secondary font-mono">{shardPlan.symbols_per_shard || '?'}</div>
                </div>
              </div>
            )}
            {/* Shard list */}
            {shardPlan.shards && Array.isArray(shardPlan.shards) && (
              <div className="space-y-1.5 max-h-[300px] overflow-y-auto scrollbar-thin">
                {shardPlan.shards.map((shard: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg bg-surface-hover border border-line-subtle">
                    <div className="w-6 h-6 rounded bg-violet-500/10 flex items-center justify-center">
                      <span className="text-[10px] font-bold text-violet-400">{i}</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex flex-wrap gap-1">
                        {(shard.symbols || []).slice(0, 8).map((s: string) => (
                          <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-raised text-fg-secondary font-mono">{s}</span>
                        ))}
                        {(shard.symbols || []).length > 8 && (
                          <span className="text-[10px] text-fg-muted">+{(shard.symbols || []).length - 8}</span>
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] text-fg-muted font-mono">{(shard.symbols || []).length} sym</span>
                  </div>
                ))}
              </div>
            )}
            {/* Raw fallback */}
            {!shardPlan.shards && (
              <pre className="text-[11px] text-fg-secondary font-mono bg-surface-hover p-3 rounded-lg overflow-x-auto max-h-[300px]">
                {JSON.stringify(shardPlan, null, 2)}
              </pre>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-fg-muted">
            <Layers className="w-8 h-8 mb-3 opacity-30" />
            <p className="text-sm mb-1">No shard plan computed yet</p>
            <p className="text-[11px] text-fg-muted">Click "Dry Run" to preview how symbols will be distributed across shards</p>
          </div>
        )}
      </Panel>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════

function DesktopMLOps() {
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
      <div className="min-h-screen bg-surface-base">
        <div className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 py-4 sm:py-8">

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
                <h1 className="text-xl sm:text-2xl font-bold text-fg-primary tracking-tight">MLOps Command Center</h1>
                <p className="text-xs text-fg-muted mt-0.5">Model lifecycle, training pipeline, drift monitoring</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-raised border border-line-subtle">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[10px] text-fg-secondary font-mono">LIVE</span>
              </div>
              <span className="text-[10px] text-fg-muted">Auto-refresh 30s</span>
            </div>
          </motion.div>

          {/* ── Tab Navigation ─────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="mb-6"
          >
            <div className="flex items-center gap-1 p-1 bg-surface-raised border border-line-subtle rounded-xl overflow-x-auto whitespace-nowrap scrollbar-none" style={{ WebkitOverflowScrolling: 'touch' }}>
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
                    activeTab === tab.id
                      ? 'bg-surface-active text-fg-primary shadow-lg shadow-black/20'
                      : 'text-fg-muted hover:text-fg-secondary hover:bg-surface-hover'
                  }`}
                >
                  <tab.icon className={`w-4 h-4 shrink-0 ${activeTab === tab.id ? 'text-cyan-400' : ''}`} />
                  <span>{tab.label}</span>
                  {tab.badge !== undefined && (
                    <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-red-500/20 text-red-400 min-w-[18px] text-center">
                      {tab.badge}
                    </span>
                  )}
                  {activeTab === tab.id && (
                    <motion.div
                      layoutId="mlops-tab-indicator"
                      className="absolute inset-0 bg-surface-hover rounded-lg border border-line-subtle"
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

export default function MLOpsDashboard() {
  const { isAuthenticated, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/auth?redirect=/mlops')
    }
  }, [isAuthenticated, isLoading, router])

  if (isLoading) {
    return (
      <AppLayout>
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-fg-muted" />
        </div>
      </AppLayout>
    )
  }

  if (!isAuthenticated) {
    return (
      <AppLayout>
        <div className="min-h-screen flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-surface-raised border border-line-subtle rounded-2xl p-8 max-w-sm w-full text-center"
          >
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-600/30 to-cyan-600/30 border border-purple-500/20 flex items-center justify-center mx-auto mb-4">
              <Lock className="w-7 h-7 text-purple-400" />
            </div>
            <h2 className="text-lg font-bold text-fg-primary mb-2">Sign In Required</h2>
            <p className="text-sm text-fg-muted mb-6">
              MLOps Command Center is restricted to authenticated users.
            </p>
            <button
              onClick={() => router.push('/auth?redirect=/mlops')}
              className="w-full py-2.5 px-4 bg-gradient-to-r from-purple-600/80 to-cyan-600/80 hover:from-purple-600 hover:to-cyan-600 text-white text-sm font-semibold rounded-xl transition-all"
            >
              Sign In
            </button>
          </motion.div>
        </div>
      </AppLayout>
    )
  }

  return (
    <>
      <div className="hidden md:block"><DesktopMLOps /></div>
      <div className="md:hidden"><MobileMLOps /></div>
    </>
  )
}
