'use client'

import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Shield,
  Target,
  TrendingDown,
  AlertTriangle,
  BarChart3,
  Gauge,
  Calculator,
  Activity,
  Percent,
  DollarSign,
  Zap,
  Info,
  ChevronDown,
  ChevronUp,
  Layers,
} from 'lucide-react'
import type { BacktestResult } from '@/lib/api'
import type { LucideIcon } from 'lucide-react'

/* ─── Types ────────────────────────────────────────────────── */

interface RiskManagerProps {
  result: BacktestResult | null
  initialCapital: number
}

/* ─── Helpers ──────────────────────────────────────────────── */

function fmt(n: number, decimals = 2): string {
  return n.toFixed(decimals)
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(2)}%`
}

function fmtDollar(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/* ─── Sub-components ───────────────────────────────────────── */

function GaugeChart({
  value,
  max,
  label,
  sublabel,
  colorStops = ['#10b981', '#f59e0b', '#ef4444'],
}: {
  value: number
  max: number
  label: string
  sublabel?: string
  colorStops?: string[]
}) {
  const pct = clamp(value / max, 0, 1)
  const angle = pct * 180
  const gradientId = `gauge-${label.replace(/\s/g, '-')}`

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 120" className="w-44 h-auto">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            {colorStops.map((color, i) => (
              <stop
                key={i}
                offset={`${(i / (colorStops.length - 1)) * 100}%`}
                stopColor={color}
              />
            ))}
          </linearGradient>
        </defs>
        {/* Background arc */}
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke="#1e293b"
          strokeWidth="14"
          strokeLinecap="round"
        />
        {/* Filled arc */}
        <motion.path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="14"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: pct }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
        />
        {/* Needle */}
        <motion.g
          initial={{ rotate: 0 }}
          animate={{ rotate: angle }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
          style={{ transformOrigin: '100px 100px' }}
        >
          <line
            x1="100"
            y1="100"
            x2="30"
            y2="100"
            stroke="#e2e8f0"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </motion.g>
        {/* Center dot */}
        <circle cx="100" cy="100" r="5" fill="#06b6d4" />
        {/* Value text */}
        <text
          x="100"
          y="85"
          textAnchor="middle"
          className="fill-white font-mono text-lg font-bold"
          fontSize="22"
        >
          {fmt(value, 1)}
        </text>
      </svg>
      <span className="text-xs font-medium text-fg-muted mt-1">{label}</span>
      {sublabel && (
        <span className="text-[10px] text-fg-muted">{sublabel}</span>
      )}
    </div>
  )
}

function RiskBar({
  value,
  max,
  label,
  color = 'cyan',
  suffix = '%',
}: {
  value: number
  max: number
  label: string
  color?: 'cyan' | 'emerald' | 'red' | 'amber'
  suffix?: string
}) {
  const pct = clamp(Math.abs(value) / max, 0, 1) * 100
  const colorMap = {
    cyan: 'from-cyan-500 to-cyan-400',
    emerald: 'from-emerald-500 to-emerald-400',
    red: 'from-red-500 to-red-400',
    amber: 'from-amber-500 to-amber-400',
  }
  const glowMap = {
    cyan: 'shadow-cyan-500/30',
    emerald: 'shadow-emerald-500/30',
    red: 'shadow-red-500/30',
    amber: 'shadow-amber-500/30',
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-fg-muted">{label}</span>
        <span className="text-xs font-mono tabular-nums text-fg-secondary">
          {fmt(Math.abs(value), 2)}
          {suffix}
        </span>
      </div>
      <div className="h-2 rounded-full bg-surface-raised overflow-hidden">
        <motion.div
          className={`h-full rounded-full bg-gradient-to-r ${colorMap[color]} shadow-lg ${glowMap[color]}`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}

function SimulatorSlider({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix = '',
  prefix = '',
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step: number
  suffix?: string
  prefix?: string
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-fg-muted">{label}</span>
        <span className="text-sm font-mono tabular-nums text-cyan-400 font-semibold">
          {prefix}
          {typeof value === 'number' && !isNaN(value) ? fmt(value, 2) : '0.00'}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer
          bg-surface-raised accent-cyan-500
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:w-4
          [&::-webkit-slider-thumb]:h-4
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-cyan-400
          [&::-webkit-slider-thumb]:shadow-lg
          [&::-webkit-slider-thumb]:shadow-cyan-500/40
          [&::-webkit-slider-thumb]:border-2
          [&::-webkit-slider-thumb]:border-cyan-300
          [&::-webkit-slider-thumb]:transition-transform
          [&::-webkit-slider-thumb]:hover:scale-125"
      />
    </div>
  )
}

function SectionCard({
  title,
  icon: Icon,
  children,
  defaultOpen = true,
  badge,
}: {
  title: string
  icon: LucideIcon
  children: React.ReactNode
  defaultOpen?: boolean
  badge?: string
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="rounded-2xl border border-line-subtle bg-surface-raised/80 backdrop-blur-xl overflow-hidden"
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface-hover transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-cyan-600/10 flex items-center justify-center">
            <Icon className="w-4 h-4 text-cyan-400" />
          </div>
          <span className="text-sm font-semibold text-fg-secondary">{title}</span>
          {badge && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              {badge}
            </span>
          )}
        </div>
        {open ? (
          <ChevronUp className="w-4 h-4 text-fg-muted" />
        ) : (
          <ChevronDown className="w-4 h-4 text-fg-muted" />
        )}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 space-y-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function MiniMetricCard({
  label,
  value,
  icon: Icon,
  positive,
}: {
  label: string
  value: string
  icon: LucideIcon
  positive?: boolean
}) {
  return (
    <div className="rounded-xl border border-line-subtle bg-surface-raised/40 p-3 space-y-1">
      <div className="flex items-center gap-1.5">
        <Icon className="w-3 h-3 text-fg-muted" />
        <span className="text-[10px] uppercase tracking-wider text-fg-muted">
          {label}
        </span>
      </div>
      <span
        className={`text-sm font-mono tabular-nums font-bold ${
          positive === undefined
            ? 'text-fg-secondary'
            : positive
              ? 'text-emerald-400'
              : 'text-red-400'
        }`}
      >
        {value}
      </span>
    </div>
  )
}

/* ─── Main component ───────────────────────────────────────── */

export default function RiskManager({ result, initialCapital }: RiskManagerProps) {
  /* --- Position Sizing state --- */
  const [accountSize, setAccountSize] = useState(initialCapital)
  const [riskPerTrade, setRiskPerTrade] = useState(2)
  const [entryPrice, setEntryPrice] = useState(150)
  const [stopLossPrice, setStopLossPrice] = useState(145)

  /* --- Kelly state --- */
  const [kellyWinRate, setKellyWinRate] = useState(
    result ? result.win_rate : 0.55
  )
  const [kellyWinLoss, setKellyWinLoss] = useState(
    result && result.avg_loss !== 0
      ? Math.abs(result.avg_win / result.avg_loss)
      : 1.5
  )

  /* --- Drawdown simulator --- */
  const [marketDrop, setMarketDrop] = useState(-20)

  /* --- Position sizing calculations --- */
  const posCalc = useMemo(() => {
    const riskDollar = accountSize * (riskPerTrade / 100)
    const priceDiff = Math.abs(entryPrice - stopLossPrice)
    if (priceDiff === 0) {
      return {
        shares: 0,
        dollarRisk: riskDollar,
        positionValue: 0,
        portfolioPct: 0,
      }
    }
    const shares = Math.floor(riskDollar / priceDiff)
    const positionValue = shares * entryPrice
    const portfolioPct = (positionValue / accountSize) * 100
    return { shares, dollarRisk: riskDollar, positionValue, portfolioPct }
  }, [accountSize, riskPerTrade, entryPrice, stopLossPrice])

  /* --- Kelly Criterion --- */
  const kelly = useMemo(() => {
    const W = kellyWinRate
    const R = kellyWinLoss
    if (R === 0) return { full: 0, half: 0, quarter: 0 }
    const fullKelly = W - (1 - W) / R
    return {
      full: Math.max(fullKelly * 100, 0),
      half: Math.max((fullKelly / 2) * 100, 0),
      quarter: Math.max((fullKelly / 4) * 100, 0),
    }
  }, [kellyWinRate, kellyWinLoss])

  /* --- Risk Score (composite 0-100) --- */
  const riskScore = useMemo(() => {
    if (!result) return null
    // Higher is riskier. We invert "good" metrics.
    const sharpeScore = clamp((2.0 - result.sharpe_ratio) / 2.0, 0, 1) * 25
    const ddScore = clamp(Math.abs(result.max_drawdown) / 0.5, 0, 1) * 25
    const varScore = clamp(Math.abs(result.var_95) / 0.1, 0, 1) * 20
    const winRateScore = clamp((0.6 - result.win_rate) / 0.6, 0, 1) * 15
    const pfScore = clamp((2.0 - result.profit_factor) / 2.0, 0, 1) * 15
    const raw = sharpeScore + ddScore + varScore + winRateScore + pfScore
    return {
      total: clamp(raw, 0, 100),
      components: {
        sharpe: sharpeScore,
        maxDD: ddScore,
        var95: varScore,
        winRate: winRateScore,
        profitFactor: pfScore,
      },
    }
  }, [result])

  const riskLabel = useMemo(() => {
    if (!riskScore) return ''
    if (riskScore.total < 25) return 'Conservative'
    if (riskScore.total < 50) return 'Moderate'
    if (riskScore.total < 75) return 'Aggressive'
    return 'Very Aggressive'
  }, [riskScore])

  const riskColor = useMemo(() => {
    if (!riskScore) return '#06b6d4'
    if (riskScore.total < 25) return '#10b981'
    if (riskScore.total < 50) return '#f59e0b'
    if (riskScore.total < 75) return '#f97316'
    return '#ef4444'
  }, [riskScore])

  /* --- Drawdown simulator --- */
  const drawdownSim = useMemo(() => {
    const currentEquity = result ? result.final_equity : accountSize
    const projectedEquity = currentEquity * (1 + marketDrop / 100)
    const loss = currentEquity - projectedEquity
    const recoveryNeeded =
      projectedEquity > 0
        ? ((currentEquity - projectedEquity) / projectedEquity) * 100
        : 100
    return { currentEquity, projectedEquity, loss, recoveryNeeded }
  }, [result, accountSize, marketDrop])

  /* --- Recommended max position based on volatility --- */
  const maxPositionByVol = useMemo(() => {
    if (!result) return null
    const vol = result.annualized_volatility
    if (vol === 0) return 100
    // Lower vol => larger position allowed. Scale inversely.
    return clamp(20 / (vol * 100), 2, 100)
  }, [result])

  /* --- Position heat map data --- */
  const tradeHeatMap = useMemo(() => {
    if (!result || !result.trades || result.trades.length === 0) return null
    return result.trades.slice(0, 60).map((t, i) => {
      const pnl = t.pnl ?? t.return_pct ?? 0
      return { index: i, pnl }
    })
  }, [result])

  /* ─── Input helper ──────────────────────────────────────── */
  function NumberInput({
    label,
    value,
    onChange,
    prefix = '',
    suffix = '',
  }: {
    label: string
    value: number
    onChange: (v: number) => void
    prefix?: string
    suffix?: string
  }) {
    return (
      <div className="space-y-1">
        <label className="text-[10px] uppercase tracking-wider text-fg-muted">
          {label}
        </label>
        <div className="flex items-center rounded-lg border border-line-default bg-surface-base px-3 py-2 focus-within:border-cyan-500/50 focus-within:ring-1 focus-within:ring-cyan-500/20 transition-all">
          {prefix && (
            <span className="text-xs text-fg-muted mr-1">{prefix}</span>
          )}
          <input
            type="number"
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            className="bg-transparent text-sm font-mono tabular-nums text-fg-secondary w-full outline-none placeholder:text-fg-muted"
          />
          {suffix && (
            <span className="text-xs text-fg-muted ml-1">{suffix}</span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ══════════════════════════════════════════════════════
          HEADER
         ══════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-center gap-3 mb-2"
      >
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/20 flex items-center justify-center">
          <Shield className="w-5 h-5 text-cyan-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-fg-primary tracking-tight">
            Risk Manager
          </h2>
          <p className="text-xs text-fg-muted">
            Position sizing, risk analytics &amp; scenario simulation
          </p>
        </div>
      </motion.div>

      {/* ══════════════════════════════════════════════════════
          1. RISK SCORE GAUGE (if result)
         ══════════════════════════════════════════════════════ */}
      {riskScore && (
        <SectionCard title="Risk Score" icon={Gauge} badge={riskLabel}>
          <div className="flex flex-col md:flex-row items-center gap-6">
            <GaugeChart
              value={riskScore.total}
              max={100}
              label="Composite Risk"
              sublabel={riskLabel}
              colorStops={['#10b981', '#f59e0b', '#ef4444']}
            />
            <div className="flex-1 w-full space-y-3">
              <RiskBar
                label="Sharpe Risk"
                value={riskScore.components.sharpe}
                max={25}
                color={riskScore.components.sharpe > 15 ? 'red' : riskScore.components.sharpe > 8 ? 'amber' : 'emerald'}
                suffix=" / 25"
              />
              <RiskBar
                label="Max Drawdown Risk"
                value={riskScore.components.maxDD}
                max={25}
                color={riskScore.components.maxDD > 15 ? 'red' : riskScore.components.maxDD > 8 ? 'amber' : 'emerald'}
                suffix=" / 25"
              />
              <RiskBar
                label="VaR 95% Risk"
                value={riskScore.components.var95}
                max={20}
                color={riskScore.components.var95 > 12 ? 'red' : riskScore.components.var95 > 6 ? 'amber' : 'emerald'}
                suffix=" / 20"
              />
              <RiskBar
                label="Win Rate Risk"
                value={riskScore.components.winRate}
                max={15}
                color={riskScore.components.winRate > 9 ? 'red' : riskScore.components.winRate > 5 ? 'amber' : 'emerald'}
                suffix=" / 15"
              />
              <RiskBar
                label="Profit Factor Risk"
                value={riskScore.components.profitFactor}
                max={15}
                color={riskScore.components.profitFactor > 9 ? 'red' : riskScore.components.profitFactor > 5 ? 'amber' : 'emerald'}
                suffix=" / 15"
              />
            </div>
          </div>
          <div
            className="mt-3 rounded-lg px-3 py-2 text-xs text-center font-medium border"
            style={{
              backgroundColor: `${riskColor}10`,
              borderColor: `${riskColor}30`,
              color: riskColor,
            }}
          >
            Overall risk level: {riskLabel} ({fmt(riskScore.total, 1)} / 100)
          </div>
        </SectionCard>
      )}

      {/* ══════════════════════════════════════════════════════
          2. POSITION SIZING CALCULATOR
         ══════════════════════════════════════════════════════ */}
      <SectionCard title="Position Sizing Calculator" icon={Calculator} badge="Interactive">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <NumberInput
            label="Account Size"
            value={accountSize}
            onChange={setAccountSize}
            prefix="$"
          />
          <NumberInput
            label="Entry Price"
            value={entryPrice}
            onChange={setEntryPrice}
            prefix="$"
          />
          <NumberInput
            label="Stop Loss"
            value={stopLossPrice}
            onChange={setStopLossPrice}
            prefix="$"
          />
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-fg-muted">
              Risk Per Trade
            </label>
            <div className="pt-1">
              <SimulatorSlider
                label=""
                value={riskPerTrade}
                onChange={setRiskPerTrade}
                min={0.5}
                max={5}
                step={0.25}
                suffix="%"
              />
            </div>
          </div>
        </div>

        {/* Calculated results */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
          <MiniMetricCard
            label="Position Size"
            value={`${posCalc.shares.toLocaleString()} shares`}
            icon={Layers}
          />
          <MiniMetricCard
            label="Dollar Risk"
            value={fmtDollar(posCalc.dollarRisk)}
            icon={DollarSign}
          />
          <MiniMetricCard
            label="Position Value"
            value={fmtDollar(posCalc.positionValue)}
            icon={BarChart3}
          />
          <MiniMetricCard
            label="% of Portfolio"
            value={`${fmt(posCalc.portfolioPct)}%`}
            icon={Percent}
            positive={posCalc.portfolioPct < 30 ? true : posCalc.portfolioPct < 60 ? undefined : false}
          />
        </div>

        {/* Portfolio allocation bar */}
        <div className="space-y-1.5">
          <span className="text-[10px] uppercase tracking-wider text-fg-muted">
            Portfolio Allocation
          </span>
          <div className="h-5 rounded-full bg-surface-raised overflow-hidden flex">
            <motion.div
              className="h-full rounded-l-full bg-gradient-to-r from-cyan-500 to-cyan-400"
              initial={{ width: 0 }}
              animate={{ width: `${clamp(posCalc.portfolioPct, 0, 100)}%` }}
              transition={{ duration: 0.6 }}
            />
            <motion.div
              className="h-full bg-surface-hover"
              initial={{ width: '100%' }}
              animate={{
                width: `${clamp(100 - posCalc.portfolioPct, 0, 100)}%`,
              }}
              transition={{ duration: 0.6 }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-fg-muted">
            <span>Allocated: {fmt(clamp(posCalc.portfolioPct, 0, 100))}%</span>
            <span>
              Cash: {fmt(clamp(100 - posCalc.portfolioPct, 0, 100))}%
            </span>
          </div>
        </div>

        {/* Kelly Criterion */}
        <div className="mt-2 rounded-xl border border-line-subtle bg-surface-base/30 p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-semibold text-fg-secondary">
              Kelly Criterion
            </span>
            <div className="group relative ml-auto">
              <Info className="w-3.5 h-3.5 text-fg-muted cursor-help" />
              <div className="absolute right-0 bottom-full mb-2 w-56 p-2 rounded-lg bg-surface-overlay border border-line-default text-[10px] text-fg-muted opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                Kelly Criterion calculates the mathematically optimal bet size.
                Half-Kelly is recommended for most traders to reduce variance.
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <SimulatorSlider
                label="Win Rate"
                value={kellyWinRate}
                onChange={setKellyWinRate}
                min={0.1}
                max={0.9}
                step={0.01}
              />
            </div>
            <div className="space-y-1.5">
              <SimulatorSlider
                label="Avg Win/Loss Ratio"
                value={kellyWinLoss}
                onChange={setKellyWinLoss}
                min={0.5}
                max={5}
                step={0.1}
                suffix="x"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Full Kelly', value: kelly.full, color: 'text-red-400' },
              {
                label: 'Half Kelly',
                value: kelly.half,
                color: 'text-amber-400',
              },
              {
                label: 'Quarter Kelly',
                value: kelly.quarter,
                color: 'text-emerald-400',
              },
            ].map((k) => (
              <div
                key={k.label}
                className="rounded-lg border border-line-subtle bg-surface-base/50 p-3 text-center"
              >
                <div className={`text-lg font-mono tabular-nums font-bold ${k.color}`}>
                  {fmt(k.value)}%
                </div>
                <div className="text-[10px] text-fg-muted mt-0.5">
                  {k.label}
                </div>
              </div>
            ))}
          </div>

          {/* Kelly gauge */}
          <div className="flex justify-center">
            <div className="relative w-full h-3 rounded-full bg-surface-raised overflow-hidden">
              {/* Quarter Kelly marker */}
              <motion.div
                className="absolute h-full bg-gradient-to-r from-emerald-500/80 to-emerald-400/60"
                initial={{ width: 0 }}
                animate={{ width: `${clamp(kelly.quarter, 0, 100)}%` }}
                transition={{ duration: 0.8 }}
              />
              {/* Half Kelly marker overlay */}
              <motion.div
                className="absolute h-full border-r-2 border-amber-400"
                initial={{ width: 0 }}
                animate={{ width: `${clamp(kelly.half, 0, 100)}%` }}
                transition={{ duration: 0.8 }}
                style={{ background: 'transparent' }}
              />
              {/* Full Kelly marker overlay */}
              <motion.div
                className="absolute h-full border-r-2 border-red-400"
                initial={{ width: 0 }}
                animate={{ width: `${clamp(kelly.full, 0, 100)}%` }}
                transition={{ duration: 0.8 }}
                style={{ background: 'transparent' }}
              />
            </div>
          </div>
          <div className="flex justify-between text-[9px] text-fg-muted">
            <span>0%</span>
            <span className="text-emerald-500">
              QK: {fmt(kelly.quarter)}%
            </span>
            <span className="text-amber-500">HK: {fmt(kelly.half)}%</span>
            <span className="text-red-500">FK: {fmt(kelly.full)}%</span>
            <span>100%</span>
          </div>
        </div>
      </SectionCard>

      {/* ══════════════════════════════════════════════════════
          3. RISK METRICS DASHBOARD (if result)
         ══════════════════════════════════════════════════════ */}
      {result && (
        <SectionCard title="Risk Metrics" icon={Activity} badge="Live">
          {/* VaR bars */}
          <div className="space-y-3">
            <RiskBar
              label="Value at Risk (95%)"
              value={result.var_95 * 100}
              max={20}
              color="amber"
            />
            <RiskBar
              label="Value at Risk (99%)"
              value={result.var_99 * 100}
              max={30}
              color="red"
            />
            <RiskBar
              label="Max Drawdown"
              value={Math.abs(result.max_drawdown) * 100}
              max={60}
              color="red"
            />
          </div>

          {/* Ulcer Index gauge */}
          <div className="flex flex-col md:flex-row items-center gap-6 mt-2">
            <GaugeChart
              value={result.ulcer_index}
              max={20}
              label="Ulcer Index"
              sublabel={
                result.ulcer_index < 5
                  ? 'Low Stress'
                  : result.ulcer_index < 10
                    ? 'Moderate Stress'
                    : 'High Stress'
              }
              colorStops={['#10b981', '#f59e0b', '#ef4444']}
            />
            <div className="flex-1 grid grid-cols-3 gap-2">
              <MiniMetricCard
                label="Sharpe"
                value={fmt(result.sharpe_ratio)}
                icon={TrendingDown}
                positive={result.sharpe_ratio > 1}
              />
              <MiniMetricCard
                label="Sortino"
                value={fmt(result.sortino_ratio)}
                icon={TrendingDown}
                positive={result.sortino_ratio > 1}
              />
              <MiniMetricCard
                label="Calmar"
                value={fmt(result.calmar_ratio)}
                icon={TrendingDown}
                positive={result.calmar_ratio > 1}
              />
            </div>
          </div>
        </SectionCard>
      )}

      {/* ══════════════════════════════════════════════════════
          4. DRAWDOWN SIMULATOR
         ══════════════════════════════════════════════════════ */}
      <SectionCard title="Drawdown Simulator" icon={TrendingDown} badge="Scenario">
        <div className="rounded-xl border border-line-subtle bg-surface-base/30 p-4 space-y-4">
          <SimulatorSlider
            label="What if the market drops..."
            value={marketDrop}
            onChange={setMarketDrop}
            min={-60}
            max={-5}
            step={1}
            suffix="%"
          />

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MiniMetricCard
              label="Current Equity"
              value={fmtDollar(drawdownSim.currentEquity)}
              icon={DollarSign}
            />
            <MiniMetricCard
              label="Projected Equity"
              value={fmtDollar(drawdownSim.projectedEquity)}
              icon={TrendingDown}
              positive={false}
            />
            <MiniMetricCard
              label="Loss Amount"
              value={fmtDollar(drawdownSim.loss)}
              icon={AlertTriangle}
              positive={false}
            />
            <MiniMetricCard
              label="Recovery Needed"
              value={`${fmt(drawdownSim.recoveryNeeded)}%`}
              icon={Target}
              positive={false}
            />
          </div>

          {/* Animated drawdown bar */}
          <div className="space-y-2">
            <span className="text-[10px] uppercase tracking-wider text-fg-muted">
              Drawdown Impact
            </span>
            <div className="flex items-end gap-1 h-24">
              {/* Current equity bar */}
              <div className="flex flex-col items-center flex-1 gap-1">
                <motion.div
                  className="w-full rounded-t-lg bg-gradient-to-t from-emerald-600 to-emerald-400"
                  initial={{ height: 0 }}
                  animate={{ height: '100%' }}
                  transition={{ duration: 0.6 }}
                />
                <span className="text-[9px] text-fg-muted">Current</span>
              </div>
              {/* Projected equity bar */}
              <div className="flex flex-col items-center flex-1 gap-1">
                <motion.div
                  className="w-full rounded-t-lg bg-gradient-to-t from-red-600 to-red-400"
                  initial={{ height: 0 }}
                  animate={{
                    height: `${clamp((drawdownSim.projectedEquity / drawdownSim.currentEquity) * 100, 0, 100)}%`,
                  }}
                  transition={{ duration: 0.6 }}
                />
                <span className="text-[9px] text-fg-muted">Projected</span>
              </div>
              {/* Loss bar */}
              <div className="flex flex-col items-center flex-1 gap-1">
                <motion.div
                  className="w-full rounded-t-lg bg-gradient-to-t from-amber-600 to-amber-400"
                  initial={{ height: 0 }}
                  animate={{
                    height: `${clamp((drawdownSim.recoveryNeeded / 150) * 100, 0, 100)}%`,
                  }}
                  transition={{ duration: 0.6 }}
                />
                <span className="text-[9px] text-fg-muted">Recovery %</span>
              </div>
            </div>
          </div>

          {/* Historical comparison */}
          {result && (
            <div className="rounded-lg border border-line-subtle bg-surface-base/20 px-3 py-2 flex items-center gap-2">
              <Info className="w-3.5 h-3.5 text-fg-muted shrink-0" />
              <span className="text-[10px] text-fg-muted">
                Historical max drawdown for this strategy was{' '}
                <span className="text-red-400 font-mono font-semibold">
                  {fmtPct(result.max_drawdown)}
                </span>
                {' '}lasting{' '}
                <span className="text-fg-secondary font-mono">
                  {result.max_drawdown_duration}
                </span>{' '}
                days to recover.
              </span>
            </div>
          )}
        </div>
      </SectionCard>

      {/* ══════════════════════════════════════════════════════
          5. CORRELATION RISK PANEL (if result)
         ══════════════════════════════════════════════════════ */}
      {result && (
        <SectionCard title="Correlation & Concentration Risk" icon={AlertTriangle}>
          <div className="space-y-3">
            {/* Single asset warning */}
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="text-xs font-medium text-amber-300">
                  Single Asset Concentration
                </span>
                <p className="text-[10px] text-fg-muted leading-relaxed">
                  This backtest runs on <span className="text-fg-secondary font-mono">{result.symbol}</span> only.
                  Consider diversifying across uncorrelated assets to reduce
                  idiosyncratic risk. A portfolio of 5-8 uncorrelated positions
                  can reduce volatility by 30-50% without sacrificing returns.
                </p>
              </div>
            </div>

            {/* Suggested diversification */}
            <div className="rounded-lg border border-line-subtle bg-surface-base/30 p-3 space-y-2">
              <span className="text-xs font-semibold text-fg-secondary">
                Diversification Recommendations
              </span>
              <ul className="space-y-1.5">
                {[
                  'Add 2-3 uncorrelated asset classes (bonds, commodities, REITs)',
                  'Limit single position to 20% of total portfolio',
                  'Consider sector rotation to reduce correlation risk',
                  'Use inverse or hedge positions during high-volatility regimes',
                ].map((tip, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <div className="w-1 h-1 rounded-full bg-cyan-500 mt-1.5 shrink-0" />
                    <span className="text-[10px] text-fg-muted">{tip}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Max recommended position */}
            {maxPositionByVol !== null && (
              <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-fg-muted">
                    Max Recommended Position (Volatility-Based)
                  </span>
                  <span className="text-sm font-mono tabular-nums text-cyan-400 font-bold">
                    {fmt(maxPositionByVol)}%
                  </span>
                </div>
                <RiskBar
                  label="Position vs Max"
                  value={clamp(posCalc.portfolioPct, 0, 100)}
                  max={maxPositionByVol}
                  color={posCalc.portfolioPct > maxPositionByVol ? 'red' : 'emerald'}
                  suffix="%"
                />
                {posCalc.portfolioPct > maxPositionByVol && (
                  <div className="flex items-center gap-1.5 text-[10px] text-red-400">
                    <AlertTriangle className="w-3 h-3" />
                    Position exceeds volatility-adjusted maximum by{' '}
                    {fmt(posCalc.portfolioPct - maxPositionByVol)}%
                  </div>
                )}
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {/* ══════════════════════════════════════════════════════
          6. POSITION HEAT MAP (if trades exist)
         ══════════════════════════════════════════════════════ */}
      {tradeHeatMap && tradeHeatMap.length > 0 && (
        <SectionCard title="Position Heat Map" icon={BarChart3} badge={`${tradeHeatMap.length} trades`}>
          <div className="space-y-2">
            <span className="text-[10px] uppercase tracking-wider text-fg-muted">
              Risk per trade — colored by P&L
            </span>
            <div className="flex flex-wrap gap-1">
              {tradeHeatMap.map((t, i) => {
                const intensity = clamp(Math.abs(t.pnl) * 20, 0.15, 1)
                const isWin = t.pnl >= 0
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.2, delay: i * 0.015 }}
                    className="w-6 h-6 rounded-sm cursor-default relative group"
                    style={{
                      backgroundColor: isWin
                        ? `rgba(16, 185, 129, ${intensity})`
                        : `rgba(239, 68, 68, ${intensity})`,
                    }}
                  >
                    {/* Tooltip */}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 rounded bg-surface-overlay border border-line-default text-[9px] text-fg-secondary font-mono whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                      #{i + 1}: {t.pnl >= 0 ? '+' : ''}
                      {fmt(t.pnl * 100)}%
                    </div>
                  </motion.div>
                )
              })}
            </div>
            <div className="flex items-center gap-4 text-[9px] text-fg-muted mt-1">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm bg-emerald-500/60" />
                <span>Winning trade</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm bg-red-500/60" />
                <span>Losing trade</span>
              </div>
              <span className="ml-auto text-fg-muted">
                Intensity = magnitude of P&L
              </span>
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  )
}
