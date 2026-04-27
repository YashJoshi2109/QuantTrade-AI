'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain, Activity, Database, AlertTriangle, Play,
  ChevronRight, ChevronDown, Cpu, Layers, Shield,
  Eye, Rocket, Target, SlidersHorizontal, Sparkles,
  Package, GitBranch, ArrowUpRight, ArrowDownRight,
  Loader2,
} from 'lucide-react'

const API = process.env.NEXT_PUBLIC_API_URL || ''

// ── Types ──
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
  runtime_seconds?: number
  error?: string
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

type TabId = 'overview' | 'runs' | 'models' | 'monitoring' | 'config'

// ── Helpers ──
function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '--'
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  return `${Math.floor(seconds / 3600)}h`
}

function relativeTime(ts?: string): string {
  if (!ts) return '--'
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60_000) return 'now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

async function apiFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, { credentials: 'include' })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

// ── Shared UI ──
function StatusBadge({ status, size = 'sm' }: { status: string; size?: 'xs' | 'sm' }) {
  const norm = status?.toLowerCase() || 'unknown'
  const isOk = ['completed', 'success', 'production', 'healthy', 'active'].includes(norm)
  const isWarn = ['running', 'training', 'staging', 'warning', 'degraded'].includes(norm)
  const isErr = ['failed', 'error', 'critical'].includes(norm)

  const c = isOk ? 'text-emerald-400 bg-emerald-500/10 dot-emerald-400'
    : isWarn ? 'text-amber-400 bg-amber-500/10 dot-amber-400'
    : isErr ? 'text-red-400 bg-red-500/10 dot-red-400'
    : 'text-fg-secondary bg-surface-raised dot-slate-400'

  const [textC, bgC, dotC] = c.split(' ')

  return (
    <span className={`inline-flex items-center gap-1.5 ${size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs'} rounded-full ${bgC} ${textC} font-medium`}>
      <span className={`${size === 'xs' ? 'w-1 h-1' : 'w-1.5 h-1.5'} rounded-full ${dotC.replace('dot-', 'bg-')} ${isWarn ? 'animate-pulse' : ''}`} />
      {status}
    </span>
  )
}

function StatCard({ icon: Icon, label, value, sub, color = 'text-cyan-400' }: {
  icon: any; label: string; value: React.ReactNode; sub?: string; color?: string
}) {
  return (
    <div className="bg-surface-raised border border-line-subtle rounded-xl p-3 shadow-lg">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-3.5 h-3.5 ${color}`} />
        <span className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <div className="text-xl font-bold text-fg-primary font-mono">{value}</div>
      {sub && <div className="text-[10px] text-fg-secondary mt-1 truncate">{sub}</div>}
    </div>
  )
}

export default function MobileMLOps() {
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [runs, setRuns] = useState<TrainingRun[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const [ov, rn, al] = await Promise.all([
        apiFetch<OverviewData>('/api/v1/mlops/overview'),
        apiFetch<{ runs: TrainingRun[] }>('/api/v1/internal/ml/runs?limit=10'),
        apiFetch<{ alerts: Alert[] }>('/api/v1/mlops/monitoring/alerts'),
      ])
      if (ov) setOverview(ov)
      if (rn) setRuns(rn.runs || [])
      if (al) setAlerts(al.alerts || [])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    fetchData()
    const int = setInterval(fetchData, 30_000)
    return () => clearInterval(int)
  }, [fetchData])

  const tabs: { id: TabId; label: string; icon: any; badge?: number }[] = [
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'runs', label: 'Runs', icon: Play },
    { id: 'models', label: 'Models', icon: Package },
    { id: 'monitoring', label: 'Alerts', icon: AlertTriangle, badge: alerts.filter(a => !a.resolved).length || undefined },
    { id: 'config', label: 'Config', icon: SlidersHorizontal },
  ]

  const prodCount = Object.keys(overview?.models?.production || {}).length
  const activeAlerts = alerts.filter(a => !a.resolved)

  return (
    <div className="flex flex-col min-h-screen bg-surface-base pb-24">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-surface-base/95 backdrop-blur-xl border-b border-line-subtle pt-safe px-4 py-3 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500/20 to-cyan-500/20 border border-purple-500/20 flex items-center justify-center">
              <Brain className="w-4 h-4 text-purple-400" />
            </div>
            <div>
              <h1 className="text-base font-bold text-fg-primary leading-tight">MLOps Center</h1>
              <p className="text-[10px] text-fg-muted flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live System
              </p>
            </div>
          </div>
        </div>

        {/* Tab Scroller */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium whitespace-nowrap transition-all active:scale-95 ${
                activeTab === tab.id
                  ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20'
                  : 'bg-surface-raised text-fg-secondary border border-line-subtle'
              }`}
            >
              <tab.icon className={`w-3.5 h-3.5 ${activeTab === tab.id ? 'text-fg-primary' : ''}`} />
              {tab.label}
              {tab.badge && (
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-4 pt-4 space-y-4">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-fg-muted animate-spin" /></div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              {/* OVERVIEW TAB */}
              {activeTab === 'overview' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <StatCard icon={Layers} label="Models" value={overview?.models?.registered || 0} sub={`${prodCount} in production`} color="text-purple-400" />
                    <StatCard icon={Database} label="Symbols" value={overview?.feature_store?.symbols || 0} sub={`Schema v${overview?.feature_store?.schema_version || '?'}`} />
                    <StatCard icon={Play} label="Runs (7d)" value={overview?.experiments?.total_runs || 0} color="text-blue-400" />
                    <StatCard icon={AlertTriangle} label="Alerts" value={activeAlerts.length} sub={activeAlerts.length ? 'Needs attention' : 'All clear'} color={activeAlerts.length ? 'text-red-400' : 'text-fg-muted'} />
                  </div>

                  <div className="bg-surface-raised border border-line-subtle rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-line-subtle flex items-center gap-2">
                      <Rocket className="w-4 h-4 text-blue-400" />
                      <h3 className="text-xs font-semibold text-fg-primary uppercase tracking-wider">Latest Run</h3>
                    </div>
                    <div className="p-4">
                      {runs[0] ? (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <code className="text-xs text-fg-secondary font-mono">{runs[0].run_id.slice(0, 12)}</code>
                            <StatusBadge status={runs[0].status} />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <div className="text-[10px] text-fg-muted uppercase mb-1">Progress</div>
                              <div className="text-sm font-bold text-fg-primary font-mono">
                                {runs[0].symbols_completed}/{runs[0].total_symbols}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-fg-muted uppercase mb-1">Runtime</div>
                              <div className="text-sm font-bold text-fg-primary font-mono">{formatDuration(runs[0].runtime_seconds)}</div>
                            </div>
                          </div>
                          {runs[0].total_symbols > 0 && (
                            <div className="h-1.5 bg-surface-raised rounded-full overflow-hidden mt-2">
                              <div
                                className={`h-full rounded-full ${runs[0].status === 'failed' ? 'bg-red-500' : 'bg-emerald-500'}`}
                                style={{ width: `${(runs[0].symbols_completed / runs[0].total_symbols) * 100}%` }}
                              />
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-fg-muted text-center py-4">No recent runs</p>
                      )}
                    </div>
                  </div>

                  <div className="bg-surface-raised border border-line-subtle rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-line-subtle flex items-center gap-2">
                      <GitBranch className="w-4 h-4 text-amber-400" />
                      <h3 className="text-xs font-semibold text-fg-primary uppercase tracking-wider">Pipeline Health</h3>
                    </div>
                    <div className="p-2 space-y-1">
                      {[
                        { name: 'Data Ingestion', icon: Database },
                        { name: 'Feature Store', icon: Sparkles },
                        { name: 'Model Training', icon: Brain },
                        { name: 'Registry', icon: Package },
                      ].map((stage, i) => (
                        <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-surface-hover">
                          <stage.icon className="w-4 h-4 text-fg-secondary" />
                          <span className="text-xs text-fg-secondary flex-1">{stage.name}</span>
                          <span className="w-2 h-2 rounded-full bg-emerald-500/50" />
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* RUNS TAB */}
              {activeTab === 'runs' && (
                <div className="space-y-2">
                  <button className="w-full py-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs font-semibold flex items-center justify-center gap-2 mb-4 active:scale-95 transition-all">
                    <Play className="w-3.5 h-3.5" /> Trigger Nightly Run
                  </button>
                  {runs.map((run) => (
                    <div key={run.run_id} className="p-3 bg-surface-raised border border-line-subtle rounded-xl">
                      <div className="flex items-center justify-between mb-2">
                        <code className="text-xs text-fg-secondary font-mono">{run.run_id.slice(0, 10)}</code>
                        <StatusBadge status={run.status} size="xs" />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-fg-muted">
                        <span>{relativeTime(run.started_at)}</span>
                        <span className="font-mono">{run.symbols_completed}/{run.total_symbols} symbols</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* MODELS TAB */}
              {activeTab === 'models' && (
                <div className="space-y-3">
                  {Object.entries(overview?.models?.production || {}).map(([name, info]: [string, any]) => (
                    <div key={name} className="p-3 bg-surface-raised border border-line-subtle rounded-xl">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Package className="w-4 h-4 text-emerald-400" />
                          <span className="text-sm font-medium text-fg-primary">{name}</span>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded-full font-mono">v{info.version}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {Object.entries(info.metrics || {}).slice(0, 4).map(([k, v]: [string, any]) => (
                          <div key={k} className="bg-black/20 rounded p-1.5 text-center">
                            <div className="text-[9px] text-fg-muted uppercase">{k.replace(/_/g, ' ')}</div>
                            <div className="text-xs font-mono text-fg-secondary">{typeof v === 'number' ? v.toFixed(3) : v}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ALERTS TAB */}
              {activeTab === 'monitoring' && (
                <div className="space-y-2">
                  {activeAlerts.length === 0 ? (
                    <div className="py-12 text-center text-fg-muted">
                      <Shield className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No active alerts</p>
                    </div>
                  ) : (
                    activeAlerts.map((alert) => (
                      <div key={alert.id} className={`p-3 border rounded-xl ${
                        alert.severity === 'critical' ? 'bg-red-500/5 border-red-500/20' : 'bg-amber-500/5 border-amber-500/20'
                      }`}>
                        <div className="flex gap-2">
                          <AlertTriangle className={`w-4 h-4 shrink-0 ${alert.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}`} />
                          <div>
                            <p className="text-xs text-fg-primary leading-relaxed mb-1">{alert.message}</p>
                            <div className="flex items-center gap-2 text-[10px] text-fg-muted">
                              {alert.model_name && <span className="font-mono">{alert.model_name}</span>}
                              <span>{relativeTime(alert.timestamp)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* CONFIG TAB */}
              {activeTab === 'config' && (
                <div className="py-12 text-center text-fg-muted">
                  <SlidersHorizontal className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm mb-1">Configuration View</p>
                  <p className="text-xs">Pipeline config requires desktop view</p>
                </div>
              )}

            </motion.div>
          </AnimatePresence>
        )}
      </main>
    </div>
  )
}
