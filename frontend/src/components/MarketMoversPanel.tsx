'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import {
  TrendingUp,
  TrendingDown,
  Activity,
  ArrowRight,
  RefreshCw,
  Flame,
  BarChart3,
  Zap,
} from 'lucide-react'
import { StockPerformance } from '@/lib/api'
import { formatNumber, formatPercent, isNumber } from '@/lib/format'

/* ────────────────── Types ────────────────── */

type Tab = 'gainers' | 'losers' | 'volume' | 'active'

/* ────────────────── Volume Formatter ────────────────── */

function formatVolume(vol: number): string {
  if (vol >= 1e9) return `${(vol / 1e9).toFixed(1)}B`
  if (vol >= 1e6) return `${(vol / 1e6).toFixed(1)}M`
  if (vol >= 1e3) return `${(vol / 1e3).toFixed(0)}K`
  return String(vol)
}

/* ────────────────── SVG: Mini Horizontal Bar ────────────────── */

function VolumeBar({
  value,
  maxValue,
  color,
}: {
  value: number
  maxValue: number
  color: string
}) {
  const pct = maxValue > 0 ? Math.min((value / maxValue) * 100, 100) : 0

  return (
    <div className="h-1 bg-slate-800/60 rounded-full overflow-hidden w-full mt-1">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{
          width: `${pct}%`,
          background: `linear-gradient(90deg, ${color}60, ${color})`,
        }}
      />
    </div>
  )
}

/* ────────────────── SVG: Mini Sparkline ────────────────── */

function MiniSparkline({
  value,
  isUp,
}: {
  value: number
  isUp: boolean
}) {
  // Generate a synthetic sparkline based on change_percent
  const points = useMemo(() => {
    const numPts = 12
    const pts: number[] = []
    const rng = Math.abs(value) * 0.3
    let base = isUp ? 40 : 60

    for (let i = 0; i < numPts; i++) {
      const noise = (Math.sin(i * 1.7 + value * 0.5) * rng) + (Math.cos(i * 0.8) * rng * 0.5)
      const trend = isUp
        ? (i / numPts) * Math.abs(value) * 2
        : -(i / numPts) * Math.abs(value) * 2
      pts.push(Math.max(5, Math.min(95, base + trend + noise)))
    }

    return pts
  }, [value, isUp])

  const w = 64
  const h = 24
  const stepX = w / (points.length - 1)
  const scaleY = h / 100

  const pathD = points
    .map((y, i) => `${i === 0 ? 'M' : 'L'} ${i * stepX} ${h - y * scaleY}`)
    .join(' ')

  const fillD = `${pathD} L ${w} ${h} L 0 ${h} Z`

  const color = isUp ? '#10B981' : '#EF4444'
  const gradId = `spark-${isUp ? 'up' : 'down'}-${Math.round(value * 100)}`

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="flex-shrink-0">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillD} fill={`url(#${gradId})`} />
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/* ────────────────── SVG: Radial Volume Gauge ────────────────── */

function VolumeGauge({
  stocks,
  maxVol,
}: {
  stocks: StockPerformance[]
  maxVol: number
}) {
  const top5 = stocks.slice(0, 5)

  const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6']

  const total = top5.reduce((s, st) => s + (st.volume || 0), 0)
  if (total === 0) return null

  const radius = 38
  const cx = 50
  const cy = 50
  const circumference = 2 * Math.PI * radius
  const strokeWidth = 8

  let accumulated = 0

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 100 100" className="w-[120px] h-[120px]">
        {/* Background */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="#1F2630"
          strokeWidth={strokeWidth}
        />
        {/* Segments */}
        {top5.map((stock, i) => {
          const vol = stock.volume || 0
          const pct = vol / total
          const segLen = pct * circumference
          const rotation = -90 + (accumulated / total) * 360
          accumulated += vol
          return (
            <circle
              key={stock.symbol}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={colors[i % colors.length]}
              strokeWidth={strokeWidth}
              strokeDasharray={`${segLen} ${circumference - segLen}`}
              transform={`rotate(${rotation} ${cx} ${cy})`}
              className="transition-all duration-700"
            />
          )
        })}
        {/* Center label */}
        <text
          x={cx}
          y={cy - 2}
          textAnchor="middle"
          fill="white"
          fontSize="11"
          fontWeight="bold"
          fontFamily="monospace"
        >
          {formatVolume(total)}
        </text>
        <text
          x={cx}
          y={cy + 10}
          textAnchor="middle"
          fill="#6B7280"
          fontSize="7"
          fontWeight="600"
        >
          TOTAL VOL
        </text>
      </svg>

      {/* Legend */}
      <div className="flex flex-col gap-1 mt-2 w-full">
        {top5.map((stock, i) => (
          <div key={stock.symbol} className="flex items-center gap-1.5">
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: colors[i % colors.length] }}
            />
            <span className="text-[9px] font-bold text-slate-300">
              {stock.symbol}
            </span>
            <span className="text-[9px] font-mono text-slate-500 ml-auto">
              {formatVolume(stock.volume || 0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ────────────────── Stock Row Component ────────────────── */

function StockRow({
  stock,
  idx,
  maxVolume,
  tab,
}: {
  stock: StockPerformance
  idx: number
  maxVolume: number
  tab: Tab
}) {
  const isUp = stock.change_percent >= 0
  const accentColor = tab === 'losers'
    ? '#EF4444'
    : tab === 'gainers'
      ? '#10B981'
      : isUp
        ? '#10B981'
        : '#EF4444'

  return (
    <Link
      href={`/research?symbol=${stock.symbol}`}
      className="flex items-center gap-3 px-3 py-3 sm:py-2.5 hover:bg-white/[0.03] active:bg-white/[0.05] border-b border-white/[0.03] transition-all group"
    >
      {/* Rank */}
      <span className="w-6 h-6 sm:w-5 sm:h-5 flex items-center justify-center text-[11px] sm:text-[10px] text-slate-500 bg-slate-800/50 rounded font-mono flex-shrink-0">
        {idx + 1}
      </span>

      {/* Symbol + Name */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-white text-sm sm:text-[13px] group-hover:text-blue-400 transition-colors">
            {stock.symbol}
          </span>
          <MiniSparkline value={stock.change_percent} isUp={isUp} />
        </div>
        <div className="text-[11px] sm:text-[10px] text-slate-500 truncate">{stock.name}</div>
        {/* Volume bar */}
        <VolumeBar value={stock.volume || 0} maxValue={maxVolume} color={accentColor} />
      </div>

      {/* Price + Change + Volume */}
      <div className="text-right flex-shrink-0">
        <div className="font-mono text-[13px] sm:text-[12px] text-white">
          {isNumber(stock.price) ? `$${formatNumber(stock.price, 2)}` : '—'}
        </div>
        <div
          className={`font-mono text-[12px] sm:text-[11px] flex items-center justify-end gap-0.5 ${
            isUp ? 'text-emerald-400' : 'text-red-400'
          }`}
        >
          {isUp ? '+' : ''}
          {formatPercent(stock.change_percent, 2)}
          {isUp ? (
            <TrendingUp className="w-3 h-3 sm:w-2.5 sm:h-2.5" />
          ) : (
            <TrendingDown className="w-3 h-3 sm:w-2.5 sm:h-2.5" />
          )}
        </div>
        <div className="text-[10px] sm:text-[9px] font-mono text-slate-500">
          {formatVolume(stock.volume || 0)} vol
        </div>
      </div>
    </Link>
  )
}

/* ────────────────── Loading Skeleton ────────────────── */

function MoversSkeletonRows({ count }: { count: number }) {
  return (
    <div className="animate-pulse">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-3 border-b border-white/[0.03]">
          <div className="w-5 h-5 bg-[#1F2630] rounded" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 bg-[#1F2630] rounded w-20" />
            <div className="h-2 bg-[#1F2630] rounded w-32" />
            <div className="h-1 bg-[#1F2630] rounded w-full" />
          </div>
          <div className="space-y-1 text-right">
            <div className="h-3 bg-[#1F2630] rounded w-14 ml-auto" />
            <div className="h-2 bg-[#1F2630] rounded w-10 ml-auto" />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ────────────────── Main Component ────────────────── */

interface MarketMoversPanelProps {
  gainers: StockPerformance[]
  losers: StockPerformance[]
  loading: boolean
  onRefresh: () => void
}

export default function MarketMoversPanel({
  gainers,
  losers,
  loading,
  onRefresh,
}: MarketMoversPanelProps) {
  const [tab, setTab] = useState<Tab>('gainers')

  // Derived lists
  const byVolume = useMemo(() => {
    const all = [...gainers, ...losers]
    return all.sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 10)
  }, [gainers, losers])

  const active = useMemo(() => {
    // "Most Active" = highest volume with significant price change
    const all = [...gainers, ...losers]
    return all
      .filter((s) => s.volume > 0 && Math.abs(s.change_percent) > 0.5)
      .sort((a, b) => {
        // Score: volume * abs(change)
        const scoreA = (a.volume || 0) * Math.abs(a.change_percent)
        const scoreB = (b.volume || 0) * Math.abs(b.change_percent)
        return scoreB - scoreA
      })
      .slice(0, 10)
  }, [gainers, losers])

  const currentList = useMemo(() => {
    switch (tab) {
      case 'gainers':
        return gainers.slice(0, 10)
      case 'losers':
        return losers.slice(0, 10)
      case 'volume':
        return byVolume
      case 'active':
        return active
    }
  }, [tab, gainers, losers, byVolume, active])

  const maxVolume = useMemo(() => {
    return Math.max(...currentList.map((s) => s.volume || 0), 1)
  }, [currentList])

  const TAB_CONFIG: { key: Tab; label: string; icon: React.ReactNode; color: string }[] = [
    { key: 'gainers', label: 'Gainers', icon: <TrendingUp className="w-3 h-3" />, color: 'text-emerald-400' },
    { key: 'losers', label: 'Losers', icon: <TrendingDown className="w-3 h-3" />, color: 'text-red-400' },
    { key: 'volume', label: 'Volume', icon: <BarChart3 className="w-3 h-3" />, color: 'text-blue-400' },
    { key: 'active', label: 'Active', icon: <Flame className="w-3 h-3" />, color: 'text-amber-400' },
  ]

  // Aggregate stats for the active tab
  const stats = useMemo(() => {
    const list = currentList
    if (list.length === 0) return null
    const avgChange = list.reduce((s, st) => s + st.change_percent, 0) / list.length
    const totalVol = list.reduce((s, st) => s + (st.volume || 0), 0)
    const maxChange = list.reduce((max, st) => Math.max(max, Math.abs(st.change_percent)), 0)
    return { avgChange, totalVol, maxChange }
  }, [currentList])

  return (
    <div className="hud-panel lg:h-full flex flex-col lg:overflow-hidden">
      {/* Header */}
      <div className="p-4 sm:p-3.5 border-b border-white/[0.04]">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 sm:w-4 sm:h-4 text-cyan-400" />
            <h3 className="font-bold text-white text-[15px] sm:text-sm">Market Movers</h3>
            <span className="px-1.5 py-0.5 text-[9px] bg-cyan-500/15 text-cyan-400 rounded font-bold border border-cyan-500/20">
              LIVE
            </span>
          </div>
          <button
            onClick={onRefresh}
            className="p-1.5 rounded-lg hover:bg-white/[0.05] text-slate-500 hover:text-white transition-all"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="flex gap-1 rounded-lg bg-[#0A0E1A]/60 p-0.5 border border-white/[0.04]">
          {TAB_CONFIG.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-2 sm:py-1.5 rounded-md text-[11px] sm:text-[10px] font-semibold transition-all ${
                tab === t.key
                  ? `bg-white/[0.06] ${t.color} border border-white/[0.06]`
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stat Chips */}
      {!loading && stats && (
        <div className="flex flex-wrap items-center gap-2 px-4 sm:px-3.5 py-2.5 sm:py-2 border-b border-white/[0.03] bg-white/[0.01]">
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800/40">
            <Zap className="w-2.5 h-2.5 text-amber-400" />
            <span className="text-[9px] font-mono text-slate-400">
              Avg {stats.avgChange >= 0 ? '+' : ''}
              {formatPercent(stats.avgChange, 2)}
            </span>
          </div>
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800/40">
            <BarChart3 className="w-2.5 h-2.5 text-blue-400" />
            <span className="text-[9px] font-mono text-slate-400">
              {formatVolume(stats.totalVol)} vol
            </span>
          </div>
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800/40">
            <Activity className="w-2.5 h-2.5 text-cyan-400" />
            <span className="text-[9px] font-mono text-slate-400">
              Max {formatPercent(stats.maxChange, 1)}
            </span>
          </div>
        </div>
      )}

      {/* Volume Distribution Gauge (only on volume/active tabs) */}
      {!loading && (tab === 'volume' || tab === 'active') && currentList.length > 0 && (
        <div className="px-4 py-3 border-b border-white/[0.03]">
          <VolumeGauge stocks={currentList} maxVol={maxVolume} />
        </div>
      )}

      {/* Stock Rows */}
      <div className="lg:flex-1 lg:overflow-y-auto">
        {loading ? (
          <MoversSkeletonRows count={8} />
        ) : currentList.length > 0 ? (
          currentList.map((stock, idx) => (
            <StockRow
              key={stock.symbol || idx}
              stock={stock}
              idx={idx}
              maxVolume={maxVolume}
              tab={tab}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center h-full py-12">
            <Activity className="w-8 h-8 text-slate-600 mb-2" />
            <p className="text-[12px] text-slate-500">No data available</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-white/[0.04]">
        <Link
          href="/markets"
          className="flex items-center justify-center gap-2 py-2 text-[12px] font-medium text-blue-400 hover:text-white rounded-lg hover:bg-blue-500/10 transition-all"
        >
          View All Markets
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  )
}
