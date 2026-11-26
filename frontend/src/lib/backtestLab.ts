/**
 * Strategy Lab (rule-based backtests): API client + shared view helpers.
 * Desktop and mobile both import from here so numbers, copy and validation
 * never drift apart.
 *
 * Backend: /api/v1/backtest/v2/* (backend/app/api/backtest_v2.py). Auth is
 * the httpOnly session cookie, so every call sends credentials.
 * Engine contract: docs/BACKTESTING.md (decisions at the close, fills at the
 * next bar's open, costs per side, no look-ahead).
 */
import { errorText, fmtMoney, fmtPct } from './portfolio'

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

export const DISCLAIMER = 'Hypothetical results; past performance does not guarantee future results.'

// ── Spec types (mirror backend/app/services/backtesting/rules.py) ─────────

export type Num = number | string // number or "$param" reference
export type Op = '>' | '<' | '>=' | '<=' | 'crosses_above' | 'crosses_below'

export interface Operand {
  indicator?: string | null
  params?: Record<string, Num>
  value?: Num | null
}

export interface Condition {
  left: Operand
  op: Op
  right: Operand
}

export interface Group {
  logic: 'all' | 'any'
  rules: (Condition | Group)[]
}

export interface StrategySpec {
  symbols: string[]
  start_date: string
  end_date: string
  benchmark: string
  entry: Group
  exit: Group | null
  parameters: Record<string, number>
  param_grid: Record<string, number[]>
  side: 'long' | 'short'
  initial_capital: number
  commission_bps: number
  slippage_bps: number
  borrow_bps_annual: number
  sizing: 'fixed_dollar' | 'pct_equity' | 'vol_target'
  sizing_value: number
  vol_lookback: number
  max_position_weight: number
  max_gross_exposure: number
  stop_loss_pct: number | null
  take_profit_pct: number | null
  trailing_stop_pct: number | null
  max_hold_bars: number | null
  signal_frequency: 'daily' | 'weekly' | 'monthly'
  rebalance: 'none' | 'weekly' | 'monthly'
  fractional_shares: boolean
}

export interface RobustnessOptions {
  oos_split: number | null
  sweep: boolean
  walk_forward_folds: number | null
  walk_forward_mode: 'anchored' | 'rolling'
  objective: 'sharpe' | 'cagr'
  monte_carlo_sims: number
  seed: number
}

export interface IndicatorMeta {
  id: string
  description: string
  params: Record<string, { type: 'int' | 'float'; default: number; min: number; max: number }>
}

export interface Preset {
  id: string
  name: string
  category: string
  description: string
  spec: Partial<StrategySpec>
}

export interface Limits {
  max_symbols: number
  max_years: number
  max_grid_combos: number
  max_param_values: number
  max_window: number
  max_conditions: number
  max_rule_depth: number
  max_mc_sims: number
  max_wf_folds: number
  job_time_budget_s: number
  max_work_cells: number
}

export interface LabMeta {
  indicators: IndicatorMeta[]
  operators: Op[]
  presets: Preset[]
  limits: Limits
  disclaimer: string
}

// ── Result types ─────────────────────────────────────────────────────────

export interface LabTrade {
  symbol: string
  side: 'LONG' | 'SHORT'
  signal_date: string
  entry_date: string
  entry_price: number
  exit_signal_date: string | null
  exit_date: string
  exit_price: number
  quantity: number
  pnl: number
  return_pct: number
  commission: number
  bars_held: number
  exit_reason: string
  mae: number
  mfe: number
}

export type Metrics = Record<string, unknown> & {
  benchmark?: Record<string, number | null>
}

export interface SeriesPoint {
  date: string
  equity: number | null
  benchmark: number | null
  drawdown_pct: number | null
}

export interface Band {
  date: string
  p5: number
  p25: number
  p50: number
  p75: number
  p95: number
}

export interface SliceMetrics {
  total_return_pct?: number | null
  cagr_pct?: number | null
  volatility_pct?: number | null
  sharpe?: number | null
  sortino?: number | null
  max_drawdown_pct?: number | null
  calmar?: number | null
  total_trades?: number
  start?: string
  end?: string
  benchmark_total_return_pct?: number | null
}

export interface SweepRow {
  params: Record<string, number>
  full: number | null
  in_sample?: number | null
  out_of_sample?: number | null
  total_return_pct?: number | null
  cagr_pct?: number | null
  sharpe?: number | null
  max_drawdown_pct?: number | null
  total_trades?: number
}

export interface LabResult {
  disclaimer: string
  spec: StrategySpec
  parameters_used: Record<string, number>
  rules_text: { entry: string; exit: string }
  execution: Record<string, unknown>
  data: Record<string, { source: string; adjusted: boolean; first_bar: string; last_bar: string }>
  metrics: Metrics
  series: { points: SeriesPoint[]; sampled: boolean }
  monthly_returns: { year: number; month: number; return_pct: number | null }[]
  yearly_returns: { year: number; return_pct: number | null }[]
  trades: LabTrade[]
  trades_truncated: boolean
  robustness: {
    split?: { split_date: string; in_sample_fraction: number; in_sample: SliceMetrics; out_of_sample: SliceMetrics; note: string }
    sweep?: null | {
      variants: number
      objective: string
      grid: SweepRow[]
      oos_split?: {
        split_date: string
        selected: number
        selected_params: Record<string, number>
        in_sample: { sharpe: number | null; total_return_pct: number | null }
        out_of_sample: { sharpe: number | null; total_return_pct: number | null }
        oos_rank_of_is_winner: number
        is_oos_rank_correlation?: number | null
      }
      pbo?: null | { pbo: number; splits: number; variants: number; is_winner_oos_sharpe_median: number; prob_oos_loss: number }
      deflated_sharpe?: null | DeflatedSharpe
      best_full_period?: { params: Record<string, number>; objective: number | null }
      walk_forward?: {
        mode: string
        folds: { train: [string, string]; test: [string, string]; params: Record<string, number>; train_sharpe: number | null; test_sharpe: number | null; test_return_pct: number | null }[]
        oos_sharpe: number | null
        oos_total_return_pct: number | null
        mean_train_sharpe: number | null
        efficiency: number | null
        equity: { date: string; equity: number }[]
      }
    }
    deflated_sharpe?: null | DeflatedSharpe
  }
  monte_carlo: null | {
    block_bootstrap: null | {
      simulations: number
      final_return_pct: Record<'p5' | 'p25' | 'p50' | 'p75' | 'p95', number>
      cagr_pct: Record<'p5' | 'p50' | 'p95', number>
      max_drawdown_pct: Record<'p5' | 'p50' | 'p95', number>
      probability_of_loss_pct: number
      probability_drawdown_over_50_pct: number
      bands: Band[]
    }
    trade_bootstrap: null | { skipped: boolean; reason?: string; final_return_pct?: Record<string, number>; probability_of_loss_pct?: number }
  }
  warnings: string[]
  elapsed_s: number
}

export interface DeflatedSharpe {
  deflated_sharpe_probability: number
  sharpe_annual: number
  benchmark_sharpe_annual: number
  trials: number
}

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled' | 'timeout'

export interface Job {
  id: string
  status: JobStatus
  stage: string
  progress: number
  error: string | null
  result?: LabResult
}

// ── API ──────────────────────────────────────────────────────────────────

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1/backtest/v2${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(errorText(body, res.status))
  return body as T
}

export const labApi = {
  meta: () => call<LabMeta>('/meta'),
  validate: (spec: StrategySpec, robustness: RobustnessOptions) =>
    call<{ ok: boolean; combinations: number; warmup_bars: number; rules_text: { entry: string; exit: string } }>('/validate', {
      method: 'POST', body: JSON.stringify({ spec, robustness }),
    }),
  start: (spec: StrategySpec, robustness: RobustnessOptions) =>
    call<Job>('/jobs', { method: 'POST', body: JSON.stringify({ spec, robustness }) }),
  get: (id: string) => call<Job>(`/jobs/${id}`),
  cancel: (id: string) => call<Job>(`/jobs/${id}`, { method: 'DELETE' }),
}

// ── Spec helpers ─────────────────────────────────────────────────────────

export const DEFAULT_ROBUSTNESS: RobustnessOptions = {
  oos_split: 0.7, sweep: true, walk_forward_folds: 5, walk_forward_mode: 'anchored',
  objective: 'sharpe', monte_carlo_sims: 500, seed: 7,
}

export function yearsAgo(n: number, from = new Date()): string {
  const d = new Date(from)
  d.setFullYear(d.getFullYear() - n)
  return d.toISOString().slice(0, 10)
}

export function baseSpec(): StrategySpec {
  return {
    symbols: ['SPY'], start_date: yearsAgo(10), end_date: new Date().toISOString().slice(0, 10), benchmark: 'SPY',
    entry: { logic: 'all', rules: [] }, exit: null, parameters: {}, param_grid: {}, side: 'long',
    initial_capital: 10_000, commission_bps: 1, slippage_bps: 5, borrow_bps_annual: 0,
    sizing: 'pct_equity', sizing_value: 1, vol_lookback: 20, max_position_weight: 1, max_gross_exposure: 1,
    stop_loss_pct: null, take_profit_pct: null, trailing_stop_pct: null, max_hold_bars: null,
    signal_frequency: 'daily', rebalance: 'none', fractional_shares: true,
  }
}

/** A full spec from a preset, keeping the user's dates, capital and costs. */
export function specFromPreset(p: Preset, keep?: Partial<StrategySpec>): StrategySpec {
  const s = { ...baseSpec(), ...structuredClone(p.spec) } as StrategySpec
  if (keep) {
    for (const k of ['start_date', 'end_date', 'initial_capital', 'commission_bps', 'slippage_bps', 'benchmark'] as const) {
      if (keep[k] !== undefined) (s as unknown as Record<string, unknown>)[k] = keep[k]
    }
  }
  s.exit = s.exit ?? null
  s.parameters = s.parameters ?? {}
  s.param_grid = s.param_grid ?? {}
  return s
}

export function isGroup(r: Condition | Group): r is Group {
  return (r as Group).rules !== undefined
}

export function newCondition(): Condition {
  return { left: { indicator: 'close', params: {} }, op: '>', right: { indicator: 'sma', params: { period: 50 } } }
}

/** Default params for an indicator (from /meta). */
export function defaultParams(meta: LabMeta | undefined, indicator: string): Record<string, Num> {
  const m = meta?.indicators.find((i) => i.id === indicator)
  if (!m) return {}
  return Object.fromEntries(Object.entries(m.params).map(([k, v]) => [k, v.default]))
}

/** Immutable update of the rule at ``path`` (indices into nested groups). */
export function updateRule(g: Group, path: number[], fn: (r: Condition | Group) => Condition | Group | null): Group {
  if (path.length === 0) return g
  const [i, ...rest] = path
  const rules = g.rules.slice()
  if (rest.length === 0) {
    const next = fn(rules[i])
    if (next === null) rules.splice(i, 1)
    else rules[i] = next
  } else {
    rules[i] = updateRule(rules[i] as Group, rest, fn)
  }
  return { ...g, rules }
}

export function countConditions(g: Group | null): number {
  if (!g) return 0
  return g.rules.reduce((n, r) => n + (isGroup(r) ? countConditions(r) : 1), 0)
}

export function groupDepth(g: Group | null): number {
  if (!g) return 0
  return 1 + Math.max(0, ...g.rules.map((r) => (isGroup(r) ? groupDepth(r) : 0)))
}

export const OP_LABELS: Record<Op, string> = {
  '>': 'is above', '<': 'is below', '>=': 'is at or above', '<=': 'is at or below',
  crosses_above: 'crosses above', crosses_below: 'crosses below',
}

function resolveNum(v: Num | undefined, params: Record<string, number>): string {
  if (v === undefined) return '?'
  if (typeof v === 'string') return v.startsWith('$') && params[v.slice(1)] !== undefined ? String(params[v.slice(1)]) : v
  return String(v)
}

export function operandText(o: Operand, params: Record<string, number> = {}): string {
  if (o.indicator == null) return resolveNum(o.value ?? undefined, params)
  const args = Object.values(o.params ?? {}).map((v) => resolveNum(v, params))
  return args.length ? `${o.indicator.toUpperCase()}(${args.join(',')})` : o.indicator.toUpperCase()
}

/** Plain-English rule text (same wording as the backend's ``describe_group``). */
export function groupText(g: Group | null, params: Record<string, number> = {}): string {
  if (!g || g.rules.length === 0) return 'none'
  return g.rules
    .map((r) => (isGroup(r) ? `(${groupText(r, params)})` : `${operandText(r.left, params)} ${r.op.replace('_', ' ')} ${operandText(r.right, params)}`))
    .join(g.logic === 'all' ? ' AND ' : ' OR ')
}

/** "10, 20, 30" -> [10, 20, 30]; also accepts ranges "10-50:10". */
export function parseGrid(text: string): number[] | null {
  const t = text.trim()
  if (!t) return []
  const range = t.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/)
  if (range) {
    const [a, b, step] = range.slice(1).map(Number)
    if (step <= 0 || b < a) return null
    const out: number[] = []
    for (let x = a; x <= b + 1e-9 && out.length <= 100; x += step) out.push(Math.round(x * 1e6) / 1e6)
    return out
  }
  const parts = t.split(/[,\s]+/).filter(Boolean).map(Number)
  return parts.every(Number.isFinite) ? Array.from(new Set(parts)) : null
}

export function gridSize(grid: Record<string, number[]>): number {
  const vals = Object.values(grid).filter((v) => v.length > 0)
  return vals.length ? vals.reduce((n, v) => n * v.length, 1) : 1
}

/** Parameter names referenced as "$name" anywhere in the rules. */
export function referencedParams(spec: Pick<StrategySpec, 'entry' | 'exit'>): string[] {
  const out = new Set<string>()
  const visit = (g: Group | null) => {
    if (!g) return
    for (const r of g.rules) {
      if (isGroup(r)) visit(r)
      else
        for (const o of [r.left, r.right]) {
          for (const v of [...Object.values(o.params ?? {}), o.value]) {
            if (typeof v === 'string' && v.startsWith('$')) out.add(v.slice(1))
          }
        }
    }
  }
  visit(spec.entry)
  visit(spec.exit)
  return Array.from(out).sort()
}

const LIMIT_DEFAULTS: Limits = {
  max_symbols: 10, max_years: 25, max_grid_combos: 60, max_param_values: 12, max_window: 400,
  max_conditions: 12, max_rule_depth: 3, max_mc_sims: 2000, max_wf_folds: 10, job_time_budget_s: 60,
  max_work_cells: 1_500_000,
}

/** Client-side checks that mirror the server's bounds, so users see why before they submit. */
export function validateSpec(spec: StrategySpec, limits: Limits = LIMIT_DEFAULTS): string[] {
  const errs: string[] = []
  if (spec.symbols.length === 0) errs.push('Add at least one symbol.')
  if (spec.symbols.length > limits.max_symbols) errs.push(`At most ${limits.max_symbols} symbols.`)
  const s = Date.parse(spec.start_date), e = Date.parse(spec.end_date)
  if (!Number.isFinite(s) || !Number.isFinite(e) || s >= e) errs.push('Start date must be before end date.')
  const years = (e - s) / (365.25 * 864e5)
  if (years > limits.max_years) errs.push(`Date range is limited to ${limits.max_years} years.`)
  if (spec.entry.rules.length === 0) errs.push('Add at least one entry condition.')
  if (countConditions(spec.entry) + countConditions(spec.exit) > limits.max_conditions * 2) errs.push('Too many conditions.')
  if (Math.max(groupDepth(spec.entry), groupDepth(spec.exit)) > limits.max_rule_depth) errs.push(`Groups can nest at most ${limits.max_rule_depth} levels.`)
  const combos = gridSize(spec.param_grid)
  if (combos > limits.max_grid_combos) errs.push(`The parameter grid has ${combos} combinations; the limit is ${limits.max_grid_combos}.`)
  for (const [k, v] of Object.entries(spec.param_grid)) {
    if (v.length > limits.max_param_values) errs.push(`'${k}' has ${v.length} values; the limit is ${limits.max_param_values}.`)
  }
  const missing = referencedParams(spec).filter((p) => spec.parameters[p] === undefined && !spec.param_grid[p]?.length)
  if (missing.length) errs.push(`Set a value for ${missing.map((m) => '$' + m).join(', ')}.`)
  if (Number.isFinite(years) && spec.symbols.length * years * 252 * combos > limits.max_work_cells)
    errs.push('Too much work for one run: reduce symbols, years or parameter values.')
  if (!(spec.initial_capital > 0)) errs.push('Initial capital must be positive.')
  if (spec.sizing === 'pct_equity' && !(spec.sizing_value > 0 && spec.sizing_value <= 1)) errs.push('% of equity must be between 0 and 100%.')
  return errs
}

// ── Result helpers ───────────────────────────────────────────────────────

export function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function fmtRatio(v: unknown, digits = 2): string {
  const n = num(v)
  return n == null ? '—' : n.toFixed(digits)
}

export type MetricFormat = 'pct' | 'pct_unsigned' | 'ratio' | 'money' | 'int' | 'days' | 'x'

export interface MetricDef {
  key: string
  label: string
  format: MetricFormat
  hint: string
  /** true when larger is better (for coloring) */
  higherIsBetter?: boolean
}

export const METRIC_DEFS: MetricDef[] = [
  { key: 'total_return_pct', label: 'Total return', format: 'pct', hint: 'Final equity vs. starting capital, after all costs.', higherIsBetter: true },
  { key: 'cagr_pct', label: 'CAGR', format: 'pct', hint: 'Compound annual growth, using calendar years.', higherIsBetter: true },
  { key: 'volatility_pct', label: 'Volatility', format: 'pct_unsigned', hint: 'Annualised standard deviation of daily returns.' },
  { key: 'sharpe', label: 'Sharpe', format: 'ratio', hint: 'Annualised mean / std of daily returns (rf = 0).', higherIsBetter: true },
  { key: 'sortino', label: 'Sortino', format: 'ratio', hint: 'Like Sharpe, but only downside deviation counts as risk.', higherIsBetter: true },
  { key: 'calmar', label: 'Calmar', format: 'ratio', hint: 'CAGR divided by the maximum drawdown.', higherIsBetter: true },
  { key: 'max_drawdown_pct', label: 'Max drawdown', format: 'pct', hint: 'Largest peak-to-trough fall in equity.' },
  { key: 'max_drawdown_duration_days', label: 'Longest drawdown', format: 'days', hint: 'Calendar days from a peak until equity recovered (or the end).' },
  { key: 'win_rate_pct', label: 'Win rate', format: 'pct_unsigned', hint: 'Share of closed trades with positive net P&L.' },
  { key: 'profit_factor', label: 'Profit factor', format: 'ratio', hint: 'Gross profit / gross loss across trades.', higherIsBetter: true },
  { key: 'total_trades', label: 'Trades', format: 'int', hint: 'Closed trades (positions are closed on the last bar).' },
  { key: 'exposure_pct', label: 'Exposure', format: 'pct_unsigned', hint: 'Share of days with any open position.' },
  { key: 'turnover_annual', label: 'Turnover', format: 'x', hint: 'Traded notional per year as a multiple of average equity.' },
  { key: 'alpha_pct', label: 'Alpha', format: 'pct', hint: 'Annualised return not explained by benchmark beta.', higherIsBetter: true },
  { key: 'beta', label: 'Beta', format: 'ratio', hint: 'Sensitivity of daily returns to the benchmark.' },
  { key: 'total_commission', label: 'Costs paid', format: 'money', hint: 'Commissions charged (slippage is in the fill prices).' },
]

export function formatMetric(v: unknown, f: MetricFormat): string {
  const n = num(v)
  if (n == null) return '—'
  switch (f) {
    case 'pct': return fmtPct(n)
    case 'pct_unsigned': return `${n.toFixed(2)}%`
    case 'ratio': return n.toFixed(2)
    case 'money': return fmtMoney(n)
    case 'int': return n.toLocaleString('en-US')
    case 'days': return `${Math.round(n).toLocaleString('en-US')} d`
    case 'x': return `${n.toFixed(2)}×`
  }
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export interface HeatRow { year: number; months: (number | null)[]; total: number | null }

export function monthlyGrid(r: Pick<LabResult, 'monthly_returns' | 'yearly_returns'>): HeatRow[] {
  const byYear = new Map<number, (number | null)[]>()
  for (const m of r.monthly_returns) {
    if (!byYear.has(m.year)) byYear.set(m.year, Array(12).fill(null))
    byYear.get(m.year)![m.month - 1] = m.return_pct
  }
  const totals = new Map(r.yearly_returns.map((y) => [y.year, y.return_pct]))
  return Array.from(byYear.entries()).sort(([a], [b]) => a - b).map(([year, months]) => ({ year, months, total: totals.get(year) ?? null }))
}

/** Tailwind classes for a heatmap cell; scaled to +/-8% per month. */
export function heatClass(v: number | null): string {
  if (v == null) return 'text-fg-muted'
  const a = Math.min(1, Math.abs(v) / 8)
  const step = a > 0.66 ? 3 : a > 0.33 ? 2 : 1
  if (Math.abs(v) < 0.05) return 'text-fg-secondary'
  if (v > 0) return ['', 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', 'bg-emerald-500/25 text-emerald-800 dark:text-emerald-200', 'bg-emerald-500/45 text-emerald-900 dark:text-emerald-100'][step]
  return ['', 'bg-red-500/10 text-red-700 dark:text-red-300', 'bg-red-500/25 text-red-800 dark:text-red-200', 'bg-red-500/45 text-red-900 dark:text-red-100'][step]
}

/** Chart rows: equity, benchmark and drawdown, plus Monte Carlo bands matched by date. */
export function chartRows(r: LabResult) {
  const bands = new Map((r.monte_carlo?.block_bootstrap?.bands ?? []).map((b) => [b.date, b]))
  return r.series.points.map((p) => {
    const b = bands.get(p.date)
    return { ...p, band: b ? [b.p5, b.p95] as [number, number] : undefined, p50: b?.p50 }
  })
}

// CSV (shared by the Strategy Lab and the classic trade journal) ----------

/** Neutralise spreadsheet formula injection (=, +, -, @, tab, CR at cell start). */
export function csvCell(v: unknown): string {
  if (v == null) return ''
  let s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v)
  if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')
}

export const TRADE_CSV_HEADERS = [
  '#', 'Symbol', 'Side', 'Signal date', 'Entry date', 'Entry price', 'Exit signal date', 'Exit date', 'Exit price',
  'Quantity', 'Net P&L', 'Return %', 'Commission', 'Bars held', 'Exit reason', 'MAE %', 'MFE %',
]

export function tradesCsv(trades: LabTrade[]): string {
  return toCsv(TRADE_CSV_HEADERS, trades.map((t, i) => [
    i + 1, t.symbol, t.side, t.signal_date, t.entry_date, round(t.entry_price, 4), t.exit_signal_date ?? '', t.exit_date,
    round(t.exit_price, 4), round(t.quantity, 6), round(t.pnl, 2), round(t.return_pct, 3), round(t.commission, 2),
    t.bars_held, t.exit_reason, round(t.mae, 3), round(t.mfe, 3),
  ]))
}

function round(v: number | null | undefined, d: number): number | '' {
  return v == null || !Number.isFinite(v) ? '' : Math.round(v * 10 ** d) / 10 ** d
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const EXIT_REASON_LABELS: Record<string, string> = {
  signal: 'Exit rule', stop_loss: 'Stop-loss', stop_loss_gap: 'Stop (gap)', trailing_stop: 'Trailing stop',
  trailing_stop_gap: 'Trailing (gap)', take_profit: 'Take-profit', take_profit_gap: 'Target (gap)',
  max_hold: 'Max hold', end_of_period: 'End of test', ruin: 'Equity exhausted',
}

// Robustness verdicts ------------------------------------------------------

export type Tone = 'good' | 'warn' | 'bad' | 'neutral'

export interface Verdict { tone: Tone; text: string }

export function pboVerdict(pbo: number | null | undefined): Verdict {
  if (pbo == null) return { tone: 'neutral', text: 'Needs a parameter grid with 2+ combinations.' }
  if (pbo < 0.2) return { tone: 'good', text: 'The in-sample winner usually stays in the top half out of sample.' }
  if (pbo < 0.5) return { tone: 'warn', text: 'Some overfitting: the in-sample pick often slips out of sample.' }
  return { tone: 'bad', text: 'Likely overfit: the in-sample winner usually ranks in the bottom half out of sample.' }
}

export function dsrVerdict(p: number | null | undefined): Verdict {
  if (p == null) return { tone: 'neutral', text: 'Not enough data.' }
  if (p >= 0.95) return { tone: 'good', text: 'Sharpe is above zero even after adjusting for the number of trials.' }
  if (p >= 0.8) return { tone: 'warn', text: 'Weak evidence once the number of trials is accounted for.' }
  return { tone: 'bad', text: 'The Sharpe ratio is consistent with luck across the trials run.' }
}

export function oosVerdict(isSharpe: number | null | undefined, oosSharpe: number | null | undefined): Verdict {
  if (isSharpe == null || oosSharpe == null) return { tone: 'neutral', text: 'Not enough data.' }
  if (oosSharpe <= 0) return { tone: 'bad', text: 'Out of sample the strategy did not earn a positive risk-adjusted return.' }
  if (isSharpe > 0 && oosSharpe < isSharpe * 0.5) return { tone: 'warn', text: 'Out-of-sample Sharpe fell by more than half.' }
  return { tone: 'good', text: 'Out-of-sample performance held up.' }
}

export function wfVerdict(eff: number | null | undefined): Verdict {
  if (eff == null) return { tone: 'neutral', text: 'Run with a parameter grid and folds.' }
  if (eff >= 0.7) return { tone: 'good', text: 'Most of the in-sample edge survived each next window.' }
  if (eff >= 0.3) return { tone: 'warn', text: 'Much of the in-sample edge faded out of sample.' }
  return { tone: 'bad', text: 'Little of the in-sample edge survived.' }
}

export const TONE_CLASS: Record<Tone, string> = {
  good: 'border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-700 dark:text-emerald-300',
  warn: 'border-amber-500/30 bg-amber-500/[0.07] text-amber-700 dark:text-amber-300',
  bad: 'border-red-500/30 bg-red-500/[0.07] text-red-700 dark:text-red-300',
  neutral: 'border-line-default bg-surface-raised text-fg-secondary',
}

export function paramsText(p: Record<string, number>): string {
  const e = Object.entries(p)
  return e.length ? e.map(([k, v]) => `${k}=${v}`).join(', ') : 'defaults'
}

export function jobProgressText(j: Pick<Job, 'status' | 'stage' | 'progress'>): string {
  if (j.status === 'queued') return 'Waiting in queue…'
  if (j.status === 'running') return `${j.stage} · ${Math.round(j.progress * 100)}%`
  return j.stage
}
