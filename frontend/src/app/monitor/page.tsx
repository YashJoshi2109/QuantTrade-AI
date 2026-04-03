'use client'

import { useState, useMemo, Suspense, lazy, useCallback } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import { motion } from 'framer-motion'
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import {
  Globe,
  Activity,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  Zap,
  Filter,
  RefreshCw,
  Maximize2,
  Minimize2,
  Radio,
  Crosshair,
  Landmark,
  CloudLightning,
  Plane,
  Ship,
  Lock,
  CircleDollarSign,
  Thermometer,
  Info,
  Shield,
  FileText,
} from 'lucide-react'
import {
  fetchMapData, fetchMonitorStats,
  type MapData, type GlobalEvent,
  type GeographicCluster, type CountryInstability,
} from '@/lib/global-monitor-api'
import {
  fetchACLEDConflicts,
  type ACLEDEvent,
} from '@/lib/monitor-extended-api'

// ── Country code lookup ──────────────────────────────────────────────
const COUNTRY_CODE_MAP: Record<string, string> = {
  'Afghanistan': 'AF', 'Albania': 'AL', 'Algeria': 'DZ', 'Angola': 'AO',
  'Argentina': 'AR', 'Armenia': 'AM', 'Australia': 'AU', 'Azerbaijan': 'AZ',
  'Bangladesh': 'BD', 'Belarus': 'BY', 'Belgium': 'BE', 'Bolivia': 'BO',
  'Bosnia': 'BA', 'Brazil': 'BR', 'Bulgaria': 'BG', 'Burkina Faso': 'BF',
  'Cambodia': 'KH', 'Cameroon': 'CM', 'Canada': 'CA', 'Central African Republic': 'CF',
  'Chad': 'TD', 'Chile': 'CL', 'China': 'CN', 'Colombia': 'CO',
  'DR Congo': 'CD', 'Democratic Republic of Congo': 'CD', 'Cuba': 'CU',
  'Ecuador': 'EC', 'Egypt': 'EG', 'El Salvador': 'SV', 'Ethiopia': 'ET',
  'France': 'FR', 'Georgia': 'GE', 'Germany': 'DE', 'Ghana': 'GH',
  'Greece': 'GR', 'Guatemala': 'GT', 'Haiti': 'HT', 'Honduras': 'HN',
  'India': 'IN', 'Indonesia': 'ID', 'Iran': 'IR', 'Iraq': 'IQ',
  'Israel': 'IL', 'Italy': 'IT', 'Japan': 'JP', 'Jordan': 'JO',
  'Kazakhstan': 'KZ', 'Kenya': 'KE', 'Kosovo': 'XK', 'Kuwait': 'KW',
  'Kyrgyzstan': 'KG', 'Lebanon': 'LB', 'Libya': 'LY', 'Madagascar': 'MG',
  'Mali': 'ML', 'Mauritania': 'MR', 'Mexico': 'MX', 'Moldova': 'MD',
  'Morocco': 'MA', 'Mozambique': 'MZ', 'Myanmar': 'MM', 'Nepal': 'NP',
  'Nicaragua': 'NI', 'Niger': 'NE', 'Nigeria': 'NG', 'North Korea': 'KP',
  'Pakistan': 'PK', 'Palestine': 'PS', 'Panama': 'PA', 'Paraguay': 'PY',
  'Peru': 'PE', 'Philippines': 'PH', 'Poland': 'PL', 'Romania': 'RO',
  'Russia': 'RU', 'Rwanda': 'RW', 'Saudi Arabia': 'SA', 'Senegal': 'SN',
  'Serbia': 'RS', 'Somalia': 'SO', 'South Africa': 'ZA', 'South Sudan': 'SS',
  'Spain': 'ES', 'Sri Lanka': 'LK', 'Sudan': 'SD', 'Syria': 'SY',
  'Taiwan': 'TW', 'Tanzania': 'TZ', 'Thailand': 'TH', 'Turkey': 'TR',
  'Uganda': 'UG', 'Ukraine': 'UA', 'United Kingdom': 'GB',
  'United States': 'US', 'Uruguay': 'UY', 'Venezuela': 'VE',
  'Vietnam': 'VN', 'Yemen': 'YE', 'Zimbabwe': 'ZW',
}

function acledThreatLevel(fatalities: number, eventType: string): GlobalEvent['threat_level'] {
  if (fatalities > 50 || eventType.includes('Explosions')) return 'critical'
  if (fatalities > 10) return 'high'
  if (fatalities > 0) return 'medium'
  return 'low'
}

function acledCategory(eventType: string): string {
  if (eventType.includes('Battle') || eventType.includes('Explosion') || eventType.includes('Violence')) return 'conflict'
  if (eventType.includes('Protest') || eventType.includes('Riot') || eventType.includes('Strategic')) return 'political'
  return 'conflict'
}

function acledSectors(eventType: string, fatalities: number): string[] {
  const sectors: string[] = []
  if (eventType.includes('Battle') || eventType.includes('Explosion')) sectors.push('Defense', 'Energy')
  if (fatalities > 10) sectors.push('Emerging Markets', 'Insurance')
  if (eventType.includes('Protest')) sectors.push('Consumer Goods', 'Financials')
  return sectors.length > 0 ? sectors : ['Emerging Markets']
}

function hashToPseudoCoords(seed: string): { latitude: number; longitude: number } {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  const latitude = ((hash % 12500) / 100) - 55 // -55..70
  const longitude = (((Math.floor(hash / 12500) % 34000) / 100) - 170) // -170..170
  return { latitude, longitude }
}

function synthesizeFromACLED(acledEvents: ACLEDEvent[]): MapData {
  const events: GlobalEvent[] = acledEvents
    .map((e, i) => ({
      ...(() => {
        const hasRealCoords =
          Number.isFinite(e.latitude) &&
          Number.isFinite(e.longitude) &&
          !(Math.abs(e.latitude) < 0.0001 && Math.abs(e.longitude) < 0.0001)
        if (hasRealCoords) {
          return { latitude: e.latitude, longitude: e.longitude }
        }
        return hashToPseudoCoords(`${e.country || 'unknown'}-${e.event_type || 'event'}-${i}`)
      })(),
      id: i + 1,
      event_id: e.event_id || `acled-${i}`,
      source: 'acled',
      category: acledCategory(e.event_type),
      title: `${e.event_type}${e.sub_event_type ? ': ' + e.sub_event_type : ''} — ${e.country}`,
      description: e.notes || `${e.event_type} reported in ${e.country}. Source: ACLED.`,
      severity: Math.min(100, 20 + e.fatalities * 2),
      threat_level: acledThreatLevel(e.fatalities, e.event_type),
      location_name: e.region || e.country,
      country_code: COUNTRY_CODE_MAP[e.country] || e.country.slice(0, 2).toUpperCase(),
      event_timestamp: e.event_date ? e.event_date + 'T12:00:00Z' : new Date().toISOString(),
      keywords: [e.event_type, e.country],
      market_impact_score: Math.min(95, 30 + e.fatalities * 1.5),
      correlated_sectors: acledSectors(e.event_type, e.fatalities),
      is_anomaly: e.fatalities > 30,
      raw_data: null,
    }))

  // Synthetic clusters from top-event countries
  const countryEvents = events.reduce((acc, e) => {
    const k = e.country_code || 'XX'
    if (!acc[k]) acc[k] = { lat: e.latitude, lng: e.longitude, events: [], code: k }
    acc[k].events.push(e)
    return acc
  }, {} as Record<string, { lat: number; lng: number; events: GlobalEvent[]; code: string }>)

  const clusters: GeographicCluster[] = Object.values(countryEvents)
    .filter(c => c.events.length >= 2)
    .slice(0, 20)
    .map((c, i) => {
      const critical = c.events.filter(e => e.threat_level === 'critical').length
      const high = c.events.filter(e => e.threat_level === 'high').length
      return {
        id: i + 1,
        cell_id: `acled-${c.code}`,
        cell_lat: c.lat,
        cell_lon: c.lng,
        event_count: c.events.length,
        distinct_categories: 1,
        avg_severity: c.events.reduce((s, e) => s + (e.severity || 0), 0) / c.events.length,
        max_threat_level: critical > 0 ? 'critical' : high > 0 ? 'high' : 'medium',
        is_hotspot: c.events.length >= 3,
        hotspot_score: c.events.length * 5,
        event_ids: c.events.map(e => e.event_id),
        category_breakdown: { conflict: c.events.length },
        affected_tickers: [],
      }
    })

  // Synthetic instability from event counts
  const instability: CountryInstability[] = Object.values(countryEvents)
    .map(c => {
      const totalFatalities = c.events.reduce((s, e) => s + (e.severity || 0), 0)
      const idx = Math.min(95, 10 + totalFatalities / 5 + c.events.length * 3)
      return {
        country_code: c.code,
        country_name: Object.entries(COUNTRY_CODE_MAP).find(([, v]) => v === c.code)?.[0] || c.code,
        instability_index: idx,
        risk_level: idx >= 75 ? 'critical' : idx >= 50 ? 'high' : idx >= 30 ? 'medium' : 'low',
        conflict_score: Math.min(100, c.events.filter(e => e.category === 'conflict').length * 10),
        political_score: Math.min(100, c.events.filter(e => e.category === 'political').length * 10),
        disaster_score: 0,
        economic_score: 10,
        active_event_count: c.events.length,
        critical_event_count: c.events.filter(e => e.threat_level === 'critical').length,
        calculated_at: new Date().toISOString(),
      }
    })
    .sort((a, b) => b.instability_index - a.instability_index)
    .slice(0, 30)

  const critical = events.filter(e => e.threat_level === 'critical').length
  const high = events.filter(e => e.threat_level === 'high').length

  return {
    events,
    clusters,
    instability,
    anomalies: [],
    stats: {
      total_events: events.length,
      critical_events: critical,
      high_threat_events: high,
      total_hotspots: clusters.filter(c => c.is_hotspot).length,
      countries_monitored: Object.keys(countryEvents).length,
      high_risk_countries: instability.filter(c => c.risk_level === 'high' || c.risk_level === 'critical').length,
      anomalies_detected: events.filter(e => e.is_anomaly).length,
      last_updated: new Date().toISOString(),
      time_window_hours: 168,
    },
  }
}

// Lazy load heavy components
const GlobalMonitorGlobe   = lazy(() => import('@/components/GlobalMonitorGlobe'))
const EventImpactPanel     = lazy(() => import('@/components/monitor/EventImpactPanel'))
const GlobalStockTicker    = lazy(() => import('@/components/monitor/GlobalStockTicker'))

// Lazy load panel components
const MarketRadarPanel         = lazy(() => import('@/components/monitor/MarketRadarPanel'))
const EconomicIndicatorsPanel  = lazy(() => import('@/components/monitor/EconomicIndicatorsPanel'))
const TradePolicyPanel         = lazy(() => import('@/components/monitor/TradePolicyPanel'))
const ContinentNewsFeedGrid    = lazy(() => import('@/components/monitor/ContinentNewsFeedGrid'))
const WorldClockWidget         = lazy(() => import('@/components/monitor/WorldClockWidget'))
const PolymarketFinancePanel   = lazy(() => import('@/components/monitor/PolymarketFinancePanel'))
const StrategicRiskPanel       = lazy(() => import('@/components/monitor/StrategicRiskPanel'))
const CommoditiesWidget        = lazy(() => import('@/components/monitor/CommoditiesWidget'))
const SecurityAdvisoriesPanel  = lazy(() => import('@/components/monitor/SecurityAdvisoriesPanel'))
const LiveEventsFeed           = lazy(() => import('@/components/monitor/LiveEventsFeed'))

function PanelShimmer({ height = 'h-48' }: { height?: string }) {
  return (
    <div className={`${height} bg-slate-900/50 rounded-xl border border-slate-800/40 animate-pulse flex items-center justify-center`}>
      <div className="w-6 h-6 border-2 border-slate-700 border-t-sky-500 rounded-full animate-spin" />
    </div>
  )
}

// ─── Selected country type ───────────────────────────────────────────
interface SelectedCountry {
  code: string
  name: string
  lat: number
  lng: number
}

// ─── Desktop Bloomberg Terminal Layout ──────────────────────────────

function MonitorDesktop() {
  const [selectedEvent, setSelectedEvent]     = useState<GlobalEvent | null>(null)
  const [selectedCountry, setSelectedCountry] = useState<SelectedCountry | null>(null)
  const [timeWindow, setTimeWindow]           = useState(24)
  const [showFilters, setShowFilters]         = useState(false)
  const [autoRotate, setAutoRotate]           = useState(true)
  const [globeExpanded, setGlobeExpanded]     = useState(false)

  const threatLevels = [
    { value: 'critical', label: 'Critical', color: 'text-red-500', bg: 'bg-red-500/20 border-red-500' },
    { value: 'high',     label: 'High',     color: 'text-orange-500', bg: 'bg-orange-500/20 border-orange-500' },
    { value: 'medium',   label: 'Medium',   color: 'text-yellow-500', bg: 'bg-yellow-500/20 border-yellow-500' },
    { value: 'low',      label: 'Low',      color: 'text-blue-500',   bg: 'bg-blue-500/20 border-blue-500' },
    { value: 'unknown',  label: 'Monitor',  color: 'text-gray-500',   bg: 'bg-gray-500/20 border-gray-500' },
  ]

  const categories: { value: string; label: string; Icon: LucideIcon }[] = [
    { value: 'conflict', label: 'Conflict', Icon: Crosshair },
    { value: 'political', label: 'Political', Icon: Landmark },
    { value: 'disaster', label: 'Disaster', Icon: CloudLightning },
    { value: 'aviation', label: 'Aviation', Icon: Plane },
    { value: 'shipping', label: 'Shipping', Icon: Ship },
    { value: 'cyber', label: 'Cyber', Icon: Lock },
    { value: 'economic', label: 'Economic', Icon: CircleDollarSign },
    { value: 'climate', label: 'Climate', Icon: Thermometer },
  ]

  const [activeThreats, setActiveThreats]       = useState<Set<string>>(new Set(threatLevels.map(t => t.value)))
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set(categories.map(c => c.value)))

  const { data: rawMapData, isLoading, refetch } = useQuery<MapData>({
    queryKey: ['monitor-map-data', timeWindow],
    queryFn: () => fetchMapData(timeWindow, true),
    refetchInterval: 45000,
    staleTime: 25000,
  })

  useQuery({
    queryKey: ['monitor-stats'],
    queryFn: fetchMonitorStats,
    refetchInterval: 60000,
  })

  // When primary map-data returns 0 events (DB not yet synced), fall back to ACLED live data
  const needsAcledFallback = !isLoading && (!rawMapData?.events || rawMapData.events.length === 0)
  const { data: acledData } = useQuery({
    queryKey: ['acled-fallback'],
    queryFn: () => fetchACLEDConflicts(150),
    enabled: needsAcledFallback,
    refetchInterval: 300000,
    staleTime: 120000,
  })

  // Merge: use real data if available, synthesize from ACLED otherwise
  const mapData: MapData | undefined = useMemo(() => {
    if (rawMapData && rawMapData.events.length > 0) return rawMapData
    if (acledData && acledData.events.length > 0) return synthesizeFromACLED(acledData.events)
    return rawMapData
  }, [rawMapData, acledData])

  const isUsingFallback = !!acledData && (!rawMapData?.events || rawMapData.events.length === 0)

  const filteredEvents = useMemo(() => {
    return (mapData?.events || []).filter(event => {
      if (!activeThreats.has(event.threat_level || 'unknown')) return false
      if (event.category && !activeCategories.has(event.category)) return false
      return true
    })
  }, [mapData, activeThreats, activeCategories])

  const toggleThreat   = (val: string) => { const n = new Set(activeThreats);   n.has(val) ? n.delete(val) : n.add(val); setActiveThreats(n) }
  const toggleCategory = (val: string) => { const n = new Set(activeCategories); n.has(val) ? n.delete(val) : n.add(val); setActiveCategories(n) }

  const handleEventClick = useCallback((event: GlobalEvent) => {
    setSelectedEvent(event)
    setSelectedCountry(null)
    setAutoRotate(false)
  }, [])

  const handleCountryClick = useCallback((country: SelectedCountry) => {
    setSelectedCountry(country)
    setSelectedEvent(null)
    setAutoRotate(false)
  }, [])

  const handleClearSelection = useCallback(() => {
    setSelectedEvent(null)
    setSelectedCountry(null)
  }, [])

  // Stat cards
  const statCards = mapData ? [
    { label: 'Events',    value: mapData.stats.total_events,       color: 'text-slate-100', border: 'border-slate-700/50' },
    { label: 'Critical',  value: mapData.stats.critical_events,    color: 'text-red-400',    border: 'border-red-900/30' },
    { label: 'High',      value: mapData.stats.high_threat_events, color: 'text-orange-400', border: 'border-orange-900/30' },
    { label: 'Hotspots',  value: mapData.stats.total_hotspots,     color: 'text-purple-400', border: 'border-purple-900/30' },
    { label: 'At Risk',   value: mapData.stats.high_risk_countries,color: 'text-yellow-400', border: 'border-yellow-900/30' },
    { label: 'Anomalies', value: mapData.stats.anomalies_detected, color: 'text-sky-400',    border: 'border-sky-900/30' },
  ] : []

  return (
    <AppLayout>
      <div className="min-h-screen bg-[#020617] text-slate-50 flex flex-col -mx-4 md:-mx-6 -my-4 md:-my-6">

        {/* ══ TOP BAR ════════════════════════════════════════════════════ */}
        <div className="border-b border-slate-800/50 bg-[#020617]/98 backdrop-blur-md sticky top-0 z-30 shrink-0">
          {/* World Clock */}
          <div
            className="border-b border-slate-800/30 px-4 py-1.5 flex justify-center"
            role="region"
            aria-label="World clock"
          >
            <Suspense fallback={<div className="h-7" />}>
              <WorldClockWidget />
            </Suspense>
          </div>

          {/* Title row */}
          <div className="px-4 py-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Globe className="w-5 h-5 text-sky-400" />
                <h1 className="text-base font-black text-slate-100 tracking-tight">Global Monitor</h1>
                {isLoading && <RefreshCw className="w-3 h-3 text-sky-400 animate-spin" />}
                <span className="hidden xl:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[9px] text-emerald-400 font-bold">
                  <Radio className="w-2 h-2 animate-pulse" /> LIVE
                </span>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={timeWindow}
                  onChange={e => setTimeWindow(Number(e.target.value))}
                  className="px-2.5 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-sky-500 font-mono"
                >
                  <option value={24}>24H</option>
                  <option value={72}>3D</option>
                  <option value={168}>1W</option>
                </select>

                <button
                  type="button"
                  onClick={() => setShowFilters(f => !f)}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs flex items-center gap-1.5 transition-colors"
                  aria-expanded={showFilters}
                  aria-controls="global-monitor-filters"
                >
                  <Filter className="w-3 h-3 shrink-0" aria-hidden />
                  <span className="hidden sm:inline">Filters</span>
                  {(activeThreats.size < threatLevels.length || activeCategories.size < categories.length) && (
                    <span className="w-1.5 h-1.5 bg-sky-500 rounded-full" aria-hidden />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => refetch()}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs transition-colors"
                  title="Refresh data"
                  aria-label="Refresh monitor data"
                >
                  <RefreshCw className="w-3 h-3" />
                </button>

                <button
                  type="button"
                  onClick={() => setAutoRotate(r => !r)}
                  className={`px-2.5 py-1 rounded-lg text-xs flex items-center gap-1.5 border transition-colors ${autoRotate ? 'bg-slate-800 border-sky-600 text-sky-300' : 'bg-slate-900 border-slate-700 text-slate-400'}`}
                  aria-pressed={autoRotate}
                  aria-label={autoRotate ? 'Pause globe rotation' : 'Resume globe rotation'}
                >
                  <Activity className={`w-3 h-3 shrink-0 ${autoRotate ? 'text-sky-400' : ''}`} aria-hidden />
                </button>
              </div>
            </div>

            {/* Stats strip */}
            {statCards.length > 0 && (
              <section
                className="mt-2 grid grid-cols-6 gap-1.5"
                role="region"
                aria-label="Event and risk summary"
              >
                {statCards.map(s => (
                  <div
                    key={s.label}
                    className={`bg-slate-800/40 rounded-lg px-2.5 py-1.5 border ${s.border}`}
                  >
                    <div className="text-[8px] text-slate-500 uppercase tracking-wider">{s.label}</div>
                    <div className={`text-xl font-black ${s.color} font-mono leading-none mt-0.5 tabular-nums`}>
                      {s.value}
                    </div>
                  </div>
                ))}
              </section>
            )}

            {/* Filter panel */}
            {showFilters && (
              <div
                id="global-monitor-filters"
                className="mt-2.5 p-3 bg-slate-800/40 rounded-lg border border-slate-700/50"
                role="region"
                aria-label="Filter events"
              >
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[10px] text-slate-400 mb-1.5 uppercase tracking-wider font-bold">Threat Level</div>
                    <div className="flex flex-wrap gap-1.5">
                      {threatLevels.map(l => (
                        <button
                          key={l.value}
                          type="button"
                          onClick={() => toggleThreat(l.value)}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all border ${activeThreats.has(l.value) ? l.bg + ' ' + l.color : 'bg-slate-700 border-slate-600 text-slate-400'}`}
                          aria-pressed={activeThreats.has(l.value)}
                        >
                          {l.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 mb-1.5 uppercase tracking-wider font-bold">Category</div>
                    <div className="flex flex-wrap gap-1.5">
                      {categories.map(c => (
                        <button
                          key={c.value}
                          type="button"
                          onClick={() => toggleCategory(c.value)}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all border inline-flex items-center gap-1 ${activeCategories.has(c.value) ? 'bg-sky-500/20 border-sky-500 text-sky-300' : 'bg-slate-700 border-slate-600 text-slate-400'}`}
                          aria-pressed={activeCategories.has(c.value)}
                        >
                          <c.Icon className="w-3 h-3 shrink-0 opacity-90" aria-hidden />
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Global Stock Impact Ticker */}
          <div role="region" aria-label="Stock impact ticker" className="pb-1">
            <Suspense fallback={<div className="h-8 bg-slate-950/80" />}>
              <GlobalStockTicker events={filteredEvents} />
            </Suspense>
          </div>
        </div>

        {/* ══ MAIN CONTENT ═══════════════════════════════════════════════ */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-3 space-y-3">

            {/* ══ HERO ROW: Events | Globe | Impact Panel ════════════════ */}
            <motion.div
              className="grid gap-3"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              style={{
                gridTemplateColumns: globeExpanded
                  ? '0px 1fr 0px'
                  : 'minmax(250px,0.85fr) minmax(0,1.45fr) minmax(300px,1fr)',
                minHeight: '520px',
              }}
            >
              {/* LEFT: Live Events Feed */}
              {!globeExpanded && (
                <div className="bg-[#020617]/95 border border-slate-800/70 rounded-xl overflow-hidden flex flex-col" style={{ height: '520px' }}>
                  <Suspense fallback={<PanelShimmer height="h-full" />}>
                    <LiveEventsFeed events={filteredEvents} onEventClick={handleEventClick} maxItems={80} />
                  </Suspense>
                </div>
              )}

              {/* CENTER: Globe */}
              <div className="relative bg-[#020617] border border-slate-800/70 rounded-xl overflow-hidden" style={{ height: '520px' }}>
                {/* Expand/collapse button */}
                <button
                  type="button"
                  onClick={() => setGlobeExpanded(e => !e)}
                  className="absolute top-3 right-3 z-20 p-1.5 rounded-lg bg-slate-900/80 border border-slate-700/50 text-slate-400 hover:text-white transition-colors"
                  aria-expanded={globeExpanded}
                  aria-label={globeExpanded ? 'Show side panels' : 'Expand globe'}
                >
                  {globeExpanded ? <Minimize2 className="w-4 h-4" aria-hidden /> : <Maximize2 className="w-4 h-4" aria-hidden />}
                </button>

                {/* Globe interaction hint + ACLED fallback badge */}
                {!isLoading && mapData && (
                  <div className="absolute top-3 left-3 z-20 flex flex-col gap-1.5">
                    <div className="px-2.5 py-1 rounded-full bg-slate-900/80 border border-slate-700/40 backdrop-blur-md text-[9px] text-slate-400 font-mono">
                      Click event · Click globe for country
                    </div>
                    {isUsingFallback && (
                      <div className="px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 backdrop-blur-md text-[9px] text-amber-400 font-mono flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        ACLED Live Data
                      </div>
                    )}
                  </div>
                )}

                {isLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="flex flex-col items-center gap-3">
                      <RefreshCw className="w-10 h-10 text-sky-500 animate-spin" />
                      <p className="text-slate-500 text-sm font-mono">Loading intelligence data...</p>
                    </div>
                  </div>
                ) : mapData ? (
                  <Suspense fallback={<div className="flex items-center justify-center h-full"><RefreshCw className="w-10 h-10 text-sky-500 animate-spin" /></div>}>
                    <GlobalMonitorGlobe
                      events={filteredEvents}
                      clusters={mapData.clusters}
                      instability={mapData.instability}
                      onEventClick={handleEventClick}
                      onCountryClick={handleCountryClick}
                      autoRotate={autoRotate}
                      showLabels={true}
                    />
                  </Suspense>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-3">
                    <AlertTriangle className="w-10 h-10 text-yellow-500" />
                    <p className="text-slate-400 text-sm">Data unavailable</p>
                  </div>
                )}

                {/* Globe overlay badges */}
                {mapData && !isLoading && (
                  <div className="absolute bottom-3 left-3 z-20 flex gap-2">
                    <div className="px-2.5 py-1 rounded-full bg-slate-900/85 border border-slate-700/50 backdrop-blur-md flex items-center gap-1.5">
                      <Activity className="w-3 h-3 text-sky-400" />
                      <span className="text-[9px] font-bold text-slate-200">{filteredEvents.length} Events</span>
                    </div>
                    {mapData.stats.critical_events > 0 && (
                      <div className="px-2.5 py-1 rounded-full bg-red-500/20 border border-red-500/30 backdrop-blur-md flex items-center gap-1.5 animate-pulse">
                        <AlertTriangle className="w-3 h-3 text-red-400" />
                        <span className="text-[9px] font-bold text-red-200">{mapData.stats.critical_events} Critical</span>
                      </div>
                    )}
                    {selectedCountry && (
                      <div className="px-2.5 py-1 rounded-full bg-sky-500/20 border border-sky-500/30 backdrop-blur-md flex items-center gap-1.5">
                        <Globe className="w-3 h-3 text-sky-400" />
                        <span className="text-[9px] font-bold text-sky-200">{selectedCountry.name}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Globe legend */}
                {mapData && !isLoading && (
                  <div className="absolute bottom-3 right-3 z-20">
                    <div className="px-2 py-1.5 rounded-lg bg-slate-900/85 border border-slate-700/40 backdrop-blur-md space-y-1">
                      {[
                        { label: 'Critical', color: 'bg-red-500' },
                        { label: 'High', color: 'bg-orange-500' },
                        { label: 'Medium', color: 'bg-yellow-500' },
                        { label: 'Hotspot', color: 'bg-purple-500', ring: true },
                      ].map(l => (
                        <div key={l.label} className="flex items-center gap-1.5">
                          <div className={`w-1.5 h-1.5 rounded-full ${l.color}`} />
                          <span className="text-[8px] text-slate-400 font-mono">{l.label}</span>
                        </div>
                      ))}
                      <div className="pt-1 border-t border-slate-700/40">
                        <div className="text-[7px] text-slate-600 font-mono">HEX = Event density</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT: Event Impact Panel */}
              {!globeExpanded && (
                <div style={{ height: '520px' }}>
                  <Suspense fallback={<PanelShimmer height="h-full" />}>
                    <EventImpactPanel
                      selectedEvent={selectedEvent}
                      selectedCountry={selectedCountry}
                      mapData={mapData ?? null}
                      onClear={handleClearSelection}
                    />
                  </Suspense>
                </div>
              )}
            </motion.div>

            {/* ══ INTELLIGENCE GRID: 3-column ════════════════════════════ */}
            <motion.section
              className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3"
              aria-label="Intelligence widgets"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.45, delay: 0.1 }}
            >

              {/* Market Radar */}
              <div className="rounded-xl overflow-hidden h-[34rem]">
                <Suspense fallback={<PanelShimmer height="h-72" />}>
                  <div className="h-full overflow-y-auto">
                    <MarketRadarPanel />
                  </div>
                </Suspense>
              </div>

              {/* Economic Indicators */}
              <div className="rounded-xl overflow-hidden h-[34rem]">
                <Suspense fallback={<PanelShimmer height="h-80" />}>
                  <div className="h-full overflow-y-auto">
                    <EconomicIndicatorsPanel />
                  </div>
                </Suspense>
              </div>

              {/* Polymarket Finance */}
              <div className="rounded-xl overflow-hidden h-[34rem]">
                <Suspense fallback={<PanelShimmer height="h-64" />}>
                  <div className="h-full overflow-y-auto">
                    <PolymarketFinancePanel />
                  </div>
                </Suspense>
              </div>

              {/* Commodities */}
              <div className="rounded-xl overflow-hidden h-[34rem]">
                <Suspense fallback={<PanelShimmer height="h-56" />}>
                  <div className="h-full overflow-y-auto">
                    <CommoditiesWidget />
                  </div>
                </Suspense>
              </div>

              {/* Trade Policy */}
              <div className="rounded-xl overflow-hidden h-[34rem]">
                <Suspense fallback={<PanelShimmer height="h-72" />}>
                  <div className="h-full overflow-y-auto">
                    <TradePolicyPanel />
                  </div>
                </Suspense>
              </div>

              {/* Strategic Risk */}
              <div className="rounded-xl overflow-hidden h-[34rem]">
                <Suspense fallback={<PanelShimmer height="h-72" />}>
                  <div className="h-full overflow-y-auto">
                    <StrategicRiskPanel />
                  </div>
                </Suspense>
              </div>

              {/* Security Advisories */}
              <div className="rounded-xl overflow-hidden h-[34rem]">
                <Suspense fallback={<PanelShimmer height="h-80" />}>
                  <div className="h-full overflow-y-auto">
                    <SecurityAdvisoriesPanel />
                  </div>
                </Suspense>
              </div>

              {/* Continent News - spans 2 cols */}
              <div className="md:col-span-2 rounded-xl overflow-hidden h-[34rem]">
                <Suspense fallback={<PanelShimmer height="h-96" />}>
                  <div className="h-full overflow-y-auto">
                    <ContinentNewsFeedGrid />
                  </div>
                </Suspense>
              </div>

            </motion.section>

          </div>
        </div>
      </div>
    </AppLayout>
  )
}

// ─── Mobile Layout ───────────────────────────────────────────────────

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

  const sections: { id: string; label: string; Icon: LucideIcon }[] = [
    { id: 'live', label: 'Live', Icon: Radio },
    { id: 'markets', label: 'Markets', Icon: TrendingUp },
    { id: 'risk', label: 'Risk', Icon: Shield },
    { id: 'news', label: 'News', Icon: Globe },
    { id: 'policy', label: 'Policy', Icon: FileText },
  ]

  return (
    <MobileLayout>
      <div className="flex flex-col min-h-screen pb-20 bg-[#0A0E1A]">

        {/* Sticky header */}
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
                    {isLoading ? 'SYNCING...' : `LIVE · ${events.length} EVENTS`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Link
                  href="/about"
                  className="p-2 rounded-xl bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-cyan-300 active:scale-90 transition-all"
                  aria-label="About this product"
                >
                  <Info className="w-4 h-4" aria-hidden />
                </Link>
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="p-2 rounded-xl bg-slate-800/60 border border-slate-700/50 text-slate-400 active:scale-90 transition-all"
                  aria-label="Refresh monitor data"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-sky-400' : ''}`} />
                </button>
              </div>
            </div>
          </div>

          {/* Section nav */}
          <nav className="flex gap-1 px-4 pb-2 overflow-x-auto no-scrollbar" aria-label="Monitor sections">
            {sections.map((sec, i) => (
              <a
                key={sec.id}
                href={`#mobile-${sec.id}`}
                onClick={() => setActiveSection(i)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-medium whitespace-nowrap transition-all border ${activeSection === i ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-slate-800/40 text-slate-400 border-slate-700/30'}`}
              >
                <sec.Icon className="w-3 h-3 shrink-0 opacity-90" aria-hidden />
                {sec.label}
              </a>
            ))}
          </nav>
        </div>

        {/* World Clock */}
        <div className="px-4 pt-4">
          <Suspense fallback={<div className="h-16 bg-slate-800/30 rounded-xl animate-pulse" />}>
            <WorldClockWidget />
          </Suspense>
        </div>

        {/* Stock ticker */}
        <div className="mt-3">
          <Suspense fallback={<div className="h-8 bg-slate-950/80" />}>
            <GlobalStockTicker events={events} />
          </Suspense>
        </div>

        {/* Globe */}
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
                  onEventClick={setSelectedEvent}
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

        {/* Live Events */}
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
              <LiveEventsFeed events={events} onEventClick={setSelectedEvent} maxItems={30} />
            </Suspense>
          </div>
        </div>

        {/* Markets */}
        <div id="mobile-markets" className="px-4 mt-6 space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
              <TrendingDown className="w-3 h-3 text-emerald-400" />
              <span className="text-[11px] font-bold text-emerald-300 uppercase tracking-wider">Markets & Predictions</span>
            </div>
          </div>
          <Suspense fallback={<PanelShimmer height="h-64" />}><MarketRadarPanel /></Suspense>
          <Suspense fallback={<PanelShimmer height="h-72" />}><PolymarketFinancePanel /></Suspense>
          <Suspense fallback={<PanelShimmer height="h-80" />}><EconomicIndicatorsPanel /></Suspense>
          <Suspense fallback={<PanelShimmer height="h-56" />}><CommoditiesWidget /></Suspense>
        </div>

        {/* Risk */}
        <div id="mobile-risk" className="px-4 mt-6 space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-orange-500/10 border border-orange-500/30">
              <AlertTriangle className="w-3 h-3 text-orange-400" />
              <span className="text-[11px] font-bold text-orange-300 uppercase tracking-wider">Risk & Security</span>
            </div>
          </div>
          <Suspense fallback={<PanelShimmer height="h-72" />}><StrategicRiskPanel /></Suspense>
          <Suspense fallback={<PanelShimmer height="h-80" />}><SecurityAdvisoriesPanel /></Suspense>
        </div>

        {/* News */}
        <div id="mobile-news" className="px-4 mt-6">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-500/10 border border-sky-500/30">
              <Globe className="w-3 h-3 text-sky-400" />
              <span className="text-[11px] font-bold text-sky-300 uppercase tracking-wider">Global News</span>
            </div>
          </div>
          <Suspense fallback={<PanelShimmer height="h-96" />}><ContinentNewsFeedGrid /></Suspense>
        </div>

        {/* Policy */}
        <div id="mobile-policy" className="px-4 mt-6 mb-8">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-500/10 border border-violet-500/30">
              <Filter className="w-3 h-3 text-violet-400" />
              <span className="text-[11px] font-bold text-violet-300 uppercase tracking-wider">Trade Policy</span>
            </div>
          </div>
          <Suspense fallback={<PanelShimmer height="h-72" />}><TradePolicyPanel /></Suspense>
        </div>

        {/* Mobile event impact drawer */}
        {selectedEvent && (
          <div className="fixed inset-0 z-50 flex items-end justify-center">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setSelectedEvent(null)} />
            <div className="bg-slate-900 w-full max-h-[85vh] rounded-t-3xl border-t border-slate-700/70 flex flex-col overflow-hidden relative animate-slide-up-mobile">
              <div className="flex justify-center pt-3 pb-1" onClick={() => setSelectedEvent(null)}>
                <div className="w-12 h-1.5 bg-slate-700/60 rounded-full" />
              </div>
              <div className="flex-1 overflow-y-auto">
                <Suspense fallback={<div className="h-40 flex items-center justify-center"><RefreshCw className="animate-spin text-sky-500" /></div>}>
                  <EventImpactPanel
                    selectedEvent={selectedEvent}
                    selectedCountry={null}
                    mapData={mapData ?? null}
                    onClear={() => setSelectedEvent(null)}
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

// ─── Page Export ─────────────────────────────────────────────────────

export default function MonitorPage() {
  return (
    <>
      <div className="hidden md:block"><MonitorDesktop /></div>
      <div className="md:hidden"><MonitorMobile /></div>
    </>
  )
}
