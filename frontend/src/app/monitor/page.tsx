'use client'

/**
 * QuantTrade AI — Global Monitor Page
 * Bloomberg Terminal-grade geopolitical intelligence dashboard
 * Full redesign with Framer Motion animations, real globe, and live data feeds
 */

import { useState, useMemo, Suspense, lazy, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import {
  Globe, Activity, AlertTriangle, TrendingDown, TrendingUp, Zap, Filter,
  RefreshCw, Maximize2, Minimize2, Radio, Crosshair, Landmark, CloudLightning,
  Plane, Ship, Lock, CircleDollarSign, Thermometer, Info, Shield, FileText,
  ChevronRight, Bell, Eye, BarChart3, Map, Clock, Layers,
} from 'lucide-react'
import {
  fetchMapData, fetchMonitorStats,
  type MapData, type GlobalEvent,
  type GeographicCluster, type CountryInstability,
} from '@/lib/global-monitor-api'
import { fetchACLEDConflicts, type ACLEDEvent } from '@/lib/monitor-extended-api'

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
  for (let i = 0; i < seed.length; i += 1) { hash = (hash * 31 + seed.charCodeAt(i)) >>> 0 }
  return { latitude: ((hash % 12500) / 100) - 55, longitude: (((Math.floor(hash / 12500) % 34000) / 100) - 170) }
}

function synthesizeFromACLED(acledEvents: ACLEDEvent[]): MapData {
  const events: GlobalEvent[] = acledEvents.map((e, i) => ({
    ...(() => {
      const hasRealCoords = Number.isFinite(e.latitude) && Number.isFinite(e.longitude) && !(Math.abs(e.latitude) < 0.0001 && Math.abs(e.longitude) < 0.0001)
      return hasRealCoords ? { latitude: e.latitude, longitude: e.longitude } : hashToPseudoCoords(`${e.country || 'unknown'}-${e.event_type || 'event'}-${i}`)
    })(),
    id: i + 1, event_id: e.event_id || `acled-${i}`, source: 'acled',
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
    is_anomaly: e.fatalities > 30, raw_data: null,
  }))
  const countryEvents = events.reduce((acc, e) => {
    const k = e.country_code || 'XX'
    if (!acc[k]) acc[k] = { lat: e.latitude, lng: e.longitude, events: [], code: k }
    acc[k].events.push(e)
    return acc
  }, {} as Record<string, { lat: number; lng: number; events: GlobalEvent[]; code: string }>)
  const clusters: GeographicCluster[] = Object.values(countryEvents).filter(c => c.events.length >= 2).slice(0, 20).map((c, i) => {
    const critical = c.events.filter(e => e.threat_level === 'critical').length
    const high = c.events.filter(e => e.threat_level === 'high').length
    return { id: i + 1, cell_id: `acled-${c.code}`, cell_lat: c.lat, cell_lon: c.lng, event_count: c.events.length, distinct_categories: 1, avg_severity: c.events.reduce((s, e) => s + (e.severity || 0), 0) / c.events.length, max_threat_level: critical > 0 ? 'critical' : high > 0 ? 'high' : 'medium', is_hotspot: c.events.length >= 3, hotspot_score: c.events.length * 5, event_ids: c.events.map(e => e.event_id), category_breakdown: { conflict: c.events.length }, affected_tickers: [] }
  })
  const instability: CountryInstability[] = Object.values(countryEvents).map(c => {
    const totalFatalities = c.events.reduce((s, e) => s + (e.severity || 0), 0)
    const idx = Math.min(95, 10 + totalFatalities / 5 + c.events.length * 3)
    return { country_code: c.code, country_name: Object.entries(COUNTRY_CODE_MAP).find(([, v]) => v === c.code)?.[0] || c.code, instability_index: idx, risk_level: idx >= 75 ? 'critical' : idx >= 50 ? 'high' : idx >= 30 ? 'medium' : 'low', conflict_score: Math.min(100, c.events.filter(e => e.category === 'conflict').length * 10), political_score: Math.min(100, c.events.filter(e => e.category === 'political').length * 10), disaster_score: 0, economic_score: 10, active_event_count: c.events.length, critical_event_count: c.events.filter(e => e.threat_level === 'critical').length, calculated_at: new Date().toISOString() }
  }).sort((a, b) => b.instability_index - a.instability_index).slice(0, 30)
  const critical = events.filter(e => e.threat_level === 'critical').length
  const high = events.filter(e => e.threat_level === 'high').length
  return { events, clusters, instability, anomalies: [], stats: { total_events: events.length, critical_events: critical, high_threat_events: high, total_hotspots: clusters.filter(c => c.is_hotspot).length, countries_monitored: Object.keys(countryEvents).length, high_risk_countries: instability.filter(c => c.risk_level === 'high' || c.risk_level === 'critical').length, anomalies_detected: events.filter(e => e.is_anomaly).length, last_updated: new Date().toISOString(), time_window_hours: 168 } }
}

// Lazy load heavy components
const GlobalMonitorGlobe = lazy(() => import('@/components/GlobalMonitorGlobe'))
const EventImpactPanel = lazy(() => import('@/components/monitor/EventImpactPanel'))
const GlobalStockTicker = lazy(() => import('@/components/monitor/GlobalStockTicker'))
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
const CobeMonitorGlobe = lazy(() => import('@/components/monitor/CobeMonitorGlobe'))
const DottedFlatMap    = lazy(() => import('@/components/monitor/DottedFlatMap'))

function PanelShimmer({ height = 'h-48' }: { height?: string }) {
  return (
    <div className={`${height} rounded-xl border border-line-subtle animate-pulse overflow-hidden relative`}>
      <div className="absolute inset-0 bg-surface-raised/80" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin" />
      </div>
    </div>
  )
}

interface SelectedCountry { code: string; name: string; lat: number; lng: number }

// ── Threat level config ──────────────────────────────────────────────
const THREAT_LEVELS = [
  { value: 'critical', label: 'Critical', color: 'text-red-400', bg: 'bg-red-500/15 border-red-500/50', dot: 'bg-red-500' },
  { value: 'high', label: 'High', color: 'text-orange-400', bg: 'bg-orange-500/15 border-orange-500/50', dot: 'bg-orange-500' },
  { value: 'medium', label: 'Medium', color: 'text-yellow-400', bg: 'bg-yellow-500/15 border-yellow-500/50', dot: 'bg-yellow-500' },
  { value: 'low', label: 'Low', color: 'text-sky-400', bg: 'bg-sky-500/15 border-sky-500/50', dot: 'bg-sky-500' },
  { value: 'unknown', label: 'Monitor', color: 'text-slate-400', bg: 'bg-slate-500/15 border-slate-500/50', dot: 'bg-slate-500' },
]

const CATEGORIES: { value: string; label: string; Icon: LucideIcon }[] = [
  { value: 'conflict', label: 'Conflict', Icon: Crosshair },
  { value: 'political', label: 'Political', Icon: Landmark },
  { value: 'disaster', label: 'Disaster', Icon: CloudLightning },
  { value: 'aviation', label: 'Aviation', Icon: Plane },
  { value: 'shipping', label: 'Shipping', Icon: Ship },
  { value: 'cyber', label: 'Cyber', Icon: Lock },
  { value: 'economic', label: 'Economic', Icon: CircleDollarSign },
  { value: 'climate', label: 'Climate', Icon: Thermometer },
]

// WorldMonitor-style intelligence layers (maps to categories for filtering)
const WORLD_LAYERS: {
  id: string; label: string; emoji: string; color: string
  categories: string[]; desc: string
}[] = [
  { id: 'conflict',    label: 'Conflicts',    emoji: '⚔️',  color: '#ef4444', categories: ['conflict'],           desc: 'Armed conflicts & battles' },
  { id: 'cyberThreats',label: 'Cyber',        emoji: '🛡️',  color: '#f43f5e', categories: ['cyber'],              desc: 'Cyber attacks & intrusions' },
  { id: 'natural',     label: 'Natural',      emoji: '🌋',  color: '#f97316', categories: ['disaster'],            desc: 'Earthquakes, floods, fires' },
  { id: 'weather',     label: 'Weather',      emoji: '⛈️',  color: '#60a5fa', categories: ['climate'],            desc: 'Severe weather events' },
  { id: 'sanctions',   label: 'Sanctions',    emoji: '🚫',  color: '#a78bfa', categories: ['political'],          desc: 'Sanctions & trade bans' },
  { id: 'economic',    label: 'Economic',     emoji: '📊',  color: '#34d399', categories: ['economic'],           desc: 'Market-moving indicators' },
  { id: 'waterways',   label: 'Waterways',    emoji: '🚢',  color: '#0ea5e9', categories: ['shipping'],           desc: 'Maritime & port disruptions' },
  { id: 'tradeRoutes', label: 'Trade Routes', emoji: '🗺️',  color: '#00d4ff', categories: ['shipping','economic'],desc: 'Global trade route events' },
  { id: 'pipelines',   label: 'Pipelines',    emoji: '⚡',  color: '#fbbf24', categories: ['economic'],           desc: 'Energy infrastructure' },
  { id: 'outages',     label: 'Outages',      emoji: '💡',  color: '#fb923c', categories: ['disaster'],           desc: 'Power & grid outages' },
  { id: 'aviation',    label: 'Aviation',     emoji: '✈️',  color: '#818cf8', categories: ['aviation'],           desc: 'ADS-B flight events' },
  { id: 'political',   label: 'Political',    emoji: '🏛️',  color: '#e879f9', categories: ['political'],          desc: 'Protests, coups, elections' },
]

// ── Stat card component ──────────────────────────────────────────────
function StatCard({ label, value, color, icon: Icon, sublabel }: { label: string; value: number | string; color: string; icon?: LucideIcon; sublabel?: string }) {
  return (
    <motion.div
      className={`relative overflow-hidden rounded-xl border bg-surface-raised backdrop-blur-sm px-4 py-3 ${color.includes('red') ? 'border-red-900/40' : color.includes('orange') ? 'border-orange-900/40' : color.includes('yellow') ? 'border-yellow-900/40' : color.includes('purple') ? 'border-purple-900/40' : color.includes('sky') ? 'border-sky-900/40' : 'border-line-subtle'}`}
      whileHover={{ scale: 1.02 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] font-bold uppercase tracking-widest text-fg-muted">{label}</span>
        {Icon && <Icon className={`w-3 h-3 ${color}`} />}
      </div>
      <div className={`text-2xl font-black tabular-nums ${color} font-mono leading-none`}>{value}</div>
      {sublabel && <div className="text-[9px] text-fg-muted font-mono mt-0.5">{sublabel}</div>}
    </motion.div>
  )
}

// ── Main desktop monitor ─────────────────────────────────────────────
function MonitorDesktop() {
  const [selectedEvent, setSelectedEvent] = useState<GlobalEvent | null>(null)
  const [selectedCountry, setSelectedCountry] = useState<SelectedCountry | null>(null)
  const [timeWindow, setTimeWindow] = useState(24)
  const [showFilters, setShowFilters] = useState(false)
  const [autoRotate, setAutoRotate] = useState(true)
  const [globeExpanded, setGlobeExpanded] = useState(false)
  const [viewMode, setViewMode] = useState<'globe' | 'cobe' | 'dotted'>('cobe')
  const [activeThreats, setActiveThreats] = useState<Set<string>>(new Set(THREAT_LEVELS.map(t => t.value)))
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set(CATEGORIES.map(c => c.value)))
  const [activeLayers, setActiveLayers] = useState<Set<string>>(new Set(WORLD_LAYERS.map(l => l.id)))

  const { data: rawMapData, isLoading, refetch } = useQuery<MapData>({
    queryKey: ['monitor-map-data', timeWindow],
    queryFn: () => fetchMapData(timeWindow, true),
    refetchInterval: 120_000,
    staleTime: 25000,
  })

  useQuery({ queryKey: ['monitor-stats'], queryFn: fetchMonitorStats, refetchInterval: 300_000 })

  const needsAcledFallback = !isLoading && (!rawMapData?.events || rawMapData.events.length === 0)
  const { data: acledData } = useQuery({
    queryKey: ['acled-fallback'],
    queryFn: () => fetchACLEDConflicts(150),
    enabled: needsAcledFallback,
    refetchInterval: 300000, staleTime: 120000,
  })

  const mapData: MapData | undefined = useMemo(() => {
    if (rawMapData && rawMapData.events.length > 0) return rawMapData
    if (acledData && acledData.events.length > 0) return synthesizeFromACLED(acledData.events)
    return rawMapData
  }, [rawMapData, acledData])

  const isUsingFallback = !!acledData && (!rawMapData?.events || rawMapData.events.length === 0)

  const toggleThreat = (val: string) => { const n = new Set(activeThreats); n.has(val) ? n.delete(val) : n.add(val); setActiveThreats(n) }
  const toggleCategory = (val: string) => { const n = new Set(activeCategories); n.has(val) ? n.delete(val) : n.add(val); setActiveCategories(n) }
  const toggleLayer = (id: string) => { const n = new Set(activeLayers); n.has(id) ? n.delete(id) : n.add(id); setActiveLayers(n) }

  // Build a category set from active layers (union of all active layer categories) — must come before filteredEvents
  const layerActiveCategories = useMemo(() => {
    const cats = new Set<string>()
    WORLD_LAYERS.forEach(l => { if (activeLayers.has(l.id)) l.categories.forEach(c => cats.add(c)) })
    return cats
  }, [activeLayers])

  const filteredEvents = useMemo(() =>
    (mapData?.events || []).filter(event =>
      activeThreats.has(event.threat_level || 'unknown') &&
      (!event.category || activeCategories.has(event.category)) &&
      (!event.category || layerActiveCategories.has(event.category) || layerActiveCategories.size === 0)),
    [mapData, activeThreats, activeCategories, layerActiveCategories])

  const handleEventClick = useCallback((event: GlobalEvent) => { setSelectedEvent(event); setSelectedCountry(null); setAutoRotate(false) }, [])
  const handleCountryClick = useCallback((country: SelectedCountry) => { setSelectedCountry(country); setSelectedEvent(null); setAutoRotate(false) }, [])
  const handleClearSelection = useCallback(() => { setSelectedEvent(null); setSelectedCountry(null) }, [])

  const criticalCount = mapData?.stats.critical_events ?? 0
  const highCount = mapData?.stats.high_threat_events ?? 0

  return (
    <AppLayout>
      <div className="min-h-screen bg-surface-base text-fg-primary flex flex-col -mx-4 md:-mx-6 -my-4 md:-my-6">

        {/* ── TOP STATUS BAR ─────────────────────────────────────── */}
        <div className="border-b border-line-subtle bg-surface-base/98 backdrop-blur-xl sticky top-0 z-30 shrink-0">

          {/* World clock strip */}
          <div className="border-b border-line-subtle/50 px-4 py-1 flex justify-center">
            <Suspense fallback={<div className="h-7 flex items-center text-[10px] text-fg-muted font-mono">Loading clocks…</div>}>
              <WorldClockWidget />
            </Suspense>
          </div>

          {/* Header row */}
          <div className="px-5 py-3">
            <div className="flex items-center justify-between gap-4">
              {/* Left: Brand + title */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg overflow-hidden bg-surface-raised border border-cyan-500/20 flex items-center justify-center">
                    <Image src="/logo.png" alt="QuantTrade AI" width={28} height={28} className="object-contain" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-sky-400" />
                      <h1 className="text-sm font-black text-white tracking-tight">GLOBAL MONITOR</h1>
                      {isLoading ? (
                        <RefreshCw className="w-3 h-3 text-sky-400 animate-spin" />
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[9px] text-emerald-400 font-bold">
                          <Radio className="w-2 h-2 animate-pulse" /> LIVE
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Critical alert badge */}
                {criticalCount > 0 && (
                  <motion.div
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/15 border border-red-500/40"
                    animate={{ opacity: [1, 0.5, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  >
                    <AlertTriangle className="w-3 h-3 text-red-400" />
                    <span className="text-[10px] font-bold text-red-300">{criticalCount} CRITICAL</span>
                  </motion.div>
                )}
              </div>

              {/* Right: macOS glass controls */}
              <div className="flex items-center gap-2">
                {/* Time window — mac-btn group */}
                <div className="flex items-center gap-0.5 mac-btn p-0.5 rounded-xl">
                  {[24, 72, 168, 720].map(w => (
                    <button key={w} onClick={() => setTimeWindow(w)}
                      className={`mac-btn mac-btn-pill text-[10px] font-mono py-1 px-3 ${timeWindow === w ? 'mac-btn-active' : ''}`}>
                      {w === 24 ? '24H' : w === 72 ? '3D' : w === 168 ? '7D' : '30D'}
                    </button>
                  ))}
                </div>
                {/* View mode toggle */}
                <div className="flex items-center gap-0.5 mac-btn p-0.5 rounded-xl">
                  {([
                    { key: 'cobe', label: '🌐 Globe' },
                    { key: 'dotted', label: '🗺 Map' },
                    { key: 'globe', label: '🌍 HD' },
                  ] as const).map(m => (
                    <button key={m.key} onClick={() => setViewMode(m.key)}
                      className={`mac-btn mac-btn-pill text-[10px] py-1 px-2.5 ${viewMode === m.key ? 'mac-btn-active' : ''}`}>
                      {m.label}
                    </button>
                  ))}
                </div>
                {/* Filter */}
                <button onClick={() => setShowFilters(f => !f)}
                  className={`mac-btn mac-btn-pill text-[10px] flex items-center gap-1.5 ${showFilters ? 'mac-btn-active' : ''}`}>
                  <Filter className="w-3 h-3" /> Layers
                  <span className="text-[9px] font-mono opacity-70">{activeLayers.size}/{WORLD_LAYERS.length}</span>
                  {(activeThreats.size < THREAT_LEVELS.length || activeCategories.size < CATEGORIES.length || activeLayers.size < WORLD_LAYERS.length) && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />}
                </button>
                {/* Refresh */}
                <button onClick={() => refetch()} className="mac-btn mac-btn-icon" title="Refresh">
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                {/* Auto-rotate */}
                <button onClick={() => setAutoRotate(r => !r)}
                  className={`mac-btn mac-btn-pill text-[10px] flex items-center gap-1.5 ${autoRotate ? 'mac-btn-active' : ''}`}
                  title={autoRotate ? 'Pause rotation' : 'Auto-rotate globe'}>
                  <Activity className={`w-3 h-3 ${autoRotate ? 'text-cyan-400' : ''}`} />
                  {autoRotate ? 'ROTATING' : 'PAUSED'}
                </button>
                {/* Expand */}
                <button onClick={() => setGlobeExpanded(e => !e)} className="mac-btn mac-btn-icon" aria-label={globeExpanded ? 'Collapse' : 'Expand globe'}>
                  {globeExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Stat strip */}
            {mapData && (
              <motion.div
                className="mt-3 grid grid-cols-6 gap-2"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <StatCard label="Events" value={mapData.stats.total_events} color="text-slate-200" sublabel="total monitored" />
                <StatCard label="Critical" value={mapData.stats.critical_events} color="text-red-400" icon={AlertTriangle} sublabel="immediate action" />
                <StatCard label="High" value={mapData.stats.high_threat_events} color="text-orange-400" icon={Zap} sublabel="elevated risk" />
                <StatCard label="Hotspots" value={mapData.stats.total_hotspots} color="text-purple-400" icon={Map} sublabel="cluster zones" />
                <StatCard label="At Risk" value={mapData.stats.high_risk_countries} color="text-yellow-400" icon={Shield} sublabel="nations flagged" />
                <StatCard label="Anomalies" value={mapData.stats.anomalies_detected} color="text-sky-400" icon={Eye} sublabel="AI-flagged" />
              </motion.div>
            )}

            {/* Filter panel */}
            <AnimatePresence>
              {showFilters && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="mt-3 overflow-hidden"
                >
                  <div className="p-3 bg-surface-hover rounded-xl border border-line-default space-y-4">
                    {/* Row 1: Threat + Category */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-fg-muted mb-2">Threat Level</div>
                        <div className="flex flex-wrap gap-1.5">
                          {THREAT_LEVELS.map(l => (
                            <button key={l.value} onClick={() => toggleThreat(l.value)}
                              className={`px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all flex items-center gap-1.5 ${activeThreats.has(l.value) ? l.bg + ' ' + l.color : 'bg-surface-raised border-line-default text-fg-muted'}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${activeThreats.has(l.value) ? l.dot : 'bg-line-default'}`} />
                              {l.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-fg-muted mb-2">Category</div>
                        <div className="flex flex-wrap gap-1.5">
                          {CATEGORIES.map(c => (
                            <button key={c.value} onClick={() => toggleCategory(c.value)}
                              className={`px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all flex items-center gap-1.5 ${activeCategories.has(c.value) ? 'bg-sky-500/15 border-sky-500/50 text-sky-300' : 'bg-surface-raised border-line-default text-fg-muted'}`}
                            >
                              <c.Icon className="w-2.5 h-2.5" />
                              {c.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Row 2: WorldMonitor Intelligence Layers */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-fg-muted">
                          Intelligence Layers
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setActiveLayers(new Set(WORLD_LAYERS.map(l => l.id)))}
                            className="text-[9px] text-sky-500 hover:text-sky-300 font-mono transition-colors">ALL ON</button>
                          <span className="text-fg-muted">·</span>
                          <button onClick={() => setActiveLayers(new Set())}
                            className="text-[9px] text-fg-muted hover:text-fg-secondary font-mono transition-colors">ALL OFF</button>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5">
                        {WORLD_LAYERS.map(layer => (
                          <motion.button
                            key={layer.id}
                            onClick={() => toggleLayer(layer.id)}
                            whileTap={{ scale: 0.93 }}
                            title={layer.desc}
                            className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-bold border transition-all overflow-hidden ${
                              activeLayers.has(layer.id)
                                ? 'border-opacity-50 text-white'
                                : 'bg-surface-raised border-line-subtle text-fg-muted'
                            }`}
                            style={activeLayers.has(layer.id) ? {
                              background: `${layer.color}18`,
                              borderColor: `${layer.color}55`,
                              color: layer.color,
                              boxShadow: `0 0 12px ${layer.color}20`,
                            } : {}}
                          >
                            <span className="text-[12px] leading-none">{layer.emoji}</span>
                            <span className="truncate">{layer.label}</span>
                            {activeLayers.has(layer.id) && (
                              <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full animate-pulse"
                                style={{ background: layer.color }} />
                            )}
                          </motion.button>
                        ))}
                      </div>
                      <div className="mt-1.5 text-[9px] text-fg-muted font-mono">
                        {activeLayers.size}/{WORLD_LAYERS.length} layers active · Data: ACLED, GDELT, USGS, OpenSky, AIS Stream, EIA
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Global stock impact ticker */}
          <div className="border-t border-line-subtle/50 pb-1">
            <Suspense fallback={<div className="h-8 bg-surface-base" />}>
              <GlobalStockTicker events={filteredEvents} />
            </Suspense>
          </div>

          {/* ACLED fallback badge */}
          {isUsingFallback && (
            <div className="px-5 pb-2 flex items-center gap-2">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 text-[9px] text-amber-400 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                ACLED Live Fallback Active
              </div>
            </div>
          )}
        </div>

        {/* ── MAIN CONTENT ─────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-4">

            {/* ── HERO ROW: Events | Globe | Impact ─────────────── */}
            <motion.div
              className="space-y-4"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            >
              <div
                className="grid gap-4"
                style={{
                  gridTemplateColumns: globeExpanded
                    ? '1fr'
                    : 'minmax(260px, 0.85fr) minmax(0, 1.5fr) minmax(300px, 1fr)',
                }}
              >
                {/* LEFT: Live events feed */}
                {!globeExpanded && (
                  <div className="bg-surface-base/90 border border-line-subtle rounded-2xl overflow-hidden flex flex-col" style={{ height: '540px' }}>
                    <div className="px-4 py-3 border-b border-line-subtle flex items-center justify-between shrink-0">
                      <div className="flex items-center gap-2">
                        <Radio className="w-3.5 h-3.5 text-sky-400 animate-pulse" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-fg-secondary">Live Events</span>
                      </div>
                      <div className="text-[10px] font-mono text-fg-muted">{filteredEvents.length} active</div>
                    </div>
                    <Suspense fallback={<PanelShimmer height="h-full" />}>
                      <LiveEventsFeed events={filteredEvents} onEventClick={handleEventClick} maxItems={80} />
                    </Suspense>
                  </div>
                )}

                {/* CENTER: Globe / Flat Map */}
                <div className="relative bg-slate-950 border border-slate-800/60 rounded-2xl overflow-hidden" style={{ height: globeExpanded ? '620px' : '540px' }}>
                  {/* Expand button */}
                  <div className="absolute top-3 right-3 z-20">
                    <button onClick={() => setGlobeExpanded(e => !e)} className="mac-btn mac-btn-icon" aria-label={globeExpanded ? 'Shrink' : 'Expand'}>
                      {globeExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {isLoading ? (
                    <div className="flex items-center justify-center h-full flex-col gap-4">
                      <div className="relative w-16 h-16">
                        <div className="absolute inset-0 rounded-full border-2 border-sky-500/20 animate-ping" />
                        <div className="absolute inset-2 rounded-full border-2 border-cyan-400/30 animate-spin" style={{ borderTopColor: '#00d4ff' }} />
                        <Globe className="absolute inset-0 m-auto w-6 h-6 text-cyan-400" />
                      </div>
                      <p className="text-fg-muted text-[11px] font-mono tracking-wider animate-pulse">LOADING INTELLIGENCE DATA</p>
                    </div>
                  ) : mapData ? (
                    <AnimatePresence mode="wait">
                      {viewMode === 'cobe' ? (
                        <motion.div key="cobe" className="w-full h-full"
                          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
                          <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="w-10 h-10 border-2 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin" /></div>}>
                            <CobeMonitorGlobe
                              events={filteredEvents} clusters={mapData.clusters} instability={mapData.instability}
                              onEventClick={handleEventClick} onCountryClick={handleCountryClick}
                              autoRotate={autoRotate} showLabels={true}
                            />
                          </Suspense>
                        </motion.div>
                      ) : viewMode === 'dotted' ? (
                        <motion.div key="dotted" className="w-full h-full"
                          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
                          <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="w-10 h-10 border-2 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin" /></div>}>
                            <DottedFlatMap events={filteredEvents} onEventClick={handleEventClick} />
                          </Suspense>
                        </motion.div>
                      ) : viewMode === 'globe' ? (
                        <motion.div key="globe" className="w-full h-full"
                          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
                          <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="w-10 h-10 border-2 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin" /></div>}>
                            <GlobalMonitorGlobe
                              events={filteredEvents} clusters={mapData.clusters} instability={mapData.instability}
                              onEventClick={handleEventClick} onCountryClick={handleCountryClick}
                              autoRotate={autoRotate} showLabels={true}
                            />
                          </Suspense>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full gap-3">
                      <AlertTriangle className="w-10 h-10 text-yellow-500" />
                      <p className="text-fg-secondary text-sm">Intelligence data unavailable</p>
                    </div>
                  )}
                </div>

                {/* RIGHT: Event Impact Panel */}
                {!globeExpanded && (
                  <div style={{ height: '540px' }}>
                    <Suspense fallback={<PanelShimmer height="h-full" />}>
                      <EventImpactPanel selectedEvent={selectedEvent} selectedCountry={selectedCountry} mapData={mapData ?? null} onClear={handleClearSelection} />
                    </Suspense>
                  </div>
                )}
              </div>

              {/* Expanded mode: Live Events + Event Impact side by side below map */}
              {globeExpanded && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-surface-base/90 border border-line-subtle rounded-2xl overflow-hidden flex flex-col" style={{ height: '400px' }}>
                    <div className="px-4 py-3 border-b border-line-subtle flex items-center justify-between shrink-0">
                      <div className="flex items-center gap-2">
                        <Radio className="w-3.5 h-3.5 text-sky-400 animate-pulse" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-fg-secondary">Live Events</span>
                      </div>
                      <div className="text-[10px] font-mono text-fg-muted">{filteredEvents.length} active</div>
                    </div>
                    <Suspense fallback={<PanelShimmer height="h-full" />}>
                      <LiveEventsFeed events={filteredEvents} onEventClick={handleEventClick} maxItems={80} />
                    </Suspense>
                  </div>
                  <div style={{ height: '400px' }}>
                    <Suspense fallback={<PanelShimmer height="h-full" />}>
                      <EventImpactPanel selectedEvent={selectedEvent} selectedCountry={selectedCountry} mapData={mapData ?? null} onClear={handleClearSelection} />
                    </Suspense>
                  </div>
                </div>
              )}
            </motion.div>

            {/* ── INTELLIGENCE GRID ──────────────────────────────── */}
            <motion.section
              className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.15 }}
            >
              {/* Panel wrapper with Bloomberg terminal aesthetic */}
              {[
                { component: <MarketRadarPanel />, label: 'Market Radar', icon: BarChart3 },
                { component: <EconomicIndicatorsPanel />, label: 'Economic Indicators', icon: TrendingUp },
                { component: <PolymarketFinancePanel />, label: 'Prediction Markets', icon: Zap },
                { component: <CommoditiesWidget />, label: 'Commodities', icon: Layers },
                { component: <TradePolicyPanel />, label: 'Trade & Policy', icon: Landmark },
                { component: <StrategicRiskPanel />, label: 'Strategic Risk', icon: Shield },
                { component: <SecurityAdvisoriesPanel />, label: 'Security Advisories', icon: Lock },
              ].map(({ component, label, icon: Icon }, i) => (
                <div key={label} className="rounded-2xl overflow-hidden h-[36rem] border border-line-subtle bg-surface-raised/60 backdrop-blur-sm">
                  <div className="px-4 py-2.5 border-b border-line-subtle flex items-center gap-2 shrink-0">
                    <Icon className="w-3.5 h-3.5 text-sky-400" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-fg-muted">{label}</span>
                  </div>
                  <div className="h-[calc(100%-2.5rem)] overflow-y-auto">
                    <Suspense fallback={<PanelShimmer height="h-full" />}>{component}</Suspense>
                  </div>
                </div>
              ))}

              {/* Continent news - full width below all panels */}
              <div className="col-span-full rounded-2xl overflow-hidden h-[36rem] border border-line-subtle bg-surface-raised/60 backdrop-blur-sm">
                <div className="px-4 py-2.5 border-b border-line-subtle flex items-center gap-2 shrink-0">
                  <Globe className="w-3.5 h-3.5 text-sky-400" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-fg-muted">World News</span>
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[8px] text-emerald-400 font-bold ml-1">
                    LIVE
                  </span>
                </div>
                <div className="h-[calc(100%-2.5rem)] overflow-y-auto">
                  <Suspense fallback={<PanelShimmer height="h-full" />}><ContinentNewsFeedGrid /></Suspense>
                </div>
              </div>
            </motion.section>

            {/* Data source attribution */}
            <div className="px-1 pb-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[9px] text-fg-muted font-mono">
                <span className="text-fg-secondary font-semibold">DATA:</span>
                {['ACLED (conflict)', 'GDELT (news/events)', 'USGS (earthquakes)', 'OpenSky (ADS-B aviation)', 'AIS Stream (maritime)', 'EIA (energy/pipelines)', 'Polymarket (prediction)'].map(src => (
                  <span key={src} className="flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full bg-line-default" />
                    {src}
                  </span>
                ))}
                <span className="ml-auto text-fg-muted">All geopolitical data is provided for informational purposes only.</span>
              </div>
            </div>

          </div>
        </div>
      </div>
    </AppLayout>
  )
}

// ── Mobile ───────────────────────────────────────────────────────────
function MonitorMobile() {
  const [selectedEvent, setSelectedEvent] = useState<GlobalEvent | null>(null)
  const [activeSection, setActiveSection] = useState(0)

  const { data: mapData, isLoading, refetch } = useQuery<MapData>({
    queryKey: ['monitor-map-data', 24],
    queryFn: () => fetchMapData(24, true),
    refetchInterval: 120000, staleTime: 60000,
  })

  const events = mapData?.events || []

  const sections: { id: string; label: string; Icon: LucideIcon }[] = [
    { id: 'live', label: 'Live', Icon: Radio },
    { id: 'markets', label: 'Markets', Icon: TrendingUp },
    { id: 'economy', label: 'Economy', Icon: Landmark },
    { id: 'risk', label: 'Risk', Icon: Shield },
    { id: 'commodities', label: 'Commodities', Icon: CircleDollarSign },
    { id: 'news', label: 'News', Icon: Globe },
    { id: 'predictions', label: 'Predictions', Icon: BarChart3 },
    { id: 'security', label: 'Security', Icon: Lock },
    { id: 'policy', label: 'Policy', Icon: FileText },
  ]

  return (
    <MobileLayout>
      <div className="flex flex-col min-h-screen pb-20 bg-surface-base">
        {/* Sticky header */}
        <div className="sticky top-0 z-30 bg-surface-base/95 backdrop-blur-xl border-b border-line-subtle">
          <div className="px-4 pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg overflow-hidden bg-surface-raised border border-cyan-500/20">
                  <Image src="/logo.png" alt="QuantTrade AI" width={32} height={32} className="object-contain" />
                </div>
                <div>
                  <h1 className="text-base font-black bg-gradient-to-r from-white to-sky-400 bg-clip-text text-transparent">Global Monitor</h1>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                    </span>
                    <p className="text-[10px] text-fg-secondary font-mono">{isLoading ? 'SYNCING...' : `LIVE · ${events.length} EVENTS`}</p>
                  </div>
                </div>
              </div>
              <button onClick={() => refetch()} className="p-2 rounded-xl bg-surface-hover border border-line-default text-fg-secondary active:scale-90 transition-all">
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-sky-400' : ''}`} />
              </button>
            </div>

            {/* Stat pills */}
            {mapData && (
              <div className="flex gap-2 mt-3 overflow-x-auto no-scrollbar pb-1">
                {[
                  { label: 'Events', value: mapData.stats.total_events, color: 'text-fg-primary' },
                  { label: 'Critical', value: mapData.stats.critical_events, color: 'text-red-400' },
                  { label: 'High', value: mapData.stats.high_threat_events, color: 'text-orange-400' },
                  { label: 'At Risk', value: mapData.stats.high_risk_countries, color: 'text-yellow-400' },
                ].map(s => (
                  <div key={s.label} className="shrink-0 px-3 py-1.5 rounded-full bg-surface-hover border border-line-subtle flex items-center gap-1.5">
                    <span className={`text-xs font-black ${s.color} font-mono`}>{s.value}</span>
                    <span className="text-[10px] text-fg-muted">{s.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section tabs */}
          <nav className="flex gap-1 px-4 pb-3 overflow-x-auto no-scrollbar">
            {sections.map((sec, i) => (
              <a key={sec.id} href={`#mobile-${sec.id}`} onClick={() => setActiveSection(i)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold whitespace-nowrap transition-all border ${activeSection === i ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-surface-hover text-fg-secondary border-line-subtle active:scale-95'}`}
              >
                <sec.Icon className="w-3 h-3" />
                {sec.label}
              </a>
            ))}
          </nav>
        </div>

        {/* Content sections */}
        <div className="flex-1 px-4 py-4 space-y-4">
          {/* Globe Preview */}
          <section id="mobile-globe">
            <div className="bg-surface-raised/80 rounded-2xl border border-line-subtle overflow-hidden h-64 relative">
              <Suspense fallback={<PanelShimmer height="h-full" />}>
                <CobeMonitorGlobe events={events} clusters={mapData?.clusters || []} instability={mapData?.instability || []} />
              </Suspense>
              <div className="absolute bottom-0 inset-x-0 h-16 bg-gradient-to-t from-[var(--surface-base)] to-transparent pointer-events-none" />
            </div>
          </section>

          <section id="mobile-live">
            <div className="flex items-center gap-2 mb-3">
              <Radio className="w-3.5 h-3.5 text-sky-400 animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-widest text-fg-muted">Live Events</span>
            </div>
            <div className="bg-surface-raised/80 rounded-2xl border border-line-subtle overflow-hidden h-96">
              <Suspense fallback={<PanelShimmer height="h-full" />}>
                <LiveEventsFeed events={events} onEventClick={setSelectedEvent} maxItems={30} />
              </Suspense>
            </div>
          </section>

          <section id="mobile-markets">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-xs font-bold uppercase tracking-widest text-fg-muted">Market Radar</span>
            </div>
            <div className="bg-surface-raised/80 rounded-2xl border border-line-subtle overflow-hidden h-80">
              <Suspense fallback={<PanelShimmer height="h-full" />}><MarketRadarPanel /></Suspense>
            </div>
          </section>

          <section id="mobile-economy">
            <div className="flex items-center gap-2 mb-3">
              <Landmark className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-xs font-bold uppercase tracking-widest text-fg-muted">Economic Indicators</span>
            </div>
            <div className="bg-surface-raised/80 rounded-2xl border border-line-subtle overflow-hidden h-96">
              <Suspense fallback={<PanelShimmer height="h-full" />}><EconomicIndicatorsPanel /></Suspense>
            </div>
          </section>

          <section id="mobile-risk">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-xs font-bold uppercase tracking-widest text-fg-muted">Strategic Risk</span>
            </div>
            <div className="bg-surface-raised/80 rounded-2xl border border-line-subtle overflow-y-auto min-h-[320px] max-h-[500px]">
              <Suspense fallback={<PanelShimmer height="h-80" />}><StrategicRiskPanel /></Suspense>
            </div>
          </section>

          <section id="mobile-commodities">
            <div className="flex items-center gap-2 mb-3">
              <CircleDollarSign className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-xs font-bold uppercase tracking-widest text-fg-muted">Commodities & Volatility</span>
            </div>
            <div className="bg-surface-raised/80 rounded-2xl border border-line-subtle overflow-hidden h-80">
              <Suspense fallback={<PanelShimmer height="h-full" />}><CommoditiesWidget /></Suspense>
            </div>
          </section>

          <section id="mobile-news">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-xs font-bold uppercase tracking-widest text-fg-muted">Continental News</span>
            </div>
            <div className="bg-surface-raised/80 rounded-2xl border border-line-subtle overflow-hidden h-96">
              <Suspense fallback={<PanelShimmer height="h-full" />}><ContinentNewsFeedGrid /></Suspense>
            </div>
          </section>

          <section id="mobile-predictions">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-xs font-bold uppercase tracking-widest text-fg-muted">Prediction Markets</span>
            </div>
            <div className="bg-surface-raised/80 rounded-2xl border border-line-subtle overflow-hidden h-96">
              <Suspense fallback={<PanelShimmer height="h-full" />}><PolymarketFinancePanel /></Suspense>
            </div>
          </section>

          <section id="mobile-security">
            <div className="flex items-center gap-2 mb-3">
              <Lock className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-xs font-bold uppercase tracking-widest text-fg-muted">Security Advisories</span>
            </div>
            <div className="bg-surface-raised/80 rounded-2xl border border-line-subtle overflow-hidden h-80">
              <Suspense fallback={<PanelShimmer height="h-full" />}><SecurityAdvisoriesPanel /></Suspense>
            </div>
          </section>

          <section id="mobile-policy">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-xs font-bold uppercase tracking-widest text-fg-muted">Trade & Policy</span>
            </div>
            <div className="bg-surface-raised/80 rounded-2xl border border-line-subtle overflow-y-auto min-h-[320px] max-h-[500px]">
              <Suspense fallback={<PanelShimmer height="h-80" />}><TradePolicyPanel /></Suspense>
            </div>
          </section>
        </div>
      </div>
    </MobileLayout>
  )
}

// ── Root export ───────────────────────────────────────────────────────
export default function MonitorPage() {
  return (
    <>
      <div className="hidden lg:block"><MonitorDesktop /></div>
      <div className="lg:hidden"><MonitorMobile /></div>
    </>
  )
}
