'use client'

import { useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Loader2, BarChart3, GitCompareArrows, Radar as RadarIcon,
  Grid3X3, Sliders, TrendingUp, CheckSquare, Square, AlertTriangle
} from 'lucide-react'
import {
  LineChart, Line, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, ResponsiveContainer, Tooltip, Legend, XAxis, YAxis,
  CartesianGrid
} from 'recharts'
import { compareStrategies, CompareResult, BacktestResult } from '@/lib/api'

/* ------------------------------------------------------------------ */
/*  Types & Constants                                                  */
/* ------------------------------------------------------------------ */

interface ComparisonViewProps {
  symbol: string
  startDate: string
  endDate: string
  initialCapital: number
}

interface StrategyInfo {
  key: string
  label: string
  category: string
}

const STRATEGIES: StrategyInfo[] = [
  { key: 'rsi_ma_crossover', label: 'RSI + MA Crossover', category: 'Momentum' },
  { key: 'ma_crossover', label: 'MA Crossover', category: 'Trend' },
  { key: 'bollinger_breakout', label: 'Bollinger Breakout', category: 'Volatility' },
  { key: 'macd_cross', label: 'MACD Cross', category: 'Momentum' },
  { key: 'mean_reversion', label: 'Mean Reversion', category: 'Mean Reversion' },
  { key: 'momentum_roc', label: 'Momentum ROC', category: 'Momentum' },
  { key: 'volume_weighted_trend', label: 'Volume Weighted Trend', category: 'Volume' },
  { key: 'multi_indicator', label: 'Multi Indicator', category: 'Composite' },
]

const STRATEGY_COLORS: Record<string, string> = {
  rsi_ma_crossover: '#06b6d4',
  ma_crossover: '#8b5cf6',
  bollinger_breakout: '#f59e0b',
  macd_cross: '#10b981',
  mean_reversion: '#f43f5e',
  momentum_roc: '#0ea5e9',
  volume_weighted_trend: '#f97316',
  multi_indicator: '#d946ef',
}

const CATEGORY_COLORS: Record<string, string> = {
  Momentum: 'bg-cyan-900/40 text-cyan-400 border-cyan-800/50',
  Trend: 'bg-violet-900/40 text-violet-400 border-violet-800/50',
  Volatility: 'bg-amber-900/40 text-amber-400 border-amber-800/50',
  'Mean Reversion': 'bg-rose-900/40 text-rose-400 border-rose-800/50',
  Volume: 'bg-orange-900/40 text-orange-400 border-orange-800/50',
  Composite: 'bg-fuchsia-900/40 text-fuchsia-400 border-fuchsia-800/50',
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmt(val: number, decimals = 2): string {
  return val.toFixed(decimals)
}

function fmtPct(val: number): string {
  return `${(val * 100).toFixed(2)}%`
}

function normalize(
  value: number,
  min: number,
  max: number,
): number {
  if (max === min) return 50
  return ((value - min) / (max - min)) * 100
}

/* ------------------------------------------------------------------ */
/*  Metric row definition                                              */
/* ------------------------------------------------------------------ */

interface MetricDef {
  label: string
  key: keyof BacktestResult
  format: (v: number) => string
  higherIsBetter: boolean
}

const METRIC_DEFS: MetricDef[] = [
  { label: 'Total Return', key: 'total_return', format: fmtPct, higherIsBetter: true },
  { label: 'Sharpe Ratio', key: 'sharpe_ratio', format: (v) => fmt(v), higherIsBetter: true },
  { label: 'Sortino Ratio', key: 'sortino_ratio', format: (v) => fmt(v), higherIsBetter: true },
  { label: 'Calmar Ratio', key: 'calmar_ratio', format: (v) => fmt(v), higherIsBetter: true },
  { label: 'Win Rate', key: 'win_rate', format: fmtPct, higherIsBetter: true },
  { label: 'Max Drawdown', key: 'max_drawdown', format: fmtPct, higherIsBetter: false },
  { label: 'Profit Factor', key: 'profit_factor', format: (v) => fmt(v), higherIsBetter: true },
  { label: 'Total Trades', key: 'total_trades', format: (v) => fmt(v, 0), higherIsBetter: false },
  { label: 'Expectancy', key: 'expectancy', format: (v) => `$${fmt(v)}`, higherIsBetter: true },
  { label: 'Avg Duration', key: 'avg_trade_duration', format: (v) => `${fmt(v, 1)}d`, higherIsBetter: false },
]

const RADAR_METRICS: { key: keyof BacktestResult; label: string; higherIsBetter: boolean }[] = [
  { key: 'total_return', label: 'Return', higherIsBetter: true },
  { key: 'sharpe_ratio', label: 'Sharpe', higherIsBetter: true },
  { key: 'win_rate', label: 'Win Rate', higherIsBetter: true },
  { key: 'profit_factor', label: 'Profit Factor', higherIsBetter: true },
  { key: 'sortino_ratio', label: 'Sortino', higherIsBetter: true },
]

/* ------------------------------------------------------------------ */
/*  Custom Tooltip                                                     */
/* ------------------------------------------------------------------ */

function EquityTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg bg-[#0F1629] border border-slate-800/60 px-3 py-2 shadow-xl">
      <p className="text-xs text-slate-500 font-mono mb-1">Day {label}</p>
      {payload.map((entry: any) => (
        <div key={entry.dataKey} className="flex items-center gap-2 text-xs">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-slate-400">{entry.name}:</span>
          <span className="text-white font-mono font-bold">
            ${Number(entry.value).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function ComparisonView({
  symbol,
  startDate,
  endDate,
  initialCapital,
}: ComparisonViewProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<CompareResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [allocations, setAllocations] = useState<Record<string, number>>({})

  /* Toggle strategy selection */
  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else if (next.size < 5) {
        next.add(key)
      }
      return next
    })
  }, [])

  /* Run comparison */
  const handleCompare = useCallback(async () => {
    if (selected.size < 2) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await compareStrategies({
        symbol,
        start_date: startDate,
        end_date: endDate,
        strategies: Array.from(selected),
        initial_capital: initialCapital,
      })
      setResult(res)
      // Initialize equal-weight allocations
      const equalWeight = 100 / res.strategies.length
      const alloc: Record<string, number> = {}
      res.strategies.forEach((s) => {
        alloc[s.strategy] = Math.round(equalWeight)
      })
      setAllocations(alloc)
    } catch (err: any) {
      setError(err?.message || 'Comparison failed')
    } finally {
      setLoading(false)
    }
  }, [selected, symbol, startDate, endDate, initialCapital])

  /* Successful strategies (no error) */
  const strategies = useMemo(
    () => (result?.strategies ?? []).filter((s) => !s.error),
    [result],
  )

  /* Equity curve data */
  const equityData = useMemo(() => {
    if (!strategies.length) return []
    const maxLen = Math.max(...strategies.map((s) => s.equity_curve.length))
    return Array.from({ length: maxLen }, (_, i) => {
      const point: Record<string, number> = { day: i }
      strategies.forEach((s) => {
        point[s.strategy] = s.equity_curve[Math.min(i, s.equity_curve.length - 1)]
      })
      return point
    })
  }, [strategies])

  /* Radar data (normalized 0-100) */
  const radarData = useMemo(() => {
    if (!strategies.length) return []
    return RADAR_METRICS.map((m) => {
      const values = strategies.map((s) => Number(s[m.key]) || 0)
      const min = Math.min(...values)
      const max = Math.max(...values)
      const point: Record<string, string | number> = { metric: m.label }
      strategies.forEach((s) => {
        const raw = Number(s[m.key]) || 0
        point[s.strategy] = Math.round(normalize(raw, min, max))
      })
      return point
    })
  }, [strategies])

  /* Combined portfolio metrics */
  const combinedMetrics = useMemo(() => {
    if (!strategies.length || !Object.keys(allocations).length) return null
    const totalAlloc = Object.values(allocations).reduce((a, b) => a + b, 0)
    if (totalAlloc === 0) return null

    const weighted = (key: keyof BacktestResult) => {
      return strategies.reduce((acc, s) => {
        const w = (allocations[s.strategy] || 0) / totalAlloc
        return acc + (Number(s[key]) || 0) * w
      }, 0)
    }

    return {
      total_return: weighted('total_return'),
      sharpe_ratio: weighted('sharpe_ratio'),
      sortino_ratio: weighted('sortino_ratio'),
      calmar_ratio: weighted('calmar_ratio'),
      win_rate: weighted('win_rate'),
      max_drawdown: weighted('max_drawdown'),
      profit_factor: weighted('profit_factor'),
      expectancy: weighted('expectancy'),
    }
  }, [strategies, allocations])

  /* Best / Worst per metric row */
  const bestWorst = useMemo(() => {
    if (!strategies.length) return {}
    const map: Record<string, { bestIdx: number; worstIdx: number }> = {}
    METRIC_DEFS.forEach((m) => {
      const values = strategies.map((s) => Number(s[m.key]) || 0)
      let bestIdx = 0
      let worstIdx = 0
      values.forEach((v, i) => {
        if (m.higherIsBetter) {
          if (v > values[bestIdx]) bestIdx = i
          if (v < values[worstIdx]) worstIdx = i
        } else {
          // For max drawdown (negative): less negative is better
          // For total trades / avg duration: lower is not necessarily better/worse, but we still highlight extremes
          if (m.key === 'max_drawdown') {
            // max_drawdown is negative, closer to 0 is better
            if (v > values[bestIdx]) bestIdx = i
            if (v < values[worstIdx]) worstIdx = i
          } else {
            if (v < values[bestIdx]) bestIdx = i
            if (v > values[worstIdx]) worstIdx = i
          }
        }
      })
      map[m.key] = { bestIdx, worstIdx }
    })
    return map
  }, [strategies])

  /* Allocation slider handler */
  const handleAllocation = useCallback((strategy: string, value: number) => {
    setAllocations((prev) => ({ ...prev, [strategy]: value }))
  }, [])

  /* Correlation matrix */
  const correlationMatrix = result?.correlation_matrix ?? {}
  const corrStrategies = Object.keys(correlationMatrix)

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */

  return (
    <div className="space-y-6">
      {/* Strategy Selection Panel */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl bg-[#0F1629]/80 border border-slate-800/60 p-6"
      >
        <div className="flex items-center gap-3 mb-4">
          <GitCompareArrows className="h-5 w-5 text-cyan-400" />
          <h2 className="text-lg font-black text-white">Select Strategies to Compare</h2>
          <span className="text-xs text-slate-500 ml-auto">
            {selected.size}/5 selected (min 2)
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {STRATEGIES.map((s) => {
            const isSelected = selected.has(s.key)
            const color = STRATEGY_COLORS[s.key]
            return (
              <button
                key={s.key}
                onClick={() => toggle(s.key)}
                disabled={!isSelected && selected.size >= 5}
                className={`
                  relative flex items-start gap-3 p-3 rounded-xl border text-left transition-all
                  ${isSelected
                    ? 'border-slate-600 bg-slate-800/50'
                    : 'border-slate-800/60 bg-[#0A0E1A] hover:border-slate-700'
                  }
                  disabled:opacity-40 disabled:cursor-not-allowed
                `}
              >
                {isSelected ? (
                  <CheckSquare className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color }} />
                ) : (
                  <Square className="h-4 w-4 mt-0.5 text-slate-600 flex-shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white truncate">{s.label}</p>
                  <span
                    className={`
                      inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded border
                      ${CATEGORY_COLORS[s.category] ?? 'bg-slate-900/40 text-slate-400 border-slate-800/50'}
                    `}
                  >
                    {s.category}
                  </span>
                </div>
                {isSelected && (
                  <span
                    className="absolute top-2 right-2 w-2 h-2 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                )}
              </button>
            )
          })}
        </div>

        <button
          onClick={handleCompare}
          disabled={selected.size < 2 || loading}
          className={`
            flex items-center gap-2 px-6 py-2.5 rounded-lg font-bold text-sm transition-all
            ${selected.size >= 2 && !loading
              ? 'bg-cyan-500 hover:bg-cyan-400 text-black'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }
          `}
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Comparing...
            </>
          ) : (
            <>
              <BarChart3 className="h-4 w-4" />
              Compare Strategies
            </>
          )}
        </button>
      </motion.div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="rounded-xl bg-red-900/20 border border-red-800/50 p-4 flex items-center gap-3"
          >
            <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-300">{error}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results */}
      <AnimatePresence>
        {strategies.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="space-y-6"
          >
            {/* ---- Equity Curves ---- */}
            <div className="rounded-xl bg-[#0F1629]/80 border border-slate-800/60 p-6">
              <div className="flex items-center gap-3 mb-4">
                <TrendingUp className="h-5 w-5 text-cyan-400" />
                <h3 className="text-lg font-black text-white">Equity Curves</h3>
              </div>
              <div className="h-[380px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={equityData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis
                      dataKey="day"
                      tick={{ fill: '#64748b', fontSize: 11 }}
                      axisLine={{ stroke: '#1e293b' }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: '#64748b', fontSize: 11 }}
                      axisLine={{ stroke: '#1e293b' }}
                      tickLine={false}
                      tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip content={<EquityTooltip />} />
                    <Legend
                      wrapperStyle={{ paddingTop: 8 }}
                      formatter={(value: string) => (
                        <span className="text-xs text-slate-300">
                          {STRATEGIES.find((s) => s.key === value)?.label ?? value}
                        </span>
                      )}
                    />
                    {strategies.map((s) => (
                      <Line
                        key={s.strategy}
                        type="monotone"
                        dataKey={s.strategy}
                        name={s.strategy}
                        stroke={STRATEGY_COLORS[s.strategy] ?? '#6b7280'}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 0 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ---- Metrics Comparison Table ---- */}
            <div className="rounded-xl bg-[#0F1629]/80 border border-slate-800/60 p-6 overflow-x-auto">
              <div className="flex items-center gap-3 mb-4">
                <BarChart3 className="h-5 w-5 text-violet-400" />
                <h3 className="text-lg font-black text-white">Metrics Comparison</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800/60">
                    <th className="text-left text-slate-500 text-xs uppercase tracking-wider py-2 pr-4">
                      Metric
                    </th>
                    {strategies.map((s) => (
                      <th key={s.strategy} className="text-right py-2 px-3">
                        <div className="flex items-center justify-end gap-2">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: STRATEGY_COLORS[s.strategy] }}
                          />
                          <span className="text-xs text-slate-300 font-bold">
                            {STRATEGIES.find((st) => st.key === s.strategy)?.label ?? s.strategy}
                          </span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {METRIC_DEFS.map((m) => {
                    const bw = bestWorst[m.key]
                    return (
                      <tr key={m.key} className="border-b border-slate-800/30">
                        <td className="text-slate-500 text-xs uppercase tracking-wider py-2.5 pr-4">
                          {m.label}
                        </td>
                        {strategies.map((s, idx) => {
                          const val = Number(s[m.key]) || 0
                          const isBest = bw?.bestIdx === idx
                          const isWorst = bw?.worstIdx === idx && strategies.length > 1
                          return (
                            <td
                              key={s.strategy}
                              className={`text-right font-mono py-2.5 px-3 ${
                                isBest
                                  ? 'text-emerald-400 font-bold'
                                  : isWorst
                                    ? 'text-slate-600'
                                    : 'text-white'
                              }`}
                            >
                              {m.format(val)}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* ---- Radar Chart ---- */}
            <div className="rounded-xl bg-[#0F1629]/80 border border-slate-800/60 p-6">
              <div className="flex items-center gap-3 mb-4">
                <RadarIcon className="h-5 w-5 text-amber-400" />
                <h3 className="text-lg font-black text-white">Strategy Profile</h3>
              </div>
              <div className="h-[380px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                    <PolarGrid stroke="#1e293b" />
                    <PolarAngleAxis
                      dataKey="metric"
                      tick={{ fill: '#94a3b8', fontSize: 12 }}
                    />
                    <PolarRadiusAxis
                      angle={90}
                      domain={[0, 100]}
                      tick={{ fill: '#475569', fontSize: 10 }}
                      axisLine={false}
                    />
                    {strategies.map((s) => (
                      <Radar
                        key={s.strategy}
                        name={STRATEGIES.find((st) => st.key === s.strategy)?.label ?? s.strategy}
                        dataKey={s.strategy}
                        stroke={STRATEGY_COLORS[s.strategy] ?? '#6b7280'}
                        fill={STRATEGY_COLORS[s.strategy] ?? '#6b7280'}
                        fillOpacity={0.12}
                        strokeWidth={2}
                      />
                    ))}
                    <Legend
                      wrapperStyle={{ paddingTop: 8 }}
                      formatter={(value: string) => (
                        <span className="text-xs text-slate-300">{value}</span>
                      )}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0F1629',
                        border: '1px solid rgba(30,41,59,0.6)',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: '#94a3b8' }}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ---- Correlation Matrix ---- */}
            {corrStrategies.length > 0 && (
              <div className="rounded-xl bg-[#0F1629]/80 border border-slate-800/60 p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Grid3X3 className="h-5 w-5 text-rose-400" />
                  <h3 className="text-lg font-black text-white">Correlation Matrix</h3>
                  <span className="text-xs text-slate-500 ml-2">
                    Low correlation = better diversification
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="text-sm mx-auto">
                    <thead>
                      <tr>
                        <th className="p-2" />
                        {corrStrategies.map((s) => (
                          <th key={s} className="p-2 text-xs text-slate-400 font-bold">
                            <div className="flex items-center justify-center gap-1">
                              <span
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: STRATEGY_COLORS[s] }}
                              />
                              <span className="truncate max-w-[80px]">
                                {STRATEGIES.find((st) => st.key === s)?.label ?? s}
                              </span>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {corrStrategies.map((row) => (
                        <tr key={row}>
                          <td className="p-2 text-xs text-slate-400 font-bold text-right">
                            <div className="flex items-center justify-end gap-1">
                              <span className="truncate max-w-[80px]">
                                {STRATEGIES.find((st) => st.key === row)?.label ?? row}
                              </span>
                              <span
                                className="w-2 h-2 rounded-full flex-shrink-0"
                                style={{ backgroundColor: STRATEGY_COLORS[row] }}
                              />
                            </div>
                          </td>
                          {corrStrategies.map((col) => {
                            const val = correlationMatrix[row]?.[col] ?? 0
                            const abs = Math.abs(val)
                            // Green for low correlation, red for high
                            const bg =
                              row === col
                                ? 'bg-slate-800/60'
                                : abs > 0.7
                                  ? 'bg-red-900/40'
                                  : abs > 0.4
                                    ? 'bg-amber-900/30'
                                    : 'bg-emerald-900/30'
                            const textColor =
                              row === col
                                ? 'text-slate-500'
                                : abs > 0.7
                                  ? 'text-red-400'
                                  : abs > 0.4
                                    ? 'text-amber-400'
                                    : 'text-emerald-400'
                            return (
                              <td
                                key={col}
                                className={`p-2 text-center font-mono text-xs font-bold rounded ${bg} ${textColor}`}
                              >
                                {fmt(val)}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ---- Combined Portfolio ---- */}
            <div className="rounded-xl bg-[#0F1629]/80 border border-slate-800/60 p-6">
              <div className="flex items-center gap-3 mb-4">
                <Sliders className="h-5 w-5 text-emerald-400" />
                <h3 className="text-lg font-black text-white">Combined Portfolio</h3>
                <span className="text-xs text-slate-500 ml-2">
                  Adjust allocations (total: {Object.values(allocations).reduce((a, b) => a + b, 0)}%)
                </span>
              </div>

              {/* Allocation sliders */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {strategies.map((s) => {
                  const label = STRATEGIES.find((st) => st.key === s.strategy)?.label ?? s.strategy
                  const color = STRATEGY_COLORS[s.strategy] ?? '#6b7280'
                  const alloc = allocations[s.strategy] ?? 0
                  return (
                    <div key={s.strategy} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: color }}
                          />
                          <span className="text-sm text-slate-300 font-bold">{label}</span>
                        </div>
                        <span className="text-sm font-mono text-white font-bold">{alloc}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={alloc}
                        onChange={(e) =>
                          handleAllocation(s.strategy, parseInt(e.target.value, 10))
                        }
                        className="w-full h-1.5 rounded-full appearance-none bg-slate-800 cursor-pointer
                          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5
                          [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full
                          [&::-webkit-slider-thumb]:cursor-pointer"
                        style={
                          {
                            '--tw-slider-thumb-bg': color,
                            accentColor: color,
                          } as React.CSSProperties
                        }
                      />
                    </div>
                  )
                })}
              </div>

              {/* Combined metrics */}
              {combinedMetrics && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Return', value: fmtPct(combinedMetrics.total_return), positive: combinedMetrics.total_return > 0 },
                    { label: 'Sharpe', value: fmt(combinedMetrics.sharpe_ratio), positive: combinedMetrics.sharpe_ratio > 1 },
                    { label: 'Sortino', value: fmt(combinedMetrics.sortino_ratio), positive: combinedMetrics.sortino_ratio > 1 },
                    { label: 'Calmar', value: fmt(combinedMetrics.calmar_ratio), positive: combinedMetrics.calmar_ratio > 1 },
                    { label: 'Win Rate', value: fmtPct(combinedMetrics.win_rate), positive: combinedMetrics.win_rate > 0.5 },
                    { label: 'Max DD', value: fmtPct(combinedMetrics.max_drawdown), positive: combinedMetrics.max_drawdown > -0.1 },
                    { label: 'Profit Factor', value: fmt(combinedMetrics.profit_factor), positive: combinedMetrics.profit_factor > 1 },
                    { label: 'Expectancy', value: `$${fmt(combinedMetrics.expectancy)}`, positive: combinedMetrics.expectancy > 0 },
                  ].map((m) => (
                    <div
                      key={m.label}
                      className="rounded-xl bg-[#0A0E1A] border border-slate-800/60 p-4 flex flex-col gap-1"
                    >
                      <span className="text-xs text-slate-500 uppercase tracking-wider">
                        {m.label}
                      </span>
                      <span
                        className={`text-xl font-black font-mono ${
                          m.positive ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {m.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
