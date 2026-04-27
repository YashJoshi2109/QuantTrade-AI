'use client'

import { useQuery } from '@tanstack/react-query'
import { Shield, AlertTriangle, MapPin, ExternalLink } from 'lucide-react'
import { fetchACLEDConflicts, type ACLEDData } from '@/lib/monitor-extended-api'

export default function StrategicRiskPanel() {
  const { data, isLoading } = useQuery<ACLEDData>({
    queryKey: ['acled-conflicts'],
    queryFn: () => fetchACLEDConflicts(50),
    refetchInterval: 300_000,
    staleTime: 120_000,
  })

  // Compute top risks by country
  const countryRisks = (data?.events || []).reduce((acc, ev) => {
    const key = ev.country
    if (!acc[key]) {
      acc[key] = { country: key, events: 0, fatalities: 0, types: new Set<string>() }
    }
    acc[key].events++
    acc[key].fatalities += ev.fatalities
    acc[key].types.add(ev.event_type)
    return acc
  }, {} as Record<string, { country: string; events: number; fatalities: number; types: Set<string> }>)

  const topRisks = Object.values(countryRisks)
    .sort((a, b) => b.fatalities - a.fatalities || b.events - a.events)
    .slice(0, 8)

  // Recent high-impact alerts
  const alerts = (data?.events || [])
    .filter(e => e.fatalities > 0)
    .sort((a, b) => b.fatalities - a.fatalities)
    .slice(0, 8)

  return (
    <div className="hud-panel flex flex-col overflow-hidden bg-surface-base/95 border border-line-subtle rounded-xl">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-line-subtle bg-surface-raised/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-fg-primary font-mono">
            STRATEGIC RISK OVERVIEW
          </span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500/10 border border-red-500/30 text-[8px] text-red-400 font-bold">
            LIVE
          </span>
        </div>
        <span className="text-[9px] text-fg-muted font-mono">ACLED</span>
      </div>

      {isLoading ? (
        <div className="p-4 space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-12 bg-surface-hover rounded animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* Top Risks */}
          <div className="px-3 pt-3 pb-2">
            <div className="text-[9px] text-fg-muted uppercase tracking-wider font-bold mb-2">TOP RISKS</div>
            <div className="space-y-1.5">
              {topRisks.map((risk, i) => (
                <div key={risk.country} className="flex items-center justify-between px-2 py-1.5 rounded-md bg-surface-raised/60 border border-line-subtle">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-fg-muted font-mono w-3">{i + 1}.</span>
                    <span className={`text-[11px] font-medium ${
                      risk.fatalities > 10 ? 'text-red-400' :
                      risk.fatalities > 0 ? 'text-orange-400' : 'text-slate-300'
                    }`}>
                      {risk.country}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[9px] text-fg-muted">{risk.events} events</span>
                    {risk.fatalities > 0 && (
                      <span className="text-[9px] text-red-400 font-mono">{risk.fatalities} killed</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Alerts */}
          <div className="px-3 pb-3">
            <div className="text-[9px] text-fg-muted uppercase tracking-wider font-bold mb-2">RECENT ALERTS ({alerts.length})</div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {alerts.map((alert) => (
                <div key={alert.event_id} className="px-2 py-2 rounded-md bg-surface-raised/40 border border-line-subtle">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="w-3 h-3 text-orange-400 flex-shrink-0" />
                    <span className="text-[9px] text-orange-400 font-bold uppercase">{alert.event_type}</span>
                  </div>
                  <p className="text-[10px] text-fg-secondary line-clamp-2 pl-5">{alert.notes || `${alert.event_type} in ${alert.country}`}</p>
                  <div className="flex items-center gap-2 mt-1 pl-5">
                    <span className="text-[9px] text-fg-muted">{alert.country}</span>
                    <span className="text-[9px] text-fg-muted">·</span>
                    <span className="text-[9px] text-fg-muted">{alert.event_date}</span>
                    {alert.fatalities > 0 && (
                      <>
                        <span className="text-[9px] text-slate-700">·</span>
                        <span className="text-[9px] text-red-400">{alert.fatalities} fatalities</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
