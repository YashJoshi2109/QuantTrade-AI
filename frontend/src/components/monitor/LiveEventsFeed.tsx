'use client'

import { useMemo } from 'react'
import { AlertTriangle, TrendingDown, Zap, Clock, ChevronRight } from 'lucide-react'
import { type GlobalEvent } from '@/lib/global-monitor-api'

interface Props {
  events: GlobalEvent[]
  onEventClick: (event: GlobalEvent) => void
  maxItems?: number
}

export default function LiveEventsFeed({ events, onEventClick, maxItems = 40 }: Props) {
  const sortedEvents = useMemo(
    () =>
      [...events]
        .sort((a, b) => {
          // Critical first, then by timestamp
          const threatOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 }
          const diff = (threatOrder[a.threat_level] ?? 4) - (threatOrder[b.threat_level] ?? 4)
          if (diff !== 0) return diff
          return new Date(b.event_timestamp).getTime() - new Date(a.event_timestamp).getTime()
        })
        .slice(0, maxItems),
    [events, maxItems]
  )

  if (sortedEvents.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-600 text-xs">
        No events in current filter
      </div>
    )
  }

  return (
    <div className="flex flex-col overflow-hidden h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-800/70 flex items-center justify-between bg-gradient-to-r from-slate-950 via-slate-900/80 to-slate-950">
        <div className="flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-200 font-mono">
            LIVE EVENTS
          </span>
        </div>
        <span className="text-[9px] text-slate-500 font-mono">{sortedEvents.length} events</span>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto">
        <div className="divide-y divide-slate-800/30">
          {sortedEvents.map((event) => {
            const isRecent = (Date.now() - new Date(event.event_timestamp).getTime()) < 3600_000
            return (
              <button
                key={event.id}
                onClick={() => onEventClick(event)}
                className="w-full text-left px-3 py-2.5 hover:bg-slate-800/30 transition-colors group"
              >
                <div className="flex items-start gap-2">
                  <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    event.threat_level === 'critical' ? 'bg-red-500 animate-pulse' :
                    event.threat_level === 'high' ? 'bg-orange-500' :
                    event.threat_level === 'medium' ? 'bg-yellow-500' :
                    'bg-sky-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-slate-200 line-clamp-2 leading-tight group-hover:text-white transition-colors">
                      {event.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[9px] text-slate-500 uppercase">{event.category}</span>
                      <span className="text-[9px] text-slate-700">·</span>
                      <span className="text-[9px] text-slate-500">{event.location_name || 'Global'}</span>
                      {isRecent && (
                        <>
                          <span className="text-[9px] text-slate-700">·</span>
                          <span className="text-[9px] text-amber-400 font-bold">NEW</span>
                        </>
                      )}
                    </div>
                    {event.market_impact_score && event.market_impact_score > 60 && (
                      <div className="flex items-center gap-1 mt-1">
                        <TrendingDown className="w-2.5 h-2.5 text-red-400" />
                        <span className="text-[9px] text-red-400">Market Impact: {event.market_impact_score}%</span>
                      </div>
                    )}
                  </div>
                  <ChevronRight className="w-3 h-3 text-slate-700 group-hover:text-slate-400 mt-1 flex-shrink-0 transition-colors" />
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
