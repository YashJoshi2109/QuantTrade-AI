'use client'

import Link from 'next/link'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import MobileDashboard from '@/components/layout/MobileDashboard'
import { useBreakingNews } from '@/hooks/useRealtimeNews'
import { useAuth } from '@/contexts/AuthContext'
import { motion, AnimatePresence } from 'framer-motion'
import {
  TrendingUp,
  TrendingDown,
  Sparkles,
  Zap,
  ArrowRight,
  Activity,
  BarChart3,
  RefreshCw,
  Globe,
  Target,
  ShieldAlert,
  Minus,
  Eye,
  Clock,
  Signal,
  Layers,
  MapPin,
  DollarSign,
} from 'lucide-react'
import {
  fetchSectorPerformance,
  fetchPredictionAlerts,
  fetchQuote,
  getWatchlist,
  SectorPerformance,
  QuoteData,
  StockPerformance,
} from '@/lib/api'
import { useExchangeHeatmap } from '@/hooks/useExchangeHeatmap'
import type { ExchangeSector } from '@/app/api/exchange/heatmap/route'
import MarketNewsGrid from '@/components/MarketNewsGrid'
import MiniWorldMonitorSnapshot from '@/components/MiniWorldMonitorSnapshot'
import LiveNewsChannelPanel from '@/components/LiveNewsChannelPanel'
import TickerLogo from '@/components/TickerLogo'
import { formatNumber, formatPercent, isNumber } from '@/lib/format'
import { SkeletonMoversSection, SkeletonSectorPerformance } from '@/components/Skeleton'
import BrandedNewsLoading from '@/components/loading/BrandedNewsLoading'
import IndicesBarSkeleton from '@/components/loading/IndicesBarSkeleton'
import { ProCard } from '@/components/ui/pro'
import IpoRadarWidget from '@/components/IpoRadarWidget'
import MoversHeatmap from '@/components/MoversHeatmap'
import {
  CONTINENTS,
  type Continent,
  DISPLAY_CURRENCIES,
  ALWAYS_ON_MACRO_SYMBOLS,
  CONTINENT_DASHBOARD_INDEX_SYMBOLS,
  getExchangeById,
  getExchangesByContinent,
  type Exchange,
} from '@/lib/world-exchanges'
import type { IndexQuote } from '@/app/api/quotes/indices/route'
import { buildMarketTape, type MarketTapeItem } from '@/lib/market-tape'
import { QuoteActivityFlash, moversActivityFingerprint } from '@/components/QuoteActivityFlash'

/** Local clock: morning 5–11, afternoon 12–16, evening otherwise. */
function getTimeBasedGreeting(d = new Date()): string {
  const h = d.getHours()
  if (h >= 5 && h < 12) return 'Good morning'
  if (h >= 12 && h < 17) return 'Good afternoon'
  return 'Good evening'
}

// ─── World Indices Hook ───────────────────────────────────────────────────────
function useWorldIndices(continent: Continent) {
  return useQuery({
    queryKey: ['worldIndices', continent],
    queryFn: async (): Promise<IndexQuote[]> => {
      const res = await fetch(`/api/quotes/indices?continent=${continent}`)
      if (!res.ok) return []
      return res.json()
    },
    refetchInterval: 120_000,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
}

// ─── Region / exchange movers (merged continents; optional exchange filter) ───
function useDashboardRegionMovers(continent: Continent, exchangeId: string | null) {
  return useQuery({
    queryKey: ['dashboardRegionMovers', continent, exchangeId ?? ''],
    queryFn: async (): Promise<{
      gainers: GlobalMover[]
      losers: GlobalMover[]
      actives: GlobalMover[]
    }> => {
      const p = new URLSearchParams({ count: '300' })
      if (exchangeId) p.set('exchange', exchangeId)
      else p.set('continent', continent)
      const res = await fetch(`/api/quotes/movers?${p}`)
      if (!res.ok) return { gainers: [], losers: [], actives: [] }
      const j = await res.json()
      return {
        gainers: j.gainers ?? [],
        losers: j.losers ?? [],
        actives: j.actives ?? [],
      }
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })
}

function useMajorDashboardQuotes(continent: Continent, exchangeId: string | null) {
  const symbolList = useMemo(() => {
    if (exchangeId) {
      const ex = getExchangeById(exchangeId)
      const idx = ex ? ex.indices.map((i) => i.symbol) : []
      return [...idx, ...ALWAYS_ON_MACRO_SYMBOLS]
    }
    const majors = CONTINENT_DASHBOARD_INDEX_SYMBOLS[continent] ?? []
    return [...majors, ...ALWAYS_ON_MACRO_SYMBOLS]
  }, [continent, exchangeId])

  return useQuery({
    queryKey: ['dashboardMajorQuotes', symbolList.join('|')],
    queryFn: async (): Promise<IndexQuote[]> => {
      const res = await fetch(
        `/api/quotes/indices?symbols=${encodeURIComponent(symbolList.join(','))}`
      )
      if (!res.ok) return []
      return res.json()
    },
    refetchInterval: 90_000,
    staleTime: 45_000,
    placeholderData: keepPreviousData,
  })
}

interface GlobalMover {
  symbol: string
  name: string
  price: number
  change: number
  change_percent: number
  volume: number
  market_cap: number
  exchange: string
  currency: string
}

// ─── Currency Hook ────────────────────────────────────────────────────────────
function useCurrencyRates() {
  return useQuery({
    queryKey: ['currencyRates'],
    queryFn: async (): Promise<Record<string, number>> => {
      const res = await fetch('/api/currencies')
      if (!res.ok) return {}
      const data = await res.json()
      return data.rates ?? {}
    },
    staleTime: 3_600_000, // 1 hour
    gcTime: 7_200_000,
  })
}

// ─── Market tape: indices + regional gainers / losers / volume (marquee) ─────
function WorldIndicesBar({
  items,
  currency,
  rates,
  continent,
  selectedExchangeId,
  onToggleExchange,
}: {
  items: MarketTapeItem[]
  currency: string
  rates: Record<string, number>
  continent: Continent
  selectedExchangeId: string | null
  onToggleExchange: (exchangeId: string) => void
}) {
  const currencyInfo = DISPLAY_CURRENCIES.find((c) => c.code === currency)
  const currSymbol = currencyInfo?.symbol ?? '$'
  const continentLabel = CONTINENTS.find((c) => c.id === continent)?.label ?? 'Global'

  function convertPrice(price: number, fromCurrency: string): number {
    if (!price || currency === fromCurrency) return price
    const toUSD = fromCurrency === 'USD' ? price : price / (rates[fromCurrency] ?? 1)
    return currency === 'USD' ? toUSD : toUSD * (rates[currency] ?? 1)
  }

  const visible = useMemo(() => {
    if (!selectedExchangeId) return items
    return items.filter((it) => {
      if (it.kind === 'index') return it.q.exchangeId === selectedExchangeId
      return true
    })
  }, [items, selectedExchangeId])

  const rows = visible.length > 0 ? visible : items
  const loop = rows.length > 1 ? [...rows, ...rows] : rows

  const roleLabel = (role: 'gainer' | 'loser' | 'volume') =>
    role === 'volume' ? 'VOL' : role === 'gainer' ? '↑' : '↓'

  return (
    <div className="relative w-full min-h-[3.25rem] bg-[#0D1117]/80 border-b border-[rgba(0,122,255,0.12)] overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-16 z-10 bg-gradient-to-r from-[#0D1117] via-[#0D1117]/90 to-transparent" />
      <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-16 z-10 bg-gradient-to-l from-[#0D1117] via-[#0D1117]/90 to-transparent" />

      <div className="flex items-stretch">
        <div className="shrink-0 flex items-center gap-1.5 px-3 py-2 border-r border-[rgba(0,122,255,0.15)] bg-[#007AFF]/8 z-20">
          <Signal className="w-3 h-3 text-[#007AFF]" />
          <span className="text-[9px] font-black uppercase tracking-[0.12em] text-[#007AFF] font-mono whitespace-nowrap leading-tight">
            {continent === 'global' ? 'WORLD' : continentLabel.toUpperCase()}
            <br />
            <span className="text-[8px] text-slate-400 font-bold tracking-normal">TAPE</span>
          </span>
        </div>

        <div className="flex-1 min-w-0 overflow-hidden flex items-center">
          <div className="flex items-center h-full animate-marquee-slow hover:[animation-play-state:paused] min-w-full">
            <div className="flex items-center gap-px shrink-0">
              {loop.map((it, i) => {
                if (it.kind === 'stock') {
                  const m = it.m
                  const up = m.change_percent >= 0
                  const displayPrice = convertPrice(m.price, m.currency || 'USD')
                  return (
                    <Link
                      key={`${m.symbol}-${it.role}-${i}`}
                      href={`/research?symbol=${encodeURIComponent(m.symbol)}`}
                      className="shrink-0 flex items-center gap-2 px-3 py-2 border-r border-slate-800/40 text-left transition-colors hover:bg-emerald-500/5 group"
                    >
                      <TickerLogo symbol={m.symbol} companyName={m.name} size={22} />
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold text-white font-mono group-hover:text-[#007AFF]">
                            {m.symbol}
                          </span>
                          <span className="text-[9px] text-slate-500 hidden sm:block max-w-[72px] truncate">
                            {m.exchange}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-[11px] font-mono font-bold text-white">
                            {displayPrice > 0
                              ? `${currSymbol}${formatNumber(displayPrice, displayPrice > 100 ? 0 : 2)}`
                              : '—'}
                          </span>
                          <span
                            className={`text-[9px] font-mono font-bold flex items-center gap-0.5 ${
                              up ? 'text-emerald-400' : 'text-red-400'
                            }`}
                          >
                            {up ? <TrendingUp className="w-2 h-2" /> : <TrendingDown className="w-2 h-2" />}
                            {up ? '+' : ''}
                            {formatPercent(m.change_percent, 2)}
                          </span>
                        </div>
                      </div>
                    </Link>
                  )
                }

                const q = it.q
                const up = q.change_percent >= 0
                const displayPrice = convertPrice(q.price, q.currency)
                const active = selectedExchangeId === q.exchangeId
                return (
                  <button
                    key={`${q.symbol}-${i}`}
                    type="button"
                    onClick={() => onToggleExchange(q.exchangeId)}
                    className={`shrink-0 flex items-center gap-2 px-3 py-2 border-r border-slate-800/40 text-left transition-colors group ${
                      active ? 'bg-[#007AFF]/15 ring-1 ring-inset ring-[#007AFF]/40' : 'hover:bg-[#007AFF]/5'
                    }`}
                  >
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: q.color }} />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-white font-mono group-hover:text-[#007AFF] transition-colors">
                          {q.shortName}
                        </span>
                        <span className="text-[8px] font-bold text-cyan-500/80 uppercase hidden sm:inline">IDX</span>
                        <span className="text-[9px] text-slate-500 hidden sm:block max-w-[56px] truncate">
                          {q.exchangeName}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="text-[11px] font-mono font-bold text-white">
                          {displayPrice > 0
                            ? `${currSymbol}${formatNumber(displayPrice, displayPrice > 100 ? 0 : 2)}`
                            : '—'}
                        </span>
                        <span
                          className={`text-[9px] font-mono font-bold flex items-center gap-0.5 ${
                            up ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {up ? <TrendingUp className="w-2 h-2" /> : <TrendingDown className="w-2 h-2" />}
                          {up ? '+' : ''}
                          {formatPercent(q.change_percent, 2)}
                        </span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
      <p className="sr-only">
        Indices filter the venue; stock chips open research. Marquee pauses on hover.
      </p>
    </div>
  )
}

// ─── Continent Tab Bar ────────────────────────────────────────────────────────
function ContinentTabBar({
  active,
  onChange,
}: {
  active: Continent
  onChange: (c: Continent) => void
}) {
  const tabs = CONTINENTS.map((c) => (
    <button
      key={c.id}
      type="button"
      onClick={() => onChange(c.id)}
      className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
        active === c.id
          ? 'bg-[#007AFF] text-white shadow-lg shadow-[rgba(0,122,255,0.25)]'
          : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
      }`}
    >
      <span>{c.emoji}</span>
      <span>{c.label}</span>
    </button>
  ))

  return (
    <div className="border-b border-slate-800/40 bg-[#0B0E14]/60">
      <div className="hidden md:flex flex-wrap items-center justify-center gap-1.5 py-2.5 px-4">
        {tabs}
      </div>
      <div className="flex md:hidden items-center gap-1 overflow-x-auto scrollbar-none px-4 py-2 justify-center">
        {tabs}
      </div>
    </div>
  )
}

// ─── Currency Selector ────────────────────────────────────────────────────────
function CurrencySelector({
  value,
  onChange,
}: {
  value: string
  onChange: (c: string) => void
}) {
  const [open, setOpen] = useState(false)
  const curr = DISPLAY_CURRENCIES.find((c) => c.code === value) ?? DISPLAY_CURRENCIES[0]

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-700/60 bg-slate-900/60 hover:border-[rgba(0,122,255,0.4)] transition-colors text-[11px] text-slate-300 font-medium"
      >
        <DollarSign className="w-3 h-3 text-[#007AFF]" />
        <span>{curr.flag} {curr.code}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.95 }}
            className="absolute right-0 top-full mt-1 z-50 w-44 rounded-xl border border-slate-700/60 bg-[#101928] shadow-2xl overflow-hidden"
          >
            <div className="max-h-64 overflow-y-auto py-1">
              {DISPLAY_CURRENCIES.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => { onChange(c.code); setOpen(false) }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-[11px] transition-colors ${
                    c.code === value
                      ? 'text-[#007AFF] bg-[#007AFF]/10'
                      : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                  }`}
                >
                  <span>{c.flag}</span>
                  <span className="font-bold font-mono">{c.code}</span>
                  <span className="text-slate-500 truncate">{c.name}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function sessionLabelForExchange(ex: Exchange): { open: boolean; line: string } {
  try {
    const tz = ex.timezone
    const now = new Date()
    const tStr = now.toLocaleTimeString('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const wd = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' })
    const weekend = wd === 'Sat' || wd === 'Sun'
    if (weekend) {
      return { open: false, line: `${ex.shortName} · ${tStr} · weekend` }
    }
    const [oh, om] = ex.openTime.split(':').map(Number)
    const [ch, cm] = ex.closeTime.split(':').map(Number)
    const [h, m] = tStr.split(':').map(Number)
    const mins = h * 60 + m
    const o = oh * 60 + om
    const c = ch * 60 + cm
    const open = mins >= o && mins < c
    return {
      open,
      line: `${ex.shortName} · local ${tStr} · session ${ex.openTime}–${ex.closeTime}`,
    }
  } catch {
    return { open: false, line: ex.shortName }
  }
}

function ExchangeSessionsPopover({ continent }: { continent: Continent }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const list = useMemo(() => {
    if (continent === 'global') return getExchangesByContinent('americas').slice(0, 6)
    return getExchangesByContinent(continent)
  }, [continent])
  const openCount = useMemo(() => list.filter((ex) => sessionLabelForExchange(ex).open).length, [list])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-cyan-500/25 bg-gradient-to-r from-slate-900/90 to-slate-900/60 text-[10px] font-mono text-cyan-100 shadow-lg shadow-cyan-500/10 hover:border-cyan-400/50 transition-all"
      >
        <Clock className="w-3.5 h-3.5 text-cyan-400" />
        <span className="hidden sm:inline font-bold tracking-wide">Sessions</span>
        <span
          className={`px-1.5 py-0.5 rounded-md text-[9px] font-black ${
            openCount > 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700/60 text-slate-400'
          }`}
        >
          {openCount}/{list.length} OPEN
        </span>
      </button>
      {open && (
      <div className="absolute right-0 top-full mt-2 w-[min(100vw-2rem,22rem)] max-h-[min(70vh,420px)] overflow-y-auto rounded-2xl border border-cyan-500/20 bg-[#0a101f]/95 backdrop-blur-xl px-3 py-3 text-[10px] shadow-2xl shadow-black/40 z-[60]">
        <div className="text-[9px] font-black uppercase tracking-[0.2em] text-cyan-400/90 mb-2 px-1">
          Exchange local time
        </div>
        <div className="space-y-1.5">
          {list.map((ex) => {
            const s = sessionLabelForExchange(ex)
            return (
              <div
                key={ex.id}
                className="flex items-start justify-between gap-2 rounded-lg border border-slate-800/60 bg-slate-900/40 px-2.5 py-2"
              >
                <div className="min-w-0">
                  <div className="font-bold text-white text-[11px]">{ex.shortName}</div>
                  <div className="text-slate-500 truncate">{ex.country}</div>
                  <div className="text-slate-400 mt-0.5 leading-snug">{s.line}</div>
                </div>
                <div
                  className={`shrink-0 px-2 py-1 rounded-md text-[9px] font-black uppercase ${
                    s.open
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25'
                      : 'bg-slate-800 text-slate-500 border border-slate-700/60'
                  }`}
                >
                  {s.open ? 'Open' : 'Shut'}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      )}
    </div>
  )
}

// ─── Prediction Alerts Widget ─────────────────────────────────────────────────
function PredictionAlertsWidget({ contextSymbols }: { contextSymbols?: Set<string> }) {
  const alertDirectionUp = (d: string | undefined) =>
    String(d ?? '')
      .trim()
      .toLowerCase() === 'up'

  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ['predictionAlerts'],
    queryFn: () => fetchPredictionAlerts(0.65, 2.0),
    refetchInterval: 90_000,
    staleTime: 45_000,
    placeholderData: keepPreviousData,
  })

  const severityColor = (s: string) =>
    s === 'high' ? 'text-red-400 bg-red-500/10 border-red-500/20' :
    s === 'medium' ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' :
    'text-slate-400 bg-slate-700/30 border-slate-600/20'

  return (
    <div className="hud-panel h-full flex flex-col">
      <div className="p-4 border-b border-slate-700/30 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-violet-400" />
          <h3 className="font-bold text-white text-sm">AI Alerts</h3>
          <span className="px-1.5 py-0.5 text-[9px] bg-violet-500/20 text-violet-400 rounded font-bold">
            LIVE
          </span>
        </div>
        <Link
          href="/research"
          className="text-[10px] text-violet-400 hover:text-white font-medium transition-colors"
        >
          Research →
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/40">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 rounded bg-slate-800/40 animate-pulse" />
            ))}
          </div>
        ) : (() => {
            const scoped =
              contextSymbols?.size && contextSymbols.size > 0
                ? alerts.filter((a) => contextSymbols.has(a.symbol))
                : alerts
            const display =
              contextSymbols?.size && contextSymbols.size > 0 && scoped.length === 0 ? alerts : scoped
            if (display.length === 0) {
              return (
                <div className="flex flex-col items-center justify-center h-full py-8 text-center px-4">
                  <Target className="w-8 h-8 text-slate-700 mb-2" />
                  <p className="text-slate-500 text-xs">No active alerts above threshold</p>
                </div>
              )
            }
            return display.slice(0, 6).map((alert, idx) => (
            <Link
              key={`${alert.symbol}-${idx}`}
              href={`/research?symbol=${alert.symbol}`}
              className="flex items-start gap-2.5 p-3 hover:bg-slate-800/30 transition-colors group"
            >
              <TickerLogo
                symbol={alert.symbol}
                companyName={alert.name}
                size={24}
                className="mt-0.5 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-white text-xs group-hover:text-violet-400 transition-colors font-mono">
                    {alert.symbol}
                  </span>
                  <span
                    className={`px-1 py-0.5 text-[8px] font-bold rounded border ${severityColor(
                      alert.severity
                    )}`}
                  >
                    {alert.severity.toUpperCase()}
                  </span>
                  <span
                    className={`text-[9px] font-bold ${
                      alertDirectionUp(alert.direction) ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {alertDirectionUp(alert.direction) ? '▲' : '▼'}{' '}
                    {formatPercent(alert.expected_return, 1)}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">{alert.message}</p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs font-bold font-mono text-violet-400">
                  {Math.round(alert.confidence * 100)}%
                </div>
                <div className="text-[9px] text-slate-600">conf</div>
              </div>
            </Link>
          ))
          })()}
      </div>
    </div>
  )
}

// ─── Watchlist Snapshot ───────────────────────────────────────────────────────
function WatchlistSnapshot({ toolbarClassName }: { toolbarClassName?: string }) {
  const { isAuthenticated } = useAuth()

  const { data: watchlist = [], isLoading: wlLoading } = useQuery({
    queryKey: ['watchlist'],
    queryFn: () => getWatchlist(),
    enabled: isAuthenticated,
    staleTime: 60_000,
    refetchInterval: 120_000,
  })

  // Fetch live quotes for first 5 watchlist items
  const symbols = watchlist.slice(0, 5).map((w) => w.symbol)
  const { data: quotes = [], isLoading: quotesLoading } = useQuery({
    queryKey: ['watchlistQuotes', symbols],
    queryFn: async (): Promise<QuoteData[]> => {
      if (symbols.length === 0) return []
      const res = await Promise.allSettled(symbols.map((s) => fetchQuote(s, 'normal')))
      return res
        .filter((r): r is PromiseFulfilledResult<QuoteData> => r.status === 'fulfilled')
        .map((r) => r.value)
    },
    enabled: symbols.length > 0,
    refetchInterval: 120_000,
    staleTime: 30_000,
  })

  const quoteMap = Object.fromEntries(quotes.map((q) => [q.symbol, q]))
  const isLoading = wlLoading || quotesLoading

  return (
    <div className="flex h-full min-h-0 flex-col hud-panel">
      <div
        className={
          toolbarClassName ??
          'flex h-12 shrink-0 items-center justify-between gap-2 border-b border-slate-700/30 px-4'
        }
      >
        <div className="flex min-w-0 items-center gap-2">
          <Eye className="h-4 w-4 shrink-0 text-cyan-400" />
          <h3 className="truncate text-sm font-bold text-white">Watchlist</h3>
        </div>
        <Link
          href="/watchlist"
          className="shrink-0 text-[10px] font-medium text-cyan-400 transition-colors hover:text-white"
        >
          View All →
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!isAuthenticated ? (
          <div className="flex flex-col items-center justify-center h-full py-6 text-center px-4">
            <Eye className="w-7 h-7 text-slate-700 mb-2" />
            <p className="text-slate-500 text-xs">Sign in to see your watchlist</p>
            <Link
              href="/auth"
              className="mt-3 px-3 py-1.5 text-xs bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded hover:bg-cyan-500/30 transition-colors"
            >
              Sign In
            </Link>
          </div>
        ) : isLoading ? (
          <div className="p-3 space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-9 rounded bg-slate-800/40 animate-pulse" />
            ))}
          </div>
        ) : watchlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-6 text-center px-4">
            <Eye className="w-7 h-7 text-slate-700 mb-2" />
            <p className="text-slate-500 text-xs">No symbols in watchlist</p>
            <Link
              href="/research"
              className="mt-3 px-3 py-1.5 text-xs bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded hover:bg-cyan-500/30 transition-colors"
            >
              Add symbols
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/40">
            {watchlist.slice(0, 5).map((item) => {
              const q = quoteMap[item.symbol]
              const up = q ? q.change_percent >= 0 : null
              return (
                <Link
                  key={item.symbol}
                  href={`/research?symbol=${item.symbol}`}
                  className="flex items-center justify-between p-3 hover:bg-cyan-500/5 transition-colors group"
                >
                  <div className="flex items-center gap-2.5">
                    <TickerLogo symbol={item.symbol} companyName={item.name} size={28} />
                    <div>
                      <div className="font-bold text-white text-xs font-mono group-hover:text-cyan-400 transition-colors">
                        {item.symbol}
                      </div>
                      {item.name && (
                        <div className="text-[10px] text-slate-500 truncate max-w-[100px]">
                          {item.name}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    {q ? (
                      <>
                        <div className="text-xs font-mono text-white font-bold">
                          {q.price > 0 ? `$${formatNumber(q.price, 2)}` : '—'}
                        </div>
                        <div
                          className={`text-[10px] font-mono font-bold flex items-center justify-end gap-0.5 ${
                            up ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {up ? '+' : ''}{formatPercent(q.change_percent, 2)}
                          {up ? (
                            <TrendingUp className="w-2.5 h-2.5" />
                          ) : (
                            <TrendingDown className="w-2.5 h-2.5" />
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="text-[10px] text-slate-600">—</div>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function mapExchangeHeatmapToSectors(raw: ExchangeSector[]): SectorPerformance[] {
  return raw.map((sec) => ({
    sector: sec.sector,
    change_percent: sec.change_percent,
    stocks: sec.stocks.map(
      (st): StockPerformance => ({
        symbol: st.symbol,
        name: st.name,
        price: st.price,
        change: st.change,
        change_percent: st.change_percent,
        volume: st.volume,
        market_cap: st.market_cap > 0 ? st.market_cap : undefined,
        sector: sec.sector,
      })
    ),
  }))
}

// ─── Sector Heatmap Widget ────────────────────────────────────────────────────
function SectorHeatmap({
  sectors,
  loading,
  emptyLabel = 'No sector performance data yet.',
}: {
  sectors: SectorPerformance[]
  loading: boolean
  emptyLabel?: string
}) {
  if (loading) return null

  if (sectors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-2 py-8 text-center">
        <BarChart3 className="mx-auto h-8 w-8 text-slate-700" />
        <p className="text-[11px] leading-snug text-slate-500">{emptyLabel}</p>
      </div>
    )
  }

  const sorted = [...sectors].sort(
    (a, b) => (b.change_percent || 0) - (a.change_percent || 0)
  )
  const max = Math.max(...sorted.map((s) => Math.abs(s.change_percent || 0)), 1)
  const compact = sorted.length > 10

  return (
    <div className="grid grid-cols-2 gap-1.5">
      {sorted.map((s, i) => {
        const pct = s.change_percent || 0
        const up = pct >= 0
        const intensity = Math.min(Math.abs(pct) / max, 1)
        return (
          <div
            key={s.sector || i}
            className={`relative flex flex-col justify-center overflow-hidden rounded px-2.5 ${
              compact ? 'h-10' : 'h-12'
            }`}
            style={{
              background: up
                ? `rgba(34,197,94,${0.06 + intensity * 0.18})`
                : `rgba(239,68,68,${0.06 + intensity * 0.18})`,
              border: `1px solid ${up ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
            }}
          >
            <div className="text-[9px] text-slate-400 truncate">{s.sector}</div>
            <div
              className={`text-xs font-bold font-mono ${up ? 'text-emerald-400' : 'text-red-400'}`}
            >
              {up ? '+' : ''}{formatPercent(pct, 2)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Continent Exchange Indices Grid (click = drill into that venue) ─────────
function ContinentIndicesGrid({
  continent,
  currency,
  rates,
  selectedExchangeId,
  onSelectExchange,
}: {
  continent: Continent
  currency: string
  rates: Record<string, number>
  selectedExchangeId: string | null
  onSelectExchange: (id: string | null) => void
}) {
  const { data: indices = [], isLoading } = useWorldIndices(continent)

  const currencyInfo = DISPLAY_CURRENCIES.find((c) => c.code === currency)
  const currSymbol = currencyInfo?.symbol ?? '$'

  function convertPrice(price: number, fromCurrency: string): number {
    if (!price || currency === fromCurrency) return price
    const toUSD = fromCurrency === 'USD' ? price : price / (rates[fromCurrency] ?? 1)
    return currency === 'USD' ? toUSD : toUSD * (rates[currency] ?? 1)
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-16 rounded-lg bg-slate-800/40 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
      {indices.filter((q) => q.price > 0).map((q) => {
        const up = q.change_percent >= 0
        const displayPrice = convertPrice(q.price, q.currency)
        const active = selectedExchangeId === q.exchangeId
        return (
          <div key={q.symbol} className="relative">
            <button
              type="button"
              onClick={() => onSelectExchange(active ? null : q.exchangeId)}
              className={`w-full text-left group hud-panel p-3 transition-all rounded-xl border ${
                active
                  ? 'border-[#007AFF]/50 bg-[#007AFF]/10 ring-1 ring-[#007AFF]/30'
                  : 'border-transparent hover:border-[rgba(0,122,255,0.3)]'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: q.color }} />
                  <span className="text-[10px] font-bold text-slate-400 group-hover:text-white transition-colors">
                    {q.exchangeName}
                  </span>
                </div>
                <span
                  className={`text-[9px] font-mono font-bold px-1 py-0.5 rounded ${
                    up ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10'
                  }`}
                >
                  {up ? '+' : ''}
                  {formatPercent(q.change_percent, 2)}
                </span>
              </div>
              <div className="text-sm font-bold font-mono text-white group-hover:text-[#007AFF] transition-colors">
                {displayPrice > 0
                  ? `${currSymbol}${formatNumber(displayPrice, displayPrice > 1000 ? 0 : 2)}`
                  : '—'}
              </div>
              <div className="text-[10px] text-slate-500 truncate mt-0.5">{q.shortName}</div>
            </button>
            <Link
              href={`/research?symbol=${encodeURIComponent(q.symbol)}`}
              className="absolute top-2 right-2 p-1 rounded-md text-[9px] text-slate-500 hover:text-[#007AFF] hover:bg-slate-800/80"
              title="Open in Research"
              onClick={(e) => e.stopPropagation()}
            >
              ↗
            </Link>
          </div>
        )
      })}
    </div>
  )
}

// ─── Major indices + macro strip (continent or selected exchange + always-on macros)
function MajorIndicesMacroGrid({
  continent,
  exchangeId,
  currency,
  rates,
}: {
  continent: Continent
  exchangeId: string | null
  currency: string
  rates: Record<string, number>
}) {
  const { data: quotes = [], isLoading } = useMajorDashboardQuotes(continent, exchangeId)
  const currencyInfo = DISPLAY_CURRENCIES.find((c) => c.code === currency)
  const currSymbol = currencyInfo?.symbol ?? '$'

  function convertPrice(price: number, fromCurrency: string): number {
    if (!price || currency === fromCurrency) return price
    const toUSD = fromCurrency === 'USD' ? price : price / (rates[fromCurrency] ?? 1)
    return currency === 'USD' ? toUSD : toUSD * (rates[currency] ?? 1)
  }

  const title =
    exchangeId && getExchangeById(exchangeId)
      ? `${getExchangeById(exchangeId)!.shortName} + macro`
      : continent === 'global'
        ? 'Key benchmarks & macro'
        : `${CONTINENTS.find((c) => c.id === continent)?.label ?? ''} benchmarks & macro`

  if (isLoading) {
    return (
      <div className="mb-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-slate-800/40 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3 px-1">
        <BarChart3 className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-bold text-white">1-Day performance</h3>
        <span className="text-[10px] text-slate-500 font-mono truncate">{title}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
        {quotes
          .filter((q) => {
            const macro = (ALWAYS_ON_MACRO_SYMBOLS as readonly string[]).includes(q.symbol)
            return macro || q.price > 0
          })
          .map((q) => {
            const up = q.change_percent >= 0
            const displayPrice = convertPrice(q.price, q.currency)
            const isMacro = q.exchangeId === 'macro'
            return (
              <Link
                key={q.symbol}
                href={`/research?symbol=${encodeURIComponent(q.symbol)}`}
                className={`group hud-panel p-3 sm:p-4 rounded-xl border transition-all hover:border-[rgba(0,122,255,0.35)] ${
                  isMacro ? 'border-amber-500/20 bg-amber-500/[0.04]' : 'border-slate-800/50'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[10px] font-bold text-slate-500 font-mono group-hover:text-white">
                    {q.shortName}
                  </span>
                  <span
                    className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                      up ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10'
                    }`}
                  >
                    {up ? '+' : ''}
                    {formatPercent(q.change_percent, 2)}
                  </span>
                </div>
                <div className="text-lg sm:text-xl font-bold font-mono text-white group-hover:text-[#007AFF] transition-colors">
                  {displayPrice > 0
                    ? `${currSymbol}${formatNumber(displayPrice, displayPrice > 10_000 ? 0 : 2)}`
                    : '—'}
                </div>
                <div className="text-[10px] text-slate-500 truncate mt-0.5">{q.exchangeName}</div>
              </Link>
            )
          })}
      </div>
    </div>
  )
}

// ─── Continent / exchange Movers Panel ───────────────────────────────────────
function ContinentMoversPanel({
  continent,
  exchangeId,
}: {
  continent: Continent
  exchangeId: string | null
}) {
  const { data, isLoading } = useDashboardRegionMovers(continent, exchangeId)
  const rawGainers = data?.gainers ?? []
  const rawLosers = data?.losers ?? []
  const actives = data?.actives ?? []

  const gainers = useMemo(() => {
    if (rawGainers.length > 0) return rawGainers
    return actives
      .filter((m) => m.change_percent > 0)
      .sort((a, b) => b.change_percent - a.change_percent)
  }, [rawGainers, actives])

  const losers = useMemo(() => {
    if (rawLosers.length > 0) return rawLosers
    return actives
      .filter((m) => m.change_percent < 0)
      .sort((a, b) => a.change_percent - b.change_percent)
  }, [rawLosers, actives])

  const scopeLabel = exchangeId
    ? getExchangeById(exchangeId)?.shortName ?? exchangeId
    : continent === 'global'
      ? 'US'
      : continent

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {/* Gainers */}
      <div className="hud-panel flex flex-col">
        <div className="px-4 py-3 border-b border-slate-700/30 flex items-center gap-2 shrink-0">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
          <h3 className="font-bold text-white text-sm">Top Gainers</h3>
          <span className="text-[9px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded font-bold uppercase">
            {scopeLabel}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/30">
          {isLoading ? (
            <SkeletonMoversSection count={6} />
          ) : gainers.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-slate-500 text-xs">No data</div>
          ) : (
            gainers.map((s, i) => (
              <Link
                key={s.symbol}
                href={`/research?symbol=${s.symbol}`}
                className="flex items-center justify-between px-4 py-2.5 hover:bg-emerald-500/5 transition-all group"
              >
                <div className="flex items-center gap-2">
                  <span className="w-4 text-[10px] text-slate-600 font-mono text-right">{i + 1}</span>
                  <TickerLogo symbol={s.symbol} companyName={s.name} size={24} />
                  <div>
                    <span className="font-bold text-white group-hover:text-emerald-400 transition-colors text-xs font-mono">{s.symbol}</span>
                    <div className="text-[10px] text-slate-500 truncate max-w-[110px]">{s.name}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-xs text-white">{s.price > 0 ? `$${formatNumber(s.price, 2)}` : '—'}</div>
                  <div className="font-mono text-[10px] text-emerald-400 font-bold">+{formatPercent(s.change_percent, 2)}</div>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>

      {/* Losers */}
      <div className="hud-panel flex flex-col">
        <div className="px-4 py-3 border-b border-slate-700/30 flex items-center gap-2 shrink-0">
          <TrendingDown className="w-4 h-4 text-red-400" />
          <h3 className="font-bold text-white text-sm">Top Losers</h3>
          <span className="text-[9px] px-1.5 py-0.5 bg-red-500/10 text-red-400 rounded font-bold uppercase">
            {scopeLabel}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/30">
          {isLoading ? (
            <SkeletonMoversSection count={6} />
          ) : losers.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-slate-500 text-xs">No data</div>
          ) : (
            losers.map((s, i) => (
              <Link
                key={s.symbol}
                href={`/research?symbol=${s.symbol}`}
                className="flex items-center justify-between px-4 py-2.5 hover:bg-red-500/5 transition-all group"
              >
                <div className="flex items-center gap-2">
                  <span className="w-4 text-[10px] text-slate-600 font-mono text-right">{i + 1}</span>
                  <TickerLogo symbol={s.symbol} companyName={s.name} size={24} />
                  <div>
                    <span className="font-bold text-white group-hover:text-red-400 transition-colors text-xs font-mono">{s.symbol}</span>
                    <div className="text-[10px] text-slate-500 truncate max-w-[110px]">{s.name}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-xs text-white">{s.price > 0 ? `$${formatNumber(s.price, 2)}` : '—'}</div>
                  <div className="font-mono text-[10px] text-red-400 font-bold">{formatPercent(s.change_percent, 2)}</div>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Desktop Dashboard ────────────────────────────────────────────────────────
function DesktopHome() {
  const { user, isAuthenticated } = useAuth()
  const [activeContinent, setActiveContinent] = useState<Continent>('global')
  const [displayCurrency, setDisplayCurrency] = useState('USD')
  const [selectedExchangeId, setSelectedExchangeId] = useState<string | null>(null)

  useEffect(() => {
    setSelectedExchangeId(null)
  }, [activeContinent])

  const toggleExchange = useCallback((id: string) => {
    setSelectedExchangeId((prev) => (prev === id ? null : id))
  }, [])

  const {
    data: regionMovers,
    isLoading: regionMoversLoading,
    refetch: refetchRegionMovers,
  } = useDashboardRegionMovers(activeContinent, selectedExchangeId)

  const { data: sectors = [], isLoading: sectorsLoading } = useQuery({
    queryKey: ['sectorPerformance'],
    queryFn: () => fetchSectorPerformance(),
    refetchInterval: 60_000,
    staleTime: 30_000,
    gcTime: 300_000,
    placeholderData: keepPreviousData,
  })

  const {
    data: exchangeHeatmapData,
    isLoading: exchangeHeatmapLoading,
  } = useExchangeHeatmap(activeContinent, selectedExchangeId)

  const continentalSectorHeatmap = useMemo(
    () => mapExchangeHeatmapToSectors(exchangeHeatmapData?.sectors ?? []),
    [exchangeHeatmapData]
  )

  const newsContext = useMemo(
    () => ({ continent: activeContinent, exchangeId: selectedExchangeId }),
    [activeContinent, selectedExchangeId]
  )

  const {
    data: liveNews = [],
    isPending: newsPending,
    isError: newsError,
    isFetching: newsFetching,
    refetch: refetchNews,
  } = useBreakingNews(20, 45_000, newsContext)

  const { data: worldIndices = [], isLoading: indicesLoading } = useWorldIndices(activeContinent)
  const { data: currencyRates = {} } = useCurrencyRates()

  const topGainers = regionMovers?.gainers?.slice(0, 10) || []
  const topLosers = regionMovers?.losers?.slice(0, 10) || []
  const alertContextSymbols = useMemo(() => {
    const s = new Set<string>()
    if (selectedExchangeId) {
      for (const m of [...(regionMovers?.gainers ?? []), ...(regionMovers?.losers ?? [])]) {
        if (m.symbol) s.add(m.symbol)
      }
      return s
    }
    if (activeContinent === 'global' && sectors.length > 0) {
      for (const sec of sectors) {
        for (const st of sec.stocks) {
          if (st.symbol) s.add(st.symbol)
        }
      }
      return s
    }
    for (const m of [...(regionMovers?.gainers ?? []), ...(regionMovers?.losers ?? [])]) {
      if (m.symbol) s.add(m.symbol)
    }
    return s
  }, [regionMovers, sectors, selectedExchangeId, activeContinent])
  /** Full-universe breadth from sector heatmap (covers all tracked stocks, not just top movers) */
  const sectorAdvancers = useMemo(
    () => sectors.reduce((sum, s) => sum + s.stocks.filter((st) => st.change_percent > 0).length, 0),
    [sectors],
  )
  const sectorDecliners = useMemo(
    () => sectors.reduce((sum, s) => sum + s.stocks.filter((st) => st.change_percent < 0).length, 0),
    [sectors],
  )
  const sectorTotal = sectorAdvancers + sectorDecliners
  /** US heatmap sectors are global-only; avoid mixing US breadth with regional mover tabs */
  const useSectorBreadth = activeContinent === 'global' && sectorTotal > 0

  /** Regional tabs: Yahoo often fills actives while gainers/losers stay empty — count from merged quotes. */
  const regionalMoverBreadth = useMemo(() => {
    if (useSectorBreadth) return null
    const seen = new Set<string>()
    const rows: GlobalMover[] = []
    const push = (m: GlobalMover) => {
      if (!m?.symbol || seen.has(m.symbol)) return
      seen.add(m.symbol)
      rows.push(m)
    }
    for (const m of regionMovers?.gainers ?? []) push(m)
    for (const m of regionMovers?.losers ?? []) push(m)
    for (const m of regionMovers?.actives ?? []) push(m)
    let up = 0
    let down = 0
    for (const m of rows) {
      if (m.change_percent > 0) up++
      else if (m.change_percent < 0) down++
    }
    return { up, down, total: rows.length }
  }, [regionMovers, useSectorBreadth])

  const breadth = useSectorBreadth
    ? sectorAdvancers - sectorDecliners
    : (regionalMoverBreadth ? regionalMoverBreadth.up - regionalMoverBreadth.down : 0)

  const pulseBreadthUp = useSectorBreadth
    ? sectorAdvancers
    : (regionalMoverBreadth?.up ?? regionMovers?.gainers?.length ?? 0)
  const pulseBreadthDown = useSectorBreadth
    ? sectorDecliners
    : (regionalMoverBreadth?.down ?? regionMovers?.losers?.length ?? 0)
  const pulseBreadthTotal = pulseBreadthUp + pulseBreadthDown

  /** All heatmap-quoted names for Market Pulse (same universe as sector tiles) */
  const heatmapUniverseStocks = useMemo(() => {
    const rows: { symbol: string; name: string; change_percent: number; price: number; sector: string }[] = []
    const seen = new Set<string>()
    for (const sec of sectors) {
      for (const st of sec.stocks) {
        if (!st.symbol || seen.has(st.symbol)) continue
        seen.add(st.symbol)
        rows.push({
          symbol: st.symbol,
          name: st.name,
          change_percent: st.change_percent,
          price: st.price,
          sector: sec.sector,
        })
      }
    }
    rows.sort((a, b) => b.change_percent - a.change_percent)
    return rows
  }, [sectors])
  const breadthTone = breadth > 0 ? 'Risk-On' : breadth < 0 ? 'Risk-Off' : 'Balanced'
  const breadthColor = breadth > 0 ? 'text-emerald-400' : breadth < 0 ? 'text-red-400' : 'text-yellow-400'

  const continentInfo = CONTINENTS.find((c) => c.id === activeContinent)

  /** Align Live News / Gainers / Losers toolbars and equal column height on large screens */
  const dashToolbar =
    'h-12 px-4 border-b border-slate-700/30 flex items-center justify-between shrink-0 gap-2'
  const topRowTripleHeight =
    'h-full w-full flex flex-col min-h-[min(380px,62vh)] lg:h-[520px] lg:max-h-[min(520px,78vh)]'

  /** Globe · Watchlist · Heatmap — same width (4+4+4) and height on large screens */
  const midRowTripleHeight =
    'flex h-full w-full min-h-[280px] flex-col lg:h-[550px] lg:max-h-[min(550px,82vh)]'

  const tapeItems = useMemo(
    () =>
      buildMarketTape({
        continent: activeContinent,
        indices: worldIndices,
        gainers: regionMovers?.gainers,
        losers: regionMovers?.losers,
        actives: regionMovers?.actives,
      }),
    [activeContinent, worldIndices, regionMovers]
  )

  const dashboardActivityFingerprint = useMemo(() => {
    const m = moversActivityFingerprint(regionMovers)
    const idx = worldIndices.slice(0, 16).reduce((a, q) => a + (Number.isFinite(q.change_percent) ? q.change_percent : 0), 0)
    return Math.round((m + idx) * 1000) / 1000
  }, [regionMovers, worldIndices])

  const newsActivityFingerprint = useMemo(
    () =>
      liveNews.slice(0, 12).reduce((a, n) => a + (n.title?.length ?? 0) + (n.related_tickers?.length ?? 0), 0),
    [liveNews]
  )

  const benchmarkPulse = useMemo(() => {
    return worldIndices.filter((q) => q.price > 0).slice(0, 5)
  }, [worldIndices])

  const benchmarkPulseMaxAbs = useMemo(() => {
    const v = benchmarkPulse.map((q) => Math.abs(q.change_percent ?? 0))
    return Math.max(0.35, ...v, 1)
  }, [benchmarkPulse])

  const regionalHeatRows = useMemo(() => {
    const seen = new Set<string>()
    const out: { symbol: string; name: string; change_percent: number; price: number }[] = []
    const push = (m: GlobalMover) => {
      if (!m?.symbol || seen.has(m.symbol)) return
      seen.add(m.symbol)
      out.push({
        symbol: m.symbol,
        name: m.name,
        change_percent: m.change_percent,
        price: m.price,
      })
    }
    for (const m of regionMovers?.gainers ?? []) push(m)
    for (const m of regionMovers?.losers ?? []) push(m)
    for (const m of regionMovers?.actives ?? []) push(m)
    out.sort((a, b) => Math.abs(b.change_percent) - Math.abs(a.change_percent))
    return out
  }, [regionMovers])

  return (
    <AppLayout>
      <div className="min-h-full flex flex-col">
        {/* Market tape (indices + regional movers) */}
        {indicesLoading && tapeItems.length === 0 ? (
          <IndicesBarSkeleton />
        ) : tapeItems.length > 0 ? (
          <WorldIndicesBar
            items={tapeItems}
            currency={displayCurrency}
            rates={currencyRates}
            continent={activeContinent}
            selectedExchangeId={selectedExchangeId}
            onToggleExchange={toggleExchange}
          />
        ) : null}

        {/* Continent tabs */}
        <ContinentTabBar active={activeContinent} onChange={setActiveContinent} />

        {/* Dashboard header */}
        <div className="px-4 pt-4 pb-2 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#007AFF]" />
              {isAuthenticated && user ? (
                <>
                  {getTimeBasedGreeting()},{' '}
                  <span className="text-[#007AFF] font-semibold text-sm capitalize">
                    {(user as { full_name?: string; username?: string; email?: string }).full_name?.split(' ')[0] ||
                     (user as { full_name?: string; username?: string; email?: string }).username ||
                     user.email?.split('@')[0] ||
                     'there'}
                  </span>
                </>
              ) : (
                <>Dashboard</>
              )}
              {activeContinent !== 'global' && (
                <span className="flex items-center gap-1 px-2 py-0.5 bg-[#007AFF]/10 border border-[rgba(0,122,255,0.2)] rounded text-sm text-[#007AFF]">
                  <MapPin className="w-3 h-3" />
                  {continentInfo?.label}
                </span>
              )}
            </h1>
            <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              {(activeContinent === 'global' || selectedExchangeId) && (
                <>
                  {' · '}
                  <span className={breadthColor + ' font-bold'}>{breadthTone}</span>
                  {(useSectorBreadth || !regionMoversLoading) && (
                    <>
                      {' · '}
                      <span className="text-emerald-400">{pulseBreadthUp}↑</span>{' '}
                      <span className="text-red-400">{pulseBreadthDown}↓</span>
                      {useSectorBreadth && (
                        <span className="text-slate-600"> /{sectorTotal}</span>
                      )}
                    </>
                  )}
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end">
            <ExchangeSessionsPopover continent={activeContinent} />
            <CurrencySelector value={displayCurrency} onChange={setDisplayCurrency} />
            <div className="flex items-center gap-2" title="Quote activity on refresh">
              <QuoteActivityFlash fingerprint={dashboardActivityFingerprint} />
              <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">Quotes</span>
            </div>
          </div>
        </div>

        {/* Major benchmarks + macro (continent or selected venue) */}
        <div className="px-4">
          <MajorIndicesMacroGrid
            continent={activeContinent}
            exchangeId={selectedExchangeId}
            currency={displayCurrency}
            rates={currencyRates}
          />
        </div>

        {/* Main bento grid */}
        <div className="flex-1 p-4 pt-2">

          {/* ── Continent-specific Exchange Indices ── */}
          {activeContinent !== 'global' && (
            <motion.div
              key={`indices-${activeContinent}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="mb-4"
            >
              <div className="hud-panel p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Globe className="w-4 h-4 text-[#007AFF]" />
                  <h3 className="font-bold text-white text-sm">
                    {continentInfo?.label} Exchange Indices
                  </h3>
                  <span className="text-[9px] px-1.5 py-0.5 bg-[#007AFF]/10 text-[#007AFF] rounded font-bold">LIVE</span>
                </div>
                <ContinentIndicesGrid
                  continent={activeContinent}
                  currency={displayCurrency}
                  rates={currencyRates}
                  selectedExchangeId={selectedExchangeId}
                  onSelectExchange={setSelectedExchangeId}
                />
              </div>
            </motion.div>
          )}

          {/* ── Non-global: Movers for that continent / venue ── */}
          {activeContinent !== 'global' && (
            <motion.div
              key={`movers-${activeContinent}-${selectedExchangeId ?? ''}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: 0.05 }}
              className="mb-4"
            >
              <ContinentMoversPanel continent={activeContinent} exchangeId={selectedExchangeId} />
            </motion.div>
          )}

          <div className="grid grid-cols-12 gap-3 lg:gap-4 items-stretch auto-rows-min">

            {/* ── Row 1 ── */}

            {/* Live News — responsive height + scroll */}
            <div
              className={`col-span-12 ${
                activeContinent === 'global' ? 'lg:col-span-4' : 'lg:col-span-12'
              } flex min-h-0`}
            >
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className={activeContinent === 'global' ? topRowTripleHeight : 'h-full min-h-[min(420px,70vh)] w-full flex flex-col'}
              >
                <div className="hud-panel h-full flex flex-col relative overflow-hidden min-h-0 flex-1">
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-500/8 via-transparent to-cyan-500/5 pointer-events-none" />
                  <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-blue-500/40 to-transparent" />

                  <div className={`${dashToolbar} relative`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[9px] font-bold text-white bg-gradient-to-r from-blue-500 to-cyan-500 rounded uppercase tracking-wider shadow-lg shadow-blue-500/20 shrink-0">
                        <Zap className="w-2.5 h-2.5" />
                        LIVE NEWS
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono hidden sm:inline shrink-0">
                        Top 7 + scroll
                      </span>
                      <QuoteActivityFlash fingerprint={newsActivityFingerprint} />
                      {newsFetching && !newsPending && (
                        <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">Syncing…</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => refetchNews()}
                      className="hud-card p-1.5 text-blue-400 hover:text-white transition-colors shrink-0"
                      aria-label="Refresh news"
                    >
                      <RefreshCw className={`w-3 h-3 ${newsFetching ? 'animate-spin' : ''}`} />
                    </button>
                  </div>

                  <div className="flex flex-1 min-h-0 flex-col overflow-hidden relative">
                    {newsPending ? (
                      <BrandedNewsLoading rows={10} />
                    ) : newsError ? (
                      <div className="flex flex-col items-center justify-center h-full py-10 text-center px-4">
                        <Activity className="w-8 h-8 text-amber-500/60 mb-3" />
                        <p className="text-slate-300 text-sm font-medium">Could not load headlines</p>
                        <button
                          type="button"
                          onClick={() => refetchNews()}
                          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 border border-slate-600 text-xs text-white hover:border-cyan-500/50"
                        >
                          <RefreshCw className="w-3 h-3" /> Retry
                        </button>
                      </div>
                    ) : liveNews.length > 0 ? (
                      <>
                        <div className="shrink-0 border-b border-slate-800/50 p-2 sm:p-3">
                          <p className="mb-2 px-0.5 text-[10px] font-mono text-slate-500">Featured</p>
                          <div className="space-y-2">
                            {liveNews.slice(0, 7).map((news, idx) => {
                              const key = news.id ?? news.url ?? `${news.title}-${idx}`
                              const isBullish = news.sentiment === 'Bullish'
                              const isBearish = news.sentiment === 'Bearish'
                              const Inner = (
                                <div className="flex items-start gap-2.5 p-2.5 sm:p-3 rounded-lg border border-slate-800/50 bg-slate-950/30 hover:bg-blue-500/5 hover:border-slate-700/60 transition-colors group/item h-full">
                                  <div
                                    className={`mt-0.5 p-1.5 rounded shrink-0 ${
                                      isBullish
                                        ? 'bg-green-500/15'
                                        : isBearish
                                          ? 'bg-red-500/15'
                                          : 'bg-slate-700/40'
                                    }`}
                                  >
                                    {isBullish ? (
                                      <TrendingUp className="w-3 h-3 text-green-400" />
                                    ) : isBearish ? (
                                      <TrendingDown className="w-3 h-3 text-red-400" />
                                    ) : (
                                      <Minus className="w-3 h-3 text-slate-400" />
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[13px] sm:text-sm text-white font-medium group-hover/item:text-blue-300 transition-colors line-clamp-3 leading-snug">
                                      {news.title}
                                    </p>
                                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                      <span className="text-[10px] text-slate-500 flex items-center gap-1 min-w-0">
                                        <Clock className="w-2.5 h-2.5 shrink-0" />
                                        <span className="truncate">{news.source}</span>
                                      </span>
                                      {news.related_tickers && news.related_tickers.length > 0 && (
                                        <div className="flex gap-1 flex-wrap">
                                          {news.related_tickers.slice(0, 3).map((t) => (
                                            <span
                                              key={t}
                                              className="px-1.5 py-0.5 text-[9px] bg-blue-500/15 text-blue-400 rounded font-mono"
                                            >
                                              {t}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )
                              return news.url ? (
                                <a
                                  key={key}
                                  href={news.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block min-w-0"
                                >
                                  {Inner}
                                </a>
                              ) : (
                                <div key={key} className="min-w-0">
                                  {Inner}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                        {liveNews.length > 7 && (
                          <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-3">
                            <p className="mb-2 px-0.5 text-[10px] font-mono text-slate-500">More headlines</p>
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
                              {liveNews.slice(7, 20).map((news, idx) => {
                                const key = news.id ?? news.url ?? `more-${news.title}-${idx}`
                                const isBullish = news.sentiment === 'Bullish'
                                const isBearish = news.sentiment === 'Bearish'
                                const Inner = (
                                  <div className="flex items-start gap-2.5 p-2.5 sm:p-3 rounded-lg border border-slate-800/50 bg-slate-950/30 hover:bg-blue-500/5 hover:border-slate-700/60 transition-colors group/item h-full">
                                    <div
                                      className={`mt-0.5 p-1.5 rounded shrink-0 ${
                                        isBullish
                                          ? 'bg-green-500/15'
                                          : isBearish
                                            ? 'bg-red-500/15'
                                            : 'bg-slate-700/40'
                                      }`}
                                    >
                                      {isBullish ? (
                                        <TrendingUp className="w-3 h-3 text-green-400" />
                                      ) : isBearish ? (
                                        <TrendingDown className="w-3 h-3 text-red-400" />
                                      ) : (
                                        <Minus className="w-3 h-3 text-slate-400" />
                                      )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[13px] sm:text-sm text-white font-medium group-hover/item:text-blue-300 transition-colors line-clamp-3 leading-snug">
                                        {news.title}
                                      </p>
                                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                        <span className="text-[10px] text-slate-500 flex items-center gap-1 min-w-0">
                                          <Clock className="w-2.5 h-2.5 shrink-0" />
                                          <span className="truncate">{news.source}</span>
                                        </span>
                                        {news.related_tickers && news.related_tickers.length > 0 && (
                                          <div className="flex gap-1 flex-wrap">
                                            {news.related_tickers.slice(0, 3).map((t) => (
                                              <span
                                                key={t}
                                                className="px-1.5 py-0.5 text-[9px] bg-blue-500/15 text-blue-400 rounded font-mono"
                                              >
                                                {t}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                )
                                return news.url ? (
                                  <a
                                    key={key}
                                    href={news.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block min-w-0"
                                  >
                                    {Inner}
                                  </a>
                                ) : (
                                  <div key={key} className="min-w-0">
                                    {Inner}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full py-10 text-center px-4">
                        <Activity className="w-8 h-8 text-slate-700 mb-3" />
                        <p className="text-slate-400 text-sm">No headlines available</p>
                        <button
                          type="button"
                          onClick={() => refetchNews()}
                          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 border border-slate-600 text-xs text-white hover:border-cyan-500/50"
                        >
                          <RefreshCw className="w-3 h-3" /> Retry
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            </div>

            {/* Top Gainers / Losers — US & global dashboard only (continent view uses panel above) */}
            {activeContinent === 'global' && (
            <div className="col-span-12 sm:col-span-6 lg:col-span-4 flex min-h-0">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.05 }}
                className={topRowTripleHeight}
              >
                <div className="hud-panel h-full flex flex-col overflow-hidden min-h-0">
                  <div className={dashToolbar}>
                    <div className="flex items-center gap-2 min-w-0">
                      <TrendingUp className="w-4 h-4 text-emerald-400 shrink-0" />
                      <h3 className="font-bold text-white text-sm truncate">Top Gainers</h3>
                      {selectedExchangeId && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 font-mono shrink-0 truncate max-w-[72px]">
                          {getExchangeById(selectedExchangeId)?.shortName ?? selectedExchangeId}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-emerald-400 font-mono font-bold tabular-nums">
                        {topGainers.length > 0 ? `+${formatPercent(topGainers[0]?.change_percent, 1)}` : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() => refetchRegionMovers()}
                        className="p-1.5 rounded text-slate-500 hover:text-white hover:bg-slate-800/60 transition-colors"
                        aria-label="Refresh movers"
                      >
                        <RefreshCw className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    {regionMoversLoading ? (
                      <SkeletonMoversSection count={8} />
                    ) : topGainers.length > 0 ? (
                      topGainers.map((stock: GlobalMover, idx: number) => (
                        <Link
                          key={stock.symbol || `gainer-${idx}`}
                          href={`/research?symbol=${stock.symbol}`}
                          className="flex items-center justify-between px-4 py-2.5 hover:bg-emerald-500/5 border-b border-slate-800/30 transition-all group"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="w-4 text-[10px] text-slate-600 font-mono text-right">
                              {idx + 1}
                            </span>
                            <div>
                              <span className="font-bold text-white group-hover:text-emerald-400 transition-colors text-xs font-mono">
                                {stock.symbol}
                              </span>
                              <div className="text-[10px] text-slate-500 truncate max-w-[110px]">
                                {stock.name}
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-mono text-xs text-white">
                              {isNumber(stock.price) ? `$${formatNumber(stock.price, 2)}` : '—'}
                            </div>
                            <div className="font-mono text-[10px] text-emerald-400 font-bold">
                              +{formatPercent(stock.change_percent, 2)}
                            </div>
                          </div>
                        </Link>
                      ))
                    ) : (
                      <div className="flex items-center justify-center h-24 text-slate-500 text-xs">
                        No data
                      </div>
                    )}
                  </div>
                  <div className="px-4 py-2.5 border-t border-slate-700/30 shrink-0">
                    <Link
                      href="/markets"
                      className="flex items-center justify-center gap-1.5 text-xs text-emerald-400 hover:text-white font-medium transition-colors"
                    >
                      All Gainers <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              </motion.div>
            </div>
            )}

            {activeContinent === 'global' && (
            <div className="col-span-12 sm:col-span-6 lg:col-span-4 flex min-h-0">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.08 }}
                className={topRowTripleHeight}
              >
                <div className="hud-panel h-full flex flex-col overflow-hidden min-h-0">
                  <div className={dashToolbar}>
                    <div className="flex items-center gap-2 min-w-0">
                      <TrendingDown className="w-4 h-4 text-red-400 shrink-0" />
                      <h3 className="font-bold text-white text-sm truncate">Top Losers</h3>
                    </div>
                    <div className="flex items-center justify-end gap-2 shrink-0 min-w-[4.5rem]">
                      {topLosers.length > 0 ? (
                        <span className="text-[10px] text-red-400 font-mono font-bold tabular-nums">
                          {formatPercent(topLosers[0]?.change_percent, 1)}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-600 font-mono w-8" aria-hidden />
                      )}
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    {regionMoversLoading ? (
                      <SkeletonMoversSection count={8} />
                    ) : topLosers.length > 0 ? (
                      topLosers.map((stock: GlobalMover, idx: number) => (
                        <Link
                          key={stock.symbol || `loser-${idx}`}
                          href={`/research?symbol=${stock.symbol}`}
                          className="flex items-center justify-between px-4 py-2.5 hover:bg-red-500/5 border-b border-slate-800/30 transition-all group"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="w-4 text-[10px] text-slate-600 font-mono text-right">
                              {idx + 1}
                            </span>
                            <div>
                              <span className="font-bold text-white group-hover:text-red-400 transition-colors text-xs font-mono">
                                {stock.symbol}
                              </span>
                              <div className="text-[10px] text-slate-500 truncate max-w-[90px]">
                                {stock.name}
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-mono text-xs text-white">
                              {isNumber(stock.price) ? `$${formatNumber(stock.price, 2)}` : '—'}
                            </div>
                            <div className="font-mono text-[10px] text-red-400 font-bold">
                              {formatPercent(stock.change_percent, 2)}
                            </div>
                          </div>
                        </Link>
                      ))
                    ) : (
                      <div className="flex items-center justify-center h-24 text-slate-500 text-xs">
                        No data
                      </div>
                    )}
                  </div>
                  <div className="px-4 py-2.5 border-t border-slate-700/30 shrink-0">
                    <Link
                      href="/markets"
                      className="flex items-center justify-center gap-1.5 text-xs text-red-400 hover:text-white font-medium transition-colors"
                    >
                      All Losers <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              </motion.div>
            </div>
            )}

            {/* ── Row 2 supplement (fills row next to live news) ── */}

            {/* Mini World Monitor */}
            <div className="col-span-12 sm:col-span-6 lg:col-span-4 flex min-h-0">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 }}
                className={midRowTripleHeight}
              >
                <MiniWorldMonitorSnapshot continent={activeContinent} />
              </motion.div>
            </div>

            {/* Watchlist Snapshot */}
            <div className="col-span-12 sm:col-span-6 lg:col-span-4 flex min-h-0">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.12 }}
                className={midRowTripleHeight}
              >
                <WatchlistSnapshot toolbarClassName={dashToolbar} />
              </motion.div>
            </div>

            {/* Sector heatmap (US) or regional 1D movers map */}
            <div className="col-span-12 sm:col-span-6 lg:col-span-4 flex min-h-0">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.14 }}
                className={midRowTripleHeight}
              >
                <div className="hud-panel flex h-full min-h-0 flex-1 flex-col overflow-hidden">
                  <div className={dashToolbar}>
                    <div className="flex min-w-0 items-center gap-2">
                      <BarChart3 className="h-4 w-4 shrink-0 text-blue-400" />
                      <h3 className="truncate text-sm font-bold text-white">Sector heatmap</h3>
                      {activeContinent === 'global' ? (
                        <span className="max-w-[72px] truncate font-mono text-[9px] text-slate-500">
                          US
                        </span>
                      ) : (
                        <span className="max-w-[100px] truncate font-mono text-[9px] text-slate-500">
                          {selectedExchangeId
                            ? getExchangeById(selectedExchangeId)?.shortName ?? selectedExchangeId
                            : continentInfo?.label}
                        </span>
                      )}
                    </div>
                    <Link
                      href="/markets"
                      className="shrink-0 text-[10px] font-medium text-blue-400 transition-colors hover:text-white"
                    >
                      Markets →
                    </Link>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-2">
                    {activeContinent === 'global' ? (
                      sectorsLoading ? (
                        <SkeletonSectorPerformance count={4} />
                      ) : (
                        <SectorHeatmap
                          sectors={sectors}
                          loading={false}
                          emptyLabel="No US sector data yet. Confirm the backend is running and sector quotes are available, then refresh."
                        />
                      )
                    ) : exchangeHeatmapLoading ? (
                      <SkeletonSectorPerformance count={4} />
                    ) : continentalSectorHeatmap.length > 0 ? (
                      <SectorHeatmap
                        sectors={continentalSectorHeatmap}
                        loading={false}
                        emptyLabel="No sector breakdown for this region."
                      />
                    ) : regionMoversLoading ? (
                      <SkeletonSectorPerformance count={4} />
                    ) : regionalHeatRows.length > 0 ? (
                      <div className="space-y-2">
                        <p className="px-0.5 text-[9px] leading-snug text-slate-500">
                          Sector quotes unavailable — showing movers until FMP/Yahoo data loads.
                        </p>
                        <MoversHeatmap rows={regionalHeatRows} emptyLabel="No regional movers" />
                      </div>
                    ) : (
                      <SectorHeatmap
                        sectors={[]}
                        loading={false}
                        emptyLabel="No sector heatmap for this region yet (configure FMP for universe quotes) and no movers loaded."
                      />
                    )}
                  </div>
                </div>
              </motion.div>
            </div>

            {/* AI Prediction Alerts */}
            <div className="col-span-12 sm:col-span-6 lg:col-span-4 flex">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.16 }}
                className="h-full min-h-[260px] lg:min-h-[280px] w-full flex flex-col"
              >
                <PredictionAlertsWidget
                  contextSymbols={alertContextSymbols.size > 0 ? alertContextSymbols : undefined}
                />
              </motion.div>
            </div>

            {/* Market Pulse + IPO Radar — split row (desktop: pulse left, IPO strip right) */}
            <div className="col-span-12 lg:col-span-8 flex min-h-0">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.18 }}
                className="flex h-full min-h-[320px] w-full flex-col lg:min-h-[420px]"
              >
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-800/50 shadow-lg shadow-black/20 hud-panel lg:flex-row">
                  <div className="relative flex min-h-0 min-w-0 flex-1 flex-col border-b border-slate-800/60 lg:max-w-[420px] lg:shrink-0 lg:border-b-0 lg:border-r">
                    <div className="absolute top-0 right-0 w-28 h-28 bg-cyan-500/6 rounded-full blur-3xl pointer-events-none" />
                    <div className={`${dashToolbar} relative`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
                        <h3 className="font-bold text-white text-sm truncate">Market Pulse</h3>
                        <span className="px-1.5 py-0.5 text-[9px] bg-cyan-500/20 text-cyan-400 rounded font-bold shrink-0">
                          LIVE
                        </span>
                      </div>
                    </div>
                    <div className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 sm:p-4">
                      <ProCard className="p-2.5 sm:p-3">
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <Activity className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                            <span className="text-[11px] font-bold text-white">Breadth</span>
                          </div>
                          <span className={`shrink-0 font-mono text-[11px] font-bold ${breadthColor}`}>
                            {breadthTone}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800/90 ring-1 ring-slate-700/40">
                            <div
                              className="h-full bg-gradient-to-r from-emerald-500 via-cyan-500/90 to-emerald-400 transition-all duration-700"
                              style={{
                                width:
                                  (useSectorBreadth && sectorsLoading) ||
                                  (!useSectorBreadth && regionMoversLoading)
                                    ? '50%'
                                    : pulseBreadthTotal <= 0
                                      ? '50%'
                                      : `${Math.round((pulseBreadthUp / pulseBreadthTotal) * 100)}%`,
                              }}
                            />
                          </div>
                          <span className="shrink-0 font-mono text-[10px] tabular-nums text-slate-500">
                            {pulseBreadthUp}↑ {pulseBreadthDown}↓
                          </span>
                        </div>
                      </ProCard>

                      <ProCard className="p-2.5 sm:p-3">
                        <div className="mb-1.5 flex items-center gap-1.5">
                          <Signal className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                          <span className="text-[11px] font-bold text-white">Benchmark pulse</span>
                        </div>
                        {indicesLoading ? (
                          <div className="space-y-2">
                            {[1, 2, 3].map((i) => (
                              <div key={i} className="h-2 rounded bg-slate-800/60 animate-pulse" />
                            ))}
                          </div>
                        ) : benchmarkPulse.length === 0 ? (
                          <p className="text-[10px] text-slate-500">No index quotes yet.</p>
                        ) : (
                          <ul className="space-y-2">
                            {benchmarkPulse.map((q) => {
                              const pct = q.change_percent ?? 0
                              const up = pct >= 0
                              const w = Math.round(
                                (Math.min(Math.abs(pct), benchmarkPulseMaxAbs) / benchmarkPulseMaxAbs) * 100
                              )
                              return (
                                <li key={q.symbol} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5">
                                  <div className="flex min-w-0 items-center gap-1.5">
                                    <span
                                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                                      style={{ background: q.color }}
                                    />
                                    <span className="truncate text-[10px] font-medium text-slate-400">
                                      {q.shortName || q.symbol}
                                    </span>
                                  </div>
                                  <span
                                    className={`shrink-0 font-mono text-[10px] font-bold ${
                                      up ? 'text-emerald-400' : 'text-red-400'
                                    }`}
                                  >
                                    {up ? '+' : ''}
                                    {formatPercent(pct, 2)}
                                  </span>
                                  <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-slate-800/80">
                                    <div
                                      className={`h-full rounded-full transition-all duration-500 ${
                                        up ? 'bg-gradient-to-r from-emerald-600 to-cyan-500' : 'bg-gradient-to-r from-amber-600 to-red-500'
                                      }`}
                                      style={{ width: `${Math.max(8, w)}%` }}
                                    />
                                  </div>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </ProCard>

                      {(activeContinent === 'global' && heatmapUniverseStocks.length > 0) ||
                      (activeContinent !== 'global' && regionalHeatRows.length > 0) ? (
                        <ProCard className="flex min-h-0 max-h-[min(240px,32vh)] flex-1 flex-col p-2.5 sm:p-3">
                          <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <Layers className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                              <span className="truncate text-[11px] font-bold text-white">
                                {activeContinent === 'global' ? 'Full heatmap universe' : 'Regional movers'}
                              </span>
                            </div>
                            <span className="shrink-0 font-mono text-[9px] text-slate-500">
                              {activeContinent === 'global'
                                ? heatmapUniverseStocks.length
                                : regionalHeatRows.length}{' '}
                              names
                            </span>
                          </div>
                          <div className="min-h-0 flex-1 space-y-0 overflow-y-auto overscroll-contain rounded-md border border-slate-800/40 bg-slate-950/30">
                            {(activeContinent === 'global' ? heatmapUniverseStocks : regionalHeatRows).map(
                              (st) => {
                                const pct = st.change_percent ?? 0
                                const up = pct >= 0
                                return (
                                  <Link
                                    key={st.symbol}
                                    href={`/research?symbol=${encodeURIComponent(st.symbol)}`}
                                    className="flex items-center justify-between gap-2 border-b border-slate-800/25 px-2 py-1.5 last:border-b-0 hover:bg-slate-800/40"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="truncate font-mono text-[10px] font-bold text-slate-200">
                                        {st.symbol}
                                      </div>
                                      {activeContinent === 'global' &&
                                      'sector' in st &&
                                      typeof st.sector === 'string' ? (
                                        <div className="truncate text-[9px] text-slate-600">{st.sector}</div>
                                      ) : null}
                                    </div>
                                    <span
                                      className={`shrink-0 font-mono text-[10px] font-bold ${
                                        up ? 'text-emerald-400' : 'text-red-400'
                                      }`}
                                    >
                                      {up ? '+' : ''}
                                      {formatPercent(pct, 2)}
                                    </span>
                                  </Link>
                                )
                              }
                            )}
                          </div>
                        </ProCard>
                      ) : null}

                      <ProCard className="p-2.5 sm:p-3">
                        <div className="flex items-center gap-1.5 mb-1">
                          <BarChart3 className="w-3.5 h-3.5 text-green-400 shrink-0" />
                          <span className="text-[11px] font-bold text-white">
                            {activeContinent === 'global' ? 'Sector leader' : 'Top mover'}
                          </span>
                        </div>
                        {activeContinent !== 'global' ? (
                          regionMoversLoading ? (
                            <div className="h-4 w-24 bg-slate-800/60 rounded animate-pulse" />
                          ) : topGainers[0] ? (
                            <Link
                              href={`/research?symbol=${encodeURIComponent(topGainers[0].symbol)}`}
                              className="flex items-center justify-between gap-2 group"
                            >
                              <span className="text-[11px] text-slate-300 font-mono truncate group-hover:text-emerald-400">
                                {topGainers[0].symbol}
                              </span>
                              <span className="text-[11px] font-mono font-bold text-emerald-400 shrink-0">
                                +{formatPercent(topGainers[0].change_percent, 2)}
                              </span>
                            </Link>
                          ) : (
                            <span className="text-[10px] text-slate-500">No movers</span>
                          )
                        ) : sectorsLoading ? (
                          <div className="h-4 w-24 bg-slate-800/60 rounded animate-pulse" />
                        ) : sectors.length > 0 ? (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] text-slate-300 truncate">{sectors[0]?.sector}</span>
                            <span
                              className={`text-[11px] font-mono font-bold shrink-0 ${
                                sectors[0]?.change_percent >= 0 ? 'text-emerald-400' : 'text-red-400'
                              }`}
                            >
                              {sectors[0]?.change_percent >= 0 ? '+' : ''}
                              {formatPercent(sectors[0]?.change_percent, 2)}
                            </span>
                          </div>
                        ) : null}
                      </ProCard>

                      <div className="grid grid-cols-2 gap-1.5 mt-auto pt-1">
                        {[
                          { label: 'Ideas Lab', href: '/ideas-lab', icon: Sparkles, color: 'text-violet-400' },
                          { label: 'Global Monitor', href: '/monitor', icon: Globe, color: 'text-sky-400' },
                          { label: 'Backtesting', href: '/backtest', icon: ShieldAlert, color: 'text-amber-400' },
                          { label: 'Markets', href: '/markets', icon: Zap, color: 'text-yellow-400' },
                        ].map(({ label, href, icon: Icon, color }) => (
                          <Link
                            key={href}
                            href={href}
                            className="flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-slate-700/50 bg-slate-950/50 hover:border-slate-600 hover:bg-slate-800/50 transition-all group"
                          >
                            <Icon className={`w-3 h-3 shrink-0 ${color}`} />
                            <span className="text-[10px] text-slate-400 group-hover:text-white transition-colors font-medium truncate">
                              {label}
                            </span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex min-h-[200px] min-w-0 flex-1 flex-col bg-[#0a0d12]/40 lg:min-h-0">
                    <IpoRadarWidget
                      variant="inline"
                      className="h-full min-h-0 px-3 sm:px-4"
                      continent={activeContinent}
                      exchangeId={selectedExchangeId}
                    />
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </div>

        {/* Bottom sections */}
        <div className="px-4 pb-6 space-y-4">
          <LiveNewsChannelPanel continent={activeContinent} />
          <MarketNewsGrid />
        </div>
      </div>
    </AppLayout>
  )
}

export default function Home() {
  return (
    <>
      <div className="hidden md:block">
        <DesktopHome />
      </div>
      <div className="md:hidden">
        <MobileLayout>
          <MobileDashboard />
        </MobileLayout>
      </div>
    </>
  )
}
