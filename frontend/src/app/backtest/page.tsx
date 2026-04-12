'use client'

/**
 * QuantTrade AI -- Pro-Level Strategy Backtester
 * 8 strategies, advanced metrics, Monte Carlo, walk-forward, equity/drawdown charts
 */

import { useState, useMemo, useRef, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import AppLayout from '@/components/AppLayout'
import { motion, AnimatePresence } from 'framer-motion'
import MobileLayout from '@/components/layout/MobileLayout'
import { runBacktest, BacktestResult, BacktestRequest, BacktestTrade, MonteCarloResult } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import {
  Play, Activity, Target, AlertTriangle, Loader2, TrendingUp, TrendingDown,
  BarChart3, Percent, DollarSign, Zap, ChevronDown, Download,
  CheckCircle, XCircle, Clock, Settings, Shield, Shuffle, ArrowDownRight,
  Timer, Layers, SlidersHorizontal,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/* ── Strategy definitions ───────────────────────────────────────────── */

const STRATEGIES = [
  {
    id: 'rsi_ma_crossover', name: 'RSI + MA Crossover', badge: 'Momentum',
    desc: 'Buy when RSI < oversold and price above fast MA; sell when RSI > overbought.',
    color: 'cyan',
    params: [
      { key: 'rsi_period', label: 'RSI Period', min: 5, max: 50, step: 1, default: 14 },
      { key: 'rsi_oversold', label: 'Oversold', min: 10, max: 40, step: 1, default: 30 },
      { key: 'rsi_overbought', label: 'Overbought', min: 60, max: 90, step: 1, default: 70 },
      { key: 'fast_ma', label: 'Fast MA', min: 5, max: 100, step: 1, default: 20 },
    ],
  },
  {
    id: 'ma_crossover', name: 'MA Crossover', badge: 'Trend',
    desc: 'Buy when fast MA crosses above slow MA; sell on cross below.',
    color: 'violet',
    params: [
      { key: 'fast_ma', label: 'Fast MA', min: 5, max: 100, step: 1, default: 20 },
      { key: 'slow_ma', label: 'Slow MA', min: 20, max: 200, step: 1, default: 50 },
    ],
  },
  {
    id: 'bollinger_breakout', name: 'Bollinger Breakout', badge: 'Mean Reversion',
    desc: 'Buy on lower-band touch with RSI confirmation; sell on upper-band touch.',
    color: 'amber',
    params: [
      { key: 'bb_period', label: 'BB Period', min: 10, max: 50, step: 1, default: 20 },
      { key: 'bb_std', label: 'Std Dev', min: 1, max: 4, step: 0.5, default: 2 },
      { key: 'rsi_period', label: 'RSI Period', min: 5, max: 30, step: 1, default: 14 },
    ],
  },
  {
    id: 'macd_cross', name: 'MACD Cross', badge: 'Momentum',
    desc: 'Buy on MACD line crossing above signal; sell on cross below.',
    color: 'emerald',
    params: [
      { key: 'fast_period', label: 'Fast EMA', min: 5, max: 30, step: 1, default: 12 },
      { key: 'slow_period', label: 'Slow EMA', min: 15, max: 50, step: 1, default: 26 },
      { key: 'signal_period', label: 'Signal', min: 3, max: 20, step: 1, default: 9 },
    ],
  },
  {
    id: 'mean_reversion', name: 'Mean Reversion (Z-Score)', badge: 'Mean Reversion',
    desc: 'Buy when price z-score drops below threshold; sell when it reverts.',
    color: 'rose',
    params: [
      { key: 'lookback', label: 'Lookback', min: 10, max: 60, step: 1, default: 20 },
      { key: 'entry_z', label: 'Entry Z', min: -4, max: -0.5, step: 0.25, default: -2 },
      { key: 'exit_z', label: 'Exit Z', min: -1, max: 2, step: 0.25, default: 0 },
    ],
  },
  {
    id: 'momentum_roc', name: 'Momentum (ROC)', badge: 'Momentum',
    desc: 'Buy when rate of change exceeds threshold; sell when it drops.',
    color: 'sky',
    params: [
      { key: 'roc_period', label: 'ROC Period', min: 5, max: 30, step: 1, default: 12 },
      { key: 'entry_threshold', label: 'Entry %', min: 1, max: 20, step: 0.5, default: 5 },
      { key: 'exit_threshold', label: 'Exit %', min: -20, max: 0, step: 0.5, default: -2 },
    ],
  },
  {
    id: 'volume_weighted_trend', name: 'Volume-Weighted Trend', badge: 'Volume',
    desc: 'Buy when VWAP trend is bullish with volume confirmation; sell on reversal.',
    color: 'orange',
    params: [
      { key: 'vwap_period', label: 'VWAP Period', min: 10, max: 50, step: 1, default: 20 },
      { key: 'vol_mult', label: 'Vol Multiplier', min: 1, max: 3, step: 0.1, default: 1.5 },
      { key: 'ma_period', label: 'MA Period', min: 5, max: 30, step: 1, default: 10 },
    ],
  },
  {
    id: 'multi_indicator', name: 'Multi-Indicator Composite', badge: 'Multi-Factor',
    desc: 'Composite score from RSI, MACD, Bollinger, and MA. Buy when 3+ indicators agree.',
    color: 'fuchsia',
    params: [
      { key: 'rsi_period', label: 'RSI Period', min: 5, max: 30, step: 1, default: 14 },
      { key: 'fast_ma', label: 'Fast MA', min: 5, max: 50, step: 1, default: 20 },
      { key: 'slow_ma', label: 'Slow MA', min: 20, max: 200, step: 1, default: 50 },
      { key: 'min_score', label: 'Min Score', min: 2, max: 4, step: 1, default: 3 },
    ],
  },
]

const POSITION_SIZING_OPTIONS = [
  { value: 'fixed', label: 'Fixed (95% of capital)' },
  { value: 'kelly', label: 'Kelly Criterion (Half-Kelly)' },
  { value: 'volatility', label: 'Volatility-Based' },
]

const BADGE_COLORS: Record<string, string> = {
  cyan: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  violet: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  amber: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  emerald: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  rose: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  sky: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  orange: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  fuchsia: 'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30',
}

/* ── Shared Components ──────────────────────────────────────────────── */

function MetricCard({ label, value, sub, positive, icon: Icon }: {
  label: string; value: string; sub?: string; positive?: boolean; icon?: LucideIcon
}) {
  return (
    <div className="bg-[#0F1629]/80 border border-slate-800/60 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        {Icon && <Icon className={`w-3.5 h-3.5 ${positive === true ? 'text-emerald-400' : positive === false ? 'text-red-400' : 'text-slate-500'}`} />}
        <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <div className={`text-xl font-black font-mono tabular-nums ${positive === true ? 'text-emerald-400' : positive === false ? 'text-red-400' : 'text-white'}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-slate-600 font-mono mt-0.5">{sub}</div>}
    </div>
  )
}

function SVGChart({ data, height = 140, color = '#10b981', label, showZeroLine = false }: {
  data: number[]; height?: number; color?: string; label?: string; showZeroLine?: boolean
}) {
  if (data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const w = 100
  const h = height
  const pad = 2

  const points = data.map((v, i) => ({
    x: (i / (data.length - 1)) * w,
    y: pad + (h - 2 * pad) - ((v - min) / range) * (h - 2 * pad),
  }))
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')
  const fillPath = d + ` L ${w} ${h} L 0 ${h} Z`

  const zeroY = showZeroLine && min < 0 && max > 0
    ? pad + (h - 2 * pad) - ((0 - min) / range) * (h - 2 * pad)
    : null

  return (
    <div className="w-full relative" style={{ height: `${height}px` }}>
      <svg className="w-full h-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`grad-${label}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={fillPath} fill={`url(#grad-${label})`} />
        {zeroY !== null && (
          <line x1="0" y1={zeroY} x2={w} y2={zeroY} stroke="#334155" strokeWidth="0.3" strokeDasharray="2,2" />
        )}
        <path d={d} fill="none" stroke={color} strokeWidth="0.6" />
      </svg>
      {label && <div className="absolute top-1.5 left-2.5 text-[9px] font-bold text-slate-600 uppercase tracking-wider">{label}</div>}
      <div className="absolute bottom-1.5 right-2.5 text-[10px] font-bold font-mono" style={{ color }}>
        {data[data.length - 1] >= 1000
          ? `$${data[data.length - 1].toLocaleString(undefined, { maximumFractionDigits: 0 })}`
          : data[data.length - 1].toFixed(2)}
      </div>
    </div>
  )
}

function MonthlyHeatmap({ data }: { data: { month: number; return_pct: number }[] }) {
  if (!data.length) return <div className="text-xs text-slate-600 p-4">No monthly data</div>
  return (
    <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5 p-4">
      {data.map((m, i) => {
        const v = m.return_pct
        const intensity = Math.min(Math.abs(v) / 10, 1)
        const bg = v >= 0
          ? `rgba(16, 185, 129, ${0.1 + intensity * 0.5})`
          : `rgba(239, 68, 68, ${0.1 + intensity * 0.5})`
        return (
          <div key={i} className="rounded-lg p-2 text-center border border-slate-800/40" style={{ background: bg }}>
            <div className="text-[9px] text-slate-500 font-semibold">M{m.month}</div>
            <div className={`text-xs font-bold font-mono ${v >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {v >= 0 ? '+' : ''}{v.toFixed(1)}%
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MCDistribution({ mc }: { mc: MonteCarloResult }) {
  const maxCount = Math.max(...mc.distribution.map(d => d.count), 1)
  return (
    <div className="space-y-3 p-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="text-center">
          <div className="text-[9px] text-slate-500 uppercase font-semibold">P(Profit)</div>
          <div className="text-lg font-black font-mono text-emerald-400">{mc.probability_of_profit}%</div>
        </div>
        <div className="text-center">
          <div className="text-[9px] text-slate-500 uppercase font-semibold">P(Ruin)</div>
          <div className="text-lg font-black font-mono text-red-400">{mc.probability_of_ruin}%</div>
        </div>
        <div className="text-center">
          <div className="text-[9px] text-slate-500 uppercase font-semibold">Median Return</div>
          <div className={`text-lg font-black font-mono ${mc.median_return >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {mc.median_return >= 0 ? '+' : ''}{mc.median_return}%
          </div>
        </div>
        <div className="text-center">
          <div className="text-[9px] text-slate-500 uppercase font-semibold">95% Range</div>
          <div className="text-sm font-bold font-mono text-slate-300">
            {mc.p5_return}% to {mc.p95_return}%
          </div>
        </div>
      </div>
      {/* Histogram */}
      <div className="flex items-end gap-px h-20 mt-2">
        {mc.distribution.map((d, i) => {
          const h = (d.count / maxCount) * 100
          const isPositive = d.range_start >= 0
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end" title={`${d.range_start.toFixed(0)}% to ${d.range_end.toFixed(0)}%: ${d.count}`}>
              <div
                className="w-full rounded-t-sm min-h-[2px]"
                style={{
                  height: `${h}%`,
                  background: isPositive ? 'rgba(16, 185, 129, 0.6)' : 'rgba(239, 68, 68, 0.6)',
                }}
              />
            </div>
          )
        })}
      </div>
      <div className="flex justify-between text-[9px] text-slate-600 font-mono">
        <span>{mc.distribution[0]?.range_start.toFixed(0)}%</span>
        <span>{mc.n_simulations.toLocaleString()} simulations</span>
        <span>{mc.distribution[mc.distribution.length - 1]?.range_end.toFixed(0)}%</span>
      </div>
    </div>
  )
}

/* ── Section wrapper ────────────────────────────────────────────────── */

function Section({ title, icon: Icon, right, children }: {
  title: string; icon?: LucideIcon; right?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className="bg-[#0F1629]/80 border border-slate-800/60 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-800/40 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-3.5 h-3.5 text-slate-500" />}
          <span className="text-sm font-bold text-white">{title}</span>
        </div>
        {right && <div className="text-[10px] text-slate-500 font-mono">{right}</div>}
      </div>
      {children}
    </div>
  )
}

/* ── Slider input ───────────────────────────────────────────────────── */

function ParamSlider({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">{label}</label>
        <span className="text-xs font-mono text-cyan-400 font-bold">{value}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none bg-slate-800 cursor-pointer accent-cyan-500
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-400 [&::-webkit-slider-thumb]:border-2
          [&::-webkit-slider-thumb]:border-[#0A0E1A] [&::-webkit-slider-thumb]:shadow-lg"
      />
    </div>
  )
}

/* ── Main Desktop Page ──────────────────────────────────────────────── */

function DesktopBacktestPage() {
  const [symbol, setSymbol] = useState('AAPL')
  const [strategy, setStrategy] = useState('rsi_ma_crossover')
  const [startDate, setStartDate] = useState('2023-01-01')
  const [endDate, setEndDate] = useState('2024-06-01')
  const [initialCapital, setInitialCapital] = useState(100000)
  const [positionSizing, setPositionSizing] = useState('fixed')
  const [commissionRate, setCommissionRate] = useState(0.001)
  const [stopLoss, setStopLoss] = useState<number | null>(null)
  const [takeProfit, setTakeProfit] = useState<number | null>(null)
  const [trailingStop, setTrailingStop] = useState<number | null>(null)
  const [maxPyramiding, setMaxPyramiding] = useState(1)
  const [walkForward, setWalkForward] = useState(false)
  const [monteCarlo, setMonteCarlo] = useState(true)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [elapsedSec, setElapsedSec] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const selectedStrat = STRATEGIES.find(s => s.id === strategy)!
  const [stratParams, setStratParams] = useState<Record<string, number>>(() => {
    const p: Record<string, number> = {}
    selectedStrat.params.forEach(sp => { p[sp.key] = sp.default })
    return p
  })

  const handleStrategyChange = (id: string) => {
    setStrategy(id)
    const s = STRATEGIES.find(st => st.id === id)!
    const p: Record<string, number> = {}
    s.params.forEach(sp => { p[sp.key] = sp.default })
    setStratParams(p)
  }

  const handleCancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    setLoading(false)
    setElapsedSec(0)
  }, [])

  const handleRunBacktest = async () => {
    // Abort any in-flight request
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)
    setResult(null)
    setElapsedSec(0)

    // Elapsed timer
    const startTime = Date.now()
    timerRef.current = setInterval(() => setElapsedSec(Math.floor((Date.now() - startTime) / 1000)), 1000)

    try {
      // Use date string directly (YYYY-MM-DD) to avoid timezone offset issues
      const req: BacktestRequest = {
        symbol: symbol.toUpperCase(),
        start_date: startDate + 'T00:00:00',
        end_date: endDate + 'T23:59:59',
        strategy,
        initial_capital: initialCapital,
        strategy_params: stratParams,
        position_sizing: positionSizing,
        commission_rate: commissionRate,
        stop_loss_pct: stopLoss,
        take_profit_pct: takeProfit,
        trailing_stop_pct: trailingStop,
        max_pyramiding: maxPyramiding,
        walk_forward: walkForward,
        monte_carlo: monteCarlo,
      }
      setResult(await runBacktest(req, controller.signal))
    } catch (err: any) {
      if (!controller.signal.aborted) {
        setError(err.message || 'Failed to run backtest')
      }
    } finally {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
      setLoading(false)
      setElapsedSec(0)
    }
  }

  const currentStrat = STRATEGIES.find(s => s.id === strategy)!

  return (
    <AppLayout>
      <div className="min-h-screen bg-[#0A0E1A] -mx-4 md:-mx-6 -my-4 md:-my-6">
        <div className="max-w-[1400px] mx-auto px-4 lg:px-6 py-6">

          {/* Header */}
          <div className="flex items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#0F1629] border border-cyan-500/20 overflow-hidden flex items-center justify-center">
                <Image src="/logo.png" alt="QuantTrade AI" width={36} height={36} className="object-contain" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  <h1 className="text-lg font-black text-white tracking-tight">Strategy Backtester</h1>
                  <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-cyan-500/15 text-cyan-400 border border-cyan-500/25 uppercase">Pro</span>
                </div>
                <p className="text-[10px] text-slate-500 font-mono">8 strategies / Monte Carlo / Walk-forward / Position sizing</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

            {/* ── Left: Strategy Builder ─────────────────────────────── */}
            <div className="lg:col-span-4 space-y-4">

              {/* Symbol & Dates */}
              <Section title="Configuration" icon={Settings}>
                <div className="p-4 space-y-3">
                  <div>
                    <label className="block text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Symbol</label>
                    <input
                      type="text" value={symbol}
                      onChange={e => setSymbol(e.target.value.toUpperCase())}
                      placeholder="AAPL"
                      className="w-full px-3 py-2 bg-[#0A0E1A] border border-slate-700/50 rounded-lg text-white text-sm font-mono placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/40"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Start</label>
                      <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                        className="w-full px-2.5 py-2 bg-[#0A0E1A] border border-slate-700/50 rounded-lg text-white text-xs font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500/50" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">End</label>
                      <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                        className="w-full px-2.5 py-2 bg-[#0A0E1A] border border-slate-700/50 rounded-lg text-white text-xs font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500/50" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Initial Capital</label>
                    <input type="number" value={initialCapital}
                      onChange={e => setInitialCapital(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-[#0A0E1A] border border-slate-700/50 rounded-lg text-white text-sm font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500/50" />
                  </div>
                </div>
              </Section>

              {/* Strategy selector */}
              <Section title="Strategy" icon={Zap}>
                <div className="p-4 space-y-2">
                  {STRATEGIES.map(s => (
                    <button key={s.id} onClick={() => handleStrategyChange(s.id)}
                      className={`w-full text-left p-3 rounded-lg border transition-all ${
                        strategy === s.id
                          ? 'bg-slate-800/60 border-cyan-500/30'
                          : 'bg-transparent border-slate-800/40 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${strategy === s.id ? 'bg-cyan-400' : 'bg-slate-700'}`} />
                        <span className={`text-xs font-bold ${strategy === s.id ? 'text-white' : 'text-slate-400'}`}>{s.name}</span>
                        <span className={`ml-auto px-1.5 py-0.5 rounded text-[8px] font-bold border ${BADGE_COLORS[s.color]}`}>{s.badge}</span>
                      </div>
                      {strategy === s.id && (
                        <p className="text-[10px] text-slate-500 mt-1.5 ml-3.5 leading-relaxed">{s.desc}</p>
                      )}
                    </button>
                  ))}
                </div>
              </Section>

              {/* Strategy parameters */}
              <Section title="Parameters" icon={SlidersHorizontal}>
                <div className="p-4 space-y-4">
                  {currentStrat.params.map(p => (
                    <ParamSlider key={p.key} label={p.label} value={stratParams[p.key] ?? p.default}
                      min={p.min} max={p.max} step={p.step}
                      onChange={v => setStratParams(prev => ({ ...prev, [p.key]: v }))} />
                  ))}
                </div>
              </Section>

              {/* Advanced options */}
              <div className="bg-[#0F1629]/80 border border-slate-800/60 rounded-xl overflow-hidden">
                <button onClick={() => setShowAdvanced(!showAdvanced)}
                  className="w-full px-5 py-3 flex items-center justify-between hover:bg-slate-800/20 transition-colors">
                  <div className="flex items-center gap-2">
                    <Shield className="w-3.5 h-3.5 text-slate-500" />
                    <span className="text-sm font-bold text-white">Risk Management</span>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                </button>
                {showAdvanced && (
                  <div className="p-4 pt-0 space-y-3 border-t border-slate-800/40">
                    <div className="pt-3">
                      <label className="block text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Position Sizing</label>
                      <select value={positionSizing} onChange={e => setPositionSizing(e.target.value)}
                        className="w-full px-3 py-2 bg-[#0A0E1A] border border-slate-700/50 rounded-lg text-white text-xs font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500/50 appearance-none">
                        {POSITION_SIZING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Stop Loss %</label>
                        <input type="number" step="0.5" placeholder="None" value={stopLoss ?? ''}
                          onChange={e => setStopLoss(e.target.value ? Number(e.target.value) : null)}
                          className="w-full px-2.5 py-2 bg-[#0A0E1A] border border-slate-700/50 rounded-lg text-white text-xs font-mono placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/50" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Take Profit %</label>
                        <input type="number" step="0.5" placeholder="None" value={takeProfit ?? ''}
                          onChange={e => setTakeProfit(e.target.value ? Number(e.target.value) : null)}
                          className="w-full px-2.5 py-2 bg-[#0A0E1A] border border-slate-700/50 rounded-lg text-white text-xs font-mono placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/50" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Trailing Stop %</label>
                        <input type="number" step="0.5" placeholder="None" value={trailingStop ?? ''}
                          onChange={e => setTrailingStop(e.target.value ? Number(e.target.value) : null)}
                          className="w-full px-2.5 py-2 bg-[#0A0E1A] border border-slate-700/50 rounded-lg text-white text-xs font-mono placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/50" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Commission %</label>
                        <input type="number" step="0.01" value={(commissionRate * 100).toFixed(2)}
                          onChange={e => setCommissionRate(Number(e.target.value) / 100)}
                          className="w-full px-2.5 py-2 bg-[#0A0E1A] border border-slate-700/50 rounded-lg text-white text-xs font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500/50" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Max Pyramiding</label>
                        <input type="number" min={1} max={5} value={maxPyramiding}
                          onChange={e => setMaxPyramiding(Number(e.target.value))}
                          className="w-full px-2.5 py-2 bg-[#0A0E1A] border border-slate-700/50 rounded-lg text-white text-xs font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500/50" />
                      </div>
                      <div className="flex flex-col justify-end gap-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={walkForward} onChange={e => setWalkForward(e.target.checked)}
                            className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500/30" />
                          <span className="text-[10px] text-slate-400 font-semibold uppercase">Walk-Forward</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={monteCarlo} onChange={e => setMonteCarlo(e.target.checked)}
                            className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500/30" />
                          <span className="text-[10px] text-slate-400 font-semibold uppercase">Monte Carlo</span>
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Run button */}
              {loading ? (
                <motion.button
                  whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                  onClick={handleCancel}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-to-r from-slate-700 to-slate-600 text-white font-black text-sm shadow-lg transition-all"
                >
                  <Loader2 className="w-4 h-4 animate-spin" /> Cancel Simulation{elapsedSec > 0 ? ` (${elapsedSec}s)` : '...'}
                </motion.button>
              ) : (
                <motion.button
                  whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                  onClick={handleRunBacktest}
                  disabled={!symbol}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-black text-sm shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Play className="w-4 h-4" /> Run Backtest
                </motion.button>
              )}
            </div>

            {/* ── Right: Results ─────────────────────────────────────── */}
            <div className="lg:col-span-8 space-y-4">

              {/* Error */}
              <AnimatePresence>
                {error && (
                  <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="p-4 bg-red-500/10 border border-red-500/25 rounded-xl text-red-400 flex items-center gap-3">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span className="text-sm flex-1">{error}</span>
                    <button onClick={handleRunBacktest}
                      className="shrink-0 px-3 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 text-xs font-bold transition-colors">
                      Retry
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Empty state */}
              {!result && !loading && !error && (
                <div className="flex items-center justify-center h-96 border border-dashed border-slate-800 rounded-xl">
                  <div className="text-center">
                    <BarChart3 className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                    <p className="text-sm text-slate-500 font-semibold">Configure a strategy and run a backtest</p>
                    <p className="text-xs text-slate-600 mt-1">Results will appear here with full analytics</p>
                  </div>
                </div>
              )}

              {/* Loading */}
              {loading && (
                <div className="flex items-center justify-center h-96 border border-slate-800/60 rounded-xl bg-[#0F1629]/40">
                  <div className="text-center">
                    <Loader2 className="w-8 h-8 text-cyan-400 animate-spin mx-auto mb-3" />
                    <p className="text-sm text-slate-400 font-semibold">Running backtest simulation...</p>
                    <p className="text-xs text-slate-600 mt-1">Computing signals, executing trades{monteCarlo ? ', Monte Carlo analysis' : ''}...</p>
                    {elapsedSec > 0 && (
                      <p className="text-xs text-slate-600 font-mono mt-2">{elapsedSec}s elapsed</p>
                    )}
                    <button onClick={handleCancel}
                      className="mt-4 px-4 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-400 hover:text-white hover:border-slate-500 transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Results */}
              <AnimatePresence>
                {result && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">

                    {/* Top metrics */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      <MetricCard label="Total Return" icon={TrendingUp}
                        value={`${result.total_return >= 0 ? '+' : ''}${result.total_return.toFixed(2)}%`}
                        positive={result.total_return >= 0}
                        sub={`$${result.initial_capital.toLocaleString()} -> $${result.final_equity.toLocaleString()}`} />
                      <MetricCard label="Sharpe Ratio" icon={BarChart3}
                        value={result.sharpe_ratio.toFixed(2)}
                        positive={result.sharpe_ratio >= 1}
                        sub="risk-adjusted" />
                      <MetricCard label="Win Rate" icon={Target}
                        value={`${result.win_rate.toFixed(1)}%`}
                        positive={result.win_rate >= 50}
                        sub={`${result.total_trades} trades`} />
                      <MetricCard label="Max Drawdown" icon={ArrowDownRight}
                        value={`-${result.max_drawdown.toFixed(2)}%`}
                        positive={false}
                        sub={`${result.max_drawdown_duration}d duration`} />
                    </div>

                    {/* Secondary metrics */}
                    <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
                      <MetricCard label="Sortino" value={result.sortino_ratio.toFixed(2)} positive={result.sortino_ratio >= 1} />
                      <MetricCard label="Calmar" value={result.calmar_ratio.toFixed(2)} positive={result.calmar_ratio >= 1} />
                      <MetricCard label="Profit Factor" value={result.profit_factor.toFixed(2)} positive={result.profit_factor >= 1.5} />
                      <MetricCard label="Expectancy" value={`$${result.expectancy.toFixed(0)}`} positive={result.expectancy > 0} />
                      <MetricCard label="Avg Duration" value={`${result.avg_trade_duration.toFixed(0)}d`} icon={Timer} />
                      <MetricCard label="Commission" value={`$${result.total_commission.toFixed(0)}`} sub={`${(result.commission_rate * 100).toFixed(2)}%`} />
                    </div>

                    {/* Walk-forward badge */}
                    {result.walk_forward?.enabled && (
                      <div className="flex items-center gap-2 px-4 py-2 bg-violet-500/10 border border-violet-500/20 rounded-lg">
                        <Layers className="w-3.5 h-3.5 text-violet-400" />
                        <span className="text-xs font-bold text-violet-300">Walk-Forward Mode</span>
                        <span className="text-[10px] text-violet-400/70 font-mono ml-1">
                          Train: {result.walk_forward.train_bars} bars / Test: {result.walk_forward.test_bars} bars
                        </span>
                      </div>
                    )}

                    {/* Equity curve */}
                    <Section title="Equity Curve" icon={TrendingUp} right={`${result.equity_curve.length} points`}>
                      <div className="p-2">
                        <SVGChart
                          data={result.equity_curve}
                          height={180}
                          color={result.total_return >= 0 ? '#10b981' : '#ef4444'}
                          label="equity"
                        />
                      </div>
                    </Section>

                    {/* Drawdown chart */}
                    <Section title="Drawdown" icon={ArrowDownRight} right={`Max: -${result.max_drawdown.toFixed(2)}%`}>
                      <div className="p-2">
                        <SVGChart
                          data={result.drawdown_curve}
                          height={120}
                          color="#ef4444"
                          label="drawdown"
                          showZeroLine
                        />
                      </div>
                    </Section>

                    {/* Rolling Sharpe */}
                    {result.rolling_sharpe.length > 5 && (
                      <Section title="Rolling Sharpe (63-day)" icon={BarChart3}>
                        <div className="p-2">
                          <SVGChart
                            data={result.rolling_sharpe}
                            height={100}
                            color="#8b5cf6"
                            label="sharpe"
                            showZeroLine
                          />
                        </div>
                      </Section>
                    )}

                    {/* Monthly returns heatmap */}
                    {result.monthly_returns.length > 0 && (
                      <Section title="Monthly Returns" icon={Percent}>
                        <MonthlyHeatmap data={result.monthly_returns} />
                      </Section>
                    )}

                    {/* Monte Carlo */}
                    {result.monte_carlo && (
                      <Section title="Monte Carlo Validation" icon={Shuffle} right={`${result.monte_carlo.n_simulations} sims`}>
                        <MCDistribution mc={result.monte_carlo} />
                      </Section>
                    )}

                    {/* Trade log */}
                    <Section title="Trade History" icon={Clock} right={`${Math.min(30, result.trades.length)} of ${result.trades.length}`}>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-slate-800/50">
                              {['#', 'Entry', 'Entry $', 'Exit', 'Exit $', 'Qty', 'P&L', 'Return', 'Reason', 'Days'].map(h => (
                                <th key={h} className="px-3 py-2.5 text-left text-[9px] font-bold uppercase tracking-wider text-slate-600">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/30">
                            {result.trades.slice(0, 30).map((trade, idx) => {
                              const pnl = trade.pnl || 0
                              const ret = trade.return_pct || 0
                              return (
                                <tr key={idx} className="hover:bg-slate-800/20 transition-colors">
                                  <td className="px-3 py-2 text-slate-600 font-mono">{idx + 1}</td>
                                  <td className="px-3 py-2 text-slate-400 font-mono">{trade.entry_date ? new Date(trade.entry_date).toLocaleDateString() : '-'}</td>
                                  <td className="px-3 py-2 text-white font-mono">${trade.entry_price.toFixed(2)}</td>
                                  <td className="px-3 py-2 text-slate-400 font-mono">{trade.exit_date ? new Date(trade.exit_date).toLocaleDateString() : '-'}</td>
                                  <td className="px-3 py-2 text-white font-mono">{trade.exit_price ? `$${trade.exit_price.toFixed(2)}` : '-'}</td>
                                  <td className="px-3 py-2 text-slate-300 font-mono">{trade.quantity}</td>
                                  <td className={`px-3 py-2 font-mono font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                                  </td>
                                  <td className={`px-3 py-2 font-mono font-bold ${ret >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {ret >= 0 ? '+' : ''}{ret.toFixed(2)}%
                                  </td>
                                  <td className="px-3 py-2">
                                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${
                                      trade.exit_reason === 'take_profit' ? 'bg-emerald-500/15 text-emerald-400' :
                                      trade.exit_reason === 'stop_loss' ? 'bg-red-500/15 text-red-400' :
                                      trade.exit_reason === 'trailing_stop' ? 'bg-amber-500/15 text-amber-400' :
                                      'bg-slate-700/50 text-slate-400'
                                    }`}>
                                      {trade.exit_reason.replace('_', ' ')}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-slate-500 font-mono">{trade.bars_held}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </Section>

                    {/* Disclaimer */}
                    <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/15 flex items-start gap-2.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500/60 shrink-0 mt-0.5" />
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        Backtest results are illustrative. Past performance does not guarantee future results.
                        Commission ({(result.commission_rate * 100).toFixed(2)}%) and slippage ({(result.slippage_rate * 100).toFixed(2)}%) are modeled.
                        Use for research purposes only.
                      </p>
                    </div>

                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}

/* ── Mobile version ─────────────────────────────────────────────────── */

function MobileBacktestPage() {
  const [symbol, setSymbol] = useState('AAPL')
  const [strategy, setStrategy] = useState('rsi_ma_crossover')
  const [startDate, setStartDate] = useState('2023-01-01')
  const [endDate, setEndDate] = useState('2024-06-01')
  const [initialCapital, setInitialCapital] = useState(100000)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const handleCancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setLoading(false)
  }, [])

  const handleRun = async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true); setError(null); setResult(null)
    try {
      const req: BacktestRequest = {
        symbol: symbol.toUpperCase(),
        start_date: startDate + 'T00:00:00',
        end_date: endDate + 'T23:59:59',
        strategy, initial_capital: initialCapital, monte_carlo: true,
      }
      setResult(await runBacktest(req, controller.signal))
    } catch (err: any) {
      if (!controller.signal.aborted) {
        setError(err.message || 'Failed')
      }
    }
    finally { setLoading(false) }
  }

  return (
    <MobileLayout>
      <div className="min-h-screen bg-[#0A0E1A] px-4 py-4 pb-24 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <h1 className="text-base font-black text-white">Backtester</h1>
          <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-cyan-500/15 text-cyan-400 border border-cyan-500/25">PRO</span>
        </div>

        {/* Config */}
        <div className="bg-[#0F1629]/80 border border-slate-800/60 rounded-xl p-4 space-y-3">
          <input type="text" value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} placeholder="Symbol"
            className="w-full px-3 py-2.5 bg-[#0A0E1A] border border-slate-700/50 rounded-lg text-white text-sm font-mono placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/50" />
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="px-2 py-2 bg-[#0A0E1A] border border-slate-700/50 rounded-lg text-white text-xs font-mono focus:outline-none" />
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              className="px-2 py-2 bg-[#0A0E1A] border border-slate-700/50 rounded-lg text-white text-xs font-mono focus:outline-none" />
          </div>
          <input type="number" value={initialCapital} onChange={e => setInitialCapital(Number(e.target.value))}
            className="w-full px-3 py-2.5 bg-[#0A0E1A] border border-slate-700/50 rounded-lg text-white text-sm font-mono focus:outline-none" />
          <select value={strategy} onChange={e => setStrategy(e.target.value)}
            className="w-full px-3 py-2.5 bg-[#0A0E1A] border border-slate-700/50 rounded-lg text-white text-xs font-mono focus:outline-none appearance-none">
            {STRATEGIES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {loading ? (
          <button onClick={handleCancel}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-slate-700 to-slate-600 text-white font-black text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Cancel
          </button>
        ) : (
          <button onClick={handleRun} disabled={!symbol}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-black text-sm disabled:opacity-50">
            <Play className="w-4 h-4" /> Run Backtest
          </button>
        )}

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/25 rounded-xl text-red-400 flex items-center gap-2 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={handleRun}
              className="shrink-0 px-2.5 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 text-[10px] font-bold transition-colors">
              Retry
            </button>
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <MetricCard label="Return" value={`${result.total_return >= 0 ? '+' : ''}${result.total_return.toFixed(1)}%`} positive={result.total_return >= 0} />
              <MetricCard label="Sharpe" value={result.sharpe_ratio.toFixed(2)} positive={result.sharpe_ratio >= 1} />
              <MetricCard label="Win Rate" value={`${result.win_rate.toFixed(0)}%`} positive={result.win_rate >= 50} />
              <MetricCard label="Max DD" value={`-${result.max_drawdown.toFixed(1)}%`} positive={false} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <MetricCard label="Trades" value={String(result.total_trades)} />
              <MetricCard label="Sortino" value={result.sortino_ratio.toFixed(2)} positive={result.sortino_ratio >= 1} />
              <MetricCard label="PF" value={result.profit_factor.toFixed(2)} positive={result.profit_factor >= 1.5} />
            </div>

            <div className="bg-[#0F1629]/80 border border-slate-800/60 rounded-xl p-2">
              <SVGChart data={result.equity_curve} height={140} color={result.total_return >= 0 ? '#10b981' : '#ef4444'} label="equity" />
            </div>

            {result.monte_carlo && (
              <div className="bg-[#0F1629]/80 border border-slate-800/60 rounded-xl">
                <div className="px-4 py-2 border-b border-slate-800/40 flex items-center gap-2">
                  <Shuffle className="w-3 h-3 text-slate-500" />
                  <span className="text-xs font-bold text-white">Monte Carlo</span>
                </div>
                <div className="grid grid-cols-2 gap-2 p-3">
                  <div className="text-center">
                    <div className="text-[9px] text-slate-500 uppercase font-semibold">P(Profit)</div>
                    <div className="text-base font-black font-mono text-emerald-400">{result.monte_carlo.probability_of_profit}%</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[9px] text-slate-500 uppercase font-semibold">Median</div>
                    <div className={`text-base font-black font-mono ${result.monte_carlo.median_return >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {result.monte_carlo.median_return >= 0 ? '+' : ''}{result.monte_carlo.median_return}%
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/15 flex items-start gap-2">
              <AlertTriangle className="w-3 h-3 text-amber-500/60 shrink-0 mt-0.5" />
              <p className="text-[9px] text-slate-500 leading-relaxed">Past performance does not guarantee future results.</p>
            </div>
          </div>
        )}
      </div>
    </MobileLayout>
  )
}

/* ── Entry point ────────────────────────────────────────────────────── */

export default function BacktestPage() {
  const { isAuthenticated, isLoading } = useAuth()
  if (isLoading) return null
  if (!isAuthenticated) {
    return (
      <AppLayout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center max-w-md px-4">
            <h2 className="text-xl font-bold text-white mb-2">Sign in required</h2>
            <p className="text-slate-400 text-sm mb-4">Backtesting is available for signed-in users only.</p>
            <Link href="/auth" className="inline-flex items-center px-5 py-2.5 rounded-xl bg-cyan-500 text-slate-950 font-semibold">
              Go to Sign In
            </Link>
          </div>
        </div>
      </AppLayout>
    )
  }
  return (
    <>
      <div className="hidden md:block"><DesktopBacktestPage /></div>
      <div className="md:hidden"><MobileBacktestPage /></div>
    </>
  )
}
