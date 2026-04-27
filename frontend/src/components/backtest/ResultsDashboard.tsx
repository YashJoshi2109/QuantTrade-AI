'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  TrendingUp, TrendingDown, Activity, BarChart3, Target, Shield,
  Percent, Flame, Gauge, DollarSign, Zap, Layers, Database,
  CheckCircle, AlertTriangle, LineChart as LineChartIcon
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, BarChart, Bar, ScatterChart, Scatter, Cell, ReferenceLine
} from 'recharts'
import type { BacktestResult } from '@/lib/api'
import { useThemeTokens } from '@/hooks/useThemeTokens'

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function MetricCard({
  label, value, sub, positive, icon: Icon
}: {
  label: string
  value: string
  sub?: string
  positive?: boolean
  icon?: LucideIcon
}) {
  return (
    <div className="rounded-xl bg-surface-raised border border-line-subtle p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2 mb-1">
        {Icon && <Icon className="h-4 w-4 text-fg-muted" />}
        <span className="text-xs text-fg-muted uppercase tracking-wider">{label}</span>
      </div>
      <span
        className={`text-2xl font-black font-mono ${
          positive === undefined
            ? 'text-fg-primary'
            : positive
              ? 'text-emerald-400'
              : 'text-red-400'
        }`}
      >
        {value}
      </span>
      {sub && <span className="text-[11px] text-fg-muted font-mono">{sub}</span>}
    </div>
  )
}

function Section({
  title, icon: Icon, right, children
}: {
  title: string
  icon?: LucideIcon
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-xl bg-surface-raised border border-line-subtle p-5"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-fg-secondary" />}
          <h3 className="text-sm font-black uppercase tracking-wider text-fg-primary">{title}</h3>
        </div>
        {right}
      </div>
      {children}
    </motion.section>
  )
}

/* ------------------------------------------------------------------ */
/*  Custom Recharts Tooltip                                            */
/* ------------------------------------------------------------------ */

function ChartTooltip({ active, payload, label, prefix, suffix }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface-overlay border border-line-default rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="text-fg-secondary mb-1">Index {label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="font-mono" style={{ color: p.color }}>
          {p.name}: {prefix ?? ''}{typeof p.value === 'number' ? p.value.toFixed(2) : p.value}{suffix ?? ''}
        </p>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmt(v: number | undefined | null, decimals = 2): string {
  if (v === null || v === undefined || isNaN(v)) return '--'
  return v.toFixed(decimals)
}

function fmtPct(v: number | undefined | null, decimals = 2): string {
  if (v === null || v === undefined || isNaN(v)) return '--'
  return `${v.toFixed(decimals)}%`
}

function fmtDollar(v: number | undefined | null): string {
  if (v === null || v === undefined || isNaN(v)) return '--'
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function returnColor(v: number): string {
  if (v > 3) return '#059669'
  if (v > 1) return '#34d399'
  if (v > 0) return '#6ee7b7'
  if (v > -1) return '#fca5a5'
  if (v > -3) return '#f87171'
  return '#dc2626'
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

interface ResultsDashboardProps {
  result: BacktestResult
}

export default function ResultsDashboard({ result }: ResultsDashboardProps) {
  const t = useThemeTokens()
  const axisTick = { fill: t.textMuted, fontSize: 10 }
  const axisLine = { stroke: t.borderDefault }

  /* ---- derived data ---- */

  const equityData = useMemo(
    () => (result.equity_curve ?? []).map((v, i) => ({ idx: i, value: v })),
    [result.equity_curve]
  )

  const benchmarkData = useMemo(
    () => (result.benchmark_equity ?? []).map((v, i) => ({ idx: i, value: v })),
    [result.benchmark_equity]
  )

  const hasBenchmark = benchmarkData.length > 0

  const equityCombined = useMemo(() => {
    if (!hasBenchmark) return equityData
    return equityData.map((d, i) => ({
      ...d,
      benchmark: benchmarkData[i]?.value ?? null,
    }))
  }, [equityData, benchmarkData, hasBenchmark])

  const drawdownData = useMemo(
    () => (result.drawdown_curve ?? []).map((v, i) => ({ idx: i, value: v })),
    [result.drawdown_curve]
  )

  const rollingSharpeData = useMemo(
    () => (result.rolling_sharpe ?? []).map((v, i) => ({ idx: i, value: v })),
    [result.rolling_sharpe]
  )

  const tradeDistData = useMemo(
    () =>
      (result.trade_distribution ?? []).map((b) => ({
        label: `${b.range_start.toFixed(1)}`,
        count: b.count,
        positive: (b.range_start + b.range_end) / 2 >= 0,
      })),
    [result.trade_distribution]
  )

  const maeMfeData = useMemo(
    () =>
      (result.mae_mfe ?? []).map((t) => ({
        mae: t.mae,
        mfe: t.mfe,
        profit: t.return_pct >= 0,
      })),
    [result.mae_mfe]
  )

  const monthlyReturns = result.monthly_returns ?? []

  /* group monthly returns into year rows */
  const monthlyGrid = useMemo(() => {
    if (!monthlyReturns.length) return []
    const byYear: Record<number, Record<number, number>> = {}
    monthlyReturns.forEach(({ month, return_pct }) => {
      const y = Math.floor(month / 100)
      const m = month % 100
      if (!byYear[y]) byYear[y] = {}
      byYear[y][m] = return_pct
    })
    return Object.entries(byYear)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([year, months]) => ({ year: Number(year), months }))
  }, [monthlyReturns])

  const mc = result.monte_carlo
  const wf = result.walk_forward

  const mcDistData = useMemo(
    () =>
      (mc?.distribution ?? []).map((b) => ({
        label: `${b.range_start.toFixed(0)}`,
        count: b.count,
        frequency: b.frequency,
      })),
    [mc]
  )

  /* ---- max drawdown index for annotation ---- */
  const maxDdIdx = useMemo(() => {
    if (!drawdownData.length) return 0
    let minVal = 0
    let minIdx = 0
    drawdownData.forEach((d, i) => {
      if (d.value < minVal) {
        minVal = d.value
        minIdx = i
      }
    })
    return minIdx
  }, [drawdownData])

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="space-y-6"
    >
      {/* ====== 1. Top Metric Cards ====== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          icon={TrendingUp}
          label="Total Return"
          value={fmtPct(result.total_return)}
          sub={`${fmtDollar(result.initial_capital)} -> ${fmtDollar(result.final_equity)}`}
          positive={result.total_return >= 0}
        />
        <MetricCard
          icon={Activity}
          label="Sharpe Ratio"
          value={fmt(result.sharpe_ratio)}
          sub="Risk-adjusted return"
          positive={result.sharpe_ratio >= 1}
        />
        <MetricCard
          icon={Target}
          label="Win Rate"
          value={fmtPct(result.win_rate)}
          sub={`${result.total_trades} trades`}
          positive={result.win_rate >= 50}
        />
        <MetricCard
          icon={TrendingDown}
          label="Max Drawdown"
          value={fmtPct(result.max_drawdown)}
          sub={`${result.max_drawdown_duration} bars`}
          positive={false}
        />
      </div>

      {/* ====== 2. Secondary Metrics Grid ====== */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <MetricCard icon={Flame} label="CAGR" value={fmtPct(result.cagr)} />
        <MetricCard icon={Shield} label="Sortino" value={fmt(result.sortino_ratio)} positive={result.sortino_ratio >= 1} />
        <MetricCard icon={Gauge} label="Calmar" value={fmt(result.calmar_ratio)} positive={result.calmar_ratio >= 1} />
        <MetricCard icon={DollarSign} label="Profit Factor" value={fmt(result.profit_factor)} positive={result.profit_factor >= 1.5} />
        <MetricCard icon={AlertTriangle} label="VaR 95%" value={fmtPct(result.var_95)} positive={false} />
        <MetricCard icon={Zap} label="Alpha" value={fmt(result.alpha)} positive={result.alpha >= 0} />
        <MetricCard icon={Layers} label="Beta" value={fmt(result.beta)} />
        <MetricCard icon={Percent} label="Ulcer Index" value={fmt(result.ulcer_index)} />
      </div>

      {/* ====== 3. Equity Curve ====== */}
      {equityData.length > 0 && (
        <Section title="Equity Curve" icon={TrendingUp}>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={equityCombined} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#34d399" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={t.borderDefault} />
              <XAxis dataKey="idx" tick={axisTick} axisLine={axisLine} tickLine={false} />
              <YAxis
                tick={axisTick}
                axisLine={axisLine}
                tickLine={false}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip content={<ChartTooltip prefix="$" />} />
              <Area
                type="monotone"
                dataKey="value"
                name="Strategy"
                stroke="#34d399"
                strokeWidth={2}
                fill="url(#equityGrad)"
                dot={false}
                isAnimationActive={false}
              />
              {hasBenchmark && (
                <Area
                  type="monotone"
                  dataKey="benchmark"
                  name="Benchmark"
                  stroke={t.textMuted}
                  strokeWidth={1.5}
                  strokeDasharray="6 3"
                  fill="transparent"
                  dot={false}
                  isAnimationActive={false}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
          {hasBenchmark && (
            <p className="text-[11px] text-fg-muted mt-2">
              Benchmark: {result.benchmark_ticker ?? 'SPY'} (dashed)
            </p>
          )}
        </Section>
      )}

      {/* ====== 4. Drawdown Chart ====== */}
      {drawdownData.length > 0 && (
        <Section title="Drawdown" icon={TrendingDown}>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={drawdownData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f87171" stopOpacity={0.05} />
                  <stop offset="100%" stopColor="#f87171" stopOpacity={0.4} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={t.borderDefault} />
              <XAxis dataKey="idx" tick={axisTick} axisLine={axisLine} tickLine={false} />
              <YAxis
                tick={axisTick}
                axisLine={axisLine}
                tickLine={false}
                tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              />
              <Tooltip content={<ChartTooltip suffix="%" />} />
              <ReferenceLine y={0} stroke={t.borderSubtle} strokeWidth={1} />
              <Area
                type="monotone"
                dataKey="value"
                name="Drawdown"
                stroke="#f87171"
                strokeWidth={1.5}
                fill="url(#ddGrad)"
                dot={false}
                isAnimationActive={false}
              />
              {/* Max drawdown annotation */}
              <ReferenceLine
                x={maxDdIdx}
                stroke="#dc2626"
                strokeDasharray="4 2"
                label={{
                  value: `Max DD: ${fmtPct(result.max_drawdown)}`,
                  fill: '#dc2626',
                  fontSize: 10,
                  position: 'insideTopRight',
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Section>
      )}

      {/* ====== 5. Rolling Sharpe ====== */}
      {rollingSharpeData.length > 0 && (
        <Section
          title="Rolling Sharpe"
          icon={LineChartIcon}
          right={<span className="text-[10px] text-fg-muted font-mono">63-day window</span>}
        >
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={rollingSharpeData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={t.borderDefault} />
              <XAxis dataKey="idx" tick={axisTick} axisLine={axisLine} tickLine={false} />
              <YAxis tick={axisTick} axisLine={axisLine} tickLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine y={0} stroke={t.borderSubtle} strokeWidth={1} />
              <Line
                type="monotone"
                dataKey="value"
                name="Sharpe"
                stroke="#a78bfa"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </Section>
      )}

      {/* ====== 6. Monthly Returns Heatmap ====== */}
      {monthlyGrid.length > 0 && (
        <Section title="Monthly Returns" icon={BarChart3}>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr>
                  <th className="text-left text-fg-muted pb-2 pr-3">Year</th>
                  {Array.from({ length: 12 }, (_, i) => (
                    <th key={i} className="text-center text-fg-muted pb-2 px-1 min-w-[42px]">
                      {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthlyGrid.map(({ year, months }) => (
                  <tr key={year}>
                    <td className="text-fg-muted pr-3 py-0.5">{year}</td>
                    {Array.from({ length: 12 }, (_, m) => {
                      const val = months[m + 1]
                      if (val === undefined) {
                        return <td key={m} className="px-1 py-0.5" />
                      }
                      return (
                        <td key={m} className="px-1 py-0.5">
                          <div
                            className="rounded text-center py-0.5 px-1"
                            style={{
                              backgroundColor: returnColor(val) + '30',
                              color: returnColor(val),
                            }}
                          >
                            {val.toFixed(1)}%
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* ====== 7. Trade Distribution Histogram ====== */}
      {tradeDistData.length > 0 && (
        <Section title="Trade Distribution" icon={BarChart3}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={tradeDistData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={t.borderDefault} />
              <XAxis dataKey="label" tick={axisTick} axisLine={axisLine} tickLine={false} />
              <YAxis tick={axisTick} axisLine={axisLine} tickLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine x="0.0" stroke={t.borderSubtle} strokeWidth={1} />
              <Bar dataKey="count" name="Trades" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {tradeDistData.map((d, i) => (
                  <Cell key={i} fill={d.positive ? '#34d399' : '#f87171'} fillOpacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Section>
      )}

      {/* ====== 8. MAE / MFE Scatter ====== */}
      {maeMfeData.length > 0 && (
        <Section title="MAE / MFE Scatter" icon={Target}>
          <ResponsiveContainer width="100%" height={250}>
            <ScatterChart margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={t.borderDefault} />
              <XAxis
                dataKey="mae"
                name="MAE"
                type="number"
                tick={axisTick}
                axisLine={axisLine}
                tickLine={false}
                label={{ value: 'MAE (adverse)', position: 'insideBottomRight', offset: -4, fill: t.textMuted, fontSize: 10 }}
              />
              <YAxis
                dataKey="mfe"
                name="MFE"
                type="number"
                tick={axisTick}
                axisLine={axisLine}
                tickLine={false}
                label={{ value: 'MFE (favorable)', position: 'insideTopLeft', offset: -4, fill: t.textMuted, fontSize: 10, angle: -90 }}
              />
              <Tooltip
                content={({ active, payload }: any) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0]?.payload
                  return (
                    <div className="bg-surface-overlay border border-line-default rounded-lg px-3 py-2 shadow-xl text-xs">
                      <p className="font-mono text-fg-secondary">MAE: {d?.mae?.toFixed(2)}%</p>
                      <p className="font-mono text-fg-secondary">MFE: {d?.mfe?.toFixed(2)}%</p>
                      <p className={`font-mono ${d?.profit ? 'text-emerald-400' : 'text-red-400'}`}>
                        {d?.profit ? 'Winner' : 'Loser'}
                      </p>
                    </div>
                  )
                }}
              />
              <ReferenceLine x={0} stroke={t.borderSubtle} strokeWidth={1} />
              <ReferenceLine y={0} stroke={t.borderSubtle} strokeWidth={1} />
              <Scatter data={maeMfeData} isAnimationActive={false}>
                {maeMfeData.map((d, i) => (
                  <Cell key={i} fill={d.profit ? '#34d399' : '#f87171'} fillOpacity={0.7} r={4} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </Section>
      )}

      {/* ====== 9. Walk-Forward Badge ====== */}
      {wf?.enabled && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 rounded-xl bg-surface-raised border border-emerald-800/40 px-5 py-3"
        >
          <CheckCircle className="h-5 w-5 text-emerald-400 shrink-0" />
          <div>
            <p className="text-sm font-black text-emerald-400">Walk-Forward Validated</p>
            <p className="text-xs text-fg-muted font-mono">
              Train: {wf.train_bars ?? wf.train_pct ?? '--'} | Test: {wf.test_bars ?? '--'} bars
            </p>
          </div>
        </motion.div>
      )}

      {/* ====== 10. Monte Carlo ====== */}
      {mc && (
        <Section title="Monte Carlo Simulation" icon={Activity} right={
          <span className="text-[10px] text-fg-muted font-mono">{mc.n_simulations.toLocaleString()} sims</span>
        }>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <MetricCard
              label="P(Profit)"
              value={fmtPct(mc.probability_of_profit)}
              positive={mc.probability_of_profit >= 50}
            />
            <MetricCard
              label="P(Ruin)"
              value={fmtPct(mc.probability_of_ruin)}
              positive={mc.probability_of_ruin < 5}
            />
            <MetricCard
              label="Median Return"
              value={fmtPct(mc.median_return)}
              positive={mc.median_return >= 0}
            />
            <MetricCard
              label="Avg Max DD"
              value={fmtPct(mc.avg_max_drawdown)}
              positive={false}
            />
          </div>

          {/* probability band */}
          <div className="flex items-center gap-2 text-[11px] font-mono text-fg-muted mb-4">
            <span className="text-red-400">{fmtPct(mc.p5_return)}</span>
            <div className="flex-1 h-2 rounded-full bg-surface-raised relative overflow-hidden">
              <div
                className="absolute inset-y-0 bg-gradient-to-r from-red-500/40 via-slate-600/30 to-emerald-500/40 rounded-full"
                style={{ left: '5%', right: '5%' }}
              />
            </div>
            <span className="text-emerald-400">{fmtPct(mc.p95_return)}</span>
          </div>

          {mcDistData.length > 0 && (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={mcDistData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={t.borderDefault} />
                <XAxis dataKey="label" tick={axisTick} axisLine={axisLine} tickLine={false} />
                <YAxis tick={axisTick} axisLine={axisLine} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name="Simulations" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {mcDistData.map((d, i) => (
                    <Cell key={i} fill={Number(d.label) >= 0 ? '#34d399' : '#f87171'} fillOpacity={0.7} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Section>
      )}

      {/* ====== 11. Data Source Badge ====== */}
      {result.data_source && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-2 text-xs text-fg-muted"
        >
          <Database className="h-3.5 w-3.5" />
          <span className="font-mono">
            Data source: <span className="text-fg-secondary">{result.data_source}</span>
          </span>
        </motion.div>
      )}
    </motion.div>
  )
}
