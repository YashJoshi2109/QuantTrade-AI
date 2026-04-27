/**
 * Global Monitor 3D Globe Visualization (HD Globe)
 * Shows only event point markers with threat-level colors, hotspot rings,
 * and click-to-inspect interactions. No labels, no arcs, no trade routes.
 */
'use client'

import { useEffect, useRef, useState } from 'react'
import { GlobalEvent, GeographicCluster, CountryInstability } from '@/lib/global-monitor-api'

function getThreatSize(level: string): number {
  return ({ critical: 1.6, high: 1.3, medium: 1.0, low: 0.7, unknown: 0.5 } as Record<string, number>)[level] ?? 0.5
}

function getThreatColor(level: string): string {
  return ({ critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22d3ee', unknown: '#6b7280' } as Record<string, string>)[level] ?? '#6b7280'
}

function getThreatBadgeClass(level: string): string {
  return ({
    critical: 'bg-red-500/20 text-red-400 border border-red-500/50',
    high: 'bg-orange-500/20 text-orange-400 border border-orange-500/50',
    medium: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50',
    low: 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50',
    unknown: 'bg-gray-500/20 text-gray-400 border border-gray-500/50',
  } as Record<string, string>)[level] ?? 'bg-gray-500/20 text-gray-400 border border-gray-500/50'
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

export default function GlobalMonitorGlobe({
  events, clusters, onEventClick, autoRotate,
}: Props) {
  const globeEl = useRef<HTMLDivElement>(null)
  const globeInstance = useRef<any>(null)
  const [Globe, setGlobe] = useState<any>(null)

  useEffect(() => {
    import('globe.gl').then(m => setGlobe(() => m.default))
  }, [])

  useEffect(() => {
    if (!Globe || !globeEl.current || globeInstance.current) return

    const globe = Globe()(globeEl.current)
      .globeImageUrl('//unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
      .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
      .backgroundColor('rgba(0,0,0,0)')
      .showAtmosphere(true)
      .atmosphereColor('#0ea5e9')
      .atmosphereAltitude(0.18)
      .pointAltitude(0.015)
      .pointRadius('size')
      .pointColor('color')
      .pointResolution(12)
      .pointsMerge(false)
      .pointLabel((d: any) => `
        <div style="background:rgba(2,6,23,0.95);color:#f1f5f9;padding:10px 12px;border-radius:10px;border:1px solid rgba(14,165,233,0.35);max-width:260px;font-family:monospace;box-shadow:0 4px 20px rgba(0,0,0,0.6);">
          <div style="font-weight:800;font-size:12px;line-height:1.3;margin-bottom:6px;">${d.event.title}</div>
          <div style="color:#94a3b8;font-size:10px;margin-bottom:6px;">${d.event.location_name || d.event.country_code || 'Global'}</div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="padding:2px 8px;border-radius:4px;font-size:9px;font-weight:800;letter-spacing:0.1em;border:1px solid" class="${getThreatBadgeClass(d.event.threat_level)}">${(d.event.threat_level || 'unknown').toUpperCase()}</span>
            ${d.event.market_impact_score ? `<span style="color:#fb923c;font-size:9px;">Impact: ${d.event.market_impact_score}%</span>` : ''}
          </div>
          ${d.event.correlated_sectors?.length ? `<div style="margin-top:6px;font-size:9px;color:#64748b;">${d.event.correlated_sectors.slice(0, 3).join(' · ')}</div>` : ''}
          <div style="margin-top:4px;font-size:8px;color:#475569;">Click for full analysis →</div>
        </div>
      `)
      .onPointClick((d: any) => { if (onEventClick) onEventClick(d.event) })
      .ringColor('color')
      .ringMaxRadius('maxR')
      .ringPropagationSpeed('propagationSpeed')
      .ringRepeatPeriod('repeatPeriod')
      .ringAltitude(0.003)
      .labelsData([])

    globe.camera().position.z = 260
    globeInstance.current = globe

    const handleResize = () => {
      if (!globeEl.current || !globeInstance.current) return
      const el = globeEl.current as HTMLElement
      const parent = el.parentElement as HTMLElement | null
      const width = el.offsetWidth || parent?.clientWidth || 800
      const rawHeight = parent?.clientHeight || el.offsetHeight || Math.round(width * 0.55)
      const logicalHeight = Math.max(240, Math.min(rawHeight, 600))
      globeInstance.current.width(width).height(logicalHeight)
    }
    handleResize()
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (globeInstance.current) {
        try { globeInstance.current._destructor() } catch { /* noop */ }
      }
      globeInstance.current = null
    }
  }, [Globe])

  useEffect(() => {
    if (!globeInstance.current) return
    const globe = globeInstance.current

    globe.pointsData(
      events
        .filter(e => e.latitude && e.longitude)
        .map(event => ({
          lat: event.latitude,
          lng: event.longitude,
          size: getThreatSize(event.threat_level),
          color: getThreatColor(event.threat_level),
          event,
        }))
    )

    globe.ringsData(
      clusters
        .filter(c => c.is_hotspot)
        .map(cluster => ({
          lat: cluster.cell_lat,
          lng: cluster.cell_lon,
          maxR: cluster.hotspot_score ? Math.min(3.5, 1 + cluster.hotspot_score * 0.03) : 2.5,
          propagationSpeed: 0.8,
          repeatPeriod: 1600,
          color: (t: number) => {
            const alpha = 1 - t
            const base = cluster.max_threat_level === 'critical' ? '239,68,68'
              : cluster.max_threat_level === 'high' ? '249,115,22' : '168,85,247'
            return `rgba(${base},${alpha * 0.7})`
          },
        }))
    )

    globe.arcsData([])
    globe.hexBinPointsData([])

  }, [events, clusters])

  useEffect(() => {
    if (!globeInstance.current) return
    const ctrl = globeInstance.current.controls()
    ctrl.autoRotate = autoRotate ?? true
    ctrl.autoRotateSpeed = 0.4
    ctrl.enableZoom = true
  }, [autoRotate])

  if (!Globe) {
    return (
      <div className="flex items-center justify-center h-full bg-surface-base">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-fg-muted text-xs font-mono">Initializing globe...</p>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={globeEl}
      className="w-full h-full min-h-0 bg-surface-base overflow-hidden"
      style={{ contain: 'layout paint' }}
    />
  )
}
