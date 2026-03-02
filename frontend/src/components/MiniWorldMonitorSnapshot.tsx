'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Globe2, Activity, Zap, ShieldAlert, BarChart3, Wind } from 'lucide-react'

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
        cleanup = initGlobe(globeRef.current, Globe)
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
  }, [])

  return (
    <div className="hud-panel h-full flex flex-col relative overflow-hidden group">
      {/* Decorative glow background */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-blue-500/10 via-sky-500/5 to-emerald-500/10" />
      <div className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-cyan-500/20 blur-[80px]" />
      <div className="pointer-events-none absolute -left-12 bottom-0 h-32 w-32 rounded-full bg-blue-500/10 blur-[60px]" />

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between border-b border-slate-700/40 px-4 py-3 bg-slate-900/40 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 bg-cyan-500/20 blur-sm rounded-full animate-pulse"></div>
            <div className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900/90 border border-cyan-500/30 shadow-lg shadow-cyan-500/10">
              <Globe2 className="h-4 w-4 text-cyan-400" />
            </div>
          </div>
          <div className="flex flex-col">
            <h3 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
              Global Insights
              <span className="flex h-2 w-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]"></span>
            </h3>
            <span className="text-[10px] font-medium text-cyan-300/80 tracking-wide uppercase">
              Live Market Intelligence
            </span>
          </div>
        </div>
        
        {/* Mobile-friendly Stats Badge */}
        <div className="hidden md:flex items-center gap-2 px-2 py-1 rounded-lg bg-slate-800/50 border border-slate-700/50">
          <Activity className="h-3 w-3 text-emerald-400" />
          <span className="text-[10px] font-mono text-emerald-300">ACTIVE</span>
        </div>
      </div>

      {/* 3D Globe Container */}
      <div className="relative z-10 flex-1 min-h-[280px] md:min-h-[auto] flex flex-col justify-center items-center py-4">
        {/* Mobile Touch Overlay - Prevents scroll hijack on mobile */}
        {isMobile && (
          <div className="absolute inset-0 z-20 pointer-events-auto touch-pan-y" />
        )}

        <div className="relative w-full max-w-[320px] aspect-square">
          {/* Globe Glow Background */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] h-[90%] bg-blue-500/10 rounded-full blur-3xl -z-10"></div>
          
          <div className="w-full h-full overflow-hidden rounded-full border border-white/5 shadow-[0_0_50px_rgba(14,165,233,0.15)] bg-slate-950/50 backdrop-blur-sm">
            <div
              ref={globeRef}
              className="w-full h-full" 
            />
          </div>

          {/* Floating Data Points (Mobile & Desktop) */}
          <div className="absolute top-4 left-0 animate-fade-in-up delay-75 pointer-events-none">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/80 border border-yellow-500/30 backdrop-blur-md shadow-lg transform -translate-x-4 md:translate-x-0">
              <Zap className="h-3 w-3 text-yellow-400" />
              <span className="text-[10px] font-bold text-yellow-100">Macro Events</span>
              <span className="text-[10px] bg-yellow-500/20 text-yellow-300 px-1 rounded">12</span>
            </div>
          </div>

          <div className="absolute bottom-8 right-0 animate-fade-in-up delay-150 pointer-events-none">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/80 border border-red-500/30 backdrop-blur-md shadow-lg transform translate-x-4 md:translate-x-0">
              <ShieldAlert className="h-3 w-3 text-red-400" />
              <span className="text-[10px] font-bold text-red-100">Risk Zones</span>
              <span className="text-[10px] bg-red-500/20 text-red-300 px-1 rounded">3</span>
            </div>
          </div>
        </div>
        
        {/* Mobile Instruction */}
        <div className="md:hidden absolute bottom-2 text-[10px] text-slate-500 flex items-center gap-1 opacity-60">
          <Globe2 className="w-3 h-3" />
          Tap full map to interact
        </div>
      </div>

      {/* Key Metrics Grid - Mobile Optimized */}
      <div className="relative z-10 grid grid-cols-3 gap-px bg-slate-700/30 border-t border-slate-700/40">
        {[
          { label: 'Volatility', value: 'High', icon: Activity, color: 'text-orange-400' },
          { label: 'Sentiment', value: 'Bullish', icon: BarChart3, color: 'text-emerald-400' },
          { label: 'Weather', value: 'Clear', icon: Wind, color: 'text-sky-400' },
        ].map((metric, i) => (
          <div key={metric.label} className="flex flex-col items-center justify-center p-3 hover:bg-white/5 transition-colors group/metric">
            <metric.icon className={`h-4 w-4 ${metric.color} mb-1 opacity-70 group-hover/metric:opacity-100 transition-opacity`} />
            <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">{metric.label}</span>
            <span className={`text-xs font-bold text-slate-200 mt-0.5`}>{metric.value}</span>
          </div>
        ))}
      </div>

      {/* Footer CTA */}
      <div className="relative z-10 border-t border-slate-700/40 p-3 bg-slate-900/40 md:bg-transparent">
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

function initGlobe(container: HTMLDivElement, Globe: any) {
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
  globe.pointsData(FINANCIAL_POINTS)
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
