/**
 * Outlook client + shared helpers (OutlookDesktop and OutlookMobile both use these).
 * Backend: /api/v1/outlook (backend/app/api/outlook.py), math in
 * backend/app/services/outlook. Educational calculators only: nothing here places,
 * routes or simulates orders. Missing values render as "—", never 0.
 */
import { useQuery } from '@tanstack/react-query'

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

export type Quality = 'good' | 'fair' | 'thin'
export type Range = [number | null, number | null]

export interface StraddleMove {
  strike: number
  price: number
  move: number
  move_pct: number
  low: number
  high: number
}

export interface ExpiryOutlook {
  expiration: string
  days: number
  t_years: number
  spot: number
  forward: number
  forward_method: 'put_call_parity' | 'spot_carry'
  atm_iv: number
  one_sigma_pct: number
  straddle: StraddleMove | null
  range_68: Range
  range_80: Range
  range_95: Range
  median: number | null
  prob_above_spot: number
  quote_basis: 'mid' | 'last'
  smile_method: 'smile' | 'atm_last' | 'straddle_flat'
  smile_points: number
  liquid_contracts: number
  quality: Quality
  source?: string
  curve?: { price: number; prob_above: number; density: number }[]
  smile?: { strike: number; iv: number }[]
}

/** How the underlying price was set: the quote, or (when the quote was more than 0.5%
 * out of step with the option book) the price put-call parity implies. */
export interface SpotMeta {
  quoted_spot: number | null
  parity_spot?: number | null
  spot_basis: 'quote' | 'option_parity'
}

export interface ImpliedResponse extends SpotMeta {
  symbol: string
  spot: number
  risk_free_rate: number
  expirations: string[]
  expiries: ExpiryOutlook[]
  source: string | null
  disclaimer: string
  generated_at: string
}

export interface ProbabilityResponse extends SpotMeta {
  symbol: string
  requested_date: string
  expiration: string
  probability: {
    target: number
    prob_above: number
    prob_below: number
    iv_at_target: number
    flat_iv_prob_above: number
  }
  expiry: ExpiryOutlook
  method: string
  disclaimer: string
}

export interface EarningsMove {
  date: string
  timing: 'bmo' | 'amc' | 'unknown'
  move_pct: number
}

export interface EarningsResponse {
  symbol: string
  today: string
  next_earnings: { date: string; hour?: string | null; fiscal_period?: string | null; eps_estimate?: number | null } | null
  implied: {
    expiration: string
    pre_event_expiration: string | null
    straddle_move_pct: number | null
    one_sigma_pct: number
    event_move_pct: number | null
    atm_iv: number
    pre_event_atm_iv: number | null
    quality: Quality
  } | null
  history: EarningsMove[]
  summary: {
    count: number
    avg_abs_move_pct: number | null
    median_abs_move_pct: number | null
    max_abs_move_pct: number | null
    up_count: number
  }
  implied_vs_realized: number | null
  notes: string
  disclaimer: string
}

export interface CalendarImplied {
  expiration: string
  move_pct: number | null
  one_sigma_pct: number
  event_move_pct: number | null
  quality: Quality
}

export interface CalendarEvent {
  type: 'earnings' | 'dividend' | 'macro'
  symbol: string | null
  date: string
  title: string
  hour?: string | null
  detail?: string | null
  eps_estimate?: number | null
  amount?: number | null
  amount_pct?: number | null
  pay_date?: string | null
  date_note?: string | null
  time?: string | null
  forecast?: number | string | null
  prior?: number | string | null
  unit?: string | null
  implied: CalendarImplied | null
}

export interface CalendarResponse {
  today: string
  end: string
  symbols: string[]
  events: CalendarEvent[]
  macro_available: boolean
  disclaimer: string
  generated_at: string
}

export interface PerceptionRow {
  expiration: string
  days: number
  trading_days: number
  market: {
    range_80: Range
    range_68: Range
    median: number | null
    prob_above_spot: number
    atm_iv: number
    straddle_move_pct: number | null
    quality: Quality
  }
  model: {
    trading_days: number
    date: string
    point: number
    exp_return_pct: number
    prob_up: number
    range_80: Range | null
    range_50: Range | null
    range_95: Range | null
  } | null
}

export interface PerceptionResponse extends SpotMeta {
  symbol: string
  spot: number | null
  rows: PerceptionRow[]
  model: {
    name: string | null
    as_of: string | null
    last_close: number | null
    vol_annualized_pct: number | null
    beats_naive: Record<string, boolean> | null
    horizon_max: number | null
    disclaimer: string | null
  } | null
  labels: { market: string; model: string }
  disclaimer: string
}

export type StrategyId = 'unhedged' | 'protective_put' | 'collar' | 'reduce'

export interface HedgeStrategy {
  id: StrategyId
  label: string
  legs: Record<string, unknown>[]
  upfront_cost: number
  upfront_cost_pct: number
  max_loss: number
  max_loss_pct: number
  max_gain: number | null
  breakeven: number
  prob_below_breakeven: number | null
  notes: string
}

export interface HedgeResponse extends SpotMeta {
  symbol: string
  spot: number
  shares: number
  position_value: number
  expiration: string
  days: number
  expirations: string[]
  put: { strike: number; premium: number; basis: 'mid' | 'last' | null }
  call: { strike: number; premium: number | null; basis: 'mid' | 'last' | null } | null
  put_strikes: number[]
  call_strikes: number[]
  strategies: HedgeStrategy[]
  curve: ({ price: number } & Partial<Record<StrategyId, number>>)[]
  source: string | null
  assumptions: string
  disclaimer: string
}

export interface HedgeRequest {
  symbol: string
  shares: number
  expiration?: string | null
  put_strike?: number | null
  call_strike?: number | null
  reduce_pct?: number
}

export interface ScenarioDef {
  id: string
  label: string
  start: string
  end: string
  description: string
}

export type ScenarioMethod = 'actual' | 'beta' | 'assumed_beta_1' | 'override' | 'no_price'

export interface ScenarioRow {
  symbol: string
  shares: number
  price: number | null
  value: number | null
  shock_pct: number | null
  pnl: number | null
  stressed_value: number | null
  method: ScenarioMethod
  beta: number | null
}

export interface ScenarioResponse {
  holdings: ScenarioRow[]
  total_value: number
  total_pnl: number
  total_pnl_pct: number | null
  stressed_value: number
  market_return_pct: number
  scenario: { id: string; label: string; start?: string; end?: string; description?: string }
  methods: Record<ScenarioMethod, string>
  price_sources?: Record<string, 'quote' | 'last_close'>
  disclaimer: string
}

export interface ScenarioRequest {
  holdings: { symbol: string; shares: number }[]
  scenario_id?: string | null
  market_move_pct?: number | null
  overrides?: Record<string, number>
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

export class OutlookError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1/outlook${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const d = (data as { detail?: unknown })?.detail
    throw new OutlookError(typeof d === 'string' ? d : `Request failed (${res.status})`, res.status)
  }
  return data as T
}

export const outlookApi = {
  implied: (symbol: string) => req<ImpliedResponse>(`/${encodeURIComponent(symbol)}/implied`),
  probability: (symbol: string, target: number, expiration: string) =>
    req<ProbabilityResponse>(
      `/${encodeURIComponent(symbol)}/probability?${new URLSearchParams({ target: String(target), expiration })}`,
    ),
  earnings: (symbol: string) => req<EarningsResponse>(`/${encodeURIComponent(symbol)}/earnings`),
  perception: (symbol: string) => req<PerceptionResponse>(`/${encodeURIComponent(symbol)}/perception`),
  calendar: (symbols: string[], days: number) =>
    req<CalendarResponse>(`/calendar?${new URLSearchParams({ symbols: symbols.join(','), days: String(days) })}`),
  hedge: (body: HedgeRequest) => req<HedgeResponse>('/hedge', { method: 'POST', body: JSON.stringify(body) }),
  scenarios: () => req<{ scenarios: ScenarioDef[]; disclaimer: string }>('/scenarios'),
  scenario: (body: ScenarioRequest) => req<ScenarioResponse>('/scenario', { method: 'POST', body: JSON.stringify(body) }),
}

const noRetry4xx = (n: number, e: unknown) => !(e instanceof OutlookError && e.status < 500) && n < 1

export function useImplied(symbol: string) {
  return useQuery({
    queryKey: ['outlook', 'implied', symbol],
    queryFn: () => outlookApi.implied(symbol),
    enabled: !!symbol,
    staleTime: 5 * 60_000,
    retry: noRetry4xx,
  })
}

export function useProbability(symbol: string, target: number | null, expiration: string | null) {
  return useQuery({
    queryKey: ['outlook', 'prob', symbol, target, expiration],
    queryFn: () => outlookApi.probability(symbol, target as number, expiration as string),
    enabled: !!symbol && !!target && target > 0 && !!expiration,
    staleTime: 5 * 60_000,
    retry: noRetry4xx,
    placeholderData: (prev) => prev,
  })
}

export function useEarningsOutlook(symbol: string) {
  return useQuery({
    queryKey: ['outlook', 'earnings', symbol],
    queryFn: () => outlookApi.earnings(symbol),
    enabled: !!symbol,
    staleTime: 15 * 60_000,
    retry: noRetry4xx,
  })
}

export function usePerception(symbol: string) {
  return useQuery({
    queryKey: ['outlook', 'perception', symbol],
    queryFn: () => outlookApi.perception(symbol),
    enabled: !!symbol,
    staleTime: 15 * 60_000,
    retry: noRetry4xx,
  })
}

export function useOutlookCalendar(symbols: string[], days: number) {
  return useQuery({
    queryKey: ['outlook', 'calendar', symbols.join(','), days],
    queryFn: () => outlookApi.calendar(symbols, days),
    enabled: symbols.length > 0,
    staleTime: 10 * 60_000,
    retry: noRetry4xx,
    placeholderData: (prev) => prev,
  })
}

export function useHedge(body: HedgeRequest | null) {
  return useQuery({
    queryKey: ['outlook', 'hedge', body],
    queryFn: () => outlookApi.hedge(body as HedgeRequest),
    enabled: !!body && !!body.symbol && body.shares > 0,
    staleTime: 5 * 60_000,
    retry: noRetry4xx,
    placeholderData: (prev) => prev,
  })
}

export function useScenarioList() {
  return useQuery({ queryKey: ['outlook', 'scenarios'], queryFn: outlookApi.scenarios, staleTime: 60 * 60_000 })
}

export function useScenario(body: ScenarioRequest | null) {
  return useQuery({
    queryKey: ['outlook', 'scenario', body],
    queryFn: () => outlookApi.scenario(body as ScenarioRequest),
    enabled: !!body && body.holdings.length > 0,
    staleTime: 10 * 60_000,
    retry: noRetry4xx,
    placeholderData: (prev) => prev,
  })
}

// ── formatting / view helpers ───────────────────────────────────────────────

export const DASH = '—'
export const DEFAULT_SYMBOL = 'SPY'
export const DEFAULT_CALENDAR = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA']

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function fmtPrice(v: number | null | undefined, digits = 2): string {
  if (!finite(v)) return DASH
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

/** Per-share amounts can be tiny (0.0675): 2 to 4 decimals. */
export function fmtPerShare(v: number | null | undefined): string {
  if (!finite(v)) return DASH
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
}

export function fmtMoney(v: number | null | undefined, signed = false): string {
  if (!finite(v)) return DASH
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  const sign = v < 0 ? '−' : signed && v > 0 ? '+' : ''
  return `${sign}$${abs}`
}

/** Percent given in percent units (2.5 -> "2.50%"). */
export function fmtPct(v: number | null | undefined, digits = 2, signed = false): string {
  if (!finite(v)) return DASH
  const sign = v < 0 ? '−' : signed && v > 0 ? '+' : ''
  return `${sign}${Math.abs(v).toFixed(digits)}%`
}

/** Probability given as a fraction (0.1313 -> "13.1%"). */
export function fmtProb(v: number | null | undefined): string {
  if (!finite(v)) return DASH
  if (v > 0 && v < 0.001) return '<0.1%'
  if (v < 1 && v > 0.999) return '>99.9%'
  return `${(v * 100).toFixed(1)}%`
}

/** Implied vol given as a fraction (0.2356 -> "23.6%"). */
export function fmtIv(v: number | null | undefined): string {
  if (!finite(v)) return DASH
  return `${(v * 100).toFixed(1)}%`
}

export function fmtRange(r: Range | null | undefined): string {
  if (!r || !finite(r[0]) || !finite(r[1])) return DASH
  return `${fmtPrice(r[0])} – ${fmtPrice(r[1])}`
}

export function fmtDate(iso: string | null | undefined, withYear = false): string {
  if (!iso) return DASH
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return DASH
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  })
}

export function directionClass(v: number | null | undefined): string {
  if (!finite(v) || v === 0) return 'text-fg-primary'
  return v > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
}

export const QUALITY_TEXT: Record<Quality, string> = {
  good: 'Liquid quotes',
  fair: 'Few strikes',
  thin: 'Thin quotes',
}

export const QUALITY_HELP: Record<Quality, string> = {
  good: 'Smile fitted to at least six liquid out-of-the-money option mids.',
  fair: 'Smile fitted to fewer than six liquid strikes; tails are less reliable.',
  thin: 'Too few two-sided quotes (often outside market hours): one lognormal volatility from last trades or the straddle.',
}

export const TIMING_TEXT: Record<EarningsMove['timing'], string> = {
  bmo: 'Before open',
  amc: 'After close',
  unknown: 'Time n/a',
}

export const STRATEGY_COLORS: Record<StrategyId, string> = {
  unhedged: '#94a3b8',
  protective_put: '#6366f1',
  collar: '#f59e0b',
  reduce: '#14b8a6',
}

export function normalizeSymbol(raw: string): string | null {
  const s = (raw || '').trim().toUpperCase()
  return /^[A-Z0-9][A-Z0-9.\-]{0,9}$/.test(s) ? s : null
}

/** Parse "AAPL, msft nvda" into unique valid symbols (max ``limit``). */
export function parseSymbols(raw: string, limit = 12): string[] {
  const out: string[] = []
  for (const part of raw.split(/[\s,;]+/)) {
    const s = normalizeSymbol(part)
    if (s && !out.includes(s)) out.push(s)
    if (out.length >= limit) break
  }
  return out
}

/** Position of ``x`` inside [lo, hi] as 0..100 for range bars (clamped). */
export function pctIn(x: number | null | undefined, lo: number, hi: number): number {
  if (!finite(x) || hi <= lo) return 0
  return Math.min(100, Math.max(0, ((x - lo) / (hi - lo)) * 100))
}

/** Common [lo, hi] covering every finite bound of the given ranges, padded 4%. */
export function axisFor(ranges: (Range | null | undefined)[], extra: (number | null | undefined)[] = []): [number, number] | null {
  const vals: number[] = []
  for (const r of ranges) if (r) for (const v of r) if (finite(v)) vals.push(v)
  for (const v of extra) if (finite(v)) vals.push(v)
  if (!vals.length) return null
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const pad = (hi - lo || hi * 0.05 || 1) * 0.04
  return [lo - pad, hi + pad]
}

/** Range of a fraction as a percent move from spot: [-3.1, +2.9]. */
export function rangePct(r: Range | null | undefined, spot: number | null | undefined): [number, number] | null {
  if (!r || !finite(r[0]) || !finite(r[1]) || !finite(spot) || spot <= 0) return null
  return [(r[0] / spot - 1) * 100, (r[1] / spot - 1) * 100]
}

/** Width of a range as a percent of spot (the "how much might it move" number). */
export function rangeWidthPct(r: Range | null | undefined, spot: number | null | undefined): number | null {
  const p = rangePct(r, spot)
  return p ? p[1] - p[0] : null
}

/** Implied / realized earnings ratio wording. */
export function pricingVerdict(ratio: number | null | undefined): string | null {
  if (!finite(ratio)) return null
  if (ratio >= 1.2) return 'Options price a bigger move than this stock has usually made on earnings.'
  if (ratio <= 0.8) return 'Options price a smaller move than this stock has usually made on earnings.'
  return 'Options price a move in line with this stock’s past earnings reactions.'
}

/** Default probability target: spot +5%, rounded to a sensible tick. */
export function defaultTarget(spot: number | null | undefined): number | null {
  if (!finite(spot) || spot <= 0) return null
  const raw = spot * 1.05
  const tick = raw >= 100 ? 1 : raw >= 10 ? 0.5 : 0.05
  return Math.round(raw / tick) * tick
}

export type ShockPreset = { id: string; label: string; move: number }
export const SHOCK_PRESETS: ShockPreset[] = [
  { id: 'm-20', label: 'Market −20%', move: -20 },
  { id: 'm-10', label: 'Market −10%', move: -10 },
  { id: 'm-5', label: 'Market −5%', move: -5 },
  { id: 'm+10', label: 'Market +10%', move: 10 },
]
