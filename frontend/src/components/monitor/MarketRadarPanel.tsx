'use client'

import { useQuery } from '@tanstack/react-query'
import { Activity, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { fetchMarketRadar, type MarketRadarData } from '@/lib/monitor-extended-api'

function getStatusColor(color: string) {
  switch (color) {
    case 'green': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
    case 'red': return 'bg-red-500/20 text-red-400 border-red-500/30'
    case 'yellow': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    case 'orange': return 'bg-orange-500/20 text-orange-400 border-orange-500/30'
    default: return 'bg-slate-500/20 text-slate-400 border-slate-500/30'
  }
}

function getOverallColor(signal: string) {
  switch (signal) {
    case 'INVEST': return 'border-l-emerald-500 text-emerald-400'
    case 'CASH': return 'border-l-orange-500 text-orange-400'
    case 'CAUTIOUS': return 'border-l-yellow-500 text-yellow-400'
    default: return 'border-l-slate-500 text-slate-400'
  }
}

export default function MarketRadarPanel() {
  const { data, isLoading } = useQuery<MarketRadarData>({
    queryKey: ['market-radar'],
    queryFn: fetchMarketRadar,
    refetchInterval: 120_000,
    staleTime: 60_000,
  })

  return (
    <div className="hud-panel flex flex-col overflow-hidden bg-slate-950/95 border border-slate-800/70 rounded-xl">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-slate-800/70 bg-gradient-to-r from-slate-950 via-slate-900/80 to-slate-950">
        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-200 font-mono">
          MARKET RADAR
        </span>
      </div>

      {isLoading || !data ? (
        <div className="p-4 space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 bg-slate-800/50 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* Overall Signal Bar */}
          <div className={`mx-3 mt-3 px-4 py-2.5 rounded-lg border-l-4 bg-slate-900/80 ${getOverallColor(data.overall_signal)}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">OVERALL</span>
                <span className="text-lg font-black font-mono tracking-wider">
                  {data.overall_signal}
                </span>
              </div>
              <span className="text-xs text-slate-500 font-mono">
                {data.bullish_count}/{data.total_signals} bullish
              </span>
            </div>
          </div>

          {/* Signal Cards Grid */}
          <div className="p-3 grid grid-cols-3 gap-2">
            {data.signals.filter(s => s.name !== 'Fear & Greed').map((signal) => (
              <div key={signal.name} className="bg-slate-900/60 border border-slate-800/60 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold text-slate-300 font-mono">{signal.name}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${getStatusColor(signal.status_color)}`}>
                    {signal.status}
                  </span>
                </div>
                {signal.sparkline && signal.sparkline.length > 0 && (
                  <div className="h-6 flex items-end gap-[1px] mb-1.5">
                    {signal.sparkline.map((v, i) => {
                      const max = Math.max(...signal.sparkline!)
                      const min = Math.min(...signal.sparkline!)
                      const h = max === min ? 50 : ((v - min) / (max - min)) * 100
                      return (
                        <div
                          key={i}
                          className={`flex-1 rounded-sm ${signal.status_color === 'green' ? 'bg-emerald-400/60' : signal.status_color === 'red' ? 'bg-red-400/60' : 'bg-yellow-400/60'}`}
                          style={{ height: `${Math.max(h, 8)}%` }}
                        />
                      )
                    })}
                  </div>
                )}
                <div className="flex items-baseline gap-2">
                  {signal.value && (
                    <span className="text-sm font-mono font-bold text-slate-200">{signal.value}</span>
                  )}
                  {signal.detail && (
                    <span className="text-[10px] text-slate-500">{signal.detail}</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Fear & Greed */}
          {data.fear_greed_index != null && (
            <div className="mx-3 mb-3 bg-slate-900/60 border border-slate-800/60 rounded-lg p-3">
              <div className="flex items-center gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] font-semibold text-slate-300 font-mono">Fear & Greed</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${
                      data.fear_greed_index < 30 ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                      data.fear_greed_index > 60 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
                      'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                    }`}>
                      {data.fear_greed_label}
                    </span>
                  </div>
                </div>
                {/* Gauge */}
                <div className="relative w-14 h-14">
                  <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
                    <circle cx="18" cy="18" r="15" fill="none" stroke="#1e293b" strokeWidth="3" />
                    <circle
                      cx="18" cy="18" r="15"
                      fill="none"
                      stroke={data.fear_greed_index < 30 ? '#ef4444' : data.fear_greed_index > 60 ? '#22c55e' : '#eab308'}
                      strokeWidth="3"
                      strokeDasharray={`${(data.fear_greed_index / 100) * 94} 94`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className={`text-sm font-bold font-mono ${
                      data.fear_greed_index < 30 ? 'text-red-400' : data.fear_greed_index > 60 ? 'text-emerald-400' : 'text-yellow-400'
                    }`}>
                      {data.fear_greed_index}
                    </span>
                  </div>
                </div>
                <span className="text-[10px] text-emerald-500/60 font-mono">alternative.me</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
