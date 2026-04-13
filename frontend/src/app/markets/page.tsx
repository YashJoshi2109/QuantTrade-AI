'use client'

import { useState, useCallback, useMemo } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import MobileMarkets from '@/components/layout/MobileMarkets'
import MarketMoversPanel from '@/components/MarketMoversPanel'
import MarketHeatmap from '@/components/MarketHeatmap'
import MoversHeatmap from '@/components/MoversHeatmap'
import EconomicCalendarStrip from '@/components/EconomicCalendarStrip'
import { QuoteActivityFlash, moversActivityFingerprint } from '@/components/QuoteActivityFlash'
import {
  SkeletonMarketIndices,
  SkeletonMarketStats,
  SkeletonHeatmap,
} from '@/components/Skeleton'
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Globe,
  BarChart3,
  Activity,
  Zap,
  Grid3X3,
  List,
  Signal,
  DollarSign,
  Database,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  fetchSectorPerformance,
  fetchMarketMovers,
  fetchMarketIndices,
  fetchMarketCoverage,
  SectorPerformance,
  MarketIndex,
} from '@/lib/api'
import { formatNumber, formatPercent, isNumber } from '@/lib/format'
import Link from 'next/link'
import { CONTINENTS, DISPLAY_CURRENCIES, type Continent } from '@/lib/world-exchanges'
import type { IndexQuote } from '@/app/api/quotes/indices/route'
import type { ExchangeSector } from '@/app/api/exchange/heatmap/route'
import { useStockSnapshot } from '@/context/StockSnapshotContext'
import { useExchangeHeatmap } from '@/hooks/useExchangeHeatmap'

// ─── Hooks ────────────────────────────────────────────────────────────────────
function useWorldIndices(continent: Continent) {
  return useQuery({
    queryKey: ['worldIndices', continent],
    queryFn: async (): Promise<IndexQuote[]> => {
      const res = await fetch(`/api/quotes/indices?continent=${continent}`)
      if (!res.ok) return []
      return res.json()
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
}

function useContinentMovers(continent: Continent) {
  return useQuery({
    queryKey: ['continentMovers', continent],
    queryFn: async (): Promise<{
      gainers: GlobalMover[]
      losers: GlobalMover[]
      actives: GlobalMover[]
    }> => {
      const apiBase = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '')
      const endpoint = `${apiBase}/api/v1/market/movers?continent=${continent}&count=12`
      const res = await fetch(endpoint)
      if (!res.ok) return { gainers: [], losers: [], actives: [] }
      const j = await res.json()
      const gainers: GlobalMover[] = j.gainers ?? []
      const losers: GlobalMover[] = j.losers ?? []
      // Backend mover endpoint does not always return actives; synthesize from available movers.
      const actives = Array.isArray(j.actives) && j.actives.length > 0
        ? j.actives
        : [...gainers, ...losers]
            .filter((m) => Number.isFinite(m.volume) && m.volume > 0)
            .sort((a, b) => (b.volume || 0) - (a.volume || 0))
            .slice(0, 12)
      return {
        gainers,
        losers,
        actives,
      }
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })
}

function useCurrencyRates() {
  return useQuery({
    queryKey: ['currencyRates'],
    queryFn: async (): Promise<Record<string, number>> => {
      const res = await fetch('/api/currencies')
      if (!res.ok) return {}
      const data = await res.json()
      return data.rates ?? {}
    },
    staleTime: 3_600_000,
    gcTime: 7_200_000,
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

// ─── Continent Tab Bar ─────────────────────────────────────────────────────
function ContinentTabBar({ active, onChange }: { active: Continent; onChange: (c: Continent) => void }) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-3 mb-4 no-scrollbar">
      {CONTINENTS.map((c) => (
        <motion.button
          key={c.id}
          type="button"
          onClick={() => onChange(c.id)}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.95 }}
          className={`mac-btn mac-btn-pill shrink-0 flex items-center gap-1.5 text-[11px] font-bold ${
            active === c.id ? 'mac-btn-active' : ''
          }`}
        >
          <span>{c.emoji}</span>
          <span>{c.label}</span>
        </motion.button>
      ))}
    </div>
  )
}

// ─── Currency Selector ─────────────────────────────────────────────────────
function CurrencySelector({ value, onChange }: { value: string; onChange: (c: string) => void }) {
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
        {curr.flag} {curr.code}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute right-0 top-full mt-1 z-50 w-44 rounded-xl border border-slate-700/60 bg-[#101928] shadow-2xl overflow-hidden"
          >
            <div className="max-h-64 overflow-y-auto py-1">
              {DISPLAY_CURRENCIES.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => { onChange(c.code); setOpen(false) }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-[11px] transition-colors ${
                    c.code === value ? 'text-[#007AFF] bg-[#007AFF]/10' : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
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

// ─── Helper: country code → flag emoji ───────────────────────────────────────
function countryFlag(code: string): string {
  if (!code || code.length !== 2) return ''
  const u = code.toUpperCase()
  const A = 0x1F1E6 // Regional Indicator Symbol Letter A (🇦)
  return String.fromCodePoint(A + u.charCodeAt(0) - 65, A + u.charCodeAt(1) - 65)
}

// ─── World Exchange Indices Grid (Bloomberg-style) ───────────────────────────
function WorldIndicesGrid({ continent, currency, rates }: { continent: Continent; currency: string; rates: Record<string, number> }) {
  const { data: indices = [], isLoading } = useWorldIndices(continent)
  const { openSnapshot } = useStockSnapshot()
  const currInfo = DISPLAY_CURRENCIES.find((c) => c.code === currency)
  const currSymbol = currInfo?.symbol ?? '$'

  function convertPrice(price: number, from: string): number {
    if (!price || currency === from) return price
    const usd = from === 'USD' ? price : price / (rates[from] ?? 1)
    return currency === 'USD' ? usd : usd * (rates[currency] ?? 1)
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 mb-6">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-slate-800/40 animate-pulse" />
        ))}
      </div>
    )
  }

  const validIndices = indices.filter((q) => q.price > 0)
  if (!validIndices.length) return null

  const isGlobal = continent === 'global'
  const displayIndices = isGlobal ? [...validIndices, ...validIndices, ...validIndices] : validIndices

  const renderCard = (q: IndexQuote, idx: number) => {
    const up = q.change_percent >= 0
    const displayPrice = convertPrice(q.price, q.currency)
    const neon = up ? '#34d399' : '#f87171'
    const neonBg = up ? 'rgba(52,211,153,' : 'rgba(248,113,113,'

    return (
      <motion.button
        key={`${q.symbol}-${idx}`}
        onClick={() => openSnapshot({
          symbol: q.symbol,
          name: q.shortName || q.exchangeName,
          price: displayPrice,
          change: (displayPrice * (q.change_percent ?? 0)) / 100,
          change_percent: q.change_percent,
          exchange: q.exchangeName,
          currency: currency,
          flag: countryFlag(q.countryCode),
        })}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: idx * 0.025 }}
        whileHover={{ scale: 1.03, y: -2 }}
        whileTap={{ scale: 0.97 }}
        className={`group relative overflow-hidden text-left cursor-pointer ${isGlobal ? 'shrink-0 w-[200px]' : ''}`}
        style={{
          background: 'linear-gradient(145deg, rgba(16,25,50,0.92) 0%, rgba(10,16,38,0.96) 100%)',
          border: `1px solid rgba(255,255,255,0.07)`,
          borderTop: '1px solid rgba(255,255,255,0.11)',
          borderLeft: '1px solid rgba(255,255,255,0.09)',
          borderRadius: 14,
          boxShadow: [
            'inset 0 1px 0 rgba(255,255,255,0.07)',
            '0 4px 16px rgba(0,0,0,0.35)',
          ].join(', '),
          backdropFilter: 'blur(20px)',
          padding: '12px 14px 10px',
          transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
        }}
      >
        {/* Top accent line */}
        <div className="absolute inset-x-0 top-0 h-[2px] rounded-t-2xl transition-opacity"
          style={{ background: `linear-gradient(90deg, transparent, ${neon}80, transparent)`, opacity: 0.6 }} />

        {/* Hover glow overlay */}
        <div className="absolute inset-0 rounded-[14px] opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          style={{ background: `radial-gradient(ellipse at 50% 0%, ${neonBg}0.06) 0%, transparent 70%)` }} />

        {/* Exchange name + change */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            {q.countryCode && <span className="text-sm leading-none">{countryFlag(q.countryCode)}</span>}
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-300">{q.exchangeName}</span>
          </div>
          <span
            className="text-[10px] font-black font-mono tabular-nums px-1.5 py-0.5 rounded-md"
            style={{
              background: neonBg + '0.12)',
              border: `1px solid ${neonBg}0.35)`,
              color: neon,
            }}
          >
            {up ? '+' : ''}{(q.change_percent ?? 0).toFixed(2)}%
          </span>
        </div>

        {/* Price */}
        <div className="text-xl font-black font-mono tabular-nums text-white leading-tight group-hover:text-white transition-colors">
          {displayPrice > 0
            ? `${currSymbol}${formatNumber(displayPrice, displayPrice > 1000 ? 0 : 2)}`
            : '—'
          }
        </div>

        {/* Index name */}
        <div className="text-[10px] text-slate-500 mt-0.5 truncate font-medium group-hover:text-slate-400 transition-colors">
          {q.shortName}
        </div>
      </motion.button>
    )
  }

  return (
    <div className="mb-6">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-3 px-0.5">
        <div className="w-1 h-4 rounded-full bg-[#007AFF]" />
        <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">Global Exchange Indices</span>
        <div className="ml-auto flex items-center gap-1.5 text-[10px] text-slate-600 font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Live
        </div>
      </div>

      {isGlobal ? (
        <div className="relative w-full overflow-hidden [mask-image:_linear-gradient(to_right,transparent_0,_black_40px,_black_calc(100%-40px),transparent_100%)]">
          <div className="animate-ticker-tape gap-2 pb-2 pt-1 px-1">
            {displayIndices.map(renderCard)}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
          {displayIndices.map(renderCard)}
        </div>
      )}
    </div>
  )
}

// ─── Exchange Universe (ranked stock list) ────────────────────────────────
const CONTINENT_UNIVERSE_KEYS: Partial<Record<Continent, { key: string; limit: number; label: string }[]>> = {
  americas: [
    { key: 'us',     limit: 300, label: '🇺🇸 United States' },
    { key: 'canada', limit: 50,  label: '🇨🇦 Canada' },
    { key: 'brazil', limit: 15,  label: '🇧🇷 Brazil' },
  ],
  europe: [
    { key: 'uk',      limit: 75, label: '🇬🇧 United Kingdom' },
    { key: 'germany', limit: 50, label: '🇩🇪 Germany' },
    { key: 'france',  limit: 40, label: '🇫🇷 France' },
  ],
  asia: [
    { key: 'india',    limit: 100, label: '🇮🇳 India' },
    { key: 'japan',    limit: 50,  label: '🇯🇵 Japan' },
    { key: 'hongkong', limit: 40,  label: '🇭🇰 Hong Kong' },
    { key: 'china',    limit: 40,  label: '🇨🇳 China' },
    { key: 'korea',    limit: 20,  label: '🇰🇷 South Korea' },
  ],
  oceania: [
    { key: 'australia', limit: 20, label: '🇦🇺 Australia' },
  ],
}

interface UniverseStock {
  symbol: string
  name: string
  sector: string
  price: number
  change_percent: number
  volume: number
  market_cap: number
  currency: string
  rank: number
}

function useExchangeUniverse(exchangeKey: string, limit: number) {
  return useQuery({
    queryKey: ['exchangeUniverse', exchangeKey, limit],
    queryFn: async (): Promise<UniverseStock[]> => {
      const res = await fetch(`/api/exchange/universe?exchange=${exchangeKey}&limit=${limit}`)
      if (!res.ok) return []
      const j = await res.json()
      return j.stocks ?? []
    },
    staleTime: 6 * 60 * 60 * 1000,   // 6 hours — FMP screener data
    gcTime:    7 * 60 * 60 * 1000,
    refetchInterval: 6 * 60 * 60 * 1000,
  })
}

function UniverseExchangeTable({
  exchangeKey,
  limit,
  label,
}: {
  exchangeKey: string
  limit: number
  label: string
}) {
  const { data: stocks = [], isLoading } = useExchangeUniverse(exchangeKey, limit)
  const { openSnapshot } = useStockSnapshot()
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? stocks : stocks.slice(0, 10)

  return (
    <div className="rounded-xl border border-slate-700/40 overflow-hidden bg-[#0d1526]/60">
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-800/30 border-b border-slate-700/30">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-white">{label}</span>
          {!isLoading && (
            <span className="text-[10px] text-slate-500 font-mono">
              {stocks.length} stocks
            </span>
          )}
        </div>
        {stocks.length > 10 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[11px] text-[#007AFF] hover:text-white transition-colors font-medium"
          >
            {expanded ? 'Show less' : `Show all ${stocks.length}`}
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="p-3 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-8 rounded bg-slate-800/30 animate-pulse" />
          ))}
        </div>
      ) : stocks.length === 0 ? (
        <div className="p-4 text-center text-slate-500 text-xs">
          No data — universe syncs nightly via FMP
        </div>
      ) : (
        <div className="divide-y divide-slate-800/40">
          {/* Header row */}
          <div className="grid grid-cols-[28px_1fr_80px_80px_80px] gap-1 px-3 py-1.5 text-[10px] text-slate-600 font-medium uppercase tracking-wide">
            <span>#</span>
            <span>Company</span>
            <span className="text-right">Price</span>
            <span className="text-right">Chg%</span>
            <span className="text-right">Mkt Cap</span>
          </div>
          {visible.map((s) => {
            const up = s.change_percent >= 0
            const mcap = s.market_cap > 1e12
              ? `${(s.market_cap / 1e12).toFixed(2)}T`
              : s.market_cap > 1e9
                ? `${(s.market_cap / 1e9).toFixed(1)}B`
                : s.market_cap > 1e6
                  ? `${(s.market_cap / 1e6).toFixed(0)}M`
                  : '—'
            return (
              <button
                key={s.symbol}
                type="button"
                onClick={() => openSnapshot({
                  symbol: s.symbol,
                  name: s.name,
                  price: s.price,
                  change: (s.price * s.change_percent) / 100,
                  change_percent: s.change_percent,
                  exchange: exchangeKey.toUpperCase(),
                  currency: s.currency,
                })}
                className="w-full grid grid-cols-[28px_1fr_80px_80px_80px] gap-1 px-3 py-2 hover:bg-slate-800/40 text-left transition-colors group"
              >
                <span className="text-[10px] text-slate-600 font-mono self-center">{s.rank}</span>
                <div className="min-w-0 self-center">
                  <div className="text-xs font-bold text-white font-mono group-hover:text-[#007AFF] transition-colors truncate">
                    {s.symbol}
                  </div>
                  <div className="text-[10px] text-slate-500 truncate">{s.name}</div>
                </div>
                <span className="text-xs font-mono text-white self-center text-right">
                  {s.price > 0 ? `${s.currency === 'USD' ? '$' : ''}${formatNumber(s.price, 2)}` : '—'}
                </span>
                <span className={`text-xs font-mono font-bold self-center text-right ${up ? 'text-emerald-400' : 'text-red-400'}`}>
                  {up ? '+' : ''}{formatPercent(s.change_percent, 2)}
                </span>
                <span className="text-[10px] font-mono text-slate-400 self-center text-right">{mcap}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ExchangeUniverseSection({ continent }: { continent: Continent }) {
  const exchanges = CONTINENT_UNIVERSE_KEYS[continent]
  if (!exchanges?.length) return null

  return (
    <div className="hud-panel p-4 sm:p-6 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <Database className="w-5 h-5 text-purple-400" />
        <h2 className="text-base font-bold text-white">
          Ranked Universe — {CONTINENTS.find((c) => c.id === continent)?.label}
        </h2>
        <span className="text-[10px] text-slate-500 ml-1">
          Sorted by market cap · 6h cache
        </span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {exchanges.map((ex) => (
          <UniverseExchangeTable
            key={ex.key}
            exchangeKey={ex.key}
            limit={ex.limit}
            label={ex.label}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Exchange Sector Heatmap ───────────────────────────────────────────────
function getHeatColor(pct: number): string {
  if (pct >= 3) return '#166534'
  if (pct >= 2) return '#15803d'
  if (pct >= 1) return '#16a34a'
  if (pct >= 0.5) return '#22c55e'
  if (pct > 0) return '#4ade80'
  if (pct >= -0.5) return '#f87171'
  if (pct >= -1) return '#ef4444'
  if (pct >= -2) return '#dc2626'
  if (pct >= -3) return '#b91c1c'
  return '#7f1d1d'
}

function SessionChangeLegendStrip({ className = '' }: { className?: string }) {
  const stops = [
    '#7f1d1d',
    '#b91c1c',
    '#dc2626',
    '#f87171',
    '#64748b',
    '#4ade80',
    '#22c55e',
    '#16a34a',
    '#15803d',
    '#166534',
  ]
  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="text-[10px] text-slate-500 text-center">1-day % change scale</div>
      <div
        className="flex h-2.5 rounded-md overflow-hidden border border-white/10 max-w-lg mx-auto shadow-inner"
        role="img"
        aria-label="Color scale from loss to gain"
      >
        {stops.map((c, i) => (
          <div key={i} className="flex-1 min-w-[4px]" style={{ backgroundColor: c }} />
        ))}
      </div>
      <div className="flex justify-between text-[9px] text-slate-600 max-w-lg mx-auto font-mono px-1">
        <span>-3%+</span>
        <span className="text-slate-500">flat</span>
        <span>+3%+</span>
      </div>
    </div>
  )
}

function ExchangeSectorHeatmap({ continent }: { continent: Continent }) {
  const { data, isLoading } = useExchangeHeatmap(continent)
  const sectors = data?.sectors ?? []

  if (isLoading) {
    return (
      <div className="hud-panel p-4 sm:p-6 mb-6">
        <div className="h-6 w-48 bg-slate-800/60 rounded animate-pulse mb-4" />
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-1">
          {Array.from({ length: 24 }).map((_, i) => (
            <div key={i} className="h-14 rounded bg-slate-800/40 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (!sectors.length) return null

  return (
    <div className="hud-panel p-4 sm:p-6 mb-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-400" />
            Sector Heatmap — {CONTINENTS.find((c) => c.id === continent)?.label}
          </h2>
          <p className="text-[11px] text-slate-500 mt-1">
            Regional names grouped by sector; tile color = session % change vs prior close.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-400">
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-[#15803d]" /> Up</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-[#dc2626]" /> Down</span>
        </div>
      </div>
      <div className="space-y-4">
        {sectors.map((sector) => (
          <div key={sector.sector} className="border border-slate-700/40 rounded-lg overflow-hidden">
            <div className={`px-3 py-2 flex items-center justify-between ${sector.change_percent >= 0 ? 'bg-emerald-900/20' : 'bg-red-900/20'}`}>
              <span className="font-bold text-white text-sm">{sector.sector}</span>
              <span className={`font-mono font-bold text-sm ${sector.change_percent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {sector.change_percent >= 0 ? '+' : ''}{sector.change_percent.toFixed(2)}%
              </span>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-px bg-slate-900 p-px">
              {sector.stocks.map((stock) => (
                <Link
                  key={stock.symbol}
                  href={`/research?symbol=${stock.symbol}`}
                  title={`${stock.name}\n${stock.currency} ${stock.price.toFixed(2)}\n${stock.change_percent >= 0 ? '+' : ''}${stock.change_percent.toFixed(2)}%`}
                  className="p-2 flex flex-col items-center justify-center border border-white/5 hover:brightness-110 hover:scale-[1.02] transition-all cursor-pointer"
                  style={{ backgroundColor: getHeatColor(stock.change_percent) }}
                >
                  <span className="font-bold text-white text-[10px] truncate w-full text-center leading-tight">
                    {stock.symbol.replace(/\.(JO|SR|L|DE|PA|AS|SW|T|HK|SS|NS|KS|SI|AX|TO|SA|NZ)$/i, '')}
                  </span>
                  <span className="text-white/90 text-[9px] font-mono">
                    {stock.change_percent >= 0 ? '+' : ''}{stock.change_percent.toFixed(1)}%
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
      <SessionChangeLegendStrip className="mt-4" />
      <p className="text-center text-[10px] text-slate-500 mt-3">
        Click any stock for detailed analysis · Powered by live market data
      </p>
    </div>
  )
}

// ─── Continent Movers ──────────────────────────────────────────────────────
function ContinentMovers({ continent }: { continent: Continent }) {
  const { data, isLoading } = useContinentMovers(continent)
  const { openSnapshot } = useStockSnapshot()
  const gainers = data?.gainers ?? []
  const losers = data?.losers ?? []
  const actives = data?.actives ?? []

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
      {[
        { label: 'Top Gainers', items: gainers, color: 'emerald' as const },
        { label: 'Top Losers', items: losers, color: 'red' as const },
        { label: 'Most Active (Vol.)', items: actives, color: 'cyan' as const },
      ].map(({ label, items, color }) => (
        <div key={label} className="hud-panel">
          <div className="px-4 py-3 border-b border-slate-700/30 flex items-center gap-2">
            {color === 'emerald' ? (
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            ) : color === 'red' ? (
              <TrendingDown className="w-4 h-4 text-red-400" />
            ) : (
              <Activity className="w-4 h-4 text-cyan-400" />
            )}
            <h3 className="font-bold text-white text-sm">{label}</h3>
          </div>
          <div className="divide-y divide-slate-800/30 max-h-64 overflow-y-auto">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 mx-4 my-1 rounded bg-slate-800/40 animate-pulse" />
              ))
            ) : items.length === 0 ? (
              <div className="flex items-center justify-center h-16 text-slate-500 text-xs">No data available</div>
            ) : (
              items.map((s, i) => (
                <button key={s.symbol}
                  onClick={() => openSnapshot({ symbol: s.symbol, name: s.name, price: s.price, change_percent: s.change_percent, exchange: s.exchange, currency: s.currency, market_cap: s.market_cap })}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-800/30 transition-colors group text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-600 font-mono w-4">{i + 1}</span>
                    <div>
                      <span className="font-bold text-white text-xs font-mono group-hover:text-[#007AFF] transition-colors">{s.symbol}</span>
                      <div className="text-[10px] text-slate-500 truncate max-w-[120px]">{s.name}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-mono text-white">{s.price > 0 ? `$${formatNumber(s.price, 2)}` : '—'}</div>
                    <div
                      className={`text-[10px] font-mono font-bold ${
                        color === 'emerald'
                          ? 'text-emerald-400'
                          : color === 'red'
                            ? 'text-red-400'
                            : s.change_percent >= 0
                              ? 'text-cyan-300'
                              : 'text-orange-300'
                      }`}
                    >
                      {color !== 'red' && s.change_percent >= 0 ? '+' : ''}
                      {formatPercent(s.change_percent, 2)}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function DesktopMarketsPage() {
  const [view, setView] = useState<'heatmap' | 'list'>('heatmap')
  const [activeContinent, setActiveContinent] = useState<Continent>('global')
  const [displayCurrency, setDisplayCurrency] = useState('USD')
  const { data: currencyRates = {} } = useCurrencyRates()
  
  // Fetch market indices from dedicated endpoint - cached aggressively
  const { data: indexData, isLoading: indicesLoading } = useQuery({
    queryKey: ['marketIndices'],
    queryFn: fetchMarketIndices,
    refetchInterval: 60000, // Update every minute (backend caches)
    staleTime: 30000, // Fresh for 30 seconds
    gcTime: 300000, // Keep in cache for 5 minutes
  })
  
  // Fetch sector data with stocks - shared cache with home page
  const { data: sectors, isLoading: sectorsLoading, refetch: refetchSectors } = useQuery({
    queryKey: ['sectorPerformance'],
    queryFn: () => fetchSectorPerformance(),
    refetchInterval: 120000, // Update every 2 minutes
    staleTime: 60000, // Fresh for 1 minute
    gcTime: 300000, // Keep in cache for 5 minutes
  })

  // Fetch movers - shared cache with home page
  const { data: movers, isLoading: moversLoading, refetch: refetchMovers } = useQuery({
    queryKey: ['marketMovers'],
    queryFn: () => fetchMarketMovers(false), // Try without force refresh first
    refetchInterval: 120000, // Update every 2 minutes
    staleTime: 60000, // Fresh for 1 minute
    gcTime: 300000, // Keep in cache for 5 minutes
  })

  const { data: coverage } = useQuery({
    queryKey: ['marketCoverage'],
    queryFn: fetchMarketCoverage,
    staleTime: 300_000,
    refetchInterval: 600_000,
  })

  // Enhanced refetch that forces refresh
  const handleRefreshMovers = useCallback(async () => {
    const refreshed = await fetchMarketMovers(true) // Force refresh
    if (refreshed.gainers.length > 0 || refreshed.losers.length > 0) {
      refetchMovers()
    }
  }, [refetchMovers])

  const { data: continentMoverBundle } = useContinentMovers(activeContinent)

  const marketsActivityFingerprint = useMemo(() => {
    if (activeContinent !== 'global') {
      return moversActivityFingerprint(continentMoverBundle)
    }
    const m = moversActivityFingerprint({ gainers: movers?.gainers, losers: movers?.losers })
    const sectorSum =
      sectors?.reduce((acc, s) => acc + (Number.isFinite(s.change_percent) ? s.change_percent : 0), 0) ?? 0
    return Math.round((m + sectorSum) * 1000) / 1000
  }, [activeContinent, continentMoverBundle, movers, sectors])

  const regionalHeatRowsMarkets = useMemo(() => {
    if (activeContinent === 'global') return []
    const seen = new Set<string>()
    const out: { symbol: string; name: string; change_percent: number }[] = []
    const push = (m: GlobalMover) => {
      if (!m?.symbol || seen.has(m.symbol)) return
      seen.add(m.symbol)
      out.push({ symbol: m.symbol, name: m.name, change_percent: m.change_percent })
    }
    for (const m of continentMoverBundle?.gainers ?? []) push(m)
    for (const m of continentMoverBundle?.losers ?? []) push(m)
    for (const m of continentMoverBundle?.actives ?? []) push(m)
    out.sort((a, b) => Math.abs(b.change_percent) - Math.abs(a.change_percent))
    return out.slice(0, 48)
  }, [activeContinent, continentMoverBundle])

  // Calculate market stats
  const marketStats = {
    totalStocks: sectors?.reduce((acc, s) => acc + s.stocks.length, 0) || 0,
    gainers: sectors?.reduce((acc, s) => acc + s.stocks.filter(st => st.change_percent > 0).length, 0) || 0,
    losers: sectors?.reduce((acc, s) => acc + s.stocks.filter(st => st.change_percent < 0).length, 0) || 0,
  }

  return (
    <AppLayout>
      <div className="min-h-full">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2 sm:gap-3">
              <Globe className="w-6 h-6 sm:w-7 sm:h-7 text-[#007AFF]" />
              Markets Overview
            </h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <CurrencySelector value={displayCurrency} onChange={setDisplayCurrency} />
            {/* View Toggle */}
            <div className="flex items-center gap-1 p-1 bg-slate-800/50 rounded-lg">
              <button
                onClick={() => setView('heatmap')}
                className={`p-2 rounded-md transition-all ${
                  view === 'heatmap' ? 'bg-[#007AFF]/20 text-[#007AFF]' : 'text-slate-400 hover:text-white'
                }`}
                aria-label="Heatmap view"
              >
                <Grid3X3 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setView('list')}
                className={`p-2 rounded-md transition-all ${
                  view === 'list' ? 'bg-[#007AFF]/20 text-[#007AFF]' : 'text-slate-400 hover:text-white'
                }`}
                aria-label="List view"
              >
                <List className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={() => refetchSectors()}
              className="hud-card px-3 sm:px-4 py-2 text-xs sm:text-sm text-[#007AFF] hover:text-white flex items-center gap-2 transition-all"
              aria-label="Refresh data"
            >
              <RefreshCw className="w-4 h-4" />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>

        {/* Continent Tabs */}
        <ContinentTabBar active={activeContinent} onChange={setActiveContinent} />

        {/* World Exchange Indices */}
        <div className="mb-2">
          <div className="flex items-center gap-2 mb-3">
            <Signal className="w-4 h-4 text-[#007AFF]" />
            <h2 className="text-sm font-bold text-white">
              {CONTINENTS.find((c) => c.id === activeContinent)?.label} Exchange Indices
            </h2>
            <QuoteActivityFlash fingerprint={marketsActivityFingerprint} className="scale-90" />
          </div>
          <WorldIndicesGrid continent={activeContinent} currency={displayCurrency} rates={currencyRates} />
        </div>

        {/* Economic calendar — today's macro events */}
        <div className="mb-4">
          <EconomicCalendarStrip />
        </div>

        {/* Continent-specific movers (non-global) */}
        {activeContinent !== 'global' && (
          <motion.div
            key={`markets-movers-${activeContinent}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <ContinentMovers continent={activeContinent} />
          </motion.div>
        )}

        {activeContinent !== 'global' && (
          <motion.div
            key={`markets-heat-${activeContinent}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.05 }}
          >
            {/* Exchange-specific sector heatmap */}
            <ExchangeSectorHeatmap continent={activeContinent} />

            {/* Ranked stock universe per exchange */}
            <ExchangeUniverseSection continent={activeContinent} />

            {/* Movers-based quick heatmap (fallback / supplement if sector data empty) */}
            {regionalHeatRowsMarkets.length > 0 && (
              <div className="hud-panel p-4 sm:p-6 mb-6">
                <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
                  <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                    <Activity className="w-5 h-5 text-cyan-400" />
                    1-Day Movers Map — {CONTINENTS.find((c) => c.id === activeContinent)?.label}
                  </h2>
                  <QuoteActivityFlash fingerprint={marketsActivityFingerprint} />
                </div>
                <MoversHeatmap
                  rows={regionalHeatRowsMarkets}
                  emptyLabel="No regional movers for this view yet"
                  showLegend
                />
              </div>
            )}
          </motion.div>
        )}

        {/* US/Global Market Stats — only on global tab */}
        {activeContinent === 'global' && (<>
        {/* Index Cards - Real-time (labels: symbol + name) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4 mb-6">
          {indicesLoading ? (
            <SkeletonMarketIndices />
          ) : indexData && indexData.length > 0 ? (
            indexData.map((index, idx) => {
              const hasValidPrice = isNumber(index.price) && index.price > 0
              const changePositive = isNumber(index.change_percent) ? index.change_percent >= 0 : false
              const label = (index.name && index.name.trim()) || 'Market index'
              return (
                <div key={index.symbol || `index-${idx}`} className="hud-panel p-3 sm:p-4 relative group flex flex-col min-h-[120px]">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-mono text-slate-500 uppercase tracking-wide truncate" title={index.symbol}>
                        {index.symbol}
                      </div>
                      <div className="text-[11px] sm:text-xs font-semibold text-white mt-0.5 line-clamp-2 leading-snug" title={label}>
                        {label}
                      </div>
                    </div>
                    {hasValidPrice && (
                      <QuoteActivityFlash
                        className="scale-75 shrink-0 mt-0.5"
                        fingerprint={
                          Math.round(
                            (Number(index.price) || 0) * 1000 +
                              (Number(index.change_percent) || 0) * 10000
                          ) / 1000
                        }
                      />
                    )}
                  </div>
                  <div className="text-lg sm:text-xl font-bold text-white font-mono mt-auto">
                    {hasValidPrice
                      ? Number(index.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                      : '—'}
                  </div>
                  {hasValidPrice ? (
                    <div className={`text-xs sm:text-sm font-mono flex items-center gap-1 mt-1 ${
                      changePositive ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {changePositive ? <TrendingUp className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" /> : <TrendingDown className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />}
                      {changePositive ? '+' : ''}{formatPercent(index.change_percent, 2)}
                      <span className="text-[10px] text-slate-600 ml-1 hidden sm:inline">session</span>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500 mt-1">No live price</div>
                  )}
                </div>
              )
            })
          ) : (
            // Fallback to static data if real-time fails
            [
              { name: 'S&P 500', value: 4783.45, change: 0.42 },
              { name: 'NASDAQ', value: 15234.12, change: 0.87 },
              { name: 'DOW JONES', value: 37892.67, change: 0.15 },
              { name: 'RUSSELL 2000', value: 2012.34, change: -0.23 },
            ].map((index, idx) => (
              <div key={idx} className="hud-panel p-4">
                <div className="text-xs text-slate-500 mb-1">{index.name}</div>
                <div className="text-xl font-bold text-white font-mono">
                  {index.value.toLocaleString()}
                </div>
                <div className={`text-sm font-mono flex items-center gap-1 ${
                  index.change >= 0 ? 'text-green-400' : 'text-red-400'
                }`}>
                  {index.change >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  {index.change >= 0 ? '+' : ''}{index.change}%
                </div>
              </div>
            ))
          )}
        </div>

        {/* Market Stats Bar */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <div className="hud-panel p-4 flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Database className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400" />
            </div>
            <div className="min-w-0">
              <div className="text-lg sm:text-xl font-bold text-white tabular-nums">
                {coverage && coverage.symbols_master_active > 0
                  ? formatNumber(coverage.symbols_master_active, 0)
                  : marketStats.totalStocks}
              </div>
              <div className="text-xs text-slate-500 leading-snug">
                Stocks tracked
              </div>
            </div>
          </div>
          <div className="hud-panel p-4 flex items-center gap-3">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-green-400" />
            </div>
            <div>
              <div className="text-lg sm:text-xl font-bold text-green-400">{marketStats.gainers}</div>
              <div className="text-xs text-slate-500">Gainers</div>
            </div>
          </div>
          <div className="hud-panel p-4 flex items-center gap-3">
            <div className="p-2 bg-red-500/10 rounded-lg">
              <TrendingDown className="w-4 h-4 sm:w-5 sm:h-5 text-red-400" />
            </div>
            <div>
              <div className="text-lg sm:text-xl font-bold text-red-400">{marketStats.losers}</div>
              <div className="text-xs text-slate-500">Losers</div>
            </div>
          </div>
          <div className="hud-panel p-4 flex items-center gap-3">
            <div className="p-2 bg-cyan-500/10 rounded-lg">
              <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-cyan-400" />
            </div>
            <div>
              <div className="text-lg sm:text-xl font-bold text-white">{sectors?.length || 0}</div>
              <div className="text-xs text-slate-500">Sectors</div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
          {/* Heatmap / List Section */}
          <div className="lg:col-span-9">
            <div className="hud-panel p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-blue-400" />
                  <span className="hidden sm:inline">1-Day Performance Map</span>
                  <span className="sm:hidden">Performance</span>
                </h2>
                <div className="flex items-center gap-2">
                  <QuoteActivityFlash fingerprint={marketsActivityFingerprint} />
                  <span className="text-xs text-slate-400 ml-2">Updates</span>
                </div>
              </div>
              
              {sectorsLoading ? (
                <SkeletonHeatmap />
              ) : view === 'heatmap' && sectors ? (
                <MarketHeatmap sectors={sectors} />
              ) : sectors ? (
                /* List View */
                <div className="space-y-4">
                  {sectors.map((sector, sectorIdx) => (
                    <div key={sector.sector || `sector-${sectorIdx}`} className="border border-slate-700/50 rounded-lg overflow-hidden">
                      <div className={`px-4 py-3 flex items-center justify-between ${
                        sector.change_percent >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'
                      }`}>
                          <span className="font-bold text-sm sm:text-base text-white">{sector.sector}</span>
                          <span className={`font-mono font-bold text-sm sm:text-base ${
                          sector.change_percent >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {sector.change_percent >= 0 ? '+' : ''}{formatPercent(sector.change_percent, 2)}
                        </span>
                      </div>
                      <div className="divide-y divide-slate-700/30">
                        {sector.stocks.slice(0, 10).map((stock, stockIdx) => (
                          <Link
                            key={stock.symbol || `${sector.sector}-${stock.name || stockIdx}`}
                            href={`/research?symbol=${stock.symbol}`}
                              className="flex items-center justify-between p-2 sm:p-3 hover:bg-slate-800/30 transition-colors"
                          >
                              <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                                <span className="font-bold text-white text-sm sm:text-base w-12 sm:w-16">{stock.symbol}</span>
                                <span className="text-xs sm:text-sm text-slate-400 truncate">{stock.name}</span>
                            </div>
                              <div className="flex items-center gap-2 sm:gap-6">
                                <span className="text-white font-mono text-sm sm:text-base">
                                {isNumber(stock.price) ? `$${formatNumber(stock.price, 2)}` : 'N/A'}
                              </span>
                              <span className={`font-mono w-20 text-right ${
                                stock.change_percent >= 0 ? 'text-green-400' : 'text-red-400'
                              }`}>
                                {stock.change_percent >= 0 ? '+' : ''}{formatPercent(stock.change_percent, 2)}
                              </span>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-20 text-slate-500">
                  No market data available
                </div>
              )}
            </div>
          </div>

          {/* Sidebar - Enhanced Market Movers */}
          <div className="lg:col-span-3">
            <div className="sticky top-24" style={{ maxHeight: 'calc(100vh - 7rem)' }}>
              <MarketMoversPanel
                gainers={movers?.gainers?.slice(0, 10) || []}
                losers={movers?.losers?.slice(0, 10) || []}
                loading={moversLoading}
                onRefresh={handleRefreshMovers}
              />
            </div>
          </div>
        </div>
        </>)}
      </div>

      {/* Data source attribution */}
      <div className="px-4 py-2 border-t border-slate-800/30 mt-2">
        <p className="text-[9px] text-slate-700 font-mono">
          Market data: Finnhub (real-time quotes) · Polygon.io (NYSE/NASDAQ/AMEX symbols) · Alpha Vantage (historical OHLCV) · Data is delayed 15 min for non-Pro users.
        </p>
      </div>
    </AppLayout>
  )
}

export default function MarketsPage() {
  return (
    <>
      <div className="hidden md:block">
        <DesktopMarketsPage />
      </div>
      <div className="md:hidden">
        <MobileLayout>
          <MobileMarkets />
        </MobileLayout>
      </div>
    </>
  )
}
