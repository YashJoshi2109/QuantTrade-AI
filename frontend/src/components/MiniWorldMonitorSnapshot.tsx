'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { Globe2 } from 'lucide-react'

type SignalType = 'exchange' | 'financial' | 'bank' | 'weather' | 'economic'

interface FinancialPoint {
  type: SignalType
  name: string
  lat: number
  lng: number
  color: string
}

const FINANCIAL_POINTS: FinancialPoint[] = [
  // Stock Exchanges
  { type: 'exchange', name: 'NYSE', lat: 40.7128, lng: -74.006, color: '#f59e0b' },
  { type: 'exchange', name: 'NASDAQ', lat: 40.758, lng: -73.9855, color: '#f59e0b' },
  { type: 'exchange', name: 'LSE', lat: 51.5074, lng: -0.1278, color: '#f59e0b' },
  { type: 'exchange', name: 'TSE', lat: 35.6762, lng: 139.6503, color: '#f59e0b' },
  { type: 'exchange', name: 'SSE', lat: 31.2304, lng: 121.4737, color: '#f59e0b' },
  { type: 'exchange', name: 'HKEX', lat: 22.3193, lng: 114.1694, color: '#f59e0b' },
  { type: 'exchange', name: 'Euronext', lat: 48.8566, lng: 2.3522, color: '#f59e0b' },
  { type: 'exchange', name: 'BSE', lat: 19.076, lng: 72.8777, color: '#f59e0b' },

  // Financial Centers
  { type: 'financial', name: 'London', lat: 51.5074, lng: -0.1278, color: '#06b6d4' },
  { type: 'financial', name: 'Singapore', lat: 1.3521, lng: 103.8198, color: '#06b6d4' },
  { type: 'financial', name: 'Hong Kong', lat: 22.3193, lng: 114.1694, color: '#06b6d4' },
  { type: 'financial', name: 'Zurich', lat: 47.3769, lng: 8.5417, color: '#06b6d4' },
  { type: 'financial', name: 'Frankfurt', lat: 50.1109, lng: 8.6821, color: '#06b6d4' },
  { type: 'financial', name: 'Dubai', lat: 25.2048, lng: 55.2708, color: '#06b6d4' },
  { type: 'financial', name: 'Sydney', lat: -33.8688, lng: 151.2093, color: '#06b6d4' },

  // Central Banks
  { type: 'bank', name: 'Federal Reserve', lat: 38.8937, lng: -77.0465, color: '#3b82f6' },
  { type: 'bank', name: 'ECB', lat: 50.1109, lng: 8.6821, color: '#3b82f6' },
  { type: 'bank', name: 'Bank of Japan', lat: 35.6762, lng: 139.6503, color: '#3b82f6' },
  { type: 'bank', name: 'Bank of England', lat: 51.5142, lng: -0.0931, color: '#3b82f6' },
  { type: 'bank', name: 'PBoC', lat: 39.9042, lng: 116.4074, color: '#3b82f6' },
  { type: 'bank', name: 'Swiss National Bank', lat: 46.948, lng: 7.4474, color: '#3b82f6' },

  // Weather Alerts (simulated)
  { type: 'weather', name: 'Hurricane Alert', lat: 25.7617, lng: -80.1918, color: '#ef4444' },
  { type: 'weather', name: 'Typhoon Warning', lat: 14.5995, lng: 120.9842, color: '#ef4444' },
  { type: 'weather', name: 'Flooding', lat: 51.5074, lng: -0.1278, color: '#ef4444' },

  // Economic Centers
  { type: 'economic', name: 'Silicon Valley', lat: 37.3861, lng: -122.0839, color: '#10b981' },
  { type: 'economic', name: 'Shenzhen', lat: 22.5431, lng: 114.0579, color: '#10b981' },
  { type: 'economic', name: 'Tel Aviv', lat: 32.0853, lng: 34.7818, color: '#10b981' },
  { type: 'economic', name: 'Bangalore', lat: 12.9716, lng: 77.5946, color: '#10b981' },
]

export default function MiniWorldMonitorSnapshot() {
  const globeRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cleanup: (() => void) | undefined
    let cancelled = false

    const setup = async () => {
      if (typeof window === 'undefined') return
      if (!globeRef.current) return

      const mod: any = await import('globe.gl')
      if (cancelled || !globeRef.current) return

      const Globe = (mod.default ?? mod) as any
      cleanup = initGlobe(globeRef.current, Globe)
    }

    void setup()

    return () => {
      cancelled = true
      if (cleanup) {
        cleanup()
      }
    }
  }, [])

  return (
    <div className="hud-panel h-full flex flex-col relative overflow-hidden">
      {/* Decorative glow background */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-blue-500/10 via-sky-500/5 to-emerald-500/10" />
      <div className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-cyan-500/15 blur-3xl" />

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between border-b border-slate-700/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900/80 border border-cyan-500/30">
            <Globe2 className="h-4 w-4 text-cyan-300" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-white">
              Sanctions, weather, and macro alerts
            </span>
          </div>
        </div> 
      </div>

      {/* 3D Globe */}
      <div className="relative z-10 px-4 pb-4 pt-4">
        <div className="flex items-center justify-center w-full">
          <div className="relative w-full max-w-[320px] aspect-square overflow-hidden rounded-xl border border-white/5 bg-gradient-to-tr from-[#040713] via-[#050A18] to-[#020617]">
            <div
              ref={globeRef}
              className="absolute inset-0"
            />
          </div>
        </div>
      </div>

      {/* Footer CTA */}
      <div className="relative z-10 border-t border-slate-700/40 p-3">
        <Link
          href="/monitor"
          className="flex items-center justify-between gap-2 rounded-lg bg-gradient-to-r from-blue-500/15 to-cyan-500/20 px-3 py-2 text-[11px] font-medium text-sky-100 hover:from-blue-500/25 hover:to-cyan-500/25 transition-colors"
        >
          <span>Open full global map</span>
          <span className="text-[10px] text-cyan-300 font-mono">UNDER WORK &rarr;</span>
        </Link>
      </div>
    </div>
  )
}

function initGlobe(container: HTMLDivElement, Globe: any) {
  // Clear any existing canvas
  while (container.firstChild) {
    container.removeChild(container.firstChild)
  }

  const globe = new Globe(container, {
    rendererConfig: { antialias: true, alpha: true },
    // render immediately; don't block on texture load
    waitForGlobeReady: false,
    animateIn: true,
  })

  globe
    // dimensions
    .width(container.clientWidth || 260)
    .height(container.clientHeight || 260)
    // background + textures
    .backgroundColor('rgba(0,0,0,0)')
    .globeImageUrl('//unpkg.com/three-globe/example/img/earth-dark.jpg')
    .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
    // atmosphere + grid
    .showAtmosphere(true)
    .atmosphereColor('#38bdf8')
    .atmosphereAltitude(0.15)
    .showGraticules(true)
    .graticulesColor('#1e293b')
    // points – set IMMEDIATELY and clearly
    .pointsData(FINANCIAL_POINTS)
    .pointLat('lat')
    .pointLng('lng')
    .pointColor('color')
    .pointAltitude(0.01)   // just above surface
    .pointRadius(0.4)      // make markers big and obvious
    .pointResolution(16)
    .pointsMerge(false)    // don't merge so we can see each point
    // pointer interaction
    .enablePointerInteraction(true)
    .showPointerCursor(true)

  // Slight initial spin + slow auto-rotate for a command-center feel
  globe.pointOfView({ lat: 20, lng: 0, altitude: 2.5 }, 0)

  // Configure controls once they're ready
  setTimeout(() => {
    try {
      const controls = globe.controls()
      if (controls) {
        controls.enablePan = false
        controls.autoRotate = true
        controls.autoRotateSpeed = 0.3
        controls.update()
      }
    } catch {
      // ignore if controls not yet ready
    }
  }, 100)

  const handleResize = () => {
    if (!container) return
    const w = container.clientWidth || 260
    const h = container.clientHeight || 260
    globe.width(w)
    globe.height(h)
  }

  window.addEventListener('resize', handleResize)

  return () => {
    window.removeEventListener('resize', handleResize)
    if (typeof globe._destructor === 'function') {
      globe._destructor()
    }
    while (container.firstChild) {
      container.removeChild(container.firstChild)
    }
  }
}
