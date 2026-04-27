'use client'

import { useState, useCallback, useMemo, useRef } from 'react'
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion'
import { scanSymbols, ScanRequest, ScanResult, ScanResultItem } from '@/lib/api'

// ---------------------------------------------------------------------------
// Preset symbol groups
// ---------------------------------------------------------------------------
const PRESETS = {
  'FAANG+': ['AAPL', 'GOOGL', 'AMZN', 'META', 'MSFT', 'NFLX', 'NVDA', 'TSLA'],
  'S&P Top 20': [
    'AAPL', 'MSFT', 'AMZN', 'NVDA', 'GOOGL', 'META', 'BRK-B', 'LLY',
    'AVGO', 'JPM', 'TSLA', 'UNH', 'V', 'XOM', 'MA', 'JNJ', 'PG', 'COST',
    'HD', 'ABBV',
  ],
  Crypto: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD', 'XRP-USD', 'ADA-USD', 'DOGE-USD', 'DOT-USD'],
  Forex: ['EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'AUDUSD=X', 'USDCAD=X', 'USDCHF=X', 'NZDUSD=X'],
} as const

const STRATEGIES = [
  { id: 'sma_crossover', label: 'SMA Crossover' },
  { id: 'ema_crossover', label: 'EMA Crossover' },
  { id: 'rsi_mean_reversion', label: 'RSI Mean Reversion' },
  { id: 'bollinger_bands', label: 'Bollinger Bands' },
  { id: 'macd_signal', label: 'MACD Signal' },
  { id: 'momentum', label: 'Momentum' },
  { id: 'mean_reversion', label: 'Mean Reversion' },
  { id: 'breakout', label: 'Breakout' },
]

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface MarketScannerProps {
  initialStrategy: string
  startDate: string
  endDate: string
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Inline SVG sparkline rendered from an equity curve array. */
function MiniSparkline({ data, width = 60, height = 24, positive }: { data: number[]; width?: number; height?: number; positive: boolean }) {
  if (!data || data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width
      const y = height - ((v - min) / range) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const stroke = positive ? '#34d399' : '#f87171'
  const gradientId = `spark-${positive ? 'g' : 'r'}-${Math.random().toString(36).slice(2, 6)}`
  const areaPath =
    `M0,${height} L` +
    data
      .map((v, i) => {
        const x = (i / (data.length - 1)) * width
        const y = height - ((v - min) / range) * height
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ') +
    ` L${width},${height} Z`

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.3} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <polyline points={points} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Circular donut progress for win rate. */
function CircularProgress({ value, size = 36 }: { value: number; size?: number }) {
  const strokeWidth = 3
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (value / 100) * circumference
  const color = value >= 55 ? '#34d399' : value >= 45 ? '#fbbf24' : '#f87171'

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(100,116,139,0.2)" strokeWidth={strokeWidth} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-[10px] text-fg-secondary tabular-nums">
        {value.toFixed(0)}%
      </span>
    </div>
  )
}

/** Styled range slider with label and current value. */
function FilterSlider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  format,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
  format?: (v: number) => string
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-fg-secondary">{label}</span>
        <span className="font-mono text-xs tabular-nums text-white">{format ? format(value) : value}</span>
      </div>
      <div className="relative h-1.5 w-full rounded-full bg-surface-raised">
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400"
          style={{ width: `${pct}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full cursor-pointer appearance-none bg-transparent [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-cyan-400 [&::-webkit-slider-thumb]:bg-[#0A0E1A] [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(34,211,238,0.5)] [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-125"
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------
const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04 } },
}
const cardVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring' as const, stiffness: 300, damping: 24 } },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtPct(v: number) {
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
}
function fmtNum(v: number, d = 2) {
  return v.toFixed(d)
}

type SortKey = 'symbol' | 'total_return' | 'sharpe_ratio' | 'sortino_ratio' | 'win_rate' | 'max_drawdown' | 'profit_factor' | 'total_trades'

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function MarketScanner({ initialStrategy, startDate, endDate }: MarketScannerProps) {
  // Config state
  const [strategy, setStrategy] = useState(initialStrategy || STRATEGIES[0].id)
  const [symbolText, setSymbolText] = useState('')
  const [minSharpe, setMinSharpe] = useState(0)
  const [minWinRate, setMinWinRate] = useState(0)
  const [minReturn, setMinReturn] = useState(-50)

  // Scan state
  const [results, setResults] = useState<ScanResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)

  // View state
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid')
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('sharpe_ratio')
  const [sortAsc, setSortAsc] = useState(false)

  const abortRef = useRef<AbortController | null>(null)

  // Parse symbols from text + presets
  const parsedSymbols = useMemo(() => {
    const raw = symbolText
      .split(/[,\n]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
    return Array.from(new Set(raw))
  }, [symbolText])

  const addPreset = useCallback(
    (key: keyof typeof PRESETS) => {
      const existing = new Set(
        symbolText
          .split(/[,\n]+/)
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
      )
      const toAdd = PRESETS[key].filter((s) => !existing.has(s))
      if (toAdd.length === 0) return
      setSymbolText((prev) => (prev.trim() ? prev.trim() + ', ' + toAdd.join(', ') : toAdd.join(', ')))
    },
    [symbolText],
  )

  // Scan execution
  const runScan = useCallback(async () => {
    if (parsedSymbols.length === 0) return
    setLoading(true)
    setError(null)
    setResults(null)
    setExpandedSymbol(null)

    const total = parsedSymbols.length
    setProgress({ current: 0, total })

    // Progress simulation
    const interval = setInterval(() => {
      setProgress((p) => ({
        ...p,
        current: Math.min(p.current + 1, p.total - 1),
      }))
    }, Math.max(200, 8000 / total))

    const controller = new AbortController()
    abortRef.current = controller

    const request: ScanRequest = {
      symbols: parsedSymbols,
      strategy,
      start_date: startDate,
      end_date: endDate,
      min_sharpe: minSharpe > 0 ? minSharpe : null,
      min_win_rate: minWinRate > 0 ? minWinRate : null,
      min_return: minReturn > -50 ? minReturn : null,
    }

    try {
      const data = await scanSymbols(request, controller.signal)
      clearInterval(interval)
      setProgress({ current: total, total })
      setResults(data)
    } catch (err: unknown) {
      clearInterval(interval)
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Scan failed')
    } finally {
      setLoading(false)
    }
  }, [parsedSymbols, strategy, startDate, endDate, minSharpe, minWinRate, minReturn])

  // Sorted / filtered results
  const sortedResults = useMemo(() => {
    if (!results) return []
    const items = [...results.results]
    items.sort((a, b) => {
      const av = a[sortKey] as number | string
      const bv = b[sortKey] as number | string
      if (typeof av === 'string') return sortAsc ? (av as string).localeCompare(bv as string) : (bv as string).localeCompare(av as string)
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
    return items
  }, [results, sortKey, sortAsc])

  // Summary stats
  const summary = useMemo(() => {
    if (!results || results.results.length === 0) return null
    const items = results.results
    const passed = items.filter((i) => i.passed_filters).length
    const best = items.reduce((a, b) => (b.total_return > a.total_return ? b : a), items[0])
    const worst = items.reduce((a, b) => (b.total_return < a.total_return ? b : a), items[0])
    const avgSharpe = items.reduce((s, i) => s + i.sharpe_ratio, 0) / items.length
    return { total: results.total_scanned, passed, best, worst, avgSharpe }
  }, [results])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((p) => !p)
    else {
      setSortKey(key)
      setSortAsc(false)
    }
  }

  const heatColor = (val: number, goodHigh: boolean, range: [number, number]) => {
    const [lo, hi] = range
    const t = Math.max(0, Math.min(1, (val - lo) / (hi - lo)))
    const norm = goodHigh ? t : 1 - t
    if (norm >= 0.6) return 'text-emerald-400'
    if (norm >= 0.4) return 'text-yellow-400'
    return 'text-red-400'
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* ── Configuration Panel ────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl border border-line-subtle bg-surface-glass p-6 backdrop-blur-xl"
      >
        {/* Subtle gradient border glow */}
        <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/[0.04]" />
        <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-96 -translate-x-1/2 bg-indigo-500/[0.06] blur-3xl" />

        <div className="relative space-y-5">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/20 to-cyan-500/20 ring-1 ring-indigo-500/20">
              <svg className="h-4.5 w-4.5 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Market Scanner</h2>
              <p className="text-xs text-fg-muted">Scan multiple symbols against a strategy</p>
            </div>
          </div>

          {/* Strategy + presets row */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* Strategy */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-fg-secondary">Strategy</label>
              <select
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
                className="w-full appearance-none rounded-lg border border-line-default bg-surface-base px-3 py-2 text-sm text-white outline-none ring-1 ring-transparent transition-all focus:border-cyan-500/50 focus:ring-cyan-500/20"
              >
                {STRATEGIES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Presets */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-fg-secondary">Quick Add</label>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => addPreset(key)}
                    className="group relative rounded-lg border border-line-default bg-surface-raised px-3 py-1.5 text-xs font-medium text-fg-secondary transition-all hover:border-cyan-500/30 hover:bg-cyan-500/[0.06] hover:text-cyan-300"
                  >
                    <span className="relative z-10">{key}</span>
                    <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-cyan-500/0 to-indigo-500/0 opacity-0 transition-opacity group-hover:opacity-100 group-hover:from-cyan-500/[0.04] group-hover:to-indigo-500/[0.04]" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Symbol textarea */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-fg-secondary">Symbols</label>
              <span className="font-mono text-xs tabular-nums text-fg-muted">
                {parsedSymbols.length} symbol{parsedSymbols.length !== 1 ? 's' : ''}
              </span>
            </div>
            <textarea
              value={symbolText}
              onChange={(e) => setSymbolText(e.target.value)}
              placeholder="AAPL, MSFT, GOOGL ..."
              rows={3}
              className="w-full resize-none rounded-lg border border-line-default bg-surface-base px-3 py-2 font-mono text-sm text-white placeholder-fg-muted outline-none ring-1 ring-transparent transition-all focus:border-cyan-500/50 focus:ring-cyan-500/20"
            />
          </div>

          {/* Filters */}
          <div className="grid gap-5 sm:grid-cols-3">
            <FilterSlider label="Min Sharpe" min={0} max={3} step={0.1} value={minSharpe} onChange={setMinSharpe} format={(v) => v.toFixed(1)} />
            <FilterSlider label="Min Win Rate" min={0} max={100} step={5} value={minWinRate} onChange={setMinWinRate} format={(v) => `${v}%`} />
            <FilterSlider label="Min Return" min={-50} max={200} step={5} value={minReturn} onChange={setMinReturn} format={(v) => `${v}%`} />
          </div>

          {/* Scan button */}
          <div className="flex items-center gap-3">
            <button
              onClick={runScan}
              disabled={loading || parsedSymbols.length === 0}
              className="group relative flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition-all hover:shadow-indigo-500/30 disabled:opacity-40 disabled:saturate-50"
            >
              {loading ? (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={3} className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth={3} strokeLinecap="round" className="opacity-75" />
                </svg>
              ) : (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              )}
              <span>Scan {parsedSymbols.length} Symbol{parsedSymbols.length !== 1 ? 's' : ''}</span>
              {parsedSymbols.length > 0 && (
                <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-white/20 px-1.5 font-mono text-[10px] tabular-nums">
                  {parsedSymbols.length}
                </span>
              )}
            </button>
            {loading && (
              <button
                onClick={() => abortRef.current?.abort()}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
              >
                Cancel
              </button>
            )}
          </div>

          {/* Progress bar */}
          <AnimatePresence>
            {loading && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-fg-muted">
                      Scanning <span className="font-mono tabular-nums text-fg-primary">{progress.current}</span> of{' '}
                      <span className="font-mono tabular-nums text-fg-primary">{progress.total}</span> ...
                    </span>
                    <span className="font-mono tabular-nums text-cyan-400">
                      {progress.total > 0 ? ((progress.current / progress.total) * 100).toFixed(0) : 0}%
                    </span>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-surface-raised">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400"
                      initial={{ width: '0%' }}
                      animate={{ width: progress.total > 0 ? `${(progress.current / progress.total) * 100}%` : '0%' }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* ── Error ──────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-sm text-red-400"
          >
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4m0 4h.01" />
            </svg>
            <span className="flex-1">{error}</span>
            <button onClick={runScan} className="shrink-0 rounded-lg bg-red-500/10 px-3 py-1 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/20">
              Retry
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Summary Stats Bar ──────────────────────────────────────────── */}
      <AnimatePresence>
        {summary && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-2 gap-3 sm:grid-cols-5"
          >
            {[
              { label: 'Scanned', value: String(summary.total), color: 'text-fg-primary' },
              { label: 'Passed Filters', value: String(summary.passed), color: 'text-emerald-400' },
              { label: 'Best Performer', value: `${summary.best.symbol} ${fmtPct(summary.best.total_return)}`, color: 'text-emerald-400' },
              { label: 'Worst Performer', value: `${summary.worst.symbol} ${fmtPct(summary.worst.total_return)}`, color: 'text-red-400' },
              { label: 'Avg Sharpe', value: fmtNum(summary.avgSharpe), color: summary.avgSharpe >= 1 ? 'text-emerald-400' : 'text-yellow-400' },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="relative overflow-hidden rounded-xl border border-line-subtle bg-surface-raised/80 px-4 py-3 backdrop-blur-xl"
              >
                <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-white/[0.03]" />
                <p className="text-[10px] font-medium uppercase tracking-wider text-fg-muted">{stat.label}</p>
                <p className={`mt-0.5 truncate font-mono text-sm font-semibold tabular-nums ${stat.color}`}>{stat.value}</p>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── View Toggle ────────────────────────────────────────────────── */}
      {results && results.results.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-fg-muted">
            Showing <span className="font-mono tabular-nums text-fg-secondary">{sortedResults.length}</span> results
          </p>
          <div className="flex overflow-hidden rounded-lg border border-line-subtle bg-surface-raised/60">
            {(['grid', 'table'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 text-xs font-medium capitalize transition-all ${
                  viewMode === mode ? 'bg-surface-hover text-fg-primary' : 'text-fg-muted hover:text-fg-secondary'
                }`}
              >
                {mode === 'grid' ? (
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="3" y="3" width="7" height="7" rx="1.5" />
                    <rect x="14" y="3" width="7" height="7" rx="1.5" />
                    <rect x="3" y="14" width="7" height="7" rx="1.5" />
                    <rect x="14" y="14" width="7" height="7" rx="1.5" />
                  </svg>
                ) : (
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="3" y="4" width="18" height="2" rx="1" />
                    <rect x="3" y="9" width="18" height="2" rx="1" />
                    <rect x="3" y="14" width="18" height="2" rx="1" />
                    <rect x="3" y="19" width="18" height="2" rx="1" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Empty State ────────────────────────────────────────────────── */}
      {!results && !loading && !error && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-20 text-center">
          <div className="relative mb-4">
            <div className="absolute inset-0 animate-ping rounded-full bg-cyan-500/10" />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-line-subtle bg-surface-raised/80">
              <svg className="h-7 w-7 text-fg-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                <path d="M2 12h20" />
              </svg>
            </div>
          </div>
          <h3 className="text-sm font-medium text-fg-muted">Configure and scan</h3>
          <p className="mt-1 max-w-xs text-xs text-fg-muted">Select a strategy, add symbols, and run a scan to discover top performers</p>
        </motion.div>
      )}

      {/* ── Grid View ──────────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {results && viewMode === 'grid' && (
          <LayoutGroup>
            <motion.div
              key="grid"
              variants={containerVariants}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0 }}
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            >
              {sortedResults.map((item) => {
                const isExpanded = expandedSymbol === item.symbol
                const positive = item.total_return >= 0
                return (
                  <motion.div
                    key={item.symbol}
                    variants={cardVariants}
                    layout
                    layoutId={`card-${item.symbol}`}
                    onClick={() => setExpandedSymbol(isExpanded ? null : item.symbol)}
                    className="group relative cursor-pointer overflow-hidden rounded-xl border border-line-subtle bg-surface-raised/80 p-4 backdrop-blur-xl transition-shadow hover:shadow-lg hover:shadow-indigo-500/[0.05]"
                    whileHover={{ y: -2 }}
                  >
                    <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-white/[0.03] transition-all group-hover:ring-white/[0.06]" />

                    {/* Status dot */}
                    <div className="absolute right-3 top-3">
                      {item.passed_filters ? (
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 ring-1 ring-emerald-500/30">
                          <svg className="h-3 w-3 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                            <path d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      ) : (
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500/10 ring-1 ring-red-500/30">
                          <svg className="h-3 w-3 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                            <path d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </div>
                      )}
                    </div>

                    {/* Symbol + sparkline row */}
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-base font-bold tracking-tight text-fg-primary">{item.symbol}</h3>
                        <p className={`mt-0.5 font-mono text-lg font-bold tabular-nums ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
                          {fmtPct(item.total_return)}
                        </p>
                      </div>
                      <MiniSparkline data={item.equity_curve} positive={positive} />
                    </div>

                    {/* Metrics row */}
                    <div className="mt-3 flex items-center gap-3">
                      <div className="flex items-center gap-1.5 rounded-md bg-surface-hover px-2 py-1">
                        <span className="text-[10px] text-fg-muted">Sharpe</span>
                        <span className={`font-mono text-xs font-semibold tabular-nums ${item.sharpe_ratio >= 1 ? 'text-emerald-400' : item.sharpe_ratio >= 0.5 ? 'text-yellow-400' : 'text-red-400'}`}>
                          {fmtNum(item.sharpe_ratio)}
                        </span>
                      </div>
                      <CircularProgress value={item.win_rate} />
                      <div className="ml-auto text-right">
                        <span className="text-[10px] text-fg-muted">Max DD</span>
                        <p className="font-mono text-xs font-medium tabular-nums text-red-400">{fmtPct(item.max_drawdown)}</p>
                      </div>
                    </div>

                    {/* Expanded details */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line-subtle pt-3">
                            {[
                              { label: 'Sortino', value: fmtNum(item.sortino_ratio) },
                              { label: 'Profit Factor', value: fmtNum(item.profit_factor) },
                              { label: 'Calmar', value: fmtNum(item.calmar_ratio) },
                              { label: 'Total Trades', value: String(item.total_trades) },
                            ].map((m) => (
                              <div key={m.label}>
                                <span className="text-[10px] text-fg-muted">{m.label}</span>
                                <p className="font-mono text-xs font-medium tabular-nums text-fg-secondary">{m.value}</p>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )
              })}
            </motion.div>
          </LayoutGroup>
        )}

        {/* ── Table View ─────────────────────────────────────────────────── */}
        {results && viewMode === 'table' && (
          <motion.div
            key="table"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative overflow-hidden rounded-xl border border-line-subtle bg-surface-raised/80 backdrop-blur-xl"
          >
            <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-white/[0.03]" />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line-subtle">
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">#</th>
                    {(
                      [
                        { key: 'symbol', label: 'Symbol' },
                        { key: 'total_return', label: 'Return' },
                        { key: 'sharpe_ratio', label: 'Sharpe' },
                        { key: 'sortino_ratio', label: 'Sortino' },
                        { key: 'win_rate', label: 'Win Rate' },
                        { key: 'max_drawdown', label: 'Max DD' },
                        { key: 'profit_factor', label: 'PF' },
                        { key: 'total_trades', label: 'Trades' },
                      ] as { key: SortKey; label: string }[]
                    ).map((col) => (
                      <th
                        key={col.key}
                        onClick={() => handleSort(col.key)}
                        className="cursor-pointer select-none px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-fg-muted transition-colors hover:text-fg-secondary"
                      >
                        <span className="inline-flex items-center gap-1">
                          {col.label}
                          {sortKey === col.key && (
                            <svg className={`h-3 w-3 transition-transform ${sortAsc ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="currentColor">
                              <path d="M7 10l5 5 5-5z" />
                            </svg>
                          )}
                        </span>
                      </th>
                    ))}
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Filter</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedResults.map((item, idx) => (
                    <motion.tr
                      key={item.symbol}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: idx * 0.02 }}
                      className="border-b border-line-subtle transition-colors hover:bg-surface-hover"
                    >
                      <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-fg-muted">{idx + 1}</td>
                      <td className="px-4 py-2.5">
                        <span className="font-semibold text-fg-primary">{item.symbol}</span>
                      </td>
                      <td className={`px-4 py-2.5 font-mono text-xs font-semibold tabular-nums ${item.total_return >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {fmtPct(item.total_return)}
                      </td>
                      <td className={`px-4 py-2.5 font-mono text-xs tabular-nums ${heatColor(item.sharpe_ratio, true, [0, 3])}`}>{fmtNum(item.sharpe_ratio)}</td>
                      <td className={`px-4 py-2.5 font-mono text-xs tabular-nums ${heatColor(item.sortino_ratio, true, [0, 3])}`}>{fmtNum(item.sortino_ratio)}</td>
                      <td className={`px-4 py-2.5 font-mono text-xs tabular-nums ${heatColor(item.win_rate, true, [30, 70])}`}>{fmtNum(item.win_rate, 1)}%</td>
                      <td className={`px-4 py-2.5 font-mono text-xs tabular-nums ${heatColor(Math.abs(item.max_drawdown), false, [0, 50])}`}>{fmtPct(item.max_drawdown)}</td>
                      <td className={`px-4 py-2.5 font-mono text-xs tabular-nums ${heatColor(item.profit_factor, true, [0.5, 2.5])}`}>{fmtNum(item.profit_factor)}</td>
                      <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-fg-muted">{item.total_trades}</td>
                      <td className="px-4 py-2.5">
                        {item.passed_filters ? (
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10">
                            <svg className="h-3 w-3 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path d="M5 13l4 4L19 7" /></svg>
                          </span>
                        ) : (
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-500/10">
                            <svg className="h-3 w-3 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path d="M6 18L18 6M6 6l12 12" /></svg>
                          </span>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
