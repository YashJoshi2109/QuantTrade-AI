'use client'

import { useState, useEffect, useCallback } from 'react'
import { Activity, Zap, Database, AlertTriangle, Radio, RefreshCw } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { formatNumber, isNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface RateLimitStats {
  max_calls_per_minute: number | null
  remaining_calls: number | null
  wait_time_seconds: number | null
  status: 'available' | 'rate_limited'
}

export interface CacheStats {
  entries: number | null
  hits?: number | null
  misses?: number | null
  /** 0–100 from server; cumulative since process start */
  hit_ratio_pct?: number | null
}

interface ApiStats {
  finnhub: {
    rate_limit: RateLimitStats
    cache: CacheStats
    recommendations?: {
      use_priority_high?: string
      use_priority_normal?: string
      cache_enabled?: boolean
    }
  }
}

interface ApiStatsMonitorProps {
  isInSidebar?: boolean
  compact?: boolean
}

interface FmpStats {
  used: number
  limit: number
  date: string
  percent: number
}

function GlassMeter({
  value,
  max,
  tone,
}: {
  value: number
  max: number
  tone: 'cyan' | 'violet' | 'amber' | 'rose'
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const bar = {
    cyan: 'from-cyan-400/90 to-sky-500/70 shadow-[0_0_12px_rgba(34,211,238,0.35)]',
    violet: 'from-violet-400/90 to-fuchsia-600/60 shadow-[0_0_12px_rgba(167,139,250,0.3)]',
    amber: 'from-amber-400/90 to-orange-500/70 shadow-[0_0_12px_rgba(251,191,36,0.25)]',
    rose: 'from-rose-400/90 to-red-600/70 shadow-[0_0_12px_rgba(251,113,133,0.35)]',
  }[tone]
  return (
    <div className="h-2 rounded-full bg-black/40 overflow-hidden ring-1 ring-white/[0.06]">
      <motion.div
        className={cn('h-full rounded-full bg-gradient-to-r', bar)}
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={{ type: 'spring', stiffness: 120, damping: 22 }}
      />
    </div>
  )
}

function GlassPopoverShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative w-[min(18rem,calc(100vw-2rem))]">
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute -inset-3 rounded-[1.35rem] opacity-60 blur-2xl"
        style={{
          background:
            'radial-gradient(ellipse at 20% 0%, rgba(0,212,255,0.18), transparent 55%), radial-gradient(ellipse at 90% 100%, rgba(139,92,246,0.14), transparent 50%)',
        }}
      />
      <div
        className={cn(
          'relative overflow-hidden rounded-2xl border border-white/[0.09]',
          'bg-[rgba(6,10,22,0.78)] backdrop-blur-xl backdrop-saturate-150',
          'shadow-[0_24px_48px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.07)]'
        )}
      >
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-cyan-500/[0.07] via-transparent to-violet-500/[0.06]" />
        <div className="pointer-events-none absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        <div className="relative z-10 p-4">{children}</div>
      </div>
    </div>
  )
}

export default function ApiStatsMonitor({ isInSidebar = false, compact = false }: ApiStatsMonitorProps) {
  const [stats, setStats] = useState<ApiStats | null>(null)
  const [fmpStats, setFmpStats] = useState<FmpStats | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [fetchError, setFetchError] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const refresh = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true)
    setFetchError(false)
    try {
      const [apiRes, fmpRes] = await Promise.all([
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/enhanced/api-stats`).catch(() => null),
        fetch('/api/stats').catch(() => null),
      ])
      if (apiRes?.ok) {
        const data = (await apiRes.json()) as ApiStats
        setStats(data)
        setLastUpdated(new Date())
      } else {
        setFetchError(true)
      }
      if (fmpRes?.ok) {
        const data = await fmpRes.json()
        if (data?.fmp) setFmpStats(data.fmp as FmpStats)
      }
    } catch {
      setFetchError(true)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void refresh(false)
    const interval = setInterval(() => void refresh(false), 120_000)
    return () => clearInterval(interval)
  }, [refresh])

  const rate = stats?.finnhub.rate_limit
  const cache = stats?.finnhub.cache
  const maxCalls = rate && isNumber(rate.max_calls_per_minute) ? rate.max_calls_per_minute : 0
  const remainingCalls = rate && isNumber(rate.remaining_calls) ? rate.remaining_calls : 0
  const usedCalls = maxCalls > 0 ? maxCalls - remainingCalls : 0
  const usagePercent = maxCalls > 0 ? (usedCalls / maxCalls) * 100 : 0
  const isRateLimited = rate?.status === 'rate_limited'

  const hitPct = cache?.hit_ratio_pct
  const totalHm = (cache?.hits ?? 0) + (cache?.misses ?? 0)
  const hitLabel =
    hitPct != null && Number.isFinite(hitPct) ? `${formatNumber(hitPct, 1)}%` : totalHm > 0 ? '—' : '…'

  // ── Compact header chip + liquid glass popover ─────────────────────────
  if (compact) {
    const fmpPct = fmpStats ? fmpStats.percent : 0
    const fmpTone: 'violet' | 'amber' | 'rose' = fmpPct > 80 ? 'rose' : fmpPct > 50 ? 'amber' : 'violet'
    const chipTone = isRateLimited ? 'rose' : usagePercent > 80 ? 'amber' : 'cyan'

    return (
      <div
        className="hidden lg:flex items-center gap-1.5 relative group isolate"
        role="group"
        aria-label="API usage — hover for Finnhub, FMP, and cache stats"
      >
        <button
          type="button"
          onClick={() => void refresh(true)}
          className={cn(
            'relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[10px] font-mono',
            'transition-all duration-300 overflow-hidden',
            'bg-[rgba(8,12,28,0.55)] backdrop-blur-md border-white/[0.08]',
            'hover:border-cyan-400/25 hover:shadow-[0_0_20px_rgba(34,211,238,0.12)]',
            isRateLimited && 'border-rose-500/35 bg-rose-950/20',
            fetchError && !stats && 'border-amber-500/40 bg-amber-950/15'
          )}
          title="Click to refresh API stats"
        >
          <span
            className={cn(
              'pointer-events-none absolute inset-0 opacity-40',
              chipTone === 'cyan' && 'bg-gradient-to-br from-cyan-500/20 via-transparent to-transparent',
              chipTone === 'amber' && 'bg-gradient-to-br from-amber-500/20 via-transparent to-transparent',
              chipTone === 'rose' && 'bg-gradient-to-br from-rose-500/25 via-transparent to-transparent'
            )}
          />
          {loading && !stats ? (
            <span className="relative z-10 flex items-center gap-1.5 text-slate-500">
              <span className="h-3.5 w-10 rounded bg-white/10 animate-pulse" />
            </span>
          ) : (
            <span className="relative z-10 flex items-center gap-1.5 text-slate-200">
              <Activity
                className={cn(
                  'w-3.5 h-3.5 shrink-0',
                  isRateLimited ? 'text-rose-400 animate-pulse' : 'text-cyan-300'
                )}
              />
              <span className="font-bold tabular-nums tracking-tight">
                {stats
                  ? `${formatNumber(remainingCalls, 0)}/${formatNumber(maxCalls, 0)}`
                  : '—'}
              </span>
              <RefreshCw
                className={cn(
                  'w-3 h-3 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity',
                  refreshing && 'animate-spin opacity-100'
                )}
              />
            </span>
          )}
        </button>

        {/* Hover bridge + popover */}
        <div className="absolute left-0 right-0 top-full h-2 z-40 pointer-events-none group-hover:pointer-events-auto" />
        <div
          className={cn(
            'absolute top-[calc(100%+4px)] right-0 z-50',
            'opacity-0 invisible translate-y-1 scale-[0.98]',
            'group-hover:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:scale-100',
            'transition-all duration-200 ease-out',
            'pointer-events-none group-hover:pointer-events-auto'
          )}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={lastUpdated?.getTime() ?? 'idle'}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <GlassPopoverShell>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <div className="flex items-center gap-2 text-[11px] font-bold tracking-wide text-white">
                      <Radio className="w-3.5 h-3.5 text-cyan-400" />
                      API pulse
                    </div>
                    <p className="text-[9px] text-slate-500 mt-0.5 leading-snug">
                      Live Finnhub limits from your API server. FMP counts this Next.js instance (UTC day).
                    </p>
                  </div>
                  {lastUpdated && (
                    <span className="text-[9px] font-mono text-slate-600 shrink-0 tabular-nums">
                      {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>

                {!stats ? (
                  <div className="text-[11px] text-amber-200/90 flex items-center gap-2 py-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    Could not load API stats. Check{' '}
                    <code className="text-[10px] bg-white/5 px-1 rounded">NEXT_PUBLIC_API_URL</code>.
                  </div>
                ) : (
                  <>
                    <div className="space-y-3">
                      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                            <Activity className="w-3.5 h-3.5 text-cyan-400" />
                            Finnhub
                          </span>
                          <span className="text-[11px] font-mono text-slate-100 tabular-nums">
                            {formatNumber(remainingCalls, 0)} left · {formatNumber(maxCalls, 0)}/min
                          </span>
                        </div>
                        <GlassMeter value={usedCalls} max={maxCalls} tone={isRateLimited ? 'rose' : usagePercent > 80 ? 'amber' : 'cyan'} />
                        {isRateLimited && rate?.wait_time_seconds != null && (
                          <p className="text-[10px] text-rose-300/90 mt-2 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            Limited — retry in ~{formatNumber(rate.wait_time_seconds, 0)}s
                          </p>
                        )}
                      </div>

                      {fmpStats && (
                        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                              <Database className="w-3.5 h-3.5 text-violet-400" />
                              FMP (daily)
                            </span>
                            <span className="text-[11px] font-mono text-slate-100 tabular-nums">
                              {fmpStats.used}/{fmpStats.limit}
                            </span>
                          </div>
                          <GlassMeter value={fmpStats.used} max={fmpStats.limit} tone={fmpTone} />
                          <p className="text-[9px] text-slate-600 mt-1.5">Resets UTC midnight · {fmpStats.date}</p>
                        </div>
                      )}

                      {cache?.entries != null && (
                        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                              <Zap className="w-3.5 h-3.5 text-emerald-400/90" />
                              Finnhub cache
                            </span>
                            <span className="text-[11px] font-mono text-slate-100">{formatNumber(cache.entries, 0)} keys</span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-slate-500 mt-2 pt-2 border-t border-white/[0.05]">
                            <span>Hits / misses</span>
                            <span className="font-mono text-slate-300">
                              {formatNumber(cache.hits ?? 0, 0)} / {formatNumber(cache.misses ?? 0, 0)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] mt-1">
                            <span className="text-slate-500">Hit ratio</span>
                            <span className="font-mono font-bold text-emerald-400/95">{hitLabel}</span>
                          </div>
                          <p className="text-[8px] text-slate-600 mt-2 leading-relaxed">
                            Ratio is measured on the API process (resets on deploy). Entries = warmed in-memory cache.
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </GlassPopoverShell>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    )
  }

  // ── Sidebar ──────────────────────────────────────────────────────────────
  if (isInSidebar) {
    if (!stats) {
      return (
        <div className="hud-stat p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] animate-pulse h-24" />
      )
    }
    return (
      <div className="rounded-xl border border-white/[0.08] bg-[rgba(6,10,22,0.55)] backdrop-blur-md p-3 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Activity className={`w-4 h-4 ${isRateLimited ? 'text-rose-400 animate-pulse' : 'text-cyan-400'}`} />
            <span className="text-xs font-bold text-white tracking-wide">API STATUS</span>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">Finnhub / min</span>
            <span
              className={cn(
                'font-mono font-bold',
                isRateLimited ? 'text-rose-400' : usagePercent > 80 ? 'text-amber-300' : 'text-emerald-300'
              )}
            >
              {formatNumber(remainingCalls, 0)}/{formatNumber(maxCalls, 0)}
            </span>
          </div>
          <GlassMeter value={usedCalls} max={maxCalls} tone={isRateLimited ? 'rose' : usagePercent > 80 ? 'amber' : 'cyan'} />
          {isRateLimited && rate?.wait_time_seconds != null && (
            <div className="text-[10px] text-rose-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Wait {formatNumber(rate.wait_time_seconds, 0)}s
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Floating widget ───────────────────────────────────────────────────────
  return (
    <div className="fixed bottom-4 right-4 z-50">
      {!isExpanded ? (
        <button
          type="button"
          onClick={() => setIsExpanded(true)}
          className={cn(
            'group relative px-4 py-2.5 rounded-2xl border transition-all duration-300',
            'bg-[rgba(6,10,22,0.72)] backdrop-blur-xl border-white/[0.1]',
            'hover:border-cyan-400/30 hover:shadow-[0_12px_40px_rgba(0,0,0,0.45)]',
            isRateLimited && 'border-rose-500/40 bg-rose-950/30'
          )}
        >
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-cyan-500/10 via-transparent to-violet-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative flex items-center gap-2">
            <Activity className={`w-4 h-4 ${isRateLimited ? 'text-rose-400 animate-pulse' : 'text-cyan-400'}`} />
            <span className="text-sm font-mono text-slate-200">
              {stats
                ? `${formatNumber(remainingCalls, 0)} / ${formatNumber(maxCalls, 0)}`
                : 'API …'}
            </span>
            {isRateLimited && <AlertTriangle className="w-4 h-4 text-rose-400 animate-pulse" />}
          </div>
          {stats && (
            <div className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-white/5 overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  isRateLimited ? 'bg-rose-400' : usagePercent > 80 ? 'bg-amber-400' : 'bg-cyan-400'
                )}
                style={{ width: `${Math.min(usagePercent, 100)}%` }}
              />
            </div>
          )}
        </button>
      ) : (
        <GlassPopoverShell>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-white">API status</h3>
            </div>
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              className="text-slate-500 hover:text-white transition-colors text-sm px-2 py-1 rounded-lg hover:bg-white/5"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          {stats ? (
            <div className="space-y-3 text-sm">
              <div>
                <div className="flex items-center justify-between mb-1 text-xs text-slate-400">
                  <span className="flex items-center gap-1">
                    <Zap className="w-3 h-3" />
                    Finnhub / min
                  </span>
                  <span className="font-mono text-slate-200">
                    {formatNumber(remainingCalls, 0)} / {formatNumber(maxCalls, 0)}
                  </span>
                </div>
                <GlassMeter value={usedCalls} max={maxCalls} tone={isRateLimited ? 'rose' : usagePercent > 80 ? 'amber' : 'cyan'} />
              </div>
              <div className="text-xs text-slate-500 border-t border-white/[0.06] pt-2">
                Cache {formatNumber(cache?.entries ?? 0, 0)} entries · hit {hitLabel}
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">No data yet.</p>
          )}
        </GlassPopoverShell>
      )}
    </div>
  )
}
