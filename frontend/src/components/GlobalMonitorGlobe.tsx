/**
 * Global Monitor 3D Globe Visualization
 * Uses Three.js and globe.gl for interactive earth with event markers
 * Country labels + conflict/event data overlaid
 */
'use client'

import { useEffect, useRef, useState } from 'react'
import { GlobalEvent, GeographicCluster, CountryInstability } from '@/lib/global-monitor-api'

// ── Country label data (lat/lng for every sovereign state) ──────────
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
  { name: 'Ecuador', lat: -1.8, lng: -78.2, code: 'EC' },
  { name: 'Bolivia', lat: -16.3, lng: -63.6, code: 'BO' },
  { name: 'Paraguay', lat: -23.4, lng: -58.4, code: 'PY' },
  { name: 'Uruguay', lat: -32.5, lng: -55.8, code: 'UY' },
  { name: 'Guyana', lat: 5.0, lng: -59.0, code: 'GY' },
  { name: 'Suriname', lat: 4.0, lng: -56.0, code: 'SR' },
  { name: 'Cuba', lat: 21.5, lng: -77.8, code: 'CU' },
  { name: 'Jamaica', lat: 18.1, lng: -77.3, code: 'JM' },
  { name: 'Haiti', lat: 19.1, lng: -72.3, code: 'HT' },
  { name: 'Dominican Rep.', lat: 18.7, lng: -70.2, code: 'DO' },
  { name: 'Panama', lat: 8.5, lng: -80.8, code: 'PA' },
  { name: 'Costa Rica', lat: 9.7, lng: -84.0, code: 'CR' },
  { name: 'Guatemala', lat: 15.8, lng: -90.2, code: 'GT' },
  { name: 'Honduras', lat: 15.2, lng: -86.2, code: 'HN' },
  { name: 'Nicaragua', lat: 12.9, lng: -85.2, code: 'NI' },
  { name: 'El Salvador', lat: 13.8, lng: -88.9, code: 'SV' },
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
  { name: 'Czech Republic', lat: 49.8, lng: 15.5, code: 'CZ' },
  { name: 'Sweden', lat: 60.1, lng: 18.6, code: 'SE' },
  { name: 'Norway', lat: 60.5, lng: 8.5, code: 'NO' },
  { name: 'Finland', lat: 61.9, lng: 25.7, code: 'FI' },
  { name: 'Denmark', lat: 56.3, lng: 9.5, code: 'DK' },
  { name: 'Ireland', lat: 53.1, lng: -8.2, code: 'IE' },
  { name: 'Greece', lat: 39.1, lng: 21.8, code: 'GR' },
  { name: 'Romania', lat: 45.9, lng: 25.0, code: 'RO' },
  { name: 'Hungary', lat: 47.2, lng: 19.5, code: 'HU' },
  { name: 'Bulgaria', lat: 42.7, lng: 25.5, code: 'BG' },
  { name: 'Slovakia', lat: 48.7, lng: 19.7, code: 'SK' },
  { name: 'Croatia', lat: 45.1, lng: 15.2, code: 'HR' },
  { name: 'Serbia', lat: 44.0, lng: 21.0, code: 'RS' },
  { name: 'Ukraine', lat: 48.4, lng: 31.2, code: 'UA' },
  { name: 'Belarus', lat: 53.7, lng: 27.9, code: 'BY' },
  { name: 'Lithuania', lat: 55.2, lng: 23.9, code: 'LT' },
  { name: 'Latvia', lat: 56.9, lng: 24.1, code: 'LV' },
  { name: 'Estonia', lat: 58.6, lng: 25.0, code: 'EE' },
  { name: 'Iceland', lat: 64.1, lng: -21.9, code: 'IS' },
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
  { name: 'Uzbekistan', lat: 41.4, lng: 64.6, code: 'UZ' },
  { name: 'Afghanistan', lat: 33.9, lng: 67.7, code: 'AF' },
  { name: 'Iran', lat: 32.4, lng: 53.7, code: 'IR' },
  { name: 'Iraq', lat: 33.2, lng: 43.7, code: 'IQ' },
  { name: 'Saudi Arabia', lat: 23.9, lng: 45.1, code: 'SA' },
  { name: 'UAE', lat: 23.4, lng: 53.8, code: 'AE' },
  { name: 'Qatar', lat: 25.4, lng: 51.2, code: 'QA' },
  { name: 'Kuwait', lat: 29.3, lng: 47.5, code: 'KW' },
  { name: 'Oman', lat: 21.5, lng: 55.9, code: 'OM' },
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
  { name: 'Cameroon', lat: 7.4, lng: 12.4, code: 'CM' },
  { name: 'Ivory Coast', lat: 7.5, lng: -5.5, code: 'CI' },
  { name: 'Senegal', lat: 14.5, lng: -14.5, code: 'SN' },
  { name: 'Sudan', lat: 12.9, lng: 30.2, code: 'SD' },
  { name: 'DR Congo', lat: -4.0, lng: 21.8, code: 'CD' },
  { name: 'Angola', lat: -11.2, lng: 17.9, code: 'AO' },
  { name: 'Mozambique', lat: -18.7, lng: 35.5, code: 'MZ' },
  { name: 'Madagascar', lat: -18.8, lng: 46.9, code: 'MG' },
  { name: 'Zimbabwe', lat: -19.0, lng: 29.2, code: 'ZW' },
  { name: 'Uganda', lat: 1.4, lng: 32.3, code: 'UG' },
  { name: 'Mali', lat: 17.6, lng: -4.0, code: 'ML' },
  { name: 'Niger', lat: 17.6, lng: 8.1, code: 'NE' },
  { name: 'Chad', lat: 15.5, lng: 18.7, code: 'TD' },
  { name: 'Somalia', lat: 5.2, lng: 46.2, code: 'SO' },
  { name: 'Rwanda', lat: -1.9, lng: 29.9, code: 'RW' },
  { name: 'Burkina Faso', lat: 12.2, lng: -1.6, code: 'BF' },
  { name: 'Australia', lat: -25.3, lng: 133.8, code: 'AU' },
  { name: 'New Zealand', lat: -40.9, lng: 174.9, code: 'NZ' },
  { name: 'Papua New Guinea', lat: -6.3, lng: 143.9, code: 'PG' },
  { name: 'Fiji', lat: -17.7, lng: 178.0, code: 'FJ' },
  { name: 'Sri Lanka', lat: 7.9, lng: 80.8, code: 'LK' },
  { name: 'Nepal', lat: 28.4, lng: 84.1, code: 'NP' },
  { name: 'Cambodia', lat: 12.6, lng: 105.0, code: 'KH' },
  { name: 'Laos', lat: 19.9, lng: 102.5, code: 'LA' },
  { name: 'Georgia', lat: 42.3, lng: 43.4, code: 'GE' },
  { name: 'Armenia', lat: 40.1, lng: 45.0, code: 'AM' },
  { name: 'Azerbaijan', lat: 40.1, lng: 47.6, code: 'AZ' },
]

interface Props {
  events: GlobalEvent[]
  clusters: GeographicCluster[]
  instability: CountryInstability[]
  onEventClick?: (event: GlobalEvent) => void
  autoRotate?: boolean
  showLabels?: boolean
}

export default function GlobalMonitorGlobe({ events, clusters, instability, onEventClick, autoRotate, showLabels = true }: Props) {
  const globeEl = useRef<any>()
  const globeInstance = useRef<any>(null)
  const [Globe, setGlobe] = useState<any>(null)

  // Dynamically import globe.gl (client-side only)
  useEffect(() => {
    import('globe.gl').then((module) => {
      setGlobe(() => module.default)
    })
  }, [])

  // 1. Setup Globe once
  useEffect(() => {
    if (!Globe || !globeEl.current || globeInstance.current) return

    const globe = Globe()(globeEl.current)
      .globeImageUrl('//unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
      .backgroundColor('rgba(0,0,0,0)')
      .showAtmosphere(true)
      .atmosphereColor('#0ea5e9')
      .atmosphereAltitude(0.15)
      .pointAltitude(0.01)
      .pointRadius('size')
      .pointColor('color')
      .pointLabel((d: any) => `
        <div class="bg-slate-900 text-white p-3 rounded-lg shadow-xl border border-sky-500/30 max-w-xs">
          <div class="font-bold text-sm">${d.event.title}</div>
          <div class="text-xs text-slate-400 mt-1">${d.event.location_name || 'Unknown'}</div>
          <div class="text-xs mt-2">
            <span class="px-2 py-1 rounded ${getThreatBadgeClass(d.event.threat_level)}">
              ${d.event.threat_level.toUpperCase()}
            </span>
          </div>
        </div>
      `)
      .onPointClick((d: any) => {
        if (onEventClick) {
          onEventClick(d.event)
        }
      })
      .ringColor('color')
      .ringMaxRadius('maxR')
      .ringPropagationSpeed('propagationSpeed')
      .ringRepeatPeriod('repeatPeriod')
      // Country labels configuration
      .labelsData(showLabels ? COUNTRY_LABELS : [])
      .labelLat((d: any) => d.lat)
      .labelLng((d: any) => d.lng)
      .labelText((d: any) => d.name)
      .labelSize(0.6)
      .labelDotRadius(0.35)
      .labelColor(() => 'rgba(148, 163, 184, 0.75)')
      .labelResolution(2)
      .labelAltitude(0.005)

    // Zoom out: larger z = globe appears smaller (reduced zoom)
    globe.camera().position.z = 280;

    globeInstance.current = globe

    // Responsive sizing – clamp height so the canvas never grows excessively tall
    const handleResize = () => {
      if (!globeEl.current || !globeInstance.current) return

      const el = globeEl.current as HTMLElement
      const parent = el.parentElement as HTMLElement | null

      const width = el.offsetWidth || parent?.clientWidth || 800
      const rawHeight = parent?.clientHeight || el.offsetHeight || Math.round(width * 0.5)

      // Clamp logical height between 220px and 360px so the globe stays compact.
      // three-globe will scale for devicePixelRatio internally.
      const logicalHeight = Math.max(220, Math.min(rawHeight, 360))

      globeInstance.current.width(width).height(logicalHeight)
    }
    handleResize()
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (globeInstance.current) {
        try {
          globeInstance.current._destructor()
        } catch (e) {}
      }
    }
  }, [Globe]) // Run once when Globe library loads

  // 2. Update Data without destroying
  useEffect(() => {
    if (!globeInstance.current) return

    const globe = globeInstance.current

    // Build a set of instability countries for label coloring
    const instabilityMap = new Map<string, string>()
    instability.forEach(c => {
      if (c.instability_index >= 80) instabilityMap.set(c.country_code, 'critical')
      else if (c.instability_index >= 60) instabilityMap.set(c.country_code, 'high')
      else if (c.instability_index >= 40) instabilityMap.set(c.country_code, 'medium')
    })

    // Update labels with instability colors
    if (showLabels) {
      globe.labelsData(COUNTRY_LABELS)
        .labelColor((d: any) => {
          const risk = instabilityMap.get(d.code)
          if (risk === 'critical') return 'rgba(239, 68, 68, 0.9)'
          if (risk === 'high') return 'rgba(249, 115, 22, 0.85)'
          if (risk === 'medium') return 'rgba(234, 179, 8, 0.7)'
          return 'rgba(148, 163, 184, 0.6)'
        })
    }

    // Add event markers as points
    globe.pointsData(events.map(event => ({
      lat: event.latitude,
      lng: event.longitude,
      size: getThreatSize(event.threat_level),
      color: getThreatColor(event.threat_level),
      event
    })))

    // Add hotspot markers as rings
    globe.ringsData(clusters.filter(c => c.is_hotspot).map(cluster => ({
      lat: cluster.cell_lat,
      lng: cluster.cell_lon,
      maxR: 2,
      propagationSpeed: 1,
      repeatPeriod: 2000,
      color: 'rgba(168, 85, 247, 0.5)' // Purple for hotspots
    })))

    // Flight paths from Aviation events (using arcs)
    const flightEvents = events.filter(e => e.category === 'aviation' && e.raw_data && e.raw_data.departure && e.raw_data.arrival)
    const arcsData = flightEvents.map(event => {
      return {
        startLat: event.latitude,
        startLng: event.longitude,
        endLat: event.latitude + (Math.random() * 20 - 10),
        endLng: event.longitude + (Math.random() * 20 - 10),
        color: ['rgba(255, 255, 255, 0.8)', 'rgba(56, 189, 248, 0.1)']
      }
    })
    globe.arcsData(arcsData)
      .arcColor('color')
      .arcDashLength(0.4)
      .arcDashGap(0.1)
      .arcDashInitialGap(() => Math.random())
      .arcDashAnimateTime(1500)

  }, [events, clusters, instability, showLabels]) // Update on data changes

  // 3. Handle Auto Rotate independently so we don't reset data
  useEffect(() => {
    if (!globeInstance.current) return
    const controls = globeInstance.current.controls()
    controls.autoRotate = autoRotate ?? true
    controls.autoRotateSpeed = 0.5
  }, [autoRotate])

  if (!Globe) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-950">
        <div className="text-slate-400">Loading globe...</div>
      </div>
    )
  }

  return (
    <div 
      ref={globeEl} 
      className="w-full h-full min-h-0 bg-slate-950 overflow-hidden isolate"
      style={{ contain: 'layout paint' }}
    />
  )
}

function getThreatSize(level: string): number {
  const sizes = {
    critical: 1.5,
    high: 1.2,
    medium: 0.9,
    low: 0.6,
    unknown: 0.5
  }
  return sizes[level as keyof typeof sizes] || 0.5
}

function getThreatColor(level: string): string {
  const colors = {
    critical: '#ef4444', // red
    high: '#f97316',    // orange
    medium: '#eab308',  // yellow
    low: '#3b82f6',     // blue
    unknown: '#6b7280'  // gray
  }
  return colors[level as keyof typeof colors] || '#6b7280'
}

function getThreatBadgeClass(level: string): string {
  const classes = {
    critical: 'bg-red-500/20 text-red-400 border border-red-500/50',
    high: 'bg-orange-500/20 text-orange-400 border border-orange-500/50',
    medium: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50',
    low: 'bg-blue-500/20 text-blue-400 border border-blue-500/50',
    unknown: 'bg-gray-500/20 text-gray-400 border border-gray-500/50'
  }
  return classes[level as keyof typeof classes] || classes.unknown
}
