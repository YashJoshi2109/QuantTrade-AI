'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import {
  X, TrendingUp, TrendingDown, Minus, AlertTriangle, Plus, Activity,
  Globe, BarChart2, Zap, Shield, ChevronRight, Clock, MapPin,
  Flame, Radio, RefreshCw, Star, ExternalLink
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  fetchTickerImpact,
  type GlobalEvent,
  type CountryInstability,
  type MapData,
} from '@/lib/global-monitor-api'
import { addToWatchlist, syncSymbol } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

interface SelectedCountry {
  code: string
  name: string
  lat: number
  lng: number
}

interface Props {
  selectedEvent: GlobalEvent | null
  selectedCountry: SelectedCountry | null
  mapData: MapData | null
  onClear: () => void
}

// ── helpers ──────────────────────────────────────────────────────────

function threatColor(level: string) {
  const map: Record<string, string> = {
    critical: 'text-red-400',
    high: 'text-orange-400',
    medium: 'text-yellow-400',
    low: 'text-blue-400',
    unknown: 'text-slate-400',
  }
  return map[level] ?? map.unknown
}

function threatBg(level: string) {
  const map: Record<string, string> = {
    critical: 'bg-red-500/15 border-red-500/40',
    high: 'bg-orange-500/15 border-orange-500/40',
    medium: 'bg-yellow-500/15 border-yellow-500/40',
    low: 'bg-blue-500/15 border-blue-500/40',
    unknown: 'bg-slate-500/15 border-slate-500/40',
  }
  return map[level] ?? map.unknown
}

function riskBar(score: number, color: string) {
  return (
    <div className="h-1.5 w-full bg-surface-hover rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full ${color}`}
        style={{ width: `${Math.min(100, score)}%`, transition: 'width 0.6s ease' }}
      />
    </div>
  )
}

function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const CATEGORY_ICON: Record<string, string> = {
  conflict: '⚔️', political: '🏛️', disaster: '🌊', aviation: '✈️',
  shipping: '🚢', cyber: '🔐', economic: '💰', climate: '🌡️', space: '🛰️',
}

// ── sub-panels ────────────────────────────────────────────────────────

function PanelHeader({ title, sub, onClose }: { title: string; sub?: string; onClose: () => void }) {
  return (
    <div className="px-4 py-3 border-b border-line-subtle flex items-center justify-between bg-surface-raised/60 shrink-0">
      <div>
        <div className="flex items-center gap-2">
          <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
          <span className="text-[11px] font-black uppercase tracking-[0.2em] text-fg-primary font-mono">{title}</span>
        </div>
        {sub && <p className="text-[9px] text-fg-muted mt-0.5 font-mono">{sub}</p>}
      </div>
      <button onClick={onClose} className="p-1.5 hover:bg-surface-hover rounded-lg transition-colors">
        <X className="w-3.5 h-3.5 text-fg-muted hover:text-fg-secondary" />
      </button>
    </div>
  )
}

// ── Event impact view ─────────────────────────────────────────────────

function EventImpactView({ event, onClose }: { event: GlobalEvent; onClose: () => void }) {
  const { isAuthenticated } = useAuth()
  const [adding, setAdding] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())

  const { data: impacts, isLoading } = useQuery({
    queryKey: ['ticker-impact', event.event_id],
    queryFn: () => fetchTickerImpact(event.event_id, 15, event),
    enabled: !!event.event_id,
    staleTime: 30000,
    refetchInterval: 60000,
  })

  const handleAdd = async (ticker: string) => {
    if (!isAuthenticated || adding) return
    setAdding(ticker)
    try {
      await syncSymbol(ticker)
      await addToWatchlist({ symbol: ticker, source: 'global_monitor' })
      setAdded(prev => new Set(Array.from(prev).concat(ticker)))
    } catch {}
    setAdding(null)
  }

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title="EVENT IMPACT"
        sub={`${event.category?.toUpperCase()} · ${timeAgo(event.event_timestamp)}`}
        onClose={onClose}
      />

      <div className="flex-1 overflow-y-auto">
        {/* Event card */}
        <div className={`m-3 p-3 rounded-xl border ${threatBg(event.threat_level)}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border ${threatBg(event.threat_level)} ${threatColor(event.threat_level)}`}>
              {event.threat_level}
            </span>
            <span className="text-[10px] text-slate-500">{CATEGORY_ICON[event.category] || '🌐'} {event.category}</span>
            {event.is_anomaly && (
              <span className="px-1.5 py-0.5 rounded text-[9px] bg-purple-500/20 border border-purple-500/40 text-purple-400 font-bold">ANOMALY</span>
            )}
          </div>
          <h3 className="text-sm font-bold text-slate-50 leading-snug">{event.title}</h3>
          {event.description && (
            <p className="text-[11px] text-fg-secondary mt-2 leading-relaxed line-clamp-3">{event.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2.5">
            {event.location_name && (
              <div className="flex items-center gap-1">
                <MapPin className="w-3 h-3 text-fg-muted" />
                <span className="text-[10px] text-fg-secondary">{event.location_name}</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-fg-muted" />
              <span className="text-[10px] text-fg-secondary">{timeAgo(event.event_timestamp)}</span>
            </div>
          </div>
          {event.market_impact_score != null && event.market_impact_score > 0 && (
            <div className="mt-2.5 pt-2.5 border-t border-line-subtle">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] text-slate-500 uppercase">Market Impact</span>
                <span className="text-[10px] font-bold text-orange-400">{event.market_impact_score.toFixed(0)}%</span>
              </div>
              {riskBar(event.market_impact_score, 'bg-orange-500')}
            </div>
          )}
        </div>

        {/* Correlated sectors */}
        {event.correlated_sectors && event.correlated_sectors.length > 0 && (
          <div className="px-3 mb-3">
            <div className="text-[9px] text-fg-muted uppercase tracking-wider mb-1.5 font-bold">Affected Sectors</div>
            <div className="flex flex-wrap gap-1.5">
              {event.correlated_sectors.map(s => (
                <span key={s} className="px-2 py-1 bg-sky-500/10 border border-sky-500/25 rounded text-[10px] text-sky-400">{s}</span>
              ))}
            </div>
          </div>
        )}

        {/* Ticker impacts */}
        <div className="px-3 pb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[9px] text-fg-muted uppercase tracking-wider font-bold">Impacted Securities</div>
            {isLoading && <RefreshCw className="w-3 h-3 text-sky-400 animate-spin" />}
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-14 bg-surface-hover rounded-lg animate-pulse" />
              ))}
            </div>
          ) : impacts && impacts.length > 0 ? (
            <div className="space-y-2">
              {impacts.map((impact, idx) => (
                <div
                  key={`${impact.ticker}-${idx}`}
                  className="bg-surface-raised/70 border border-line-subtle rounded-xl p-3 hover:border-line-default transition-colors"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <Link
                        href={`/research?symbol=${impact.ticker}`}
                        className="text-sm font-bold text-slate-50 hover:text-sky-400 transition-colors"
                      >
                        {impact.ticker}
                      </Link>
                      {impact.company_name && (
                        <p className="text-[10px] text-fg-muted mt-0.5 truncate max-w-[140px]">{impact.company_name}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Direction */}
                      <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${
                        impact.expected_direction === 'positive'
                          ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                          : impact.expected_direction === 'negative'
                          ? 'bg-red-500/15 border-red-500/30 text-red-400'
                          : 'bg-surface-raised border-line-default text-fg-secondary'
                      }`}>
                        {impact.expected_direction === 'positive' ? <TrendingUp className="w-2.5 h-2.5" /> :
                         impact.expected_direction === 'negative' ? <TrendingDown className="w-2.5 h-2.5" /> :
                         <Minus className="w-2.5 h-2.5" />}
                        <span className="text-[9px]">{impact.expected_direction || 'neutral'}</span>
                      </div>
                      {/* Add to watchlist */}
                      {isAuthenticated && (
                        <button
                          onClick={() => handleAdd(impact.ticker)}
                          disabled={!!adding || added.has(impact.ticker)}
                          className="p-1 hover:bg-surface-hover rounded transition-colors disabled:opacity-50"
                          title="Add to watchlist"
                        >
                          {adding === impact.ticker ? (
                            <RefreshCw className="w-3 h-3 text-sky-400 animate-spin" />
                          ) : added.has(impact.ticker) ? (
                            <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                          ) : (
                            <Plus className="w-3 h-3 text-slate-400" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Impact metrics row */}
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <div>
                      <div className="text-[8px] text-fg-muted uppercase">Impact</div>
                      <div className="text-xs font-bold text-fg-primary font-mono">{impact.impact_score.toFixed(0)}<span className="text-[8px] text-fg-muted">/100</span></div>
                    </div>
                    <div>
                      <div className="text-[8px] text-fg-muted uppercase">Confidence</div>
                      <div className="text-xs font-bold text-fg-primary font-mono">{(impact.confidence * 100).toFixed(0)}%</div>
                    </div>
                    {impact.volatility_increase ? (
                      <div>
                        <div className="text-[8px] text-fg-muted uppercase">Vol+</div>
                        <div className="text-xs font-bold text-orange-400 font-mono">+{impact.volatility_increase}%</div>
                      </div>
                    ) : null}
                  </div>

                  {impact.impact_reason && (
                    <p className="text-[10px] text-fg-secondary mb-2 line-clamp-2 leading-relaxed">{impact.impact_reason}</p>
                  )}

                  {/* Impact bar */}
                  {riskBar(impact.impact_score, impact.expected_direction === 'positive' ? 'bg-emerald-500' : impact.expected_direction === 'negative' ? 'bg-red-500' : 'bg-slate-500')}

                  {/* ETFs row */}
                  {impact.related_etfs && impact.related_etfs.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {impact.related_etfs.slice(0, 4).map(etf => (
                        <Link key={etf} href={`/research?symbol=${etf}`} className="px-1.5 py-0.5 bg-surface-hover rounded text-[9px] text-sky-400 hover:text-sky-300 transition-colors">
                          {etf}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center">
              <BarChart2 className="w-8 h-8 text-slate-700 mx-auto mb-2" />
              <p className="text-[11px] text-fg-muted">No significant market impact detected</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Country risk view ─────────────────────────────────────────────────

function CountryRiskView({
  country, instability, allEvents, onClose
}: {
  country: SelectedCountry
  instability: CountryInstability | undefined
  allEvents: GlobalEvent[]
  onClose: () => void
}) {
  const countryEvents = useMemo(() =>
    allEvents
      .filter(e => e.country_code === country.code)
      .sort((a, b) => {
        const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 }
        return (order[a.threat_level] ?? 4) - (order[b.threat_level] ?? 4)
      })
      .slice(0, 8),
    [allEvents, country.code]
  )

  const riskLevel = instability?.risk_level || 'unknown'
  const colorClass = riskLevel === 'critical' ? 'text-red-400' : riskLevel === 'high' ? 'text-orange-400' : riskLevel === 'medium' ? 'text-yellow-400' : riskLevel === 'low' ? 'text-blue-400' : 'text-slate-400'

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title={`${country.name.toUpperCase()}`}
        sub={`COUNTRY RISK PROFILE · ${country.code}`}
        onClose={onClose}
      />

      <div className="flex-1 overflow-y-auto">
        {/* Risk summary */}
        {instability ? (
          <div className="m-3 p-3 bg-surface-raised/70 border border-line-subtle rounded-xl">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-[9px] text-slate-500 uppercase">Instability Index</div>
                <div className={`text-2xl font-black font-mono mt-0.5 ${colorClass}`}>
                  {instability.instability_index.toFixed(0)}
                  <span className="text-sm text-slate-500">/100</span>
                </div>
              </div>
              <div className={`px-3 py-1.5 rounded-lg border text-xs font-bold uppercase ${threatBg(riskLevel)} ${colorClass}`}>
                {riskLevel} RISK
              </div>
            </div>

            {riskBar(instability.instability_index,
              riskLevel === 'critical' ? 'bg-red-500' :
              riskLevel === 'high' ? 'bg-orange-500' :
              riskLevel === 'medium' ? 'bg-yellow-500' : 'bg-blue-500'
            )}

            <div className="grid grid-cols-2 gap-2 mt-3">
              {[
                { label: 'Conflict', value: instability.conflict_score, color: 'bg-red-500' },
                { label: 'Political', value: instability.political_score, color: 'bg-orange-500' },
                { label: 'Disaster', value: instability.disaster_score, color: 'bg-yellow-500' },
                { label: 'Economic', value: instability.economic_score, color: 'bg-blue-500' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-surface-hover rounded-lg p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] text-fg-muted uppercase">{label}</span>
                    <span className="text-[10px] font-bold text-fg-secondary font-mono">{value.toFixed(0)}</span>
                  </div>
                  {riskBar(value, color)}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 mt-2">
              <div className="bg-surface-hover rounded-lg p-2 text-center">
                <div className="text-[9px] text-fg-muted">Active Events</div>
                <div className="text-lg font-black text-fg-primary font-mono">{instability.active_event_count}</div>
              </div>
              <div className="bg-surface-hover rounded-lg p-2 text-center">
                <div className="text-[9px] text-slate-500">Critical</div>
                <div className="text-lg font-black text-red-400 font-mono">{instability.critical_event_count}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="m-3 p-3 bg-surface-raised/50 border border-line-subtle rounded-xl">
            <p className="text-[11px] text-fg-muted text-center">No risk data available for this country</p>
          </div>
        )}

        {/* Country events */}
        {countryEvents.length > 0 && (
          <div className="px-3 pb-4">
            <div className="text-[9px] text-fg-muted uppercase tracking-wider font-bold mb-2">
              Active Events ({countryEvents.length})
            </div>
            <div className="space-y-1.5">
              {countryEvents.map(event => (
                <div
                  key={event.event_id}
                  className={`p-2.5 rounded-lg border ${threatBg(event.threat_level)} cursor-default`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                      event.threat_level === 'critical' ? 'bg-red-500 animate-pulse' :
                      event.threat_level === 'high' ? 'bg-orange-500' :
                      event.threat_level === 'medium' ? 'bg-yellow-500' : 'bg-blue-500'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-fg-primary leading-tight line-clamp-2">{event.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[9px] text-fg-muted">{CATEGORY_ICON[event.category] || '🌐'} {event.category}</span>
                        <span className="text-[9px] text-fg-muted">·</span>
                        <span className="text-[9px] text-fg-muted">{timeAgo(event.event_timestamp)}</span>
                      </div>
                    </div>
                    <span className={`text-[9px] font-bold uppercase shrink-0 ${threatColor(event.threat_level)}`}>
                      {event.threat_level}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {countryEvents.length === 0 && (
          <div className="px-3 pb-4">
            <div className="py-6 text-center">
              <Shield className="w-8 h-8 text-emerald-700 mx-auto mb-2" />
              <p className="text-[11px] text-emerald-600">No active events detected</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Global overview (default state) ──────────────────────────────────

function GlobalOverview({ mapData }: { mapData: MapData | null }) {
  const topCountries = useMemo(() =>
    (mapData?.instability || [])
      .filter(c => c.instability_index > 0)
      .sort((a, b) => b.instability_index - a.instability_index)
      .slice(0, 8),
    [mapData]
  )

  const sectorCounts = useMemo(() => {
    const map: Record<string, number> = {}
    ;(mapData?.events || []).forEach(e => {
      if (e.correlated_sectors) {
        e.correlated_sectors.forEach(s => { map[s] = (map[s] || 0) + 1 })
      }
      if (e.category) { map[e.category] = (map[e.category] || 0) + 1 }
    })
    return Object.entries(map).sort(([, a], [, b]) => b - a).slice(0, 8)
  }, [mapData])

  const topCriticalEvents = useMemo(() =>
    (mapData?.events || [])
      .filter(e => e.threat_level === 'critical' || e.threat_level === 'high')
      .slice(0, 4),
    [mapData]
  )

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-4 py-3 border-b border-line-subtle bg-surface-raised/60 shrink-0">
        <div className="flex items-center gap-2">
          <Globe className="w-3.5 h-3.5 text-sky-400" />
          <span className="text-[11px] font-black uppercase tracking-[0.2em] text-fg-primary font-mono">GLOBAL INTELLIGENCE</span>
          <span className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[8px] text-emerald-400 font-bold">
            <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" /> LIVE
          </span>
        </div>
        <p className="text-[9px] text-fg-muted mt-0.5 font-mono">Click any event or country on the globe</p>
      </div>

      {/* Quick stats */}
      {mapData && (
        <div className="px-3 pt-3 grid grid-cols-2 gap-2">
          {[
            { label: 'Active Events', value: mapData.stats.total_events, color: 'text-slate-100', icon: Activity },
            { label: 'Critical', value: mapData.stats.critical_events, color: 'text-red-400', icon: Flame },
            { label: 'Hotspots', value: mapData.stats.total_hotspots, color: 'text-purple-400', icon: Zap },
            { label: 'High Risk', value: mapData.stats.high_risk_countries, color: 'text-orange-400', icon: Shield },
          ].map(({ label, value, color, icon: Icon }) => (
            <div key={label} className="bg-surface-raised/60 border border-line-subtle rounded-xl p-2.5 flex items-center gap-2">
              <Icon className={`w-4 h-4 ${color} shrink-0`} />
              <div>
                <div className="text-[8px] text-fg-muted uppercase">{label}</div>
                <div className={`text-lg font-black font-mono ${color}`}>{value}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Critical alerts */}
      {topCriticalEvents.length > 0 && (
        <div className="px-3 mt-3">
          <div className="text-[9px] text-fg-muted uppercase tracking-wider font-bold mb-2">Critical Alerts</div>
          <div className="space-y-1.5">
            {topCriticalEvents.map(event => (
              <div key={event.event_id} className="p-2 bg-red-500/5 border border-red-500/20 rounded-lg">
                <div className="flex items-start gap-1.5">
                  <AlertTriangle className="w-3 h-3 text-red-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[10px] text-fg-primary leading-tight line-clamp-2">{event.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[9px] font-bold ${threatColor(event.threat_level)}`}>{event.threat_level.toUpperCase()}</span>
                      <span className="text-[9px] text-fg-muted">·</span>
                      <span className="text-[9px] text-fg-muted">{event.location_name || event.country_code || 'Global'}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top risk countries */}
      {topCountries.length > 0 && (
        <div className="px-3 mt-3">
          <div className="text-[9px] text-fg-muted uppercase tracking-wider font-bold mb-2">
            Highest Risk Countries
          </div>
          <div className="space-y-2">
            {topCountries.map((c, i) => {
              const level = c.instability_index >= 75 ? 'critical' : c.instability_index >= 50 ? 'high' : c.instability_index >= 30 ? 'medium' : 'low'
              const barColor = level === 'critical' ? 'bg-red-500' : level === 'high' ? 'bg-orange-500' : level === 'medium' ? 'bg-yellow-500' : 'bg-blue-500'
              return (
                <div key={c.country_code} className="flex items-center gap-2">
                  <span className="text-[9px] text-fg-muted font-mono w-4 shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[10px] text-fg-secondary font-medium truncate">{c.country_name}</span>
                      <span className={`text-[10px] font-black font-mono ${threatColor(level)}`}>{c.instability_index.toFixed(0)}</span>
                    </div>
                    {riskBar(c.instability_index, barColor)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Affected sectors */}
      {sectorCounts.length > 0 && (
        <div className="px-3 mt-3 pb-4">
          <div className="text-[9px] text-fg-muted uppercase tracking-wider font-bold mb-2">Affected Sectors</div>
          <div className="flex flex-wrap gap-1.5">
            {sectorCounts.map(([sector, count]) => (
              <div key={sector} className="px-2 py-1 bg-surface-hover border border-line-subtle rounded-lg flex items-center gap-1.5">
                <span className="text-[10px]">{CATEGORY_ICON[sector.toLowerCase()] || '📊'}</span>
                <span className="text-[10px] text-fg-secondary">{sector}</span>
                <span className="text-[9px] text-sky-400 font-mono">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!mapData && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Globe className="w-10 h-10 text-slate-700 mx-auto mb-3 animate-pulse" />
            <p className="text-sm text-fg-muted">Loading intelligence data...</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main exported component ───────────────────────────────────────────

export default function EventImpactPanel({ selectedEvent, selectedCountry, mapData, onClear }: Props) {
  const instability = mapData?.instability || []
  const allEvents = mapData?.events || []

  const countryInstabilityData = selectedCountry
    ? instability.find(c => c.country_code === selectedCountry.code)
    : undefined

  const mode = selectedEvent ? 'event' : selectedCountry ? 'country' : 'overview'

  return (
    <div className="h-full bg-surface-base/98 border border-line-subtle rounded-xl overflow-hidden flex flex-col">
      <AnimatePresence mode="wait">
        {mode === 'event' && selectedEvent ? (
          <motion.div
            key="event"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col h-full"
          >
            <EventImpactView event={selectedEvent} onClose={onClear} />
          </motion.div>
        ) : mode === 'country' && selectedCountry ? (
          <motion.div
            key="country"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col h-full"
          >
            <CountryRiskView
              country={selectedCountry}
              instability={countryInstabilityData}
              allEvents={allEvents}
              onClose={onClear}
            />
          </motion.div>
        ) : (
          <motion.div
            key="overview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col h-full"
          >
            <GlobalOverview mapData={mapData} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
