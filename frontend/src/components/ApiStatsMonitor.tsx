'use client'

import { useState, useEffect } from 'react'
import { Activity, Zap, Database, AlertTriangle } from 'lucide-react'
import { formatNumber, isNumber } from '@/lib/format'

export interface RateLimitStats {
  max_calls_per_minute: number | null
  remaining_calls: number | null
  wait_time_seconds: number | null
  status: 'available' | 'rate_limited'
}

export interface CacheStats {
  entries: number | null
  hit_ratio?: string | null
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

export default function ApiStatsMonitor({ isInSidebar = false, compact = false }: ApiStatsMonitorProps) {
  const [stats, setStats] = useState<ApiStats | null>(null)
  const [fmpStats, setFmpStats] = useState<FmpStats | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [apiRes, fmpRes] = await Promise.all([
          fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/enhanced/api-stats`).catch(() => null),
          fetch('/api/stats').catch(() => null),
        ])
        if (apiRes?.ok) {
          const data = await apiRes.json()
          setStats(data)
        }
        if (fmpRes?.ok) {
          const data = await fmpRes.json()
          if (data?.fmp) setFmpStats(data.fmp)
        }
      } catch {
        // Silently fail — endpoint may not be available
      }
    }

    fetchStats()
    // Poll every 2 minutes
    const interval = setInterval(fetchStats, 120_000)
    return () => clearInterval(interval)
  }, [])

  if (!stats) return null

  const { rate_limit, cache } = stats.finnhub
  const maxCalls = isNumber(rate_limit.max_calls_per_minute) ? rate_limit.max_calls_per_minute : 0
  const remainingCalls = isNumber(rate_limit.remaining_calls) ? rate_limit.remaining_calls : 0
  const usagePercent = maxCalls > 0 ? ((maxCalls - remainingCalls) / maxCalls) * 100 : 0
  const isRateLimited = rate_limit.status === 'rate_limited'

  // Header compact view — clickable with hover popover
  if (compact) {
    const fmpPct = fmpStats ? fmpStats.percent : 0
    const fmpBarColor = fmpPct > 80 ? 'bg-red-500' : fmpPct > 50 ? 'bg-amber-500' : 'bg-emerald-500'

    return (
      <div
        className="hidden lg:flex items-center gap-1.5 relative group"
        role="group"
        aria-label="API usage — hover for Finnhub rate limit, FMP daily quota, and cache stats"
      >
        {/* Finnhub badge (FMP shown in popover only) */}
        <div
          className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs font-mono cursor-pointer transition-colors hover:bg-slate-700/40 ${
            isRateLimited
              ? 'bg-red-500/10 border-red-500/30 text-red-300'
              : 'bg-slate-800/50 border-slate-700/60 text-slate-300'
          }`}
        >
          <Activity className={`w-3 h-3 ${isRateLimited ? 'text-red-400 animate-pulse' : 'text-cyan-300'}`} />
          <span className="font-bold tabular-nums text-[10px]">
            {formatNumber(rate_limit.remaining_calls, 0)}/{formatNumber(rate_limit.max_calls_per_minute, 0)}
          </span>
        </div>

        {/* FMP daily quota: details only in hover popover (avoids second header chip + tooltip overlap) */}

        {/* Hover popover */}
        <div className="absolute top-full right-0 mt-2 w-64 rounded-xl border border-slate-700/60 bg-[#0b0f14] p-4 shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
          <div className="text-xs font-bold text-white mb-3">API Usage</div>

          {/* Finnhub */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-slate-400 flex items-center gap-1">
                <Activity className="w-3 h-3 text-cyan-400" /> Finnhub
              </span>
              <span className="text-[10px] font-mono text-slate-300">
                {formatNumber(rate_limit.remaining_calls, 0)}/{formatNumber(rate_limit.max_calls_per_minute, 0)}/min
              </span>
            </div>
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  isRateLimited ? 'bg-red-500' : usagePercent > 80 ? 'bg-amber-500' : 'bg-cyan-500'
                }`}
                style={{ width: `${Math.min(usagePercent, 100)}%` }}
              />
            </div>
          </div>

          {/* FMP */}
          {fmpStats && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                  <Database className="w-3 h-3 text-violet-400" /> FMP (daily)
                </span>
                <span className="text-[10px] font-mono text-slate-300">
                  {fmpStats.used}/{fmpStats.limit}
                </span>
              </div>
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${fmpBarColor}`}
                  style={{ width: `${Math.min(fmpPct, 100)}%` }}
                />
              </div>
              <div className="text-[9px] text-slate-600 mt-0.5">
                Resets daily · {fmpStats.date}
              </div>
            </div>
          )}

          {/* Cache */}
          {cache.entries != null && (
            <div className="flex items-center justify-between text-[10px] border-t border-slate-800/60 pt-2 mt-2">
              <span className="text-slate-500">Cache entries</span>
              <span className="text-slate-300 font-mono">{cache.entries}</span>
            </div>
          )}
          {cache.hit_ratio && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-slate-500">Hit ratio</span>
              <span className="text-emerald-400 font-mono font-bold">{cache.hit_ratio}</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Sidebar compact view
  if (isInSidebar) {
    return (
      <div className="hud-stat p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Activity className={`w-4 h-4 ${isRateLimited ? 'text-red-400 animate-pulse' : 'text-blue-400'}`} />
            <span className="text-xs font-bold text-white">API STATUS</span>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Rate Limit</span>
            <span className={`font-mono font-bold ${
              isRateLimited ? 'text-red-400' : 
              usagePercent > 80 ? 'text-yellow-400' : 'text-green-400'
            }`}>
              {formatNumber(rate_limit.remaining_calls, 0)}/{formatNumber(rate_limit.max_calls_per_minute, 0)}
            </span>
          </div>
          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-500 ${
                isRateLimited ? 'bg-red-400' : 
                usagePercent > 80 ? 'bg-yellow-400' : 'bg-blue-400'
              }`}
              style={{ width: `${usagePercent}%` }}
            />
          </div>
          {isRateLimited && (
            <div className="text-[10px] text-red-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Wait {formatNumber(rate_limit.wait_time_seconds, 0)}s
            </div>
          )}
        </div>
      </div>
    )
  }

  // Original floating widget
  return (
    <div className="fixed bottom-4 right-4 z-50">
      {!isExpanded ? (
        <button
          onClick={() => setIsExpanded(true)}
          className={`
            group relative px-4 py-2 rounded-lg backdrop-blur-sm
            border transition-all duration-300 hover:scale-105
            ${isRateLimited 
              ? 'bg-red-500/10 border-red-500/30 hover:bg-red-500/20' 
              : 'bg-slate-800/80 border-slate-700/50 hover:bg-slate-800/90'
            }
          `}
        >
          <div className="flex items-center gap-2">
            <Activity className={`w-4 h-4 ${isRateLimited ? 'text-red-400 animate-pulse' : 'text-blue-400'}`} />
            <span className="text-sm font-mono text-slate-300">
              API: {formatNumber(rate_limit.remaining_calls, 0)} / {formatNumber(rate_limit.max_calls_per_minute, 0)}
            </span>
            {isRateLimited && (
              <AlertTriangle className="w-4 h-4 text-red-400 animate-pulse" />
            )}
          </div>
          
          {/* Progress bar */}
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-700/50 rounded-b-lg overflow-hidden">
            <div 
              className={`h-full transition-all duration-500 ${
                isRateLimited ? 'bg-red-400' : 
                usagePercent > 80 ? 'bg-yellow-400' : 'bg-blue-400'
              }`}
              style={{ width: `${usagePercent}%` }}
            />
          </div>
        </button>
      ) : (
        <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700/50 rounded-lg p-4 shadow-2xl min-w-[300px]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-400" />
              <h3 className="text-sm font-bold text-slate-200">API Status</h3>
            </div>
            <button
              onClick={() => setIsExpanded(false)}
              className="text-slate-400 hover:text-slate-200 transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Rate Limit Section */}
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  Rate Limit
                </span>
                <span className={`text-xs font-mono font-bold ${
                  isRateLimited ? 'text-red-400' : 
                  usagePercent > 80 ? 'text-yellow-400' : 'text-green-400'
                }`}>
                  {formatNumber(rate_limit.remaining_calls, 0)} / {formatNumber(rate_limit.max_calls_per_minute, 0)}
                </span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all duration-500 ${
                    isRateLimited ? 'bg-red-400' : 
                    usagePercent > 80 ? 'bg-yellow-400' : 'bg-blue-400'
                  }`}
                  style={{ width: `${usagePercent}%` }}
                />
              </div>
              {isRateLimited && (
                <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
                  <div className="flex items-center gap-1 mb-1">
                    <AlertTriangle className="w-3 h-3" />
                    <span className="font-semibold">Rate Limited</span>
                  </div>
                  <span className="text-[10px]">
                    Wait {formatNumber(rate_limit.wait_time_seconds, 1)}s for next call
                  </span>
                </div>
              )}
            </div>

            {/* Cache Section */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <Database className="w-3 h-3" />
                  Cache
                </span>
                <span className="text-xs font-mono text-slate-300">
                  {formatNumber(cache.entries, 0)} entries
                </span>
              </div>
              <div className="text-[10px] text-slate-500 mt-1">
                Reduces API calls by 70-80%
              </div>
            </div>

            {/* Status Badge */}
            <div className="pt-2 border-t border-slate-700/50">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  isRateLimited ? 'bg-red-400 animate-pulse' : 'bg-green-400'
                }`} />
                <span className={`text-xs font-semibold ${
                  isRateLimited ? 'text-red-400' : 'text-green-400'
                }`}>
                  {rate_limit.status.toUpperCase()}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
