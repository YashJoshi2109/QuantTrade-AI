'use client'

import { useId, useMemo } from 'react'
import { FundamentalsData } from '@/lib/api'
import { isNumber, formatNumber } from '@/lib/format'
import { Zap, RefreshCw, Loader2 } from 'lucide-react'

/* ────────────────── Health Score Computation ────────────────── */

interface HealthScore {
  total: number
  valuation: number
  profitability: number
  returns: number
  stability: number
}

function computeHealthScore(f: FundamentalsData | null): HealthScore {
  if (!f)
    return { total: 0, valuation: 0, profitability: 0, returns: 0, stability: 0 }

  let valuation = 0
  let profitability = 0
  let returns = 0
  let stability = 0

  // Valuation (0-25)
  if (isNumber(f.pe_ratio)) {
    const pe = f.pe_ratio as number
    valuation += pe < 15 ? 12 : pe < 25 ? 9 : pe < 40 ? 5 : 2
  }
  if (isNumber(f.peg_ratio)) {
    const peg = f.peg_ratio as number
    valuation += peg < 1 ? 13 : peg < 2 ? 8 : 3
  }

  // Profitability (0-25)
  if (isNumber(f.profit_margin)) {
    profitability += Math.min(12, Math.max(0, (f.profit_margin as number) * 0.35))
  }
  if (isNumber(f.operating_margin)) {
    profitability += Math.min(
      13,
      Math.max(0, (f.operating_margin as number) * 0.35),
    )
  }

  // Returns (0-25)
  if (isNumber(f.roe)) {
    returns += Math.min(13, Math.max(0, (f.roe as number) * 0.45))
  }
  if (isNumber(f.roa)) {
    returns += Math.min(12, Math.max(0, (f.roa as number) * 0.7))
  }

  // Stability (0-25)
  if (isNumber(f.current_ratio)) {
    const cr = f.current_ratio as number
    stability += cr >= 1.5 && cr <= 3 ? 13 : cr >= 1 ? 8 : 3
  }
  if (isNumber(f.beta)) {
    const beta = f.beta as number
    stability +=
      beta >= 0.8 && beta <= 1.2 ? 12 : beta >= 0.5 && beta <= 1.5 ? 8 : 4
  }

  return {
    total: Math.round(valuation + profitability + returns + stability),
    valuation: Math.round(valuation),
    profitability: Math.round(profitability),
    returns: Math.round(returns),
    stability: Math.round(stability),
  }
}

/* ────────────────── SVG: Health Score Donut ────────────────── */

function ScoreDonut({ score }: { score: HealthScore }) {
  const segments = [
    { value: score.valuation, color: '#3B82F6', label: 'Valuation' },
    { value: score.profitability, color: '#10B981', label: 'Profitability' },
    { value: score.returns, color: '#F59E0B', label: 'Returns' },
    { value: score.stability, color: '#8B5CF6', label: 'Stability' },
  ].filter((s) => s.value > 0)

  const total = segments.reduce((s, seg) => s + seg.value, 0)
  if (total === 0) return null

  const radius = 42
  const cx = 55
  const cy = 55
  const circumference = 2 * Math.PI * radius
  const strokeWidth = 10

  let accumulated = 0
  const scoreColor =
    total >= 70 ? '#10B981' : total >= 45 ? '#F59E0B' : '#EF4444'

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 110 110" className="w-[130px] h-[130px]">
        {/* Background ring */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="#1F2630"
          strokeWidth={strokeWidth}
        />
        {/* Segments */}
        {segments.map((seg, i) => {
          const segLen = (seg.value / total) * circumference
          const rotation = -90 + (accumulated / total) * 360
          accumulated += seg.value
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${segLen} ${circumference - segLen}`}
              transform={`rotate(${rotation} ${cx} ${cy})`}
              className="transition-all duration-700"
            />
          )
        })}
        {/* Center score */}
        <text
          x={cx}
          y={cy - 2}
          textAnchor="middle"
          fill={scoreColor}
          fontSize="20"
          fontWeight="bold"
          fontFamily="monospace"
        >
          {total}
        </text>
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          fill="#6B7280"
          fontSize="8"
          fontWeight="600"
          letterSpacing="0.5"
        >
          HEALTH
        </text>
      </svg>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: seg.color }}
            />
            <span className="text-[9px] text-slate-500">{seg.label}</span>
            <span className="text-[9px] font-mono text-white ml-auto">
              {seg.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ────────────────── SVG: Margin Concentric Rings ────────────────── */

function MarginRings({
  gross,
  operating,
  profit,
}: {
  gross?: number
  operating?: number
  profit?: number
}) {
  const rings = [
    { value: gross, color: '#8B5CF6', label: 'Gross', radius: 42 },
    { value: operating, color: '#38BDF8', label: 'Operating', radius: 32 },
    { value: profit, color: '#10B981', label: 'Profit', radius: 22 },
  ]

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 110 110" className="w-[130px] h-[130px]">
        {rings.map((ring, i) => {
          const circumference = 2 * Math.PI * ring.radius
          const value = isNumber(ring.value)
            ? Math.min(Math.max(ring.value, 0), 100)
            : 0
          const filled = (value / 100) * circumference
          return (
            <g key={i}>
              <circle
                cx="55"
                cy="55"
                r={ring.radius}
                fill="none"
                stroke="#1F2630"
                strokeWidth="7"
              />
              <circle
                cx="55"
                cy="55"
                r={ring.radius}
                fill="none"
                stroke={ring.color}
                strokeWidth="7"
                strokeDasharray={`${filled} ${circumference - filled}`}
                strokeLinecap="round"
                transform="rotate(-90 55 55)"
                className="transition-all duration-700"
              />
            </g>
          )
        })}
        {/* Center label */}
        <text
          x="55"
          y="53"
          textAnchor="middle"
          fill="white"
          fontSize="11"
          fontWeight="bold"
          fontFamily="monospace"
        >
          {isNumber(profit) ? `${formatNumber(profit, 0)}%` : '\u2014'}
        </text>
        <text
          x="55"
          y="63"
          textAnchor="middle"
          fill="#6B7280"
          fontSize="7"
          fontWeight="600"
        >
          NET
        </text>
      </svg>

      {/* Legend */}
      <div className="flex flex-col gap-1 mt-2">
        {rings.map((ring, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: ring.color }}
            />
            <span className="text-[9px] text-slate-500">{ring.label}</span>
            <span className="text-[9px] font-mono text-white ml-auto">
              {isNumber(ring.value)
                ? `${formatNumber(ring.value, 1)}%`
                : '\u2014'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ────────────────── Gradient Metric Bar ────────────────── */

function MetricBar({
  label,
  value,
  maxValue,
  color,
  suffix = '%',
  displayValue,
  colorEnd,
}: {
  label: string
  value: number | undefined
  maxValue: number
  color: string
  suffix?: string
  displayValue?: string
  colorEnd?: string
}) {
  const uid = useId().replace(/:/g, '')
  const pct = isNumber(value)
    ? Math.min(Math.max(Math.abs(value) / maxValue, 0), 1) * 100
    : 0
  const display =
    displayValue ??
    (isNumber(value) ? `${formatNumber(value, 1)}${suffix}` : '\u2014')
  const endColor = colorEnd ?? color

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-slate-400">{label}</span>
        <span className="text-[11px] font-mono font-bold" style={{ color: endColor }}>{display}</span>
      </div>
      <div className="relative h-2 bg-slate-800/80 rounded-full overflow-hidden">
        <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id={`mb-${uid}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={color} stopOpacity="0.5" />
              <stop offset="100%" stopColor={endColor} stopOpacity="1" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width={`${pct}%`} height="100%" rx="4" fill={`url(#mb-${uid})`} className="transition-all duration-700 ease-out" />
        </svg>
        {pct > 8 && (
          <div
            className="absolute top-0 h-full rounded-full opacity-30 blur-sm"
            style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}50, ${endColor}70)` }}
          />
        )}
      </div>
    </div>
  )
}

/* ────────────────── Mini Arc Gauge (for Risk stats) ────────────────── */

function MiniArcGauge({
  value,
  maxValue,
  label,
  displayValue,
  color,
  colorEnd,
  zones,
}: {
  value: number | undefined
  maxValue: number
  label: string
  displayValue: string
  color: string
  colorEnd?: string
  zones?: { from: number; to: number; color: string }[]
}) {
  const uid = useId().replace(/:/g, '')
  const cx = 50
  const cy = 50
  const r = 36
  const strokeW = 7
  const halfCircumference = Math.PI * r

  const fraction = isNumber(value) ? Math.min(Math.abs(value) / maxValue, 1) : 0
  const filled = fraction * halfCircumference

  const arcPath = (startDeg: number, endDeg: number, radius: number) => {
    const s = (startDeg * Math.PI) / 180
    const e = (endDeg * Math.PI) / 180
    return `M ${cx + radius * Math.cos(s)} ${cy - radius * Math.sin(s)} A ${radius} ${radius} 0 ${startDeg - endDeg > 180 ? 1 : 0} 0 ${cx + radius * Math.cos(e)} ${cy - radius * Math.sin(e)}`
  }

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 100 60" className="w-[100px] h-[60px]">
        <defs>
          <linearGradient id={`ag-${uid}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={color} stopOpacity="0.6" />
            <stop offset="100%" stopColor={colorEnd ?? color} stopOpacity="1" />
          </linearGradient>
          <filter id={`aggl-${uid}`}>
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Background semicircle */}
        <path d={arcPath(180, 0, r)} fill="none" stroke="#1e293b" strokeWidth={strokeW} strokeLinecap="round" />

        {/* Optional color zones */}
        {zones?.map((z, i) => {
          const zStart = 180 - (z.from / maxValue) * 180
          const zEnd = 180 - (z.to / maxValue) * 180
          return <path key={i} d={arcPath(zStart, zEnd, r)} fill="none" stroke={z.color} strokeWidth={strokeW} opacity="0.2" />
        })}

        {/* Filled arc */}
        <path
          d={arcPath(180, 0, r)}
          fill="none"
          stroke={`url(#ag-${uid})`}
          strokeWidth={strokeW}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${halfCircumference}`}
          filter={`url(#aggl-${uid})`}
          className="transition-all duration-700 ease-out"
        />

        {/* Center value */}
        <text x={cx} y={cy - 2} textAnchor="middle" fill={colorEnd ?? color} fontSize="14" fontWeight="bold" fontFamily="monospace">{displayValue}</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fill="#64748b" fontSize="7" fontWeight="600" letterSpacing="0.5">{label.toUpperCase()}</text>
      </svg>
    </div>
  )
}

/* ────────────────── Risk Stat Row (label + badge + gradient bar) ────────────── */

interface TagInfo { text: string; bg: string; fg: string }

function betaTag(v: number | undefined): TagInfo {
  if (!isNumber(v)) return { text: '—', bg: 'bg-slate-800/50', fg: 'text-slate-500' }
  const b = Math.abs(v)
  if (b <= 0.8) return { text: 'Low Vol', bg: 'bg-emerald-500/15', fg: 'text-emerald-400' }
  if (b <= 1.3) return { text: 'Normal', bg: 'bg-cyan-500/15', fg: 'text-cyan-400' }
  return { text: 'High Vol', bg: 'bg-amber-500/15', fg: 'text-amber-400' }
}

function deTag(v: number | undefined): TagInfo {
  if (!isNumber(v)) return { text: '—', bg: 'bg-slate-800/50', fg: 'text-slate-500' }
  if (v <= 0.5) return { text: 'Low', bg: 'bg-emerald-500/15', fg: 'text-emerald-400' }
  if (v <= 1.5) return { text: 'Moderate', bg: 'bg-cyan-500/15', fg: 'text-cyan-400' }
  if (v <= 3) return { text: 'High', bg: 'bg-amber-500/15', fg: 'text-amber-400' }
  return { text: 'Very High', bg: 'bg-red-500/15', fg: 'text-red-400' }
}

function ratioTag(v: number | undefined): TagInfo {
  if (!isNumber(v)) return { text: '—', bg: 'bg-slate-800/50', fg: 'text-slate-500' }
  if (v >= 2) return { text: 'Strong', bg: 'bg-emerald-500/15', fg: 'text-emerald-400' }
  if (v >= 1) return { text: 'Adequate', bg: 'bg-cyan-500/15', fg: 'text-cyan-400' }
  return { text: 'Weak', bg: 'bg-red-500/15', fg: 'text-red-400' }
}

function RiskStatRow({
  label,
  value,
  displayValue,
  maxValue,
  color,
  colorEnd,
  tag,
}: {
  label: string
  value: number | undefined
  displayValue: string
  maxValue: number
  color: string
  colorEnd: string
  tag: TagInfo
}) {
  const uid = useId().replace(/:/g, '')
  const pct = isNumber(value) ? Math.min(Math.abs(value) / maxValue, 1) * 100 : 0

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-slate-400">{label}</span>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${tag.bg} ${tag.fg}`}>{tag.text}</span>
          <span className="text-xs font-mono font-bold" style={{ color: colorEnd }}>{displayValue}</span>
        </div>
      </div>
      <div className="relative h-2 bg-slate-800/80 rounded-full overflow-hidden">
        <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id={`rs-${uid}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={color} stopOpacity="0.5" />
              <stop offset="100%" stopColor={colorEnd} stopOpacity="1" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width={`${pct}%`} height="100%" rx="4" fill={`url(#rs-${uid})`} className="transition-all duration-700 ease-out" />
        </svg>
        {pct > 8 && (
          <div
            className="absolute top-0 h-full rounded-full opacity-30 blur-sm"
            style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}50, ${colorEnd}70)` }}
          />
        )}
      </div>
    </div>
  )
}

/* ────────────────── Main Component ────────────────── */

interface FundamentalsPanelProps {
  fundamentals: FundamentalsData | null
  price: number | undefined
  loading?: boolean
  onSync?: () => void
  syncing?: boolean
}

export default function FundamentalsPanel({
  fundamentals,
  loading,
  onSync,
  syncing,
}: FundamentalsPanelProps) {
  const f = fundamentals
  const score = useMemo(() => computeHealthScore(f), [f])
  const roi = (f as unknown as Record<string, unknown>)?.roi as number | undefined

  /* ── Loading skeleton ── */
  if (loading) {
    return (
      <div className="hud-panel p-5 h-full animate-pulse">
        <div className="h-4 w-48 bg-[#1F2630] rounded mb-6" />
        <div className="flex justify-around mb-6">
          <div className="w-[120px] h-[120px] bg-[#1F2630] rounded-full" />
          <div className="w-[120px] h-[120px] bg-[#1F2630] rounded-full" />
        </div>
        <div className="space-y-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-3 bg-[#1F2630] rounded" />
          ))}
        </div>
      </div>
    )
  }

  /* ── Derived values ── */
  const marketCap = f?.market_cap
  const pe = f?.pe_ratio
  const forwardPe = f?.forward_pe
  const peg = f?.peg_ratio
  const priceToSales = f?.price_to_sales
  const priceToBook = f?.price_to_book

  const fmtMarketCap = (() => {
    if (!isNumber(marketCap)) return '\u2014'
    const mc = marketCap as number
    const [val, suffix] =
      mc >= 1e12
        ? [mc / 1e12, 'T']
        : mc >= 1e9
          ? [mc / 1e9, 'B']
          : mc >= 1e6
            ? [mc / 1e6, 'M']
            : [mc, '']
    return `$${formatNumber(val, 2)}${suffix}`
  })()

  return (
    <div className="hud-panel p-5 h-full flex flex-col">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-cyan-400" />
          <h3 className="font-bold text-sm text-white">
            Fundamentals Overview
          </h3>
        </div>
        {score.total > 0 && (
          <span
            className={`text-xs font-bold font-mono px-2.5 py-1 rounded-lg border ${
              score.total >= 70
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : score.total >= 45
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  : 'bg-red-500/10 text-red-400 border-red-500/20'
            }`}
          >
            {score.total}/100
          </span>
        )}
      </div>

      {/* ── Charts Row ── */}
      <div className="flex items-start justify-around mb-5 pb-4 border-b border-blue-500/10">
        <ScoreDonut score={score} />
        <MarginRings
          gross={f?.gross_margin}
          operating={f?.operating_margin}
          profit={f?.profit_margin}
        />
      </div>

      {/* ── Scrollable Metrics ── */}
      <div className="flex-1 overflow-y-auto space-y-4 text-xs text-slate-300 pr-1">
        {/* Valuation */}
        <div>
          <p className="hud-label mb-2">VALUATION</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-800/30 rounded-lg p-2.5">
              <div className="text-[10px] text-slate-500 mb-0.5">
                Market Cap
              </div>
              <div className="text-sm font-mono text-white font-bold">
                {fmtMarketCap}
              </div>
            </div>
            <div className="bg-slate-800/30 rounded-lg p-2.5">
              <div className="text-[10px] text-slate-500 mb-0.5">
                P/E &middot; Forward
              </div>
              <div className="text-sm font-mono text-white font-bold">
                {isNumber(pe) ? formatNumber(pe, 1) : '\u2014'}
                <span className="text-slate-600 mx-1">/</span>
                {isNumber(forwardPe) ? formatNumber(forwardPe, 1) : '\u2014'}
              </div>
            </div>
            <div className="bg-slate-800/30 rounded-lg p-2.5">
              <div className="text-[10px] text-slate-500 mb-0.5">
                PEG Ratio
              </div>
              <div className="text-sm font-mono text-white font-bold">
                {isNumber(peg) ? formatNumber(peg, 2) : '\u2014'}
              </div>
            </div>
            <div className="bg-slate-800/30 rounded-lg p-2.5">
              <div className="text-[10px] text-slate-500 mb-0.5">
                P/S &middot; P/B
              </div>
              <div className="text-sm font-mono text-white font-bold">
                {isNumber(priceToSales) ? formatNumber(priceToSales, 1) : '\u2014'}
                <span className="text-slate-600 mx-1">/</span>
                {isNumber(priceToBook) ? formatNumber(priceToBook, 1) : '\u2014'}
              </div>
            </div>
          </div>
        </div>

        {/* Returns */}
        <div>
          <p className="hud-label mb-2">RETURNS</p>
          <div className="space-y-3">
            <MetricBar label="ROE" value={f?.roe} maxValue={50} color="#F59E0B" colorEnd="#FBBF24" />
            <MetricBar label="ROA" value={f?.roa} maxValue={30} color="#22C55E" colorEnd="#84CC16" />
            <MetricBar label="ROI" value={roi} maxValue={40} color="#A855F7" colorEnd="#D946EF" />
          </div>
        </div>

        {/* Risk & Liquidity */}
        <div>
          <p className="hud-label mb-2">RISK &amp; LIQUIDITY</p>
          <div className="space-y-3">
            <RiskStatRow
              label="Beta"
              value={f?.beta}
              displayValue={isNumber(f?.beta) ? formatNumber(f!.beta, 2) : '\u2014'}
              maxValue={3}
              color="#8B5CF6"
              colorEnd="#A78BFA"
              tag={betaTag(f?.beta)}
            />
            <RiskStatRow
              label="Debt / Equity"
              value={f?.debt_to_equity}
              displayValue={isNumber(f?.debt_to_equity) ? formatNumber(f!.debt_to_equity, 2) : '\u2014'}
              maxValue={5}
              color="#F59E0B"
              colorEnd="#FBBF24"
              tag={deTag(f?.debt_to_equity)}
            />
            <RiskStatRow
              label="Current Ratio"
              value={f?.current_ratio}
              displayValue={isNumber(f?.current_ratio) ? formatNumber(f!.current_ratio, 2) : '\u2014'}
              maxValue={5}
              color="#06B6D4"
              colorEnd="#22D3EE"
              tag={ratioTag(f?.current_ratio)}
            />
            <RiskStatRow
              label="Quick Ratio"
              value={f?.quick_ratio}
              displayValue={isNumber(f?.quick_ratio) ? formatNumber(f!.quick_ratio, 2) : '\u2014'}
              maxValue={5}
              color="#6366F1"
              colorEnd="#818CF8"
              tag={ratioTag(f?.quick_ratio)}
            />
          </div>
        </div>

        {/* Earnings & Momentum */}
        <div>
          <p className="hud-label mb-2">EARNINGS &amp; MOMENTUM</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-800/30 rounded-lg p-2.5">
              <div className="text-[10px] text-slate-500 mb-0.5">
                EPS &middot; Next Q
              </div>
              <div className="text-sm font-mono text-white font-bold">
                {isNumber(f?.eps) ? formatNumber(f!.eps, 2) : '\u2014'}
                <span className="text-slate-600 mx-1">/</span>
                {isNumber(f?.eps_next_quarter)
                  ? formatNumber(f!.eps_next_quarter, 2)
                  : '\u2014'}
              </div>
            </div>
            <div className="bg-slate-800/30 rounded-lg p-2.5">
              <div className="text-[10px] text-slate-500 mb-0.5">
                Target &middot; Rec
              </div>
              <div className="text-sm font-mono text-white font-bold">
                {isNumber(f?.target_price)
                  ? `$${formatNumber(f!.target_price, 0)}`
                  : '\u2014'}
                <span className="text-slate-600 mx-1">/</span>
                <span className="text-xs">{f?.recommendation ?? '\u2014'}</span>
              </div>
            </div>
          </div>
          {f?.earnings_date && (
            <div className="mt-2 flex items-center justify-between bg-amber-500/5 border border-amber-500/20 rounded-lg p-2.5">
              <span className="text-[10px] text-amber-400 font-medium">
                Next Earnings
              </span>
              <span className="text-[11px] font-mono text-amber-300 font-bold">
                {f.earnings_date}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Refresh Button ── */}
      {onSync && (
        <button
          onClick={onSync}
          disabled={syncing}
          className="w-full mt-4 hud-card py-2.5 text-sm font-medium text-blue-400 hover:text-white hover:border-blue-500/30 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {syncing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          {syncing ? 'Syncing...' : 'Refresh All Data'}
        </button>
      )}
    </div>
  )
}
