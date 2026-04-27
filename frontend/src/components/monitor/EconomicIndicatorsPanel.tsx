'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, TrendingUp, TrendingDown } from 'lucide-react'
import { fetchEconomicIndicators, type EconomicIndicatorsData } from '@/lib/monitor-extended-api'

const TABS = [
  { key: 'indicators', label: 'Indicators', icon: '📊' },
  { key: 'oil', label: 'Oil', icon: '🛢️' },
  { key: 'gov', label: 'Gov', icon: '🏛️' },
  { key: 'central_banks', label: 'Central Banks', icon: '🏦' },
]

export default function EconomicIndicatorsPanel() {
  const [activeTab, setActiveTab] = useState('indicators')
  
  const { data, isLoading } = useQuery<EconomicIndicatorsData>({
    queryKey: ['economic-indicators', activeTab],
    queryFn: () => fetchEconomicIndicators(activeTab),
    refetchInterval: 300_000,
    staleTime: 120_000,
  })

  return (
    <div className="hud-panel flex flex-col overflow-hidden bg-surface-base/95 border border-line-subtle rounded-xl">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-line-subtle bg-surface-raised/80">
        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-fg-primary font-mono">
          ECONOMIC INDICATORS
        </span>
      </div>

      {/* Tab Bar */}
      <div className="flex border-b border-line-subtle">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 px-3 py-2.5 text-[11px] font-medium transition-all flex items-center justify-center gap-1.5 ${
              activeTab === tab.key
                ? 'bg-emerald-500/10 text-emerald-400 border-b-2 border-emerald-500'
                : 'text-fg-muted hover:text-fg-secondary hover:bg-surface-hover'
            }`}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Indicator Rows */}
      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-line-subtle">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-16 bg-surface-hover rounded animate-pulse" />
            ))}
          </div>
        ) : data?.indicators.map((ind, i) => (
          <div key={ind.series_id + i} className="px-4 py-3.5 hover:bg-surface-hover transition-colors">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[12px] font-medium text-fg-secondary">{ind.name}</div>
                <div className="text-xl font-bold text-fg-primary font-mono mt-0.5">{ind.value}</div>
                <div className="text-[10px] text-fg-muted mt-0.5">{ind.date}</div>
              </div>
              <div className="text-right flex flex-col items-end gap-1">
                <span className="text-[10px] text-fg-muted font-mono">{ind.series_id}</span>
                {ind.change && (
                  <div className={`flex items-center gap-1 text-sm font-mono font-bold ${
                    ind.change_direction === 'up' ? 'text-emerald-400' :
                    ind.change_direction === 'down' ? 'text-red-400' : 'text-fg-secondary'
                  }`}>
                    {ind.change_direction === 'up' ? (
                      <TrendingUp className="w-3 h-3" />
                    ) : ind.change_direction === 'down' ? (
                      <TrendingDown className="w-3 h-3" />
                    ) : null}
                    {ind.change}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
