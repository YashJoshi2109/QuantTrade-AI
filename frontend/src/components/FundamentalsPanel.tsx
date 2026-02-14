'use client'

import { useMemo } from 'react'
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

/* ────────────────── Metric Bar ────────────────── */

function MetricBar({
  label,
  value,
  maxValue,
  color,
  suffix = '%',
  displayValue,
}: {
  label: string
  value: number | undefined
  maxValue: number
  color: string
  suffix?: string
  displayValue?: string
}) {
  const pct = isNumber(value)
    ? Math.min(Math.max(Math.abs(value) / maxValue, 0), 1) * 100
    : 0
  const display =
    displayValue ??
    (isNumber(value) ? `${formatNumber(value, 1)}${suffix}` : '\u2014')

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-slate-500">{label}</span>
        <span className="text-[11px] font-mono text-white">{display}</span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${color}80, ${color})`,
          }}
        />
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
          <div className="space-y-2.5">
            <MetricBar
              label="ROE"
              value={f?.roe}
              maxValue={50}
              color="#F59E0B"
            />
            <MetricBar
              label="ROA"
              value={f?.roa}
              maxValue={30}
              color="#84CC16"
            />
            <MetricBar
              label="ROI"
              value={roi}
              maxValue={40}
              color="#D946EF"
            />
          </div>
        </div>

        {/* Risk & Liquidity */}
        <div>
          <p className="hud-label mb-2">RISK &amp; LIQUIDITY</p>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div className="bg-slate-800/30 rounded-lg p-2.5 text-center">
              <div className="text-[10px] text-slate-500 mb-0.5">Beta</div>
              <div className="text-sm font-mono text-white font-bold">
                {isNumber(f?.beta) ? formatNumber(f!.beta, 2) : '\u2014'}
              </div>
            </div>
            <div className="bg-slate-800/30 rounded-lg p-2.5 text-center">
              <div className="text-[10px] text-slate-500 mb-0.5">D/E</div>
              <div className="text-sm font-mono text-white font-bold">
                {isNumber(f?.debt_to_equity)
                  ? formatNumber(f!.debt_to_equity, 2)
                  : '\u2014'}
              </div>
            </div>
            <div className="bg-slate-800/30 rounded-lg p-2.5 text-center">
              <div className="text-[10px] text-slate-500 mb-0.5">
                Cur / Quick
              </div>
              <div className="text-sm font-mono text-white font-bold">
                {isNumber(f?.current_ratio)
                  ? formatNumber(f!.current_ratio, 1)
                  : '\u2014'}
                <span className="text-slate-600">/</span>
                {isNumber(f?.quick_ratio)
                  ? formatNumber(f!.quick_ratio, 1)
                  : '\u2014'}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MetricBar
              label="Current Ratio"
              value={f?.current_ratio}
              maxValue={5}
              color="#22D3EE"
              suffix=""
              displayValue={
                isNumber(f?.current_ratio)
                  ? formatNumber(f!.current_ratio, 2)
                  : '\u2014'
              }
            />
            <MetricBar
              label="Quick Ratio"
              value={f?.quick_ratio}
              maxValue={5}
              color="#818CF8"
              suffix=""
              displayValue={
                isNumber(f?.quick_ratio)
                  ? formatNumber(f!.quick_ratio, 2)
                  : '\u2014'
              }
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
