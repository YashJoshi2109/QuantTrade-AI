'use client'

/**
 * QuantTrade AI — Pro-Level Strategy Backtester
 * Premium tabbed interface: Strategy Builder → Results → Trade Journal → Compare → Scanner → Risk
 */

import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import AppLayout from '@/components/AppLayout'
import { motion, AnimatePresence } from 'framer-motion'
import MobileLayout from '@/components/layout/MobileLayout'
import { runBacktest, BacktestResult, BacktestRequest, getBacktestDateRange, type BacktestDateRange } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import ResultsDashboard from '@/components/backtest/ResultsDashboard'
import TradeJournal from '@/components/backtest/TradeJournal'
import ComparisonView from '@/components/backtest/ComparisonView'
import MarketScanner from '@/components/backtest/MarketScanner'
import RiskManager from '@/components/backtest/RiskManager'
import BacktestDataFlowLoader from '@/components/backtest/BacktestDataFlowLoader'
import {
  Play, Activity, Target, AlertTriangle, Loader2, TrendingUp,
  BarChart3, Zap, ChevronDown, ChevronRight,
  Clock, Settings, Shield, SlidersHorizontal,
  GitCompare, Radar, ShieldAlert, BookOpen,
  Sparkles, ArrowRight, Check, X as XIcon,
} from 'lucide-react'
import MobileSymbolSearch from '@/components/ui/mobile-symbol-search'
import type { LucideIcon } from 'lucide-react'

/* ── Strategy definitions ───────────────────────────────────────────── */

const STRATEGIES = [
  {
    id: 'rsi_ma_crossover', name: 'RSI + MA Crossover', badge: 'Momentum',
    desc: 'Buy when RSI < oversold and price above fast MA; sell when RSI > overbought.',
    color: 'cyan',
    params: [
      { key: 'rsi_period', label: 'RSI Period', min: 5, max: 50, step: 1, default: 14 },
      { key: 'rsi_oversold', label: 'Oversold', min: 10, max: 50, step: 1, default: 40 },
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
  { value: 'fixed', label: 'Fixed (95% of capital)', desc: 'Simple allocation' },
  { value: 'kelly', label: 'Kelly Criterion', desc: 'Half-Kelly, capped at 25%' },
  { value: 'volatility', label: 'Volatility-Based', desc: 'Risk-adjusted sizing' },
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

const GLOW_COLORS: Record<string, string> = {
  cyan: 'shadow-cyan-500/20', violet: 'shadow-violet-500/20', amber: 'shadow-amber-500/20',
  emerald: 'shadow-emerald-500/20', rose: 'shadow-rose-500/20', sky: 'shadow-sky-500/20',
  orange: 'shadow-orange-500/20', fuchsia: 'shadow-fuchsia-500/20',
}

/* ── Tab definitions ───────────────────────────────────────────────── */

type TabId = 'builder' | 'results' | 'journal' | 'compare' | 'scanner' | 'risk'

const TABS: { id: TabId; label: string; icon: LucideIcon; desc: string }[] = [
  { id: 'builder', label: 'Strategy', icon: Zap, desc: 'Configure & Run' },
  { id: 'results', label: 'Results', icon: BarChart3, desc: 'Analytics' },
  { id: 'journal', label: 'Journal', icon: BookOpen, desc: 'Trade Log' },
  { id: 'compare', label: 'Compare', icon: GitCompare, desc: 'Multi-Strategy' },
  { id: 'scanner', label: 'Scanner', icon: Radar, desc: 'Market Scan' },
  { id: 'risk', label: 'Risk', icon: ShieldAlert, desc: 'Risk Manager' },
]

/* ── Premium Slider Input ──────────────────────────────────────────── */

function ParamSlider({ label, value, min, max, step, onChange, color = 'cyan' }: {
  label: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void; color?: string
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="group">
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold group-hover:text-slate-400 transition-colors">{label}</label>
        <span className="text-xs font-mono text-cyan-400 font-bold bg-cyan-500/10 px-1.5 py-0.5 rounded">{value}</span>
      </div>
      <div className="relative">
        <div className="absolute inset-0 h-1.5 rounded-full bg-slate-800 top-1/2 -translate-y-1/2" />
        <div
          className="absolute h-1.5 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 top-1/2 -translate-y-1/2"
          style={{ width: `${pct}%` }}
        />
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          className="relative w-full h-6 appearance-none bg-transparent cursor-pointer z-10
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-400
            [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#0A0E1A]
            [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-cyan-500/30
            [&::-webkit-slider-thumb]:hover:scale-125 [&::-webkit-slider-thumb]:transition-transform"
        />
      </div>
    </div>
  )
}

/* ── Glass Section wrapper ─────────────────────────────────────────── */

function GlassSection({ title, icon: Icon, right, children, className = '' }: {
  title: string; icon?: LucideIcon; right?: React.ReactNode; children: React.ReactNode; className?: string
}) {
  return (
    <div className={`bg-[#0F1629]/60 backdrop-blur-xl border border-slate-800/40 rounded-2xl overflow-hidden ${className}`}>
      <div className="px-5 py-3.5 border-b border-slate-800/30 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {Icon && <Icon className="w-4 h-4 text-slate-500" />}
          <span className="text-sm font-bold text-white tracking-tight">{title}</span>
        </div>
        {right && <div className="text-[10px] text-slate-500 font-mono">{right}</div>}
      </div>
      {children}
    </div>
  )
}

/* ── Main Desktop Page ──────────────────────────────────────────────── */

function DesktopBacktestPage() {
  /* ── Form state ── */
  const [symbol, setSymbol] = useState('AAPL')
  const [strategy, setStrategy] = useState('rsi_ma_crossover')
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 2); return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])
  const [initialCapital, setInitialCapital] = useState(100000)
  const [positionSizing, setPositionSizing] = useState('fixed')
  const [commissionRate, setCommissionRate] = useState(0.001)
  const [slippageRate, setSlippageRate] = useState(0.0005)
  const [stopLoss, setStopLoss] = useState<number | null>(null)
  const [takeProfit, setTakeProfit] = useState<number | null>(null)
  const [trailingStop, setTrailingStop] = useState<number | null>(null)
  const [maxPyramiding, setMaxPyramiding] = useState(1)
  const [walkForward, setWalkForward] = useState(false)
  const [monteCarlo, setMonteCarlo] = useState(true)
  const [benchmark, setBenchmark] = useState('SPY')

  /* ── UI state ── */
  const [activeTab, setActiveTab] = useState<TabId>('builder')
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

  /* ── Symbol search autocomplete ── */
  const [symbolQuery, setSymbolQuery] = useState('')
  const [suggestions, setSuggestions] = useState<{ symbol: string; name: string; exchange?: string }[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const suggestRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (symbolQuery.length < 2) { setSuggestions([]); return }
    const timer = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
        const res = await fetch(`${API_URL}/api/v1/backtest/symbols?q=${encodeURIComponent(symbolQuery)}&limit=10`)
        if (res.ok) {
          const data = await res.json()
          setSuggestions((data.results || []).map((r: any) => ({
            symbol: r.symbol, name: r.name || '', exchange: r.exchange || r.source || ''
          })))
          setShowSuggestions(true)
        }
      } catch { setSuggestions([]) }
      setSearchLoading(false)
    }, 150)
    return () => clearTimeout(timer)
  }, [symbolQuery])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (suggestRef.current && !suggestRef.current.contains(e.target as Node)) setShowSuggestions(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSymbolInput = (val: string) => {
    const upper = val.toUpperCase()
    setSymbol(upper)
    setSymbolQuery(upper)
  }

  /* ── Date range for selected symbol ── */
  const [dateRange, setDateRange] = useState<BacktestDateRange | null>(null)
  const [dateRangeLoading, setDateRangeLoading] = useState(false)

  // Fetch available date range whenever symbol changes
  useEffect(() => {
    if (!symbol || symbol.length < 1) { setDateRange(null); return }
    let cancelled = false
    const timer = setTimeout(async () => {
      setDateRangeLoading(true)
      try {
        const range = await getBacktestDateRange(symbol)
        if (!cancelled) {
          setDateRange(range)
          // Auto-adjust dates to fit available range
          if (range.available && range.min_date && range.max_date) {
            // Default to last 2 years of available data, or full range if less
            const maxDate = range.max_date
            const twoYearsBack = new Date(new Date(maxDate).getTime() - 2 * 365 * 86400000)
              .toISOString().split('T')[0]
            const effectiveStart = twoYearsBack > range.min_date ? twoYearsBack : range.min_date
            setStartDate(prev => {
              if (prev < range.min_date!) return effectiveStart
              if (prev > range.max_date!) return effectiveStart
              return prev
            })
            setEndDate(prev => {
              if (prev > range.max_date!) return maxDate
              if (prev < range.min_date!) return maxDate
              return prev
            })
          }
        }
      } catch { if (!cancelled) setDateRange(null) }
      if (!cancelled) setDateRangeLoading(false)
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [symbol])

  const handleSelectSymbol = (sym: string) => {
    setSymbol(sym)
    setSymbolQuery('')
    setSuggestions([])
    setShowSuggestions(false)
  }

  const handleStrategyChange = useCallback((id: string) => {
    setStrategy(id)
    const s = STRATEGIES.find(st => st.id === id)!
    const p: Record<string, number> = {}
    s.params.forEach(sp => { p[sp.key] = sp.default })
    setStratParams(p)
  }, [])

  const handleCancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    setLoading(false)
    setElapsedSec(0)
  }, [])

  const handleRunBacktest = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    setResult(null)
    setElapsedSec(0)

    const startTime = Date.now()
    timerRef.current = setInterval(() => setElapsedSec(Math.floor((Date.now() - startTime) / 1000)), 1000)

    // Minimum animation duration so the pipeline visualization is always visible
    const MIN_ANIMATION_MS = 4000
    const animationFloor = new Promise(r => setTimeout(r, MIN_ANIMATION_MS))

    try {
      const req: BacktestRequest = {
        symbol: symbol.toUpperCase(),
        start_date: startDate + 'T00:00:00',
        end_date: endDate + 'T23:59:59',
        strategy,
        initial_capital: initialCapital,
        strategy_params: stratParams,
        position_sizing: positionSizing,
        commission_rate: commissionRate,
        slippage_rate: slippageRate,
        stop_loss_pct: stopLoss,
        take_profit_pct: takeProfit,
        trailing_stop_pct: trailingStop,
        max_pyramiding: maxPyramiding,
        walk_forward: walkForward,
        monte_carlo: monteCarlo,
        benchmark,
      }
      // Run backtest + wait for minimum animation time in parallel
      const [res] = await Promise.all([runBacktest(req, controller.signal), animationFloor])

      // Validate results — zero trades / zero return with no equity movement = empty result
      const hasNoTrades = !res.total_trades || res.total_trades === 0
      const hasNoReturn = res.total_return === 0 && res.sharpe_ratio === 0 && res.win_rate === 0
      const hasNoEquity = !res.equity_curve || res.equity_curve.length <= 1

      if (hasNoTrades && hasNoReturn) {
        setError(
          hasNoEquity
            ? `No trades generated for ${symbol.toUpperCase()} with ${STRATEGIES.find(s => s.id === strategy)?.name ?? strategy}. Try a different date range, strategy, or check that market data is available.`
            : `Strategy produced 0 trades — parameters may be too restrictive or insufficient data for ${symbol.toUpperCase()} in the selected period.`
        )
      } else {
        setResult(res)
        setActiveTab('results')
      }
    } catch (err: any) {
      // Still wait for animation floor so error state shows properly
      const elapsed = Date.now() - startTime
      if (elapsed < MIN_ANIMATION_MS) {
        await new Promise(r => setTimeout(r, MIN_ANIMATION_MS - elapsed))
      }
      if (!controller.signal.aborted) {
        setError(err.message || 'Failed to run backtest')
      }
    } finally {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
      setLoading(false)
      setElapsedSec(0)
    }
  }, [symbol, startDate, endDate, strategy, initialCapital, stratParams, positionSizing, commissionRate, slippageRate, stopLoss, takeProfit, trailingStop, maxPyramiding, walkForward, monteCarlo, benchmark])

  const currentStrat = STRATEGIES.find(s => s.id === strategy)!

  /* ── Keyboard shortcut ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'r' && !e.metaKey && !e.ctrlKey && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLSelectElement)) {
        e.preventDefault()
        if (!loading) handleRunBacktest()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [loading, handleRunBacktest])

  return (
    <AppLayout>
      <div className="min-h-screen bg-[#0A0E1A] -mx-4 md:-mx-6 -my-4 md:-my-6">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-5">

          {/* ── Premium Header ── */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/20 flex items-center justify-center shrink-0">
                <Image src="/logo.png" alt="QuantTrade AI" width={36} height={36} className="object-contain" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-base sm:text-lg font-black text-white tracking-tight truncate">Strategy Backtester</h1>
                  <span className="px-2 py-0.5 rounded-md text-[9px] font-black bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-400 border border-cyan-500/25 uppercase tracking-wider shrink-0">Pro</span>
                </div>
                <p className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">
                  8 strategies · Monte Carlo · Walk-forward · Alpha/Beta · VaR · MAE/MFE
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {result && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[10px] font-bold text-emerald-400">
                    {result.symbol} · {result.total_return >= 0 ? '+' : ''}{result.total_return.toFixed(1)}%
                  </span>
                </motion.div>
              )}
              <div className="text-[9px] text-slate-600 font-mono hidden lg:block">
                Press <kbd className="px-1 py-0.5 rounded bg-slate-800 text-slate-400 font-bold">R</kbd> to run
              </div>
            </div>
          </div>

          {/* ── Premium Tab Navigation ── */}
          <div className="flex items-center gap-1 mb-4 sm:mb-5 bg-[#0F1629]/40 backdrop-blur-xl border border-slate-800/30 rounded-2xl p-1 sm:p-1.5 overflow-x-auto scrollbar-none" style={{ WebkitOverflowScrolling: 'touch' }}>
            {TABS.map(tab => {
              const isActive = activeTab === tab.id
              const isDisabled = (tab.id === 'results' || tab.id === 'journal' || tab.id === 'risk') && !result
              return (
                <button
                  key={tab.id}
                  onClick={() => !isDisabled && setActiveTab(tab.id)}
                  disabled={isDisabled}
                  className={`relative flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0
                    ${isActive
                      ? 'bg-gradient-to-r from-cyan-500/15 to-blue-500/10 text-white shadow-lg shadow-cyan-500/5 border border-cyan-500/20'
                      : isDisabled
                        ? 'text-slate-700 cursor-not-allowed'
                        : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/30'
                    }`}
                >
                  <tab.icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-cyan-400' : ''}`} />
                  <span>{tab.label}</span>
                  <span className={`text-[8px] font-mono hidden sm:inline ${isActive ? 'text-cyan-400/60' : 'text-slate-600'}`}>{tab.desc}</span>
                  {isActive && (
                    <motion.div
                      layoutId="activeTab"
                      className="absolute inset-0 rounded-xl bg-gradient-to-r from-cyan-500/10 to-blue-500/5 border border-cyan-500/15"
                      style={{ zIndex: -1 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    />
                  )}
                </button>
              )
            })}
          </div>

          {/* ── Error Banner (non-builder tabs only — builder shows error in DataFlowLoader) ── */}
          <AnimatePresence>
            {error && activeTab !== 'builder' && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="mb-4 p-4 bg-red-500/8 backdrop-blur-xl border border-red-500/20 rounded-2xl text-red-400 flex items-center gap-3"
              >
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="text-sm flex-1 font-medium">{error}</span>
                <button onClick={handleRunBacktest}
                  className="shrink-0 px-4 py-1.5 rounded-xl bg-red-500/15 hover:bg-red-500/25 text-red-300 text-xs font-bold transition-all hover:scale-105">
                  Retry
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Tab Content ── */}
          <AnimatePresence mode="wait">
            {/* ══════ BUILDER TAB ══════ */}
            {activeTab === 'builder' && (
              <motion.div
                key="builder"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2 }}
                className="grid grid-cols-1 lg:grid-cols-12 gap-5"
              >
                {/* Left: Config */}
                <div className="lg:col-span-5 xl:col-span-4 space-y-4">

                  {/* Symbol & Dates */}
                  <GlassSection title="Configuration" icon={Settings}>
                    <div className="p-4 space-y-3">
                      <div ref={suggestRef} className="relative">
                        <label className="block text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1.5">Symbol</label>
                        <div className="relative">
                          <input
                            type="text" value={symbol}
                            onChange={e => handleSymbolInput(e.target.value)}
                            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                            placeholder="AAPL, TSLA, BTC-USD..."
                            className="w-full px-4 py-2.5 bg-[#0A0E1A]/80 border border-slate-700/40 rounded-xl text-white text-sm font-mono placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/30 transition-all"
                          />
                          {searchLoading ? (
                            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-cyan-400 animate-spin" />
                          ) : (
                            <Sparkles className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600" />
                          )}
                        </div>
                        <p className="text-[9px] text-slate-600 mt-1 font-mono">Type 2+ chars · 300+ US stocks, ETFs, Crypto, Forex</p>
                        <AnimatePresence>
                          {showSuggestions && suggestions.length > 0 && (
                            <motion.div
                              initial={{ opacity: 0, y: -4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }}
                              className="absolute z-50 left-0 right-0 mt-1 bg-[#0F1629] border border-slate-700/50 rounded-xl shadow-2xl shadow-black/40 overflow-hidden max-h-64 overflow-y-auto"
                            >
                              {suggestions.map((s, i) => (
                                <button
                                  key={s.symbol}
                                  onClick={() => handleSelectSymbol(s.symbol)}
                                  className={`w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-cyan-500/10 transition-colors ${i > 0 ? 'border-t border-slate-800/30' : ''}`}
                                >
                                  <span className="text-xs font-bold text-cyan-400 font-mono w-14 shrink-0">{s.symbol}</span>
                                  <span className="text-xs text-slate-400 truncate flex-1">{s.name}</span>
                                  {s.exchange && <span className="text-[9px] text-slate-600 font-mono shrink-0">{s.exchange}</span>}
                                </button>
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1.5">Start</label>
                          <input type="date" value={startDate}
                            onChange={e => setStartDate(e.target.value)}
                            min={dateRange?.available ? dateRange.min_date : undefined}
                            max={endDate || (dateRange?.available ? dateRange.max_date : undefined)}
                            className="w-full px-3 py-2.5 bg-[#0A0E1A]/80 border border-slate-700/40 rounded-xl text-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500/30 transition-all [color-scheme:dark]" />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1.5">End</label>
                          <input type="date" value={endDate}
                            onChange={e => setEndDate(e.target.value)}
                            min={startDate || (dateRange?.available ? dateRange.min_date : undefined)}
                            max={dateRange?.available ? dateRange.max_date : undefined}
                            className="w-full px-3 py-2.5 bg-[#0A0E1A]/80 border border-slate-700/40 rounded-xl text-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500/30 transition-all [color-scheme:dark]" />
                        </div>
                      </div>
                      {/* Date range availability indicator */}
                      {dateRangeLoading ? (
                        <div className="flex items-center gap-1.5 text-[9px] text-slate-600 font-mono">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" /> Checking data availability...
                        </div>
                      ) : dateRange?.available ? (
                        <div className="flex items-center gap-1.5 text-[9px] font-mono">
                          <Check className="w-2.5 h-2.5 text-emerald-400" />
                          <span className="text-emerald-400/80">Data available</span>
                          <span className="text-slate-600">{dateRange.min_date} → {dateRange.max_date}</span>
                          <span className="text-slate-700">·</span>
                          <span className="text-slate-600">{dateRange.total_bars} bars</span>
                        </div>
                      ) : dateRange && !dateRange.available ? (
                        <div className="flex items-center gap-1.5 text-[9px] font-mono">
                          <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
                          <span className="text-amber-400/80">No data found for {symbol}</span>
                        </div>
                      ) : null}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1.5">Initial Capital</label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-mono">$</span>
                            <input type="number" value={initialCapital}
                              onChange={e => setInitialCapital(Number(e.target.value))}
                              className="w-full pl-7 pr-3 py-2.5 bg-[#0A0E1A]/80 border border-slate-700/40 rounded-xl text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500/30 transition-all" />
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1.5">Benchmark</label>
                          <input type="text" value={benchmark}
                            onChange={e => setBenchmark(e.target.value.toUpperCase())}
                            className="w-full px-3 py-2.5 bg-[#0A0E1A]/80 border border-slate-700/40 rounded-xl text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500/30 transition-all" />
                        </div>
                      </div>
                    </div>
                  </GlassSection>

                  {/* Strategy selector */}
                  <GlassSection title="Strategy" icon={Zap}>
                    <div className="p-3 space-y-1.5 max-h-[340px] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-800">
                      {STRATEGIES.map(s => {
                        const isSelected = strategy === s.id
                        return (
                          <motion.button
                            key={s.id}
                            onClick={() => handleStrategyChange(s.id)}
                            whileHover={{ scale: 1.01 }}
                            whileTap={{ scale: 0.99 }}
                            className={`w-full text-left p-3 rounded-xl border transition-all ${
                              isSelected
                                ? `bg-slate-800/50 border-slate-700/60 shadow-lg ${GLOW_COLORS[s.color]}`
                                : 'bg-transparent border-transparent hover:border-slate-800/40 hover:bg-slate-800/20'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full transition-all ${isSelected ? 'bg-cyan-400 shadow-lg shadow-cyan-500/50' : 'bg-slate-700'}`} />
                              <span className={`text-xs font-bold ${isSelected ? 'text-white' : 'text-slate-400'}`}>{s.name}</span>
                              <span className={`ml-auto px-2 py-0.5 rounded-md text-[8px] font-bold border ${BADGE_COLORS[s.color]}`}>{s.badge}</span>
                            </div>
                            <AnimatePresence>
                              {isSelected && (
                                <motion.p
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: 'auto' }}
                                  exit={{ opacity: 0, height: 0 }}
                                  className="text-[10px] text-slate-500 mt-1.5 ml-4 leading-relaxed"
                                >
                                  {s.desc}
                                </motion.p>
                              )}
                            </AnimatePresence>
                          </motion.button>
                        )
                      })}
                    </div>
                  </GlassSection>

                  {/* Strategy parameters */}
                  <GlassSection title="Parameters" icon={SlidersHorizontal}>
                    <div className="p-4 space-y-5">
                      {currentStrat.params.map(p => (
                        <ParamSlider key={p.key} label={p.label} value={stratParams[p.key] ?? p.default}
                          min={p.min} max={p.max} step={p.step}
                          onChange={v => setStratParams(prev => ({ ...prev, [p.key]: v }))} />
                      ))}
                    </div>
                  </GlassSection>

                  {/* Risk Management (advanced toggle) */}
                  <div className="bg-[#0F1629]/60 backdrop-blur-xl border border-slate-800/40 rounded-2xl overflow-hidden">
                    <button onClick={() => setShowAdvanced(!showAdvanced)}
                      className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-slate-800/15 transition-colors">
                      <div className="flex items-center gap-2.5">
                        <Shield className="w-4 h-4 text-slate-500" />
                        <span className="text-sm font-bold text-white">Risk Management</span>
                        {(stopLoss || takeProfit || trailingStop) && (
                          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                        )}
                      </div>
                      <motion.div animate={{ rotate: showAdvanced ? 180 : 0 }} transition={{ duration: 0.2 }}>
                        <ChevronDown className="w-4 h-4 text-slate-500" />
                      </motion.div>
                    </button>
                    <AnimatePresence>
                      {showAdvanced && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="p-4 pt-0 space-y-3 border-t border-slate-800/30">
                            <div className="pt-3">
                              <label className="block text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1.5">Position Sizing</label>
                              <div className="space-y-1.5">
                                {POSITION_SIZING_OPTIONS.map(o => (
                                  <button key={o.value} onClick={() => setPositionSizing(o.value)}
                                    className={`w-full text-left px-3 py-2 rounded-lg border transition-all ${
                                      positionSizing === o.value
                                        ? 'bg-cyan-500/10 border-cyan-500/20 text-white'
                                        : 'border-transparent text-slate-400 hover:bg-slate-800/30'
                                    }`}>
                                    <div className="flex items-center gap-2">
                                      <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                                        positionSizing === o.value ? 'border-cyan-400' : 'border-slate-600'
                                      }`}>
                                        {positionSizing === o.value && <div className="w-1.5 h-1.5 rounded-full bg-cyan-400" />}
                                      </div>
                                      <span className="text-xs font-bold">{o.label}</span>
                                    </div>
                                    <p className="text-[9px] text-slate-600 ml-5 mt-0.5">{o.desc}</p>
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              {[
                                { label: 'Stop Loss %', value: stopLoss, setter: setStopLoss },
                                { label: 'Take Profit %', value: takeProfit, setter: setTakeProfit },
                                { label: 'Trailing Stop %', value: trailingStop, setter: setTrailingStop },
                                { label: 'Commission %', value: commissionRate * 100, setter: (v: number | null) => setCommissionRate((v ?? 0.1) / 100) },
                              ].map(({ label, value, setter }) => (
                                <div key={label}>
                                  <label className="block text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1.5">{label}</label>
                                  <input type="number" step="0.5"
                                    placeholder={label.includes('Commission') ? '0.10' : 'None'}
                                    value={value ?? ''}
                                    onChange={e => {
                                      const v = e.target.value ? Number(e.target.value) : null
                                      setter(v)
                                    }}
                                    className="w-full px-3 py-2 bg-[#0A0E1A]/80 border border-slate-700/40 rounded-xl text-white text-xs font-mono placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 transition-all" />
                                </div>
                              ))}
                            </div>
                            <div className="grid grid-cols-2 gap-3 pt-1">
                              <div>
                                <label className="block text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1.5">Max Pyramiding</label>
                                <input type="number" min={1} max={10} value={maxPyramiding}
                                  onChange={e => setMaxPyramiding(Number(e.target.value))}
                                  className="w-full px-3 py-2 bg-[#0A0E1A]/80 border border-slate-700/40 rounded-xl text-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500/30 transition-all" />
                              </div>
                              <div className="flex flex-col justify-end gap-2">
                                {[
                                  { label: 'Walk-Forward', checked: walkForward, setter: setWalkForward },
                                  { label: 'Monte Carlo', checked: monteCarlo, setter: setMonteCarlo },
                                ].map(({ label, checked, setter }) => (
                                  <label key={label} className="flex items-center gap-2 cursor-pointer group">
                                    <div className={`w-4 h-4 rounded-md border-2 flex items-center justify-center transition-all ${
                                      checked ? 'bg-cyan-500 border-cyan-500' : 'border-slate-600 group-hover:border-slate-500'
                                    }`}>
                                      {checked && <Check className="w-2.5 h-2.5 text-white" />}
                                    </div>
                                    <span className="text-[10px] text-slate-400 font-semibold uppercase">{label}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Run button */}
                  {loading ? (
                    <motion.button
                      whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                      onClick={handleCancel}
                      className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-2xl bg-gradient-to-r from-slate-700 to-slate-600 text-white font-black text-sm shadow-xl transition-all"
                    >
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Running Simulation...</span>
                      {elapsedSec > 0 && <span className="font-mono text-slate-300">{elapsedSec}s</span>}
                      <span className="ml-auto text-[10px] text-slate-400 font-mono">Click to cancel</span>
                    </motion.button>
                  ) : (
                    <motion.button
                      whileHover={{ scale: 1.02, boxShadow: '0 0 40px rgba(6, 182, 212, 0.15)' }}
                      whileTap={{ scale: 0.98 }}
                      onClick={handleRunBacktest}
                      disabled={!symbol}
                      className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-2xl bg-gradient-to-r from-cyan-500 via-blue-500 to-cyan-600 text-white font-black text-sm shadow-xl shadow-cyan-500/20 hover:shadow-cyan-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed group"
                    >
                      <Play className="w-4 h-4 group-hover:scale-110 transition-transform" />
                      <span>Run Backtest</span>
                      <ArrowRight className="w-3.5 h-3.5 ml-1 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                    </motion.button>
                  )}
                </div>

                {/* Right: Preview / Empty State */}
                <div className="lg:col-span-7 xl:col-span-8">
                  {loading || error ? (
                    <BacktestDataFlowLoader
                      strategyName={currentStrat.name}
                      symbol={symbol}
                      monteCarlo={monteCarlo}
                      walkForward={walkForward}
                      elapsedSec={elapsedSec}
                      error={loading ? null : error}
                      onRetry={handleRunBacktest}
                      onDismissError={() => setError(null)}
                    />
                  ) : result ? (
                    <div className="bg-[#0F1629]/30 backdrop-blur-xl border border-slate-800/30 rounded-2xl p-5">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="text-sm font-black text-white">Last Result: {result.symbol}</h3>
                          <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                            {result.strategy.replace(/_/g, ' ')} · {result.total_trades} trades · {result.data_source || 'database'}
                          </p>
                        </div>
                        <button
                          onClick={() => setActiveTab('results')}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-bold hover:bg-cyan-500/20 transition-all"
                        >
                          View Full Results <ChevronRight className="w-3 h-3" />
                        </button>
                      </div>
                      {/* Quick metrics preview */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                          { label: 'Return', value: `${result.total_return >= 0 ? '+' : ''}${result.total_return.toFixed(1)}%`, positive: result.total_return >= 0 },
                          { label: 'Sharpe', value: result.sharpe_ratio.toFixed(2), positive: result.sharpe_ratio >= 1 },
                          { label: 'Win Rate', value: `${result.win_rate.toFixed(0)}%`, positive: result.win_rate >= 50 },
                          { label: 'Max DD', value: `-${result.max_drawdown.toFixed(1)}%`, positive: false },
                        ].map(m => (
                          <div key={m.label} className="bg-[#0A0E1A]/60 border border-slate-800/40 rounded-xl p-3">
                            <div className="text-[9px] text-slate-500 uppercase font-semibold tracking-wider">{m.label}</div>
                            <div className={`text-lg font-black font-mono tabular-nums mt-0.5 ${m.positive ? 'text-emerald-400' : 'text-red-400'}`}>{m.value}</div>
                          </div>
                        ))}
                      </div>
                      {/* Mini equity curve */}
                      {result.equity_curve.length > 2 && (
                        <div className="mt-3 h-32 relative">
                          <svg className="w-full h-full" viewBox="0 0 100 50" preserveAspectRatio="none">
                            <defs>
                              <linearGradient id="eq-grad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={result.total_return >= 0 ? '#10b981' : '#ef4444'} stopOpacity="0.3" />
                                <stop offset="100%" stopColor={result.total_return >= 0 ? '#10b981' : '#ef4444'} stopOpacity="0" />
                              </linearGradient>
                            </defs>
                            {(() => {
                              const data = result.equity_curve
                              const min = Math.min(...data)
                              const max = Math.max(...data)
                              const range = max - min || 1
                              const pts = data.map((v, i) => ({
                                x: (i / (data.length - 1)) * 100,
                                y: 2 + 46 - ((v - min) / range) * 46,
                              }))
                              const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
                              return (
                                <>
                                  <path d={`${d} L100,50 L0,50 Z`} fill="url(#eq-grad)" />
                                  <path d={d} fill="none" stroke={result.total_return >= 0 ? '#10b981' : '#ef4444'} strokeWidth="0.5" />
                                </>
                              )
                            })()}
                          </svg>
                          <div className="absolute bottom-2 right-3 text-xs font-black font-mono text-emerald-400">
                            ${result.final_equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-[600px] bg-[#0F1629]/20 backdrop-blur-xl border border-dashed border-slate-800/40 rounded-2xl">
                      <div className="text-center max-w-sm">
                        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700/50 flex items-center justify-center">
                          <BarChart3 className="w-7 h-7 text-slate-600" />
                        </div>
                        <p className="text-sm text-slate-400 font-bold">Configure Your Strategy</p>
                        <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                          Select a strategy, adjust parameters, and run a backtest.
                          Results will appear here with comprehensive analytics.
                        </p>
                        <div className="flex items-center justify-center gap-4 mt-4 text-[9px] text-slate-600 font-mono">
                          <span>8 strategies</span>
                          <span>·</span>
                          <span>Monte Carlo</span>
                          <span>·</span>
                          <span>Alpha/Beta</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* ══════ RESULTS TAB ══════ */}
            {activeTab === 'results' && result && (
              <motion.div
                key="results"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2 }}
              >
                <ResultsDashboard result={result} />
              </motion.div>
            )}

            {/* ══════ JOURNAL TAB ══════ */}
            {activeTab === 'journal' && result && (
              <motion.div
                key="journal"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2 }}
              >
                <TradeJournal trades={result.trades} symbol={result.symbol} />
              </motion.div>
            )}

            {/* ══════ COMPARE TAB ══════ */}
            {activeTab === 'compare' && (
              <motion.div
                key="compare"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2 }}
              >
                <ComparisonView
                  symbol={symbol}
                  startDate={startDate + 'T00:00:00'}
                  endDate={endDate + 'T23:59:59'}
                  initialCapital={initialCapital}
                />
              </motion.div>
            )}

            {/* ══════ SCANNER TAB ══════ */}
            {activeTab === 'scanner' && (
              <motion.div
                key="scanner"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2 }}
              >
                <MarketScanner
                  initialStrategy={strategy}
                  startDate={startDate + 'T00:00:00'}
                  endDate={endDate + 'T23:59:59'}
                />
              </motion.div>
            )}

            {/* ══════ RISK TAB ══════ */}
            {activeTab === 'risk' && (
              <motion.div
                key="risk"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2 }}
              >
                <RiskManager result={result} initialCapital={initialCapital} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Disclaimer ── */}
          {result && (
            <div className="mt-6 p-3 rounded-xl bg-amber-500/5 border border-amber-500/10 flex items-start gap-2.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500/50 shrink-0 mt-0.5" />
              <p className="text-[9px] text-slate-500 leading-relaxed">
                Backtest results are illustrative. Past performance does not guarantee future results.
                Commission ({(result.commission_rate * 100).toFixed(2)}%) and slippage ({(result.slippage_rate * 100).toFixed(2)}%) are modeled.
                Data source: {result.data_source || 'database'}. Use for research purposes only.
              </p>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}

/* ── Mobile version ─────────────────────────────────────────────────── */

function MobileBacktestPage() {
  const [symbol, setSymbol] = useState('AAPL')
  const [strategy, setStrategy] = useState('rsi_ma_crossover')
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 2); return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])
  const [initialCapital, setInitialCapital] = useState(100000)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'config' | 'results'>('config')
  const abortRef = useRef<AbortController | null>(null)
  const [dateRange, setDateRange] = useState<BacktestDateRange | null>(null)

  useEffect(() => {
    if (!symbol || symbol.length < 1) return
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const range = await getBacktestDateRange(symbol)
        if (!cancelled) {
          setDateRange(range)
          if (range.available && range.min_date && range.max_date) {
            const maxDate = range.max_date
            const twoYearsBack = new Date(new Date(maxDate).getTime() - 2 * 365 * 86400000).toISOString().split('T')[0]
            const effectiveStart = twoYearsBack > range.min_date ? twoYearsBack : range.min_date
            setStartDate(prev => prev < range.min_date! || prev > range.max_date! ? effectiveStart : prev)
            setEndDate(prev => prev > range.max_date! || prev < range.min_date! ? maxDate : prev)
          }
        }
      } catch {}
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [symbol])

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
    const startTime = Date.now()
    const MIN_MS = 4000
    try {
      const req: BacktestRequest = {
        symbol: symbol.toUpperCase(),
        start_date: startDate + 'T00:00:00',
        end_date: endDate + 'T23:59:59',
        strategy, initial_capital: initialCapital, monte_carlo: true,
      }
      const [res] = await Promise.all([runBacktest(req, controller.signal), new Promise(r => setTimeout(r, MIN_MS))])
      const hasNoTrades = !res.total_trades || res.total_trades === 0
      const hasNoReturn = res.total_return === 0 && res.sharpe_ratio === 0 && res.win_rate === 0
      if (hasNoTrades && hasNoReturn) {
        setError(`No trades generated for ${symbol.toUpperCase()}. Try different parameters or date range.`)
      } else {
        setResult(res)
        setActiveTab('results')
      }
    } catch (err: any) {
      const elapsed = Date.now() - startTime
      if (elapsed < MIN_MS) await new Promise(r => setTimeout(r, MIN_MS - elapsed))
      if (!controller.signal.aborted) {
        setError(err.message || 'Failed')
      }
    } finally { setLoading(false) }
  }

  return (
    <MobileLayout>
      <div className="min-h-screen bg-[#0A0E1A] px-4 py-4 pb-24 space-y-4">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex items-center gap-2 mb-2"
        >
          <Activity className="w-4 h-4 text-cyan-400" />
          <h1 className="text-base font-black text-white">Backtester</h1>
          <span className="px-2 py-0.5 rounded-md text-[8px] font-black bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-400 border border-cyan-500/25">PRO</span>
        </motion.div>

        {/* Mobile tabs */}
        <div className="flex gap-1 bg-[#0F1629]/40 border border-slate-800/30 rounded-xl p-1">
          {(['config', 'results'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              disabled={tab === 'results' && !result}
              className={`relative flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                activeTab === tab
                  ? 'text-white'
                  : 'text-slate-500 disabled:text-slate-700'
              }`}
            >
              {activeTab === tab && (
                <motion.div
                  layoutId="backtest-tab"
                  className="absolute inset-0 bg-cyan-500/15 border border-cyan-500/20 rounded-lg"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <span className="relative z-10">{tab === 'config' ? 'Configure' : 'Results'}</span>
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
        {activeTab === 'config' && (
          <motion.div
            key="config"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            <div className="bg-[#0F1629]/60 border border-slate-800/40 rounded-2xl p-4 space-y-3">
              <MobileSymbolSearch
                value={symbol}
                onChange={setSymbol}
                placeholder="Search symbol or company name..."
              />
              <div className="grid grid-cols-2 gap-2">
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                  min={dateRange?.available ? dateRange.min_date : undefined}
                  max={endDate || (dateRange?.available ? dateRange.max_date : undefined)}
                  className="px-2 py-2 bg-[#0A0E1A]/80 border border-slate-700/40 rounded-xl text-white text-xs font-mono focus:outline-none [color-scheme:dark]" />
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                  min={startDate || (dateRange?.available ? dateRange.min_date : undefined)}
                  max={dateRange?.available ? dateRange.max_date : undefined}
                  className="px-2 py-2 bg-[#0A0E1A]/80 border border-slate-700/40 rounded-xl text-white text-xs font-mono focus:outline-none [color-scheme:dark]" />
              </div>
              <input type="number" value={initialCapital} onChange={e => setInitialCapital(Number(e.target.value))}
                className="w-full px-3 py-2.5 bg-[#0A0E1A]/80 border border-slate-700/40 rounded-xl text-white text-sm font-mono focus:outline-none" />
              <select value={strategy} onChange={e => setStrategy(e.target.value)}
                className="w-full px-3 py-2.5 bg-[#0A0E1A]/80 border border-slate-700/40 rounded-xl text-white text-xs font-mono focus:outline-none appearance-none">
                {STRATEGIES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            {loading ? (
              <button onClick={handleCancel}
                className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl bg-gradient-to-r from-slate-700 to-slate-600 text-white font-black text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Cancel
              </button>
            ) : (
              <button onClick={handleRun} disabled={!symbol}
                className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-black text-sm disabled:opacity-40">
                <Play className="w-4 h-4" /> Run Backtest
              </button>
            )}

            {error && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 bg-red-500/8 border border-red-500/20 rounded-2xl text-red-400 flex items-center gap-2 text-xs"
              >
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="flex-1">{error}</span>
              </motion.div>
            )}
          </motion.div>
        )}

        {activeTab === 'results' && result && (
          <motion.div
            key="results"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="space-y-3"
          >
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Return', value: `${result.total_return >= 0 ? '+' : ''}${result.total_return.toFixed(1)}%`, positive: result.total_return >= 0 },
                { label: 'Sharpe', value: result.sharpe_ratio.toFixed(2), positive: result.sharpe_ratio >= 1 },
                { label: 'Win Rate', value: `${result.win_rate.toFixed(0)}%`, positive: result.win_rate >= 50 },
                { label: 'Max DD', value: `-${result.max_drawdown.toFixed(1)}%`, positive: false },
              ].map(m => (
                <div key={m.label} className="bg-[#0F1629]/60 border border-slate-800/40 rounded-xl p-3">
                  <div className="text-[9px] text-slate-500 uppercase font-semibold">{m.label}</div>
                  <div className={`text-lg font-black font-mono ${m.positive ? 'text-emerald-400' : 'text-red-400'}`}>{m.value}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Trades', value: String(result.total_trades) },
                { label: 'Sortino', value: result.sortino_ratio.toFixed(2), positive: result.sortino_ratio >= 1 },
                { label: 'PF', value: result.profit_factor.toFixed(2), positive: result.profit_factor >= 1.5 },
              ].map(m => (
                <div key={m.label} className="bg-[#0F1629]/60 border border-slate-800/40 rounded-xl p-3">
                  <div className="text-[9px] text-slate-500 uppercase font-semibold">{m.label}</div>
                  <div className={`text-base font-black font-mono ${'positive' in m ? (m.positive ? 'text-emerald-400' : 'text-red-400') : 'text-white'}`}>{m.value}</div>
                </div>
              ))}
            </div>

            {/* Mini equity curve */}
            {result.equity_curve.length > 2 && (
              <div className="bg-[#0F1629]/60 border border-slate-800/40 rounded-xl p-2 h-36">
                <svg className="w-full h-full" viewBox="0 0 100 50" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="meq-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={result.total_return >= 0 ? '#10b981' : '#ef4444'} stopOpacity="0.3" />
                      <stop offset="100%" stopColor={result.total_return >= 0 ? '#10b981' : '#ef4444'} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {(() => {
                    const data = result.equity_curve
                    const min = Math.min(...data)
                    const max = Math.max(...data)
                    const range = max - min || 1
                    const pts = data.map((v, i) => ({
                      x: (i / (data.length - 1)) * 100,
                      y: 2 + 46 - ((v - min) / range) * 46,
                    }))
                    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
                    return (
                      <>
                        <path d={`${d} L100,50 L0,50 Z`} fill="url(#meq-grad)" />
                        <path d={d} fill="none" stroke={result.total_return >= 0 ? '#10b981' : '#ef4444'} strokeWidth="0.5" />
                      </>
                    )
                  })()}
                </svg>
              </div>
            )}

            {result.monte_carlo && (
              <div className="bg-[#0F1629]/60 border border-slate-800/40 rounded-xl p-3">
                <div className="text-[10px] text-slate-500 uppercase font-semibold mb-2">Monte Carlo</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="text-center">
                    <div className="text-[9px] text-slate-500">P(Profit)</div>
                    <div className="text-base font-black font-mono text-emerald-400">{result.monte_carlo.probability_of_profit}%</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[9px] text-slate-500">Median</div>
                    <div className={`text-base font-black font-mono ${result.monte_carlo.median_return >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {result.monte_carlo.median_return >= 0 ? '+' : ''}{result.monte_carlo.median_return}%
                    </div>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
        </AnimatePresence>
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
        <div className="min-h-screen flex items-center justify-center bg-[#0A0E1A]">
          <div className="text-center max-w-md px-4">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/20 flex items-center justify-center">
              <Activity className="w-7 h-7 text-cyan-400" />
            </div>
            <h2 className="text-xl font-black text-white mb-2">Sign In Required</h2>
            <p className="text-slate-400 text-sm mb-6">Access the Pro Strategy Backtester with your account.</p>
            <Link href="/auth" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold text-sm shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30 transition-all">
              Sign In <ArrowRight className="w-4 h-4" />
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
