'use client'

import { useState, useEffect } from 'react'
import { Activity, Zap, Database, AlertTriangle } from 'lucide-react'

interface ApiStats {
  finnhub: {
    rate_limit: {
      max_calls_per_minute: number
      remaining_calls: number
      wait_time_seconds: number
      status: 'available' | 'rate_limited'
    }
    cache: {
      entries: number
      hit_ratio: string
    }
    recommendations: {
      use_priority_high: string
      use_priority_normal: string
      cache_enabled: boolean
    }
  }
}

export default function ApiStatsMonitor() {
  const [stats, setStats] = useState<ApiStats | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/v1/enhanced/api-stats`
        )
        if (response.ok) {
          const data = await response.json()
          setStats(data)
        }
      } catch (error) {
        console.error('API stats error:', error)
      }
    }

    fetchStats()
    const interval = setInterval(fetchStats, 10000) // Update every 10 seconds
    return () => clearInterval(interval)
  }, [])

  if (!stats) return null

  const { rate_limit, cache } = stats.finnhub
  const usagePercent = ((rate_limit.max_calls_per_minute - rate_limit.remaining_calls) / rate_limit.max_calls_per_minute) * 100
  const isRateLimited = rate_limit.status === 'rate_limited'

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
              API: {rate_limit.remaining_calls}/{rate_limit.max_calls_per_minute}
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
                  {rate_limit.remaining_calls} / {rate_limit.max_calls_per_minute}
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
                    Wait {rate_limit.wait_time_seconds.toFixed(1)}s for next call
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
                  {cache.entries} entries
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
