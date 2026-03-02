'use client'

import { useState, useEffect, Suspense, lazy } from 'react'
import { useQuery } from '@tanstack/react-query'
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import Link from 'next/link'
import { 
  Globe, Activity, AlertTriangle, TrendingUp, TrendingDown,
  Zap, Filter, Clock, RefreshCw, Share2, Download, Maximize2,
  X, ChevronDown, ChevronUp, Info
} from 'lucide-react'
import { fetchMapData, fetchMonitorStats, type MapData, type MonitorStats, type GlobalEvent } from '@/lib/global-monitor-api'

// Lazy load the globe component for better performance
const GlobalMonitorGlobe = lazy(() => import('@/components/GlobalMonitorGlobe'))
const TickerImpactDrawer = lazy(() => import('@/components/TickerImpactDrawer'))

function MonitorDesktop() {
  const [selectedEvent, setSelectedEvent] = useState<GlobalEvent | null>(null)
  const [timeWindow, setTimeWindow] = useState(24) // hours
  const [showFilters, setShowFilters] = useState(false)
  const [threatFilter, setThreatFilter] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [autoRotate, setAutoRotate] = useState(true)
  
  // Fetch map data with auto-refresh every 2 minutes
  const { data: mapData, isLoading, refetch } = useQuery<MapData>({
    queryKey: ['monitor-map-data', timeWindow, threatFilter, categoryFilter],
    queryFn: () => fetchMapData(timeWindow, true),
    refetchInterval: 120000, // 2 minutes
    staleTime: 60000, // 1 minute
  })
  
  // Fetch stats
  const { data: stats } = useQuery<MonitorStats>({
    queryKey: ['monitor-stats'],
    queryFn: fetchMonitorStats,
    refetchInterval: 60000, // 1 minute
  })

  // Filter events based on selected filters
  const filteredEvents = mapData?.events.filter(event => {
    if (threatFilter && event.threat_level !== threatFilter) return false
    if (categoryFilter && event.category !== categoryFilter) return false
    return true
  }) || []

  const threatLevels = [
    { value: 'critical', label: 'Critical', color: 'text-red-500' },
    { value: 'high', label: 'High', color: 'text-orange-500' },
    { value: 'medium', label: 'Medium', color: 'text-yellow-500' },
    { value: 'low', label: 'Low', color: 'text-blue-500' }
  ]

  const categories = [
    { value: 'conflict', label: 'Conflict', icon: '⚔️' },
    { value: 'political', label: 'Political', icon: '🏛️' },
    { value: 'disaster', label: 'Disaster', icon: '🌊' },
    { value: 'aviation', label: 'Aviation', icon: '✈️' },
    { value: 'shipping', label: 'Shipping', icon: '🚢' },
    { value: 'cyber', label: 'Cyber', icon: '🔒' },
    { value: 'economic', label: 'Economic', icon: '💰' },
    { value: 'climate', label: 'Climate', icon: '🌡️' }
  ]

  const handleEventClick = (event: GlobalEvent) => {
    setSelectedEvent(event)
    setAutoRotate(false)
  }

  return (
    <AppLayout>
      <div className="min-h-screen bg-slate-950 text-slate-50">
        {/* Header */}
        <div className="border-b border-slate-800/50 bg-slate-900/30 backdrop-blur-sm sticky top-0 z-20">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold flex items-center gap-3">
                  <Globe className="w-7 h-7 text-sky-400" />
                  Global Monitor
                  {isLoading && (
                    <RefreshCw className="w-4 h-4 text-sky-400 animate-spin" />
                  )}
                </h1>
                <p className="text-sm text-slate-400 mt-1">
                  Real-time global event tracking with market impact analysis
                </p>
              </div>
              
              <div className="flex items-center gap-3">
                {/* Time Window Selector */}
                <select
                  value={timeWindow}
                  onChange={(e) => setTimeWindow(Number(e.target.value))}
                  className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value={1}>Last Hour</option>
                  <option value={6}>Last 6 Hours</option>
                  <option value={24}>Last 24 Hours</option>
                  <option value={72}>Last 3 Days</option>
                  <option value={168}>Last Week</option>
                </select>

                {/* Filters Button */}
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-sm flex items-center gap-2 transition-colors"
                >
                  <Filter className="w-4 h-4" />
                  Filters
                  {(threatFilter || categoryFilter) && (
                    <span className="w-2 h-2 bg-sky-500 rounded-full" />
                  )}
                </button>

                <button
                  onClick={() => refetch()}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-sm flex items-center gap-2 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh
                </button>

                <button
                  onClick={() => setAutoRotate((prev) => !prev)}
                  className={`px-4 py-2 rounded-xl text-sm flex items-center gap-2 transition-colors border ${
                    autoRotate
                      ? 'bg-slate-800 border-sky-600 text-sky-300 hover:bg-slate-700'
                      : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <Activity className={`w-4 h-4 ${autoRotate ? 'text-sky-400' : 'text-slate-400'}`} />
                  {autoRotate ? 'Auto-rotate: On' : 'Auto-rotate: Off'}
                </button>
              </div>
            </div>

            {/* Stats Bar */}
            {mapData && (
              <div className="mt-4 grid grid-cols-6 gap-3">
                <div className="bg-slate-800/50 rounded-xl px-4 py-3 border border-slate-700/50">
                  <div className="text-xs text-slate-400">Total Events</div>
                  <div className="text-2xl font-bold text-slate-50 mt-1">
                    {mapData.stats.total_events}
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-xl px-4 py-3 border border-red-900/30">
                  <div className="text-xs text-red-400">Critical</div>
                  <div className="text-2xl font-bold text-red-500 mt-1">
                    {mapData.stats.critical_events}
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-xl px-4 py-3 border border-orange-900/30">
                  <div className="text-xs text-orange-400">High Threat</div>
                  <div className="text-2xl font-bold text-orange-500 mt-1">
                    {mapData.stats.high_threat_events}
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-xl px-4 py-3 border border-purple-900/30">
                  <div className="text-xs text-purple-400">Hotspots</div>
                  <div className="text-2xl font-bold text-purple-500 mt-1">
                    {mapData.stats.total_hotspots}
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-xl px-4 py-3 border border-yellow-900/30">
                  <div className="text-xs text-yellow-400">High Risk Countries</div>
                  <div className="text-2xl font-bold text-yellow-500 mt-1">
                    {mapData.stats.high_risk_countries}
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-xl px-4 py-3 border border-sky-900/30">
                  <div className="text-xs text-sky-400">Anomalies</div>
                  <div className="text-2xl font-bold text-sky-500 mt-1">
                    {mapData.stats.anomalies_detected}
                  </div>
                </div>
              </div>
            )}

            {/* Filters Panel */}
            {showFilters && (
              <div className="mt-4 p-4 bg-slate-800/50 rounded-xl border border-slate-700/50">
                <div className="grid grid-cols-2 gap-6">
                  {/* Threat Level Filter */}
                  <div>
                    <div className="text-sm font-medium text-slate-300 mb-2">Threat Level</div>
                    <div className="flex flex-wrap gap-2">
                      {threatLevels.map(level => (
                        <button
                          key={level.value}
                          onClick={() => setThreatFilter(threatFilter === level.value ? null : level.value)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                            threatFilter === level.value
                              ? `bg-${level.value === 'critical' ? 'red' : level.value === 'high' ? 'orange' : level.value === 'medium' ? 'yellow' : 'blue'}-500/20 border border-${level.value === 'critical' ? 'red' : level.value === 'high' ? 'orange' : level.value === 'medium' ? 'yellow' : 'blue'}-500 ${level.color}`
                              : 'bg-slate-700 border border-slate-600 text-slate-300 hover:bg-slate-600'
                          }`}
                        >
                          {level.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Category Filter */}
                  <div>
                    <div className="text-sm font-medium text-slate-300 mb-2">Event Category</div>
                    <div className="flex flex-wrap gap-2">
                      {categories.map(cat => (
                        <button
                          key={cat.value}
                          onClick={() => setCategoryFilter(categoryFilter === cat.value ? null : cat.value)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                            categoryFilter === cat.value
                              ? 'bg-sky-500/20 border border-sky-500 text-sky-300'
                              : 'bg-slate-700 border border-slate-600 text-slate-300 hover:bg-slate-600'
                          }`}
                        >
                          <span className="mr-1">{cat.icon}</span>
                          {cat.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Globe Visualization */}
        <div className="relative" style={{ height: 'calc(100vh - 240px)' }}>
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <RefreshCw className="w-12 h-12 text-sky-500 animate-spin mx-auto mb-4" />
                <p className="text-slate-400">Loading global data...</p>
              </div>
            </div>
          ) : mapData ? (
            <Suspense fallback={
              <div className="flex items-center justify-center h-full">
                <RefreshCw className="w-12 h-12 text-sky-500 animate-spin" />
              </div>
            }>
              <GlobalMonitorGlobe
                events={filteredEvents}
                clusters={mapData.clusters}
                instability={mapData.instability}
                onEventClick={handleEventClick}
                autoRotate={autoRotate}
              />
            </Suspense>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
                <p className="text-slate-400">Failed to load map data</p>
                <button
                  onClick={() => refetch()}
                  className="mt-4 px-4 py-2 bg-sky-500 rounded-xl text-sm hover:bg-sky-600 transition-colors"
                >
                  Retry
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Ticker Impact Drawer */}
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

function MonitorMobile() {
  const [selectedEvent, setSelectedEvent] = useState<any>(null)
  
  // Reuse same query for mobile
  const { data: mapData, isLoading, refetch } = useQuery<MapData>({
    queryKey: ['monitor-map-data', 24],
    queryFn: () => fetchMapData(24, true),
    refetchInterval: 120000,
    staleTime: 60000,
  })

  // Mobile-specific data transformation
  const events = mapData?.events || []
  const activeEvents = events.length
  
  const categories = [
    { value: 'conflict', label: 'Conflict', icon: '⚔️', color: 'bg-red-500/10 text-red-400 border-red-500/20' },
    { value: 'political', label: 'Political', icon: '🏛️', color: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
    { value: 'economic', label: 'Economic', icon: '💰', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
    { value: 'climate', label: 'Climate', icon: '🌡️', color: 'bg-sky-500/10 text-sky-400 border-sky-500/20' }
  ]

  return (
    <MobileLayout>
      <div className="flex flex-col min-h-screen pb-20">
        {/* Header */}
        <div className="px-5 pt-6 pb-2">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
                Global Monitor
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <p className="text-xs text-slate-400 font-mono">
                  {isLoading ? 'SYNCING...' : 'LIVE FEED ACTIVE'}
                </p>
              </div>
            </div>
            <button 
              onClick={() => refetch()}
              className="p-2 rounded-xl bg-slate-800/50 border border-slate-700/50 text-slate-400 active:scale-95 transition-transform"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-sky-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* 3D Globe Viewer */}
        <div className="relative w-full aspect-square max-h-[360px] my-2">
          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <RefreshCw className="w-8 h-8 text-sky-500 animate-spin opacity-50" />
            </div>
          ) : mapData ? (
            <div className="w-full h-full relative">
              <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-slate-950/80 z-10 pointer-events-none" />
              <Suspense fallback={null}>
                <GlobalMonitorGlobe
                  events={events}
                  clusters={mapData.clusters}
                  instability={mapData.instability}
                  onEventClick={setSelectedEvent}
                />
              </Suspense>
              
              {/* Globe Overlay Stats */}
              <div className="absolute bottom-4 left-5 z-20 flex gap-2">
                <div className="px-3 py-1.5 rounded-full bg-slate-900/80 border border-slate-700 backdrop-blur-md flex items-center gap-1.5">
                  <Activity className="w-3 h-3 text-sky-400" />
                  <span className="text-[10px] font-bold text-slate-200">{activeEvents} Events</span>
                </div>
                {mapData.stats.critical_events > 0 && (
                  <div className="px-3 py-1.5 rounded-full bg-red-500/20 border border-red-500/30 backdrop-blur-md flex items-center gap-1.5 animate-pulse">
                    <AlertTriangle className="w-3 h-3 text-red-400" />
                    <span className="text-[10px] font-bold text-red-200">{mapData.stats.critical_events} Critical</span>
                  </div>
                )}
              </div>
              
              <div className="absolute top-4 right-5 z-20">
                <div className="px-2 py-1 rounded bg-slate-900/60 backdrop-blur text-[9px] text-slate-500 border border-white/5">
                  Tap points to inspect
                </div>
              </div>
            </div>
          ) : (
             <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-2">
               <AlertTriangle className="w-8 h-8 opacity-50" />
               <span className="text-xs">Map Data Unavailable</span>
             </div>
          )}
        </div>

        {/* Quick Filters / Legend */}
        <div className="px-5 mb-4">
          <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
            {categories.map(cat => (
              <div 
                key={cat.value} 
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-medium whitespace-nowrap ${cat.color}`}
              >
                <span>{cat.icon}</span>
                {cat.label}
              </div>
            ))}
          </div>
        </div>

        {/* Event Feed */}
        <div className="flex-1 px-5 pb-8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-yellow-500" />
              Latest Alerts
            </h3>
            <span className="text-[10px] text-slate-500">
              {mapData?.stats?.last_updated ? new Date(mapData.stats.last_updated).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}
            </span>
          </div>
          
          <div className="space-y-3">
            {isLoading ? (
               [1,2,3].map(i => (
                 <div key={i} className="h-20 bg-slate-800/50 rounded-xl animate-pulse" />
               ))
            ) : events.slice(0, 5).map(event => (
              <div 
                key={event.id}
                onClick={() => setSelectedEvent(event)}
                className="group relative overflow-hidden bg-slate-900/50 border border-slate-800 rounded-xl p-3 active:scale-[0.98] transition-all"
              >
                <div className="flex justify-between items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        event.threat_level === 'critical' ? 'bg-red-500 animate-pulse' :
                        event.threat_level === 'high' ? 'bg-orange-500' :
                        'bg-sky-500'
                      }`} />
                      <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                        {event.category} • {event.location_name || 'Global'}
                      </span>
                    </div>
                    <h4 className="text-sm font-medium text-slate-200 line-clamp-1 group-active:text-sky-400 transition-colors">
                      {event.title}
                    </h4>
                    <div className="flex items-center gap-2 mt-2">
                       {event.market_impact_score && event.market_impact_score > 70 && (
                         <div className="flex items-center gap-1 text-[10px] text-red-300 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20">
                           <TrendingDown className="w-3 h-3" />
                           High Impact
                         </div>
                       )}
                       <span className="text-[10px] text-slate-500">
                         {new Date(event.event_timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                       </span>
                    </div>
                  </div>
                  <ChevronDown className="w-4 h-4 text-slate-600 -rotate-90 group-active:translate-x-1 transition-transform" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Mobile Impact Drawer */}
        {selectedEvent && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pointer-events-none">
            <div 
              className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-auto"
              onClick={() => setSelectedEvent(null)}
            />
            <div className="bg-slate-900 w-full max-h-[85vh] rounded-t-3xl border-t border-slate-700 pointer-events-auto flex flex-col overflow-hidden animate-slide-up-mobile">
              <div className="flex justify-center pt-3 pb-1" onClick={() => setSelectedEvent(null)}>
                <div className="w-12 h-1.5 bg-slate-700/50 rounded-full" />
              </div>
              <div className="flex-1 overflow-y-auto">
                <Suspense fallback={<div className="h-40 flex items-center justify-center"><RefreshCw className="animate-spin" /></div>}>
                  <TickerImpactDrawer 
                    event={selectedEvent} 
                    onClose={() => setSelectedEvent(null)} 
                  />
                </Suspense>
              </div>
            </div>
          </div>
        )}
      </div>
    </MobileLayout>
  )
}

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

