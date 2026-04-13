'use client'

import { useMemo } from 'react'
import { Globe } from '@/components/ui/cobe-globe'
import type { GlobalEvent, GeographicCluster, CountryInstability } from '@/lib/global-monitor-api'

function threatToCobeColor(level: string): [number, number, number] {
  switch (level) {
    case 'critical': return [0.94, 0.27, 0.27]
    case 'high':     return [0.98, 0.45, 0.09]
    case 'medium':   return [0.92, 0.72, 0.03]
    case 'low':      return [0.0, 0.83, 1.0]
    default:         return [0.4, 0.45, 0.53]
  }
}

interface Props {
  events: GlobalEvent[]
  clusters: GeographicCluster[]
  instability: CountryInstability[]
  onEventClick?: (event: GlobalEvent) => void
  onCountryClick?: (country: { code: string; name: string; lat: number; lng: number }) => void
  autoRotate?: boolean
  showLabels?: boolean
}

export default function CobeMonitorGlobe({
  events,
  autoRotate = true,
}: Props) {
  const markers = useMemo(() => {
    const seen = new Set<string>()
    return events
      .filter(ev => ev.latitude && ev.longitude)
      .map(ev => {
        const key = `${ev.latitude.toFixed(1)},${ev.longitude.toFixed(1)}`
        if (seen.has(key)) return null
        seen.add(key)
        return {
          id: ev.event_id,
          location: [ev.latitude, ev.longitude] as [number, number],
          label: ev.location_name || ev.title?.slice(0, 30) || 'Event',
        }
      })
      .filter(Boolean) as { id: string; location: [number, number]; label: string }[]
  }, [events])

  const dominantColor = useMemo((): [number, number, number] => {
    const critical = events.filter(e => e.threat_level === 'critical').length
    const high = events.filter(e => e.threat_level === 'high').length
    if (critical > 5) return threatToCobeColor('critical')
    if (high > 10) return threatToCobeColor('high')
    return [0.0, 0.83, 1.0]
  }, [events])

  return (
    <div className="w-full h-full flex items-center justify-center relative">
      <Globe
        markers={markers}
        arcs={[]}
        className="w-full max-w-[520px]"
        dark={1}
        baseColor={[0.05, 0.08, 0.15]}
        glowColor={[0.0, 0.15, 0.3]}
        markerColor={dominantColor}
        mapBrightness={4}
        markerSize={0.04}
        markerElevation={0.02}
        speed={autoRotate ? 0.002 : 0}
        theta={0.15}
        diffuse={1.2}
        mapSamples={20000}
      />

      <div className="absolute top-3 left-3 z-10">
        <div className="frosted-chip px-2.5 py-1 text-[9px] font-mono text-slate-400 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          3D GLOBE · {markers.length} events
        </div>
      </div>
    </div>
  )
}
