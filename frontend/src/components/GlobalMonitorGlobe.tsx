/**
 * Global Monitor 3D Globe Visualization
 * Enhanced: HexBin event density, heatmap layer, country click detection,
 * animated arcs, improved atmospherics and event markers
 */
'use client'

import { useEffect, useRef, useState } from 'react'
import { GlobalEvent, GeographicCluster, CountryInstability } from '@/lib/global-monitor-api'

// ── Country label data ──────────────────────────────────────────────
const COUNTRY_LABELS: { name: string; lat: number; lng: number; code: string }[] = [
  { name: 'United States', lat: 39.8, lng: -98.6, code: 'US' },
  { name: 'Canada', lat: 56.1, lng: -106.3, code: 'CA' },
  { name: 'Mexico', lat: 23.6, lng: -102.6, code: 'MX' },
  { name: 'Brazil', lat: -14.2, lng: -51.9, code: 'BR' },
  { name: 'Argentina', lat: -38.4, lng: -63.6, code: 'AR' },
  { name: 'Colombia', lat: 4.6, lng: -74.1, code: 'CO' },
  { name: 'Peru', lat: -9.2, lng: -75.0, code: 'PE' },
  { name: 'Chile', lat: -35.7, lng: -71.5, code: 'CL' },
  { name: 'Venezuela', lat: 6.4, lng: -66.6, code: 'VE' },
  { name: 'Cuba', lat: 21.5, lng: -77.8, code: 'CU' },
  { name: 'Haiti', lat: 19.1, lng: -72.3, code: 'HT' },
  { name: 'Panama', lat: 8.5, lng: -80.8, code: 'PA' },
  { name: 'Guatemala', lat: 15.8, lng: -90.2, code: 'GT' },
  { name: 'United Kingdom', lat: 55.4, lng: -3.4, code: 'GB' },
  { name: 'France', lat: 46.2, lng: 2.2, code: 'FR' },
  { name: 'Germany', lat: 51.2, lng: 10.5, code: 'DE' },
  { name: 'Italy', lat: 41.9, lng: 12.6, code: 'IT' },
  { name: 'Spain', lat: 40.5, lng: -3.7, code: 'ES' },
  { name: 'Portugal', lat: 39.4, lng: -8.2, code: 'PT' },
  { name: 'Netherlands', lat: 52.1, lng: 5.3, code: 'NL' },
  { name: 'Belgium', lat: 50.5, lng: 4.5, code: 'BE' },
  { name: 'Switzerland', lat: 46.8, lng: 8.2, code: 'CH' },
  { name: 'Austria', lat: 47.5, lng: 14.6, code: 'AT' },
  { name: 'Poland', lat: 51.9, lng: 19.1, code: 'PL' },
  { name: 'Sweden', lat: 60.1, lng: 18.6, code: 'SE' },
  { name: 'Norway', lat: 60.5, lng: 8.5, code: 'NO' },
  { name: 'Finland', lat: 61.9, lng: 25.7, code: 'FI' },
  { name: 'Denmark', lat: 56.3, lng: 9.5, code: 'DK' },
  { name: 'Ireland', lat: 53.1, lng: -8.2, code: 'IE' },
  { name: 'Greece', lat: 39.1, lng: 21.8, code: 'GR' },
  { name: 'Romania', lat: 45.9, lng: 25.0, code: 'RO' },
  { name: 'Hungary', lat: 47.2, lng: 19.5, code: 'HU' },
  { name: 'Ukraine', lat: 48.4, lng: 31.2, code: 'UA' },
  { name: 'Belarus', lat: 53.7, lng: 27.9, code: 'BY' },
  { name: 'Russia', lat: 61.5, lng: 105.3, code: 'RU' },
  { name: 'China', lat: 35.9, lng: 104.2, code: 'CN' },
  { name: 'Japan', lat: 36.2, lng: 138.3, code: 'JP' },
  { name: 'South Korea', lat: 35.9, lng: 127.8, code: 'KR' },
  { name: 'North Korea', lat: 40.3, lng: 127.5, code: 'KP' },
  { name: 'India', lat: 20.6, lng: 79.0, code: 'IN' },
  { name: 'Pakistan', lat: 30.4, lng: 69.3, code: 'PK' },
  { name: 'Bangladesh', lat: 23.7, lng: 90.4, code: 'BD' },
  { name: 'Indonesia', lat: -0.8, lng: 113.9, code: 'ID' },
  { name: 'Philippines', lat: 12.9, lng: 121.8, code: 'PH' },
  { name: 'Vietnam', lat: 14.1, lng: 108.3, code: 'VN' },
  { name: 'Thailand', lat: 15.9, lng: 100.5, code: 'TH' },
  { name: 'Myanmar', lat: 21.9, lng: 95.9, code: 'MM' },
  { name: 'Malaysia', lat: 4.2, lng: 101.9, code: 'MY' },
  { name: 'Singapore', lat: 1.4, lng: 103.8, code: 'SG' },
  { name: 'Taiwan', lat: 23.7, lng: 121.0, code: 'TW' },
  { name: 'Mongolia', lat: 46.9, lng: 103.8, code: 'MN' },
  { name: 'Kazakhstan', lat: 48.0, lng: 68.0, code: 'KZ' },
  { name: 'Afghanistan', lat: 33.9, lng: 67.7, code: 'AF' },
  { name: 'Iran', lat: 32.4, lng: 53.7, code: 'IR' },
  { name: 'Iraq', lat: 33.2, lng: 43.7, code: 'IQ' },
  { name: 'Saudi Arabia', lat: 23.9, lng: 45.1, code: 'SA' },
  { name: 'UAE', lat: 23.4, lng: 53.8, code: 'AE' },
  { name: 'Qatar', lat: 25.4, lng: 51.2, code: 'QA' },
  { name: 'Yemen', lat: 15.6, lng: 48.5, code: 'YE' },
  { name: 'Syria', lat: 35.0, lng: 38.0, code: 'SY' },
  { name: 'Jordan', lat: 30.6, lng: 36.2, code: 'JO' },
  { name: 'Lebanon', lat: 33.9, lng: 35.9, code: 'LB' },
  { name: 'Israel', lat: 31.0, lng: 34.9, code: 'IL' },
  { name: 'Turkey', lat: 38.9, lng: 35.2, code: 'TR' },
  { name: 'Egypt', lat: 26.8, lng: 30.8, code: 'EG' },
  { name: 'Libya', lat: 26.3, lng: 17.2, code: 'LY' },
  { name: 'Tunisia', lat: 33.9, lng: 9.5, code: 'TN' },
  { name: 'Algeria', lat: 28.0, lng: 1.7, code: 'DZ' },
  { name: 'Morocco', lat: 31.8, lng: -7.1, code: 'MA' },
  { name: 'Nigeria', lat: 9.1, lng: 8.7, code: 'NG' },
  { name: 'South Africa', lat: -30.6, lng: 22.9, code: 'ZA' },
  { name: 'Kenya', lat: -0.0, lng: 37.9, code: 'KE' },
  { name: 'Ethiopia', lat: 9.1, lng: 40.5, code: 'ET' },
  { name: 'Tanzania', lat: -6.4, lng: 34.9, code: 'TZ' },
  { name: 'Ghana', lat: 7.9, lng: -1.0, code: 'GH' },
  { name: 'Sudan', lat: 12.9, lng: 30.2, code: 'SD' },
  { name: 'DR Congo', lat: -4.0, lng: 21.8, code: 'CD' },
  { name: 'Somalia', lat: 5.2, lng: 46.2, code: 'SO' },
  { name: 'Mali', lat: 17.6, lng: -4.0, code: 'ML' },
  { name: 'Niger', lat: 17.6, lng: 8.1, code: 'NE' },
  { name: 'Chad', lat: 15.5, lng: 18.7, code: 'TD' },
  { name: 'Burkina Faso', lat: 12.2, lng: -1.6, code: 'BF' },
  { name: 'Australia', lat: -25.3, lng: 133.8, code: 'AU' },
  { name: 'New Zealand', lat: -40.9, lng: 174.9, code: 'NZ' },
  { name: 'Sri Lanka', lat: 7.9, lng: 80.8, code: 'LK' },
  { name: 'Nepal', lat: 28.4, lng: 84.1, code: 'NP' },
  { name: 'Georgia', lat: 42.3, lng: 43.4, code: 'GE' },
  { name: 'Armenia', lat: 40.1, lng: 45.0, code: 'AM' },
  { name: 'Azerbaijan', lat: 40.1, lng: 47.6, code: 'AZ' },
  { name: 'Honduras', lat: 15.2, lng: -86.2, code: 'HN' },
  { name: 'Nicaragua', lat: 12.9, lng: -85.2, code: 'NI' },
  { name: 'Ecuador', lat: -1.8, lng: -78.2, code: 'EC' },
  { name: 'Bolivia', lat: -16.3, lng: -63.6, code: 'BO' },
  { name: 'Paraguay', lat: -23.4, lng: -58.4, code: 'PY' },
  { name: 'Uruguay', lat: -32.5, lng: -55.8, code: 'UY' },
]

// ── Geo distance (Haversine) ─────────────────────────────────────────
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function findNearestCountry(lat: number, lng: number) {
  let best = COUNTRY_LABELS[0]
  let bestDist = Infinity
  for (const c of COUNTRY_LABELS) {
    const d = haversineKm(lat, lng, c.lat, c.lng)
    if (d < bestDist) { bestDist = d; best = c }
  }
  return best
}

// ── Color helpers ────────────────────────────────────────────────────
function getThreatSize(level: string): number {
  return ({ critical: 1.6, high: 1.3, medium: 1.0, low: 0.7, unknown: 0.5 } as Record<string, number>)[level] ?? 0.5
}

function getThreatColor(level: string): string {
  return ({ critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#3b82f6', unknown: '#6b7280' } as Record<string, string>)[level] ?? '#6b7280'
}

function getThreatBadgeClass(level: string): string {
  return ({ critical: 'bg-red-500/20 text-red-400 border border-red-500/50', high: 'bg-orange-500/20 text-orange-400 border border-orange-500/50', medium: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50', low: 'bg-blue-500/20 text-blue-400 border border-blue-500/50', unknown: 'bg-gray-500/20 text-gray-400 border border-gray-500/50' } as Record<string, string>)[level] ?? 'bg-gray-500/20 text-gray-400 border border-gray-500/50'
}

// ── Props ────────────────────────────────────────────────────────────
interface Props {
  events: GlobalEvent[]
  clusters: GeographicCluster[]
  instability: CountryInstability[]
  onEventClick?: (event: GlobalEvent) => void
  onCountryClick?: (country: { code: string; name: string; lat: number; lng: number }) => void
  autoRotate?: boolean
  showLabels?: boolean
}

// ── Component ────────────────────────────────────────────────────────
export default function GlobalMonitorGlobe({
  events, clusters, instability, onEventClick, onCountryClick, autoRotate, showLabels = true
}: Props) {
  const globeEl = useRef<HTMLDivElement>(null)
  const globeInstance = useRef<any>(null)
  const [Globe, setGlobe] = useState<any>(null)

  // Dynamically import globe.gl (client-side only)
  useEffect(() => {
    import('globe.gl').then(m => setGlobe(() => m.default))
  }, [])

  // 1. Setup Globe once
  useEffect(() => {
    if (!Globe || !globeEl.current || globeInstance.current) return

    const globe = Globe()(globeEl.current)
      // Globe texture
      .globeImageUrl('//unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
      .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
      .backgroundColor('rgba(0,0,0,0)')
      // Atmosphere
      .showAtmosphere(true)
      .atmosphereColor('#0ea5e9')
      .atmosphereAltitude(0.18)
      // Event points
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
          ${d.event.correlated_sectors?.length ? `<div style="margin-top:6px;font-size:9px;color:#64748b;">${d.event.correlated_sectors.slice(0,3).join(' · ')}</div>` : ''}
          <div style="margin-top:4px;font-size:8px;color:#475569;">Click for full analysis →</div>
        </div>
      `)
      .onPointClick((d: any) => { if (onEventClick) onEventClick(d.event) })
      // Rings (hotspots)
      .ringColor('color')
      .ringMaxRadius('maxR')
      .ringPropagationSpeed('propagationSpeed')
      .ringRepeatPeriod('repeatPeriod')
      .ringAltitude(0.003)
      // Arcs
      .arcColor('color')
      .arcDashLength(0.45)
      .arcDashGap(0.12)
      .arcDashInitialGap(() => Math.random())
      .arcDashAnimateTime(1800)
      .arcStroke(0.4)
      .arcAltitudeAutoScale(0.3)
      // Labels
      .labelsData(showLabels ? COUNTRY_LABELS : [])
      .labelLat((d: any) => d.lat)
      .labelLng((d: any) => d.lng)
      .labelText((d: any) => d.name)
      .labelSize(0.55)
      .labelDotRadius(0.3)
      .labelColor(() => 'rgba(148,163,184,0.7)')
      .labelResolution(2)
      .labelAltitude(0.006)
      // Globe click → country selection
      .onGlobeClick(({ lat, lng }: { lat: number; lng: number }) => {
        if (onCountryClick) {
          const country = findNearestCountry(lat, lng)
          onCountryClick(country)
        }
      })
      // HexBin (event density 3D columns)
      .hexBinPointsData([])
      .hexBinPointLat('lat')
      .hexBinPointLng('lng')
      .hexBinPointWeight('weight')
      .hexBinResolution(4)
      .hexMargin(0.3)
      .hexAltitude((d: any) => Math.min(0.12, d.sumWeight * 0.002))
      .hexTopColor((d: any) => {
        const w = d.sumWeight
        if (w >= 25) return 'rgba(239,68,68,0.85)'
        if (w >= 12) return 'rgba(249,115,22,0.75)'
        if (w >= 5) return 'rgba(234,179,8,0.65)'
        return 'rgba(59,130,246,0.5)'
      })
      .hexSideColor((d: any) => {
        const w = d.sumWeight
        if (w >= 25) return 'rgba(239,68,68,0.3)'
        if (w >= 12) return 'rgba(249,115,22,0.25)'
        if (w >= 5) return 'rgba(234,179,8,0.2)'
        return 'rgba(59,130,246,0.15)'
      })

    // Camera
    globe.camera().position.z = 260
    globeInstance.current = globe

    // Responsive resize
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
        try { globeInstance.current._destructor() } catch {}
      }
      globeInstance.current = null
    }
  }, [Globe])

  // 2. Update data
  useEffect(() => {
    if (!globeInstance.current) return
    const globe = globeInstance.current

    // Instability map for label colors
    const instabilityMap = new Map<string, number>()
    instability.forEach(c => instabilityMap.set(c.country_code, c.instability_index))

    // Country labels with risk-colored dots
    if (showLabels) {
      globe
        .labelsData(COUNTRY_LABELS)
        .labelColor((d: any) => {
          const idx = instabilityMap.get(d.code) ?? 0
          if (idx >= 75) return 'rgba(239,68,68,0.95)'
          if (idx >= 55) return 'rgba(249,115,22,0.9)'
          if (idx >= 35) return 'rgba(234,179,8,0.8)'
          if (idx >= 15) return 'rgba(99,179,237,0.65)'
          return 'rgba(148,163,184,0.55)'
        })
        .labelDotRadius((d: any) => {
          const idx = instabilityMap.get(d.code) ?? 0
          return idx >= 55 ? 0.5 : idx >= 35 ? 0.4 : 0.28
        })
    }

    // Event points
    globe.pointsData(
      events.map(event => ({
        lat: event.latitude,
        lng: event.longitude,
        size: getThreatSize(event.threat_level),
        color: getThreatColor(event.threat_level),
        event,
      }))
    )

    // Rings for hotspots
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
            const base = cluster.max_threat_level === 'critical' ? '239,68,68' : cluster.max_threat_level === 'high' ? '249,115,22' : '168,85,247'
            return `rgba(${base},${alpha * 0.7})`
          }
        }))
    )

    // Arcs: flight paths from aviation events + shipping events
    const arcEvents = events.filter(e =>
      (e.category === 'aviation' || e.category === 'shipping') &&
      e.latitude && e.longitude
    )

    const arcsData = arcEvents.map(event => {
      // Generate destination from raw_data if available, else offset
      const depLat = event.latitude
      const depLng = event.longitude
      const arrLat = event.raw_data?.arr_lat ?? (depLat + (Math.random() * 30 - 15))
      const arrLng = event.raw_data?.arr_lng ?? (depLng + (Math.random() * 40 - 20))
      const isAviation = event.category === 'aviation'
      return {
        startLat: depLat,
        startLng: depLng,
        endLat: arrLat,
        endLng: arrLng,
        color: isAviation
          ? ['rgba(147,197,253,0.9)', 'rgba(147,197,253,0.1)']
          : ['rgba(110,231,183,0.9)', 'rgba(110,231,183,0.1)'],
      }
    })

    // Add trade route arcs for high-impact economic events
    const economicHotspots = events.filter(e => e.category === 'economic' && (e.threat_level === 'critical' || e.threat_level === 'high'))
    economicHotspots.slice(0, 5).forEach(e => {
      arcsData.push({
        startLat: e.latitude,
        startLng: e.longitude,
        endLat: 40.7128, // New York
        endLng: -74.006,
        color: ['rgba(251,191,36,0.8)', 'rgba(251,191,36,0.05)'],
      })
    })

    globe.arcsData(arcsData)

    // HexBin: weight events by threat severity
    const hexData = events.map(e => ({
      lat: e.latitude,
      lng: e.longitude,
      weight:
        e.threat_level === 'critical' ? 10 :
        e.threat_level === 'high' ? 6 :
        e.threat_level === 'medium' ? 3 : 1,
    }))
    globe.hexBinPointsData(hexData)

  }, [events, clusters, instability, showLabels])

  // 3. Auto-rotate
  useEffect(() => {
    if (!globeInstance.current) return
    const ctrl = globeInstance.current.controls()
    ctrl.autoRotate = autoRotate ?? true
    ctrl.autoRotateSpeed = 0.4
    ctrl.enableZoom = true
  }, [autoRotate])

  if (!Globe) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-500 text-xs font-mono">Initializing globe...</p>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={globeEl}
      className="w-full h-full min-h-0 bg-slate-950 overflow-hidden"
      style={{ contain: 'layout paint' }}
    />
  )
}
