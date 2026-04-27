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
    <div className="hud-panel flex flex-col overflow-hidden bg-surface-base/95 border border-line-subtle rounded-xl max-h-[34rem]">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-line-subtle bg-surface-raised/80 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-fg-primary font-mono">
          TRADE POLICY
        </span>
        <span className="text-[9px] text-fg-muted font-mono">WTO / GDELT</span>
      </div>

      {/* Policy List */}
      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-line-subtle">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-14 bg-surface-hover rounded animate-pulse" />
            ))}
          </div>
        ) : data?.policies.length === 0 ? (
          <div className="flex items-center justify-center p-8 text-xs text-fg-muted">
            No recent trade policy updates
          </div>
        ) : data?.policies.map((policy, i) => (
          <div key={i} className="px-4 py-3 hover:bg-surface-hover transition-colors group">
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
                    <span className="text-[9px] text-fg-muted">{policy.country}</span>
                  )}
                </div>
                <p className="text-[11px] font-medium text-fg-secondary line-clamp-2 group-hover:text-sky-400 transition-colors">
                  {policy.title}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[9px] text-fg-muted">{policy.source}</span>
                  <span className="text-[9px] text-fg-muted">·</span>
                  <span className="text-[9px] text-fg-muted">{policy.date}</span>
                </div>
              </div>
              {policy.url && (
                <a
                  href={policy.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-md hover:bg-surface-hover text-fg-muted hover:text-sky-400 transition-colors"
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
        <div className="px-4 py-2 border-t border-line-subtle text-[9px] text-fg-muted font-mono text-center">
          {data.total} policies · Updated {new Date(data.updated_at).toLocaleTimeString()}
        </div>
      )}
    </div>
  )
}
