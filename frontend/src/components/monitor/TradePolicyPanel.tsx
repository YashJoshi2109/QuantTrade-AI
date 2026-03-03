'use client'

import { useQuery } from '@tanstack/react-query'
import { Scale, ExternalLink } from 'lucide-react'
import { fetchTradePolicy, type TradePolicyData } from '@/lib/monitor-extended-api'

export default function TradePolicyPanel() {
  const { data, isLoading } = useQuery<TradePolicyData>({
    queryKey: ['trade-policy'],
    queryFn: () => fetchTradePolicy(20),
    refetchInterval: 300_000,
    staleTime: 120_000,
  })

  return (
    <div className="hud-panel flex flex-col overflow-hidden bg-slate-950/95 border border-slate-800/70 rounded-xl max-h-[34rem]">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-slate-800/70 bg-gradient-to-r from-slate-950 via-slate-900/80 to-slate-950 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-200 font-mono">
          TRADE POLICY
        </span>
        <span className="text-[9px] text-slate-600 font-mono">WTO / GDELT</span>
      </div>

      {/* Policy List */}
      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-800/40">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-14 bg-slate-800/50 rounded animate-pulse" />
            ))}
          </div>
        ) : data?.policies.length === 0 ? (
          <div className="flex items-center justify-center p-8 text-xs text-slate-500">
            No recent trade policy updates
          </div>
        ) : data?.policies.map((policy, i) => (
          <div key={i} className="px-4 py-3 hover:bg-slate-800/20 transition-colors group">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {policy.category && (
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider border ${
                      policy.category === 'tariff' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                      policy.category === 'restriction' ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' :
                      'bg-sky-500/20 text-sky-400 border-sky-500/30'
                    }`}>
                      {policy.category.replace('_', ' ')}
                    </span>
                  )}
                  {policy.country && (
                    <span className="text-[9px] text-slate-500">{policy.country}</span>
                  )}
                </div>
                <p className="text-[11px] font-medium text-slate-300 line-clamp-2 group-hover:text-sky-400 transition-colors">
                  {policy.title}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[9px] text-slate-600">{policy.source}</span>
                  <span className="text-[9px] text-slate-700">·</span>
                  <span className="text-[9px] text-slate-600">{policy.date}</span>
                </div>
              </div>
              {policy.url && (
                <a
                  href={policy.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-md hover:bg-slate-700/50 text-slate-500 hover:text-sky-400 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      {data && (
        <div className="px-4 py-2 border-t border-slate-800/50 text-[9px] text-slate-600 font-mono text-center">
          {data.total} policies · Updated {new Date(data.updated_at).toLocaleTimeString()}
        </div>
      )}
    </div>
  )
}
