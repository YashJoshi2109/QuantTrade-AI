'use client'

import { useMemo, useCallback } from 'react'
import { WorldMap } from '@/components/ui/world-map'
import type { GlobalEvent } from '@/lib/global-monitor-api'

const THREAT_DOT_COLOR: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22d3ee',
  unknown: '#64748b',
}

interface Props {
  events: GlobalEvent[]
  onEventClick: (e: GlobalEvent) => void
}

export default function DottedFlatMap({ events, onEventClick }: Props) {
  const eventMarkers = useMemo(() => {
    const seen = new Set<string>()
    return events
      .filter(ev => ev.latitude && ev.longitude)
      .map(ev => {
        const key = `${ev.latitude.toFixed(1)},${ev.longitude.toFixed(1)}`
        if (seen.has(key)) return null
        seen.add(key)
        return {
          id: ev.event_id,
          lat: ev.latitude,
          lng: ev.longitude,
          color: THREAT_DOT_COLOR[ev.threat_level] || THREAT_DOT_COLOR.unknown,
          label: ev.location_name || ev.title?.slice(0, 30) || 'Event',
          pulse: ev.threat_level === 'critical' || ev.threat_level === 'high',
        }
      })
      .filter(Boolean) as { id: string; lat: number; lng: number; color: string; label: string; pulse: boolean }[]
  }, [events])

  const eventById = useMemo(() => {
    const m = new Map<string, GlobalEvent>()
    events.forEach(e => m.set(e.event_id, e))
    return m
  }, [events])

  const handleMarkerClick = useCallback(
    (marker: { id?: string }) => {
      if (marker.id) {
        const ev = eventById.get(marker.id)
        if (ev) onEventClick(ev)
      }
    },
    [eventById, onEventClick],
  )

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <div className="w-full">
        <WorldMap
          eventMarkers={eventMarkers}
          onMarkerClick={handleMarkerClick}
          dark
        />
      </div>

      <div className="absolute top-3 left-3 z-10">
        <div className="frosted-chip px-2.5 py-1 text-[9px] font-mono text-fg-secondary flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          FLAT MAP · {eventMarkers.length} events
        </div>
      </div>

      <div className="absolute bottom-3 left-3 z-10 flex gap-1.5">
        {[
          { label: 'CRITICAL', c: '#ef4444', n: events.filter(e => e.threat_level === 'critical').length },
          { label: 'HIGH', c: '#f97316', n: events.filter(e => e.threat_level === 'high').length },
          { label: 'MEDIUM', c: '#eab308', n: events.filter(e => e.threat_level === 'medium').length },
          { label: 'LOW', c: '#22d3ee', n: events.filter(e => e.threat_level === 'low').length },
        ].map(l => (
          <div key={l.label} className="frosted-chip px-2 py-1 flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: l.c }} />
            <span className="text-[9px] font-bold font-mono" style={{ color: l.c }}>{l.n}</span>
            <span className="text-[8px] text-fg-muted">{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
