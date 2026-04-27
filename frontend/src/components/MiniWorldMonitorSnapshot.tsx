'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Globe2, Activity, Zap, ShieldAlert, BarChart3, Wind } from 'lucide-react'
import { CONTINENTS, filterGlobePointsForContinent, type Continent } from '@/lib/world-exchanges'

export default function MiniWorldMonitorSnapshot({ continent = 'global' }: { continent?: Continent }) {
  const globeRef = useRef<HTMLDivElement | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  // Use simple mobile detection matching the globe init
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  useEffect(() => {
    let cleanup: (() => void) | undefined
    let cancelled = false

    const setup = async () => {
      if (typeof window === 'undefined') return
      if (!globeRef.current) return

      try {
        const mod = await import('globe.gl')
        if (cancelled || !globeRef.current) return

        const Globe = mod.default
        cleanup = initGlobe(
          globeRef.current,
          Globe,
          filterGlobePointsForContinent(continent).map(({ continents: _c, ...p }) => p)
        )
      } catch (err) {
        console.error('Failed to load globe', err)
      }
    }

    void setup()

    return () => {
      cancelled = true
      if (cleanup) {
        cleanup()
      }
    }
  }, [continent])

  return (
    <div className="group relative flex h-full min-h-0 flex-col overflow-hidden hud-panel">
      {/* Decorative glow background */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-blue-500/10 via-sky-500/5 to-emerald-500/10" />
      <div className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-cyan-500/20 blur-[80px]" />
      <div className="pointer-events-none absolute -left-12 bottom-0 h-32 w-32 rounded-full bg-blue-500/10 blur-[60px]" />

      {/* Header — h-12 to align with dashboard watchlist / heatmap toolbars */}
      <div className="relative z-10 flex h-12 shrink-0 items-center justify-between border-b border-line-subtle/40 px-4 bg-surface-base/40 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-2">
          <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-500/30 bg-surface-base/90 shadow-md shadow-cyan-500/10">
            <Globe2 className="h-4 w-4 text-cyan-400" />
          </div>
          <h3 className="truncate text-sm font-bold tracking-tight text-white">
            {continent === 'global' ? 'Global' : CONTINENTS.find((c) => c.id === continent)?.label}{' '}
            Insights
          </h3>
          <span
            className="hidden shrink-0 sm:inline h-2 w-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"
            aria-hidden
          />
        </div>
        <div className="hidden items-center gap-1.5 rounded-md border border-line-subtle bg-surface-raised/50 px-2 py-1 md:flex">
          <Activity className="h-3 w-3 text-emerald-400" />
          <span className="text-[10px] font-mono text-emerald-300">MAP</span>
        </div>
      </div>

      {/* 3D Globe Container */}
      <div className="relative z-10 flex min-h-[240px] flex-1 flex-col items-center justify-center py-2 md:min-h-0 md:py-3">
        {/* Mobile Touch Overlay - Prevents scroll hijack on mobile */}
        {isMobile && (
          <div className="absolute inset-0 z-20 pointer-events-auto touch-pan-y" />
        )}

        <div className="relative w-full max-w-[320px] aspect-square">
          {/* Globe Glow Background */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] h-[90%] bg-blue-500/10 rounded-full blur-3xl -z-10"></div>
          
          <div className="w-full h-full overflow-hidden rounded-full border border-line-subtle shadow-[0_0_50px_rgba(14,165,233,0.15)] bg-surface-base/50 backdrop-blur-sm">
            <div
              ref={globeRef}
              className="w-full h-full" 
            />
          </div>

          {/* Floating Data Points (Mobile & Desktop) */}
          <div className="absolute top-4 left-0 animate-fade-in-up delay-75 pointer-events-none">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-base/80 border border-yellow-500/30 backdrop-blur-md shadow-lg transform -translate-x-4 md:translate-x-0">
              <Zap className="h-3 w-3 text-yellow-400" />
              <span className="text-[10px] font-bold text-yellow-100">Macro Events</span>
              <span className="text-[10px] bg-yellow-500/20 text-yellow-300 px-1 rounded">12</span>
            </div>
          </div>

          <div className="absolute bottom-8 right-0 animate-fade-in-up delay-150 pointer-events-none">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-base/80 border border-red-500/30 backdrop-blur-md shadow-lg transform translate-x-4 md:translate-x-0">
              <ShieldAlert className="h-3 w-3 text-red-400" />
              <span className="text-[10px] font-bold text-red-100">Risk Zones</span>
              <span className="text-[10px] bg-red-500/20 text-red-300 px-1 rounded">3</span>
            </div>
          </div>
        </div>
        
        {/* Mobile Instruction */}
        <div className="md:hidden absolute bottom-2 text-[10px] text-fg-muted flex items-center gap-1 opacity-60">
          <Globe2 className="w-3 h-3" />
          Tap full map to interact
        </div>
      </div>

      {/* Key Metrics Grid - Mobile Optimized */}
      <div className="relative z-10 grid grid-cols-3 gap-px border-t border-line-subtle/40 bg-surface-overlay/30">
        {[
          { label: 'Volatility', value: 'High', icon: Activity, color: 'text-orange-400' },
          { label: 'Sentiment', value: 'Bullish', icon: BarChart3, color: 'text-emerald-400' },
          { label: 'Weather', value: 'Clear', icon: Wind, color: 'text-sky-400' },
        ].map((metric) => (
          <div
            key={metric.label}
            className="group/metric flex flex-col items-center justify-center p-2 transition-colors hover:bg-white/5 md:p-2.5"
          >
            <metric.icon
              className={`mb-0.5 h-3.5 w-3.5 ${metric.color} opacity-70 transition-opacity group-hover/metric:opacity-100`}
            />
            <span className="text-[9px] font-medium uppercase tracking-wider text-fg-muted">{metric.label}</span>
            <span className="mt-0.5 text-[11px] font-bold text-slate-200">{metric.value}</span>
          </div>
        ))}
      </div>

      {/* Footer CTA */}
      <div className="relative z-10 border-t border-line-subtle/40 bg-surface-base/40 p-2 md:bg-transparent md:p-2.5">
        <Link
          href="/monitor"
          className="flex items-center justify-between gap-3 w-full group/btn p-1"
        >
          <div className="flex items-center gap-2 text-xs text-sky-300 group-hover/btn:text-sky-200 transition-colors">
            <div className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
            Launch Global Monitor
          </div>
          
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 text-[10px] font-medium group-hover/btn:bg-sky-500/20 transition-all">
            FULL ACCESS
            <svg className="w-3 h-3 transform group-hover/btn:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </Link>
      </div>
    </div>
  )
}

function initGlobe(
  container: HTMLDivElement,
  Globe: any,
  pointsData: { type: string; name: string; lat: number; lng: number; color: string }[]
) {
  // Clear any existing canvas
  while (container.firstChild) {
    container.removeChild(container.firstChild)
  }

  // Use function call pattern like GlobalMonitorGlobe
  const globe = Globe()(container)
    .width(container.clientWidth || 320)
    .height(container.clientHeight || 320)
    .backgroundColor('rgba(0,0,0,0)')
    // Use the colorful "Earth Blue Marble" texture
    .globeImageUrl('//unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
    .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
    .showAtmosphere(true)
    .atmosphereColor('#0ea5e9')
    .atmosphereAltitude(0.15)
    
  // Add financial points
  globe.pointsData(pointsData)
    .pointLat('lat')
    .pointLng('lng')
    .pointColor('color')
    .pointAltitude(0.01)
    .pointRadius(0.5)
    .pointResolution(16)
    .pointsMerge(false)

  // Auto-rotate
  globe.controls().autoRotate = true
  globe.controls().autoRotateSpeed = 0.5
  globe.controls().enableZoom = false

  const handleResize = () => {
    if (!container) return
    const w = container.clientWidth || 320
    const h = container.clientHeight || 320
    globe.width(w)
    globe.height(h)
  }

  window.addEventListener('resize', handleResize)

  return () => {
    window.removeEventListener('resize', handleResize)
    globe._destructor() // Clean up
    while (container.firstChild) {
      container.removeChild(container.firstChild)
    }
  }
}
