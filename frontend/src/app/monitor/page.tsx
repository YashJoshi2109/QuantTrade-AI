'use client'

import { useState, useMemo, Suspense, lazy } from 'react'
import { useQuery } from '@tanstack/react-query'
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import {
  Globe,
  Activity,
  AlertTriangle,
  TrendingDown,
  Zap,
  Filter,
  RefreshCw,
  Maximize2,
  Minimize2,
  ChevronDown,
} from 'lucide-react'
import { fetchMapData, fetchMonitorStats, type MapData, type MonitorStats, type GlobalEvent } from '@/lib/global-monitor-api'

// Lazy load heavy components
const GlobalMonitorGlobe = lazy(() => import('@/components/GlobalMonitorGlobe'))
const TickerImpactDrawer = lazy(() => import('@/components/TickerImpactDrawer'))

// Lazy load all panel components
const MarketRadarPanel = lazy(() => import('@/components/monitor/MarketRadarPanel'))
const EconomicIndicatorsPanel = lazy(() => import('@/components/monitor/EconomicIndicatorsPanel'))
const TradePolicyPanel = lazy(() => import('@/components/monitor/TradePolicyPanel'))
const ContinentNewsFeedGrid = lazy(() => import('@/components/monitor/ContinentNewsFeedGrid'))
const WorldClockWidget = lazy(() => import('@/components/monitor/WorldClockWidget'))
const PolymarketFinancePanel = lazy(() => import('@/components/monitor/PolymarketFinancePanel'))
const StrategicRiskPanel = lazy(() => import('@/components/monitor/StrategicRiskPanel'))
const CommoditiesWidget = lazy(() => import('@/components/monitor/CommoditiesWidget'))
const SecurityAdvisoriesPanel = lazy(() => import('@/components/monitor/SecurityAdvisoriesPanel'))
const LiveEventsFeed = lazy(() => import('@/components/monitor/LiveEventsFeed'))

// Shimmer placeholder while panels load
function PanelShimmer({ height = 'h-48' }: { height?: string }) {
  return (
    <div className={`${height} bg-slate-900/50 rounded-xl border border-slate-800/40 animate-pulse flex items-center justify-center`}>
      <div className="w-6 h-6 border-2 border-slate-700 border-t-sky-500 rounded-full animate-spin" />
    </div>
  )
}

// ─── Desktop Bloomberg Terminal Layout ──────────────────────────────────

function MonitorDesktop() {
  const [selectedEvent, setSelectedEvent] = useState<GlobalEvent | null>(null)
  const [timeWindow, setTimeWindow] = useState(24)
  const [showFilters, setShowFilters] = useState(false)
  const [globeExpanded, setGlobeExpanded] = useState(false)

  const threatLevels = [
    { value: 'critical', label: 'Critical', color: 'text-red-500', bg: 'bg-red-500/20 border-red-500' },
    { value: 'high', label: 'High', color: 'text-orange-500', bg: 'bg-orange-500/20 border-orange-500' },
    { value: 'medium', label: 'Medium', color: 'text-yellow-500', bg: 'bg-yellow-500/20 border-yellow-500' },
    { value: 'low', label: 'Low', color: 'text-blue-500', bg: 'bg-blue-500/20 border-blue-500' },
    { value: 'unknown', label: 'Monitoring', color: 'text-gray-500', bg: 'bg-gray-500/20 border-gray-500' },
  ]

  const categories = [
    { value: 'conflict', label: 'Conflict', icon: '⚔️' },
    { value: 'political', label: 'Political', icon: '🏛️' },
    { value: 'disaster', label: 'Disaster', icon: '🌊' },
    { value: 'aviation', label: 'Aviation', icon: '✈️' },
    { value: 'shipping', label: 'Shipping', icon: '🚢' },
    { value: 'cyber', label: 'Cyber', icon: '🔒' },
    { value: 'economic', label: 'Economic', icon: '💰' },
    { value: 'climate', label: 'Climate', icon: '🌡️' },
  ]

  const [activeThreats, setActiveThreats] = useState<Set<string>>(new Set(threatLevels.map(t => t.value)))
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set(categories.map(c => c.value)))
  const [autoRotate, setAutoRotate] = useState(true)

  const { data: mapData, isLoading, refetch } = useQuery<MapData>({
    queryKey: ['monitor-map-data', timeWindow],
    queryFn: () => fetchMapData(timeWindow, true),
    refetchInterval: 60000,
    staleTime: 30000,
  })

  const { data: stats } = useQuery<MonitorStats>({
    queryKey: ['monitor-stats'],
    queryFn: fetchMonitorStats,
    refetchInterval: 60000,
  })

  const filteredEvents = useMemo(() => {
    return (mapData?.events || []).filter(event => {
      if (!activeThreats.has(event.threat_level || 'unknown')) return false
      if (event.category && !activeCategories.has(event.category)) return false
      return true
    })
  }, [mapData, activeThreats, activeCategories])

  const toggleThreat = (val: string) => {
    const next = new Set(activeThreats)
    next.has(val) ? next.delete(val) : next.add(val)
    setActiveThreats(next)
  }
  const toggleCategory = (val: string) => {
    const next = new Set(activeCategories)
    next.has(val) ? next.delete(val) : next.add(val)
    setActiveCategories(next)
  }

  const handleEventClick = (event: GlobalEvent) => {
    setSelectedEvent(event)
    setAutoRotate(false)
  }

  return (
    <AppLayout>
      <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col -mx-4 md:-mx-6 -my-4 md:-my-6">
        {/* ─── TOP BAR: World Clock + Stats ────────────────────── */}
        <div className="border-b border-slate-800/50 bg-slate-950/95 backdrop-blur-md sticky top-0 z-30 shrink-0">
          {/* World Clock Row */}
          <div className="border-b border-slate-800/30 px-4 py-2 flex justify-center">
            <Suspense fallback={<div className="h-8" />}>
              <WorldClockWidget />
            </Suspense>
          </div>

          {/* Title + Controls */}
          <div className="px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Globe className="w-6 h-6 text-sky-400" />
                <h1 className="text-lg font-bold text-slate-100">Global Monitor</h1>
                {isLoading && <RefreshCw className="w-3.5 h-3.5 text-sky-400 animate-spin" />}
                <span className="hidden xl:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[9px] text-emerald-400 font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> LIVE
                </span>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={timeWindow}
                  onChange={(e) => setTimeWindow(Number(e.target.value))}
                  className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-sky-500 font-mono"
                >
                  <option value={1}>1H</option>
                  <option value={6}>6H</option>
                  <option value={24}>24H</option>
                  <option value={72}>3D</option>
                  <option value={168}>1W</option>
                </select>

                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs flex items-center gap-1.5 transition-colors"
                >
                  <Filter className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Filters</span>
                  {(activeThreats.size < threatLevels.length || activeCategories.size < categories.length) && (
                    <span className="w-1.5 h-1.5 bg-sky-500 rounded-full" />
                  )}
                </button>

                <button
                  onClick={() => refetch()}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs flex items-center gap-1.5 transition-colors"
                  title="Refresh"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => setAutoRotate(r => !r)}
                  className={`px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 border transition-colors ${
                    autoRotate
                      ? 'bg-slate-800 border-sky-600 text-sky-300'
                      : 'bg-slate-900 border-slate-700 text-slate-400'
                  }`}
                  title="Auto-rotate globe"
                >
                  <Activity className={`w-3.5 h-3.5 ${autoRotate ? 'text-sky-400' : ''}`} />
                </button>
              </div>
            </div>

            {/* Stats strip */}
            {mapData && (
              <div className="mt-2.5 grid grid-cols-6 gap-2">
                {[
                  { label: 'Events', value: mapData.stats.total_events, color: 'text-slate-50', border: 'border-slate-700/50' },
                  { label: 'Critical', value: mapData.stats.critical_events, color: 'text-red-500', border: 'border-red-900/30' },
                  { label: 'High Threat', value: mapData.stats.high_threat_events, color: 'text-orange-500', border: 'border-orange-900/30' },
                  { label: 'Hotspots', value: mapData.stats.total_hotspots, color: 'text-purple-500', border: 'border-purple-900/30' },
                  { label: 'High Risk', value: mapData.stats.high_risk_countries, color: 'text-yellow-500', border: 'border-yellow-900/30' },
                  { label: 'Anomalies', value: mapData.stats.anomalies_detected, color: 'text-sky-500', border: 'border-sky-900/30' },
                ].map((stat) => (
                  <div key={stat.label} className={`bg-slate-800/40 rounded-lg px-3 py-2 border ${stat.border}`}>
                    <div className="text-[9px] text-slate-500 uppercase tracking-wider">{stat.label}</div>
                    <div className={`text-xl font-bold ${stat.color} font-mono`}>{stat.value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Expandable Filters */}
            {showFilters && (
              <div className="mt-3 p-3 bg-slate-800/40 rounded-lg border border-slate-700/50">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[10px] text-slate-400 mb-1.5 uppercase tracking-wider font-bold">Threat Level</div>
                    <div className="flex flex-wrap gap-1.5">
                      {threatLevels.map(level => (
                        <button
                          key={level.value}
                          onClick={() => toggleThreat(level.value)}
                          className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all border ${
                            activeThreats.has(level.value) ? level.bg + ' ' + level.color : 'bg-slate-700 border-slate-600 text-slate-400'
                          }`}
                        >
                          {level.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 mb-1.5 uppercase tracking-wider font-bold">Category</div>
                    <div className="flex flex-wrap gap-1.5">
                      {categories.map(cat => (
                        <button
                          key={cat.value}
                          onClick={() => toggleCategory(cat.value)}
                          className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all border ${
                            activeCategories.has(cat.value) ? 'bg-sky-500/20 border-sky-500 text-sky-300' : 'bg-slate-700 border-slate-600 text-slate-400'
                          }`}
                        >
                          {cat.icon} {cat.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── MAIN CONTENT ─────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-3 space-y-3">

            {/* ═══ HERO ROW: Globe (dominant left) + Live Events (right) ═══ */}
            <div className="grid grid-cols-12 gap-3" style={{ minHeight: '420px' }}>
              {/* Globe — 8 cols = dominant hero */}
              <div className="col-span-8">
                <div
                  className="relative bg-slate-950 border border-slate-800/70 rounded-xl overflow-hidden"
                  style={{ height: '420px' }}
                >
                  {/* Globe expand/collapse button */}
                  <button
                    onClick={() => setGlobeExpanded(!globeExpanded)}
                    className="absolute top-3 right-3 z-20 p-1.5 rounded-lg bg-slate-900/80 border border-slate-700/50 text-slate-400 hover:text-white transition-colors"
                    title={globeExpanded ? 'Collapse' : 'Expand'}
                  >
                    {globeExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                  </button>

                  {isLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <RefreshCw className="w-10 h-10 text-sky-500 animate-spin" />
                    </div>
                  ) : mapData ? (
                    <Suspense fallback={<div className="flex items-center justify-center h-full"><RefreshCw className="w-10 h-10 text-sky-500 animate-spin" /></div>}>
                      <GlobalMonitorGlobe
                        events={filteredEvents}
                        clusters={mapData.clusters}
                        instability={mapData.instability}
                        onEventClick={handleEventClick}
                        autoRotate={autoRotate}
                        showLabels={true}
                      />
                    </Suspense>
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <AlertTriangle className="w-10 h-10 text-yellow-500" />
                    </div>
                  )}

                  {/* Globe overlay stat badges */}
                  {mapData && !isLoading && (
                    <div className="absolute bottom-3 left-3 z-20 flex gap-2">
                      <div className="px-2.5 py-1 rounded-full bg-slate-900/80 border border-slate-700 backdrop-blur-md flex items-center gap-1.5">
                        <Activity className="w-3 h-3 text-sky-400" />
                        <span className="text-[9px] font-bold text-slate-200">{filteredEvents.length} Events</span>
                      </div>
                      {mapData.stats.critical_events > 0 && (
                        <div className="px-2.5 py-1 rounded-full bg-red-500/20 border border-red-500/30 backdrop-blur-md flex items-center gap-1.5 animate-pulse">
                          <AlertTriangle className="w-3 h-3 text-red-400" />
                          <span className="text-[9px] font-bold text-red-200">{mapData.stats.critical_events} Critical</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Live Events Feed — 4 cols, same height as globe */}
              <div className="col-span-4">
                <div
                  className="bg-slate-950/95 border border-slate-800/70 rounded-xl overflow-hidden"
                  style={{ height: '420px' }}
                >
                  <Suspense fallback={<PanelShimmer height="h-full" />}>
                    <LiveEventsFeed events={filteredEvents} onEventClick={handleEventClick} maxItems={60} />
                  </Suspense>
                </div>
              </div>
            </div>

            {/* ═══ PINTEREST / MASONRY GRID below the hero ═══ */}
            <div className="columns-1 md:columns-2 xl:columns-3 gap-3 space-y-3 [&>*]:break-inside-avoid">

              {/* Economic Indicators — tall card */}
              <div className="rounded-xl overflow-hidden">
                <Suspense fallback={<PanelShimmer height="h-80" />}>
                  <EconomicIndicatorsPanel />
                </Suspense>
              </div>

              {/* Strategic Risk — medium card */}
              <div className="rounded-xl overflow-hidden">
                <Suspense fallback={<PanelShimmer height="h-72" />}>
                  <StrategicRiskPanel />
                </Suspense>
              </div>

              {/* Polymarket Finance — compact */}
              <div className="rounded-xl overflow-hidden">
                <Suspense fallback={<PanelShimmer height="h-64" />}>
                  <PolymarketFinancePanel />
                </Suspense>
              </div>

              {/* Trade Policy — medium card */}
              <div className="rounded-xl overflow-hidden">
                <Suspense fallback={<PanelShimmer height="h-72" />}>
                  <TradePolicyPanel />
                </Suspense>
              </div>

              {/* Security & Infrastructure — taller */}
              <div className="rounded-xl overflow-hidden">
                <Suspense fallback={<PanelShimmer height="h-80" />}>
                  <SecurityAdvisoriesPanel />
                </Suspense>
              </div>

              {/* Commodities Widget — compact */}
              <div className="rounded-xl overflow-hidden">
                <Suspense fallback={<PanelShimmer height="h-56" />}>
                  <CommoditiesWidget />
                </Suspense>
              </div>

            </div>

            {/* ═══ CONTINENT NEWS — full width below masonry ═══ */}
            <div>
              <Suspense fallback={<PanelShimmer height="h-96" />}>
                <ContinentNewsFeedGrid />
              </Suspense>
            </div>

            {/* ═══ MARKET RADAR — full width bottom anchor ═══ */}
            <div>
              <Suspense fallback={<PanelShimmer height="h-64" />}>
                <MarketRadarPanel />
              </Suspense>
            </div>

          </div>
        </div>

        {/* ─── DRAWER: Ticker Impact ────────────────────────────── */}
        {selectedEvent && (
          <Suspense fallback={null}>
            <TickerImpactDrawer
              event={selectedEvent}
              onClose={() => setSelectedEvent(null)}
            />
          </Suspense>
        )}
      </div>
    </AppLayout>
  )
}

// ─── Mobile Layout (simplified) ────────────────────────────────────────

// ─── Mobile Layout — Full Bloomberg Terminal Experience ─────────────────

function MonitorMobile() {
  const [selectedEvent, setSelectedEvent] = useState<GlobalEvent | null>(null)
  const [activeSection, setActiveSection] = useState(0)

  const { data: mapData, isLoading, refetch } = useQuery<MapData>({
    queryKey: ['monitor-map-data', 24],
    queryFn: () => fetchMapData(24, true),
    refetchInterval: 120000,
    staleTime: 60000,
  })

  const events = mapData?.events || []

  const handleEventClick = (event: GlobalEvent) => {
    setSelectedEvent(event)
  }

  // Section navigation for quick jumps
  const sections = [
    { id: 'live', label: 'Live', icon: '🔴' },
    { id: 'markets', label: 'Markets', icon: '📈' },
    { id: 'risk', label: 'Risk', icon: '🛡️' },
    { id: 'news', label: 'News', icon: '🌍' },
    { id: 'policy', label: 'Policy', icon: '📋' },
  ]

  return (
    <MobileLayout>
      <div className="flex flex-col min-h-screen pb-20">
        {/* ═══ STICKY HEADER ═══ */}
        <div className="sticky top-0 z-30 bg-[#0A0E1A]/95 backdrop-blur-xl border-b border-slate-800/50">
          <div className="px-4 pt-4 pb-2">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-lg font-bold bg-gradient-to-r from-white via-sky-200 to-sky-400 bg-clip-text text-transparent">
                  Global Monitor
                </h1>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                  </span>
                  <p className="text-[10px] text-slate-400 font-mono tracking-wider">
                    {isLoading ? 'SYNCING...' : `LIVE • ${events.length} EVENTS`}
                  </p>
                </div>
              </div>
              <button
                onClick={() => refetch()}
                className="p-2 rounded-xl bg-slate-800/60 border border-slate-700/50 text-slate-400 active:scale-90 transition-all"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-sky-400' : ''}`} />
              </button>
            </div>
          </div>

          {/* Quick Section Nav */}
          <div className="flex gap-1 px-4 pb-2 overflow-x-auto no-scrollbar">
            {sections.map((sec, i) => (
              <a
                key={sec.id}
                href={`#mobile-${sec.id}`}
                onClick={() => setActiveSection(i)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-[10px] font-medium whitespace-nowrap transition-all ${
                  activeSection === i
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                    : 'bg-slate-800/40 text-slate-400 border border-slate-700/30'
                }`}
              >
                <span>{sec.icon}</span>
                {sec.label}
              </a>
            ))}
          </div>
        </div>

        {/* ═══ WORLD CLOCK — Horizontal Scroll ═══ */}
        <div className="px-4 pt-4">
          <Suspense fallback={<div className="h-16 bg-slate-800/30 rounded-xl animate-pulse" />}>
            <WorldClockWidget />
          </Suspense>
        </div>

        {/* ═══ GLOBE — Compact ═══ */}
        <div className="relative w-full aspect-[4/3] max-h-[280px] mt-3 mx-auto">
          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <RefreshCw className="w-8 h-8 text-sky-500 animate-spin opacity-40" />
            </div>
          ) : mapData ? (
            <div className="w-full h-full relative">
              <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#0A0E1A] z-10 pointer-events-none" />
              <Suspense fallback={null}>
                <GlobalMonitorGlobe
                  events={events}
                  clusters={mapData.clusters}
                  instability={mapData.instability}
                  onEventClick={handleEventClick}
                  showLabels={true}
                />
              </Suspense>
              <div className="absolute bottom-3 left-4 z-20 flex gap-2">
                <div className="px-2.5 py-1 rounded-full bg-slate-900/90 border border-slate-700/60 backdrop-blur-md flex items-center gap-1.5">
                  <Activity className="w-3 h-3 text-sky-400" />
                  <span className="text-[10px] font-bold text-slate-200">{events.length} Events</span>
                </div>
                <div className="px-2.5 py-1 rounded-full bg-slate-900/90 border border-red-500/30 backdrop-blur-md flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 text-red-400" />
                  <span className="text-[10px] font-bold text-red-300">
                    {events.filter(e => e.threat_level === 'critical' || e.threat_level === 'high').length} Critical
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-2">
              <AlertTriangle className="w-6 h-6 opacity-40" />
              <span className="text-xs">Map Unavailable</span>
            </div>
          )}
        </div>

        {/* ═══ SECTION: LIVE EVENTS ═══ */}
        <div id="mobile-live" className="px-4 mt-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-500/10 border border-red-500/30">
              <Zap className="w-3 h-3 text-red-400" />
              <span className="text-[11px] font-bold text-red-300 uppercase tracking-wider">Live Events</span>
            </div>
            <div className="flex-1 h-px bg-gradient-to-r from-red-500/20 to-transparent" />
          </div>
          <div className="rounded-xl overflow-hidden border border-slate-800/50" style={{ height: '320px' }}>
            <Suspense fallback={<PanelShimmer height="h-full" />}>
              <LiveEventsFeed events={events} onEventClick={handleEventClick} maxItems={30} />
            </Suspense>
          </div>
        </div>

        {/* ═══ SECTION: MARKETS & PREDICTIONS ═══ */}
        <div id="mobile-markets" className="px-4 mt-6">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
              <TrendingDown className="w-3 h-3 text-emerald-400" />
              <span className="text-[11px] font-bold text-emerald-300 uppercase tracking-wider">Markets & Predictions</span>
            </div>
            <div className="flex-1 h-px bg-gradient-to-r from-emerald-500/20 to-transparent" />
          </div>

          <div className="space-y-3">
            {/* Market Radar */}
            <div className="rounded-xl overflow-hidden">
              <Suspense fallback={<PanelShimmer height="h-64" />}>
                <MarketRadarPanel />
              </Suspense>
            </div>

            {/* Polymarket Finance */}
            <div className="rounded-xl overflow-hidden">
              <Suspense fallback={<PanelShimmer height="h-72" />}>
                <PolymarketFinancePanel />
              </Suspense>
            </div>

            {/* Economic Indicators */}
            <div className="rounded-xl overflow-hidden">
              <Suspense fallback={<PanelShimmer height="h-80" />}>
                <EconomicIndicatorsPanel />
              </Suspense>
            </div>

            {/* Commodities */}
            <div className="rounded-xl overflow-hidden">
              <Suspense fallback={<PanelShimmer height="h-56" />}>
                <CommoditiesWidget />
              </Suspense>
            </div>
          </div>
        </div>

        {/* ═══ SECTION: STRATEGIC RISK ═══ */}
        <div id="mobile-risk" className="px-4 mt-6">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-orange-500/10 border border-orange-500/30">
              <AlertTriangle className="w-3 h-3 text-orange-400" />
              <span className="text-[11px] font-bold text-orange-300 uppercase tracking-wider">Risk & Security</span>
            </div>
            <div className="flex-1 h-px bg-gradient-to-r from-orange-500/20 to-transparent" />
          </div>

          <div className="space-y-3">
            {/* Strategic Risk */}
            <div className="rounded-xl overflow-hidden">
              <Suspense fallback={<PanelShimmer height="h-72" />}>
                <StrategicRiskPanel />
              </Suspense>
            </div>

            {/* Security Advisories */}
            <div className="rounded-xl overflow-hidden">
              <Suspense fallback={<PanelShimmer height="h-80" />}>
                <SecurityAdvisoriesPanel />
              </Suspense>
            </div>
          </div>
        </div>

        {/* ═══ SECTION: GLOBAL NEWS ═══ */}
        <div id="mobile-news" className="px-4 mt-6">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-500/10 border border-sky-500/30">
              <Globe className="w-3 h-3 text-sky-400" />
              <span className="text-[11px] font-bold text-sky-300 uppercase tracking-wider">Global News</span>
            </div>
            <div className="flex-1 h-px bg-gradient-to-r from-sky-500/20 to-transparent" />
          </div>
          <div className="rounded-xl overflow-hidden">
            <Suspense fallback={<PanelShimmer height="h-96" />}>
              <ContinentNewsFeedGrid />
            </Suspense>
          </div>
        </div>

        {/* ═══ SECTION: TRADE POLICY ═══ */}
        <div id="mobile-policy" className="px-4 mt-6 mb-8">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-500/10 border border-violet-500/30">
              <Filter className="w-3 h-3 text-violet-400" />
              <span className="text-[11px] font-bold text-violet-300 uppercase tracking-wider">Trade Policy</span>
            </div>
            <div className="flex-1 h-px bg-gradient-to-r from-violet-500/20 to-transparent" />
          </div>
          <div className="rounded-xl overflow-hidden">
            <Suspense fallback={<PanelShimmer height="h-72" />}>
              <TradePolicyPanel />
            </Suspense>
          </div>
        </div>

        {/* ═══ MOBILE IMPACT DRAWER ═══ */}
        {selectedEvent && (
          <div className="fixed inset-0 z-50 flex items-end justify-center pointer-events-none">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm pointer-events-auto" onClick={() => setSelectedEvent(null)} />
            <div className="bg-slate-900 w-full max-h-[85vh] rounded-t-3xl border-t border-slate-700/70 pointer-events-auto flex flex-col overflow-hidden animate-slide-up-mobile">
              <div className="flex justify-center pt-3 pb-1" onClick={() => setSelectedEvent(null)}>
                <div className="w-12 h-1.5 bg-slate-700/60 rounded-full" />
              </div>
              <div className="flex-1 overflow-y-auto">
                <Suspense fallback={<div className="h-40 flex items-center justify-center"><RefreshCw className="animate-spin text-sky-500" /></div>}>
                  <TickerImpactDrawer event={selectedEvent} onClose={() => setSelectedEvent(null)} />
                </Suspense>
              </div>
            </div>
          </div>
        )}
      </div>
    </MobileLayout>
  )
}

// ─── Page Export ────────────────────────────────────────────────────────

export default function MonitorPage() {
  return (
    <>
      <div className="hidden md:block">
        <MonitorDesktop />
      </div>
      <div className="md:hidden">
        <MonitorMobile />
      </div>
    </>
  )
}
