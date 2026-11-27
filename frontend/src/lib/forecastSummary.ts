/**
 * Compact statistical forecast summaries, shared by every surface that shows a
 * forecast outside the Research panel: watchlist rows, portfolio holdings, the
 * screener column and the copilot ticker card. Desktop and mobile use the same
 * helpers.
 *
 * Source: GET /api/v1/forecasts/summary?tickers=… (cache only), built on the
 * backend by app/services/forecasting/summary.py from /api/v1/forecast/{ticker}.
 * The copilot's get_forecast tool uses the same backend function, so ranges,
 * hit rates and "no edge" labels match everywhere.
 *
 * Honesty rules (same as lib/forecastHonesty):
 * - Always "Experimental · Not investment advice". Never a signal.
 * - The 80% / 95% ranges are always shown. Midpoint and P(up) exist only for a
 *   horizon that beat ARIMA(0,1,0) in walk-forward tests; else they are null.
 * - No green/red on a forecast: colour is for realised direction only.
 * - Hit rate = measured share of held-out test outcomes inside the range.
 */
import { BENCHMARK_NAME, EXPERIMENTAL_LABEL, horizonLabel, type CalibrationStatus, type Reliability } from './forecastHonesty'

const API = process.env.NEXT_PUBLIC_API_URL || ''

export type Range = [number, number]

export interface ForecastHorizonSummary {
  h: number
  label: string
  date?: string | null
  range_80: Range | null
  range_95: Range | null
  range_80_pct: [number | null, number | null] | null
  range_95_pct: [number | null, number | null] | null
  sigma_log?: number | null
  reliability: Reliability
  edge: boolean
  edge_text: string
  midpoint: number | null
  exp_return_pct: number | null
  prob_up_pct: number | null
  hit_rate_80: number | null
  hit_rate_95: number | null
  hit_rate_tests: number | null
  calibration: CalibrationStatus
}

export interface ForecastSummary {
  ticker: string | null
  as_of: string | null
  generated_at?: string | null
  last_close: number | null
  vol_annualized_pct?: number | null
  benchmark: string
  horizons: ForecastHorizonSummary[]
  any_edge: boolean
  status: 'experimental'
  label: string
  investment_advice: false
  signal: false
  ml_gate?: { promoted: boolean; gates_passed?: number | null; gates_total?: number | null; gates_required?: number | null; note: string }
}

export type SummaryStatus = 'ready' | 'pending' | 'invalid'
export interface SummaryItem { ticker: string; status: SummaryStatus; summary: ForecastSummary | null }
export interface SummaryResponse { items: SummaryItem[]; label: string; benchmark: string; note: string }

export const SUMMARY_MAX = 50
/** Horizons offered in compact surfaces (trading days). */
export const COMPACT_HORIZONS = [5, 20, 60] as const
export const DEFAULT_HORIZON = 20

/** Upper-case, trimmed, de-duplicated tickers in first-seen order, at most SUMMARY_MAX. */
export function normalizeTickers(tickers: readonly (string | null | undefined)[]): string[] {
  const out: string[] = []
  for (const t of tickers) {
    const s = (t ?? '').trim().toUpperCase()
    if (s && !out.includes(s)) out.push(s)
    if (out.length >= SUMMARY_MAX) break
  }
  return out
}

export async function fetchForecastSummaries(tickers: string[], opts: { warm?: boolean } = {}): Promise<SummaryResponse> {
  const q = new URLSearchParams({ tickers: tickers.join(',') })
  if (opts.warm === false) q.set('warm', 'false')
  const res = await fetch(`${API}/api/v1/forecasts/summary?${q}`)
  if (!res.ok) throw new Error(`Forecasts unavailable (${res.status})`)
  return res.json()
}

export function pickHorizon(s: ForecastSummary | null | undefined, h: number): ForecastHorizonSummary | null {
  return s?.horizons.find((r) => r.h === h) ?? null
}

/* ── Client-side mirror for a full /forecast/{ticker} payload ──────────── */

interface FullRow {
  h: number
  date?: string
  point?: number
  exp_return_pct?: number
  prob_up?: number
  sigma_log?: number
  bands?: Partial<Record<'50' | '80' | '95', [number, number]>>
  reliability?: Reliability
  calibration?: { status?: CalibrationStatus }
  eval?: { holdout_origins?: number | null; coverage?: Record<string, number | null> | null } | null
}
interface FullPayload {
  ticker?: string
  as_of?: string
  generated_at?: string
  last_close?: number
  vol_annualized_pct?: number
  benchmark?: { name?: string }
  horizons?: FullRow[]
  beats_naive?: Record<string, boolean>
  backtest?: { origins?: number; band_coverage?: Record<string, Record<string, number | null>>; holdout_origins?: Record<string, number | null> }
  ml_model?: { promoted?: boolean; gates_passed?: number | null; gates_total?: number; gates_required?: number; note?: string }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Same result as backend summarize_forecast(), for a payload already on the page (Research). */
export function summarizeFullForecast(raw: FullPayload | null | undefined): ForecastSummary | null {
  if (!raw?.horizons?.length) return null
  const last = num(raw.last_close)
  const pct = (v: number | null) => (v != null && last ? Math.round((v / last - 1) * 10000) / 100 : null)
  const horizons = raw.horizons.map((row): ForecastHorizonSummary => {
    const k = String(row.h)
    const reliability: Reliability = row.reliability ?? (raw.beats_naive?.[k] ? 'edge_in_backtest' : 'no_edge')
    const edge = reliability === 'edge_in_backtest'
    const cov = row.eval?.coverage ?? raw.backtest?.band_coverage?.[k] ?? {}
    const tests = row.eval?.holdout_origins ?? raw.backtest?.holdout_origins?.[k] ?? raw.backtest?.origins ?? null
    const b80 = row.bands?.['80'] ?? null
    const b95 = row.bands?.['95'] ?? null
    const prob = num(row.prob_up)
    return {
      h: row.h,
      label: horizonLabel(row.h),
      date: row.date ?? null,
      range_80: b80,
      range_95: b95,
      range_80_pct: b80 ? [pct(b80[0]), pct(b80[1])] : null,
      range_95_pct: b95 ? [pct(b95[0]), pct(b95[1])] : null,
      sigma_log: num(row.sigma_log),
      reliability,
      edge,
      edge_text: edge ? `Beat ${BENCHMARK_NAME} in tests` : `No edge vs ${BENCHMARK_NAME}`,
      midpoint: edge ? num(row.point) : null,
      exp_return_pct: edge ? num(row.exp_return_pct) : null,
      prob_up_pct: edge && prob != null ? Math.round(prob * 1000) / 10 : null,
      hit_rate_80: num(cov?.['80']),
      hit_rate_95: num(cov?.['95']),
      hit_rate_tests: tests ?? null,
      calibration: row.calibration?.status ?? 'insufficient_data',
    }
  })
  return {
    ticker: raw.ticker ?? null,
    as_of: raw.as_of ?? null,
    generated_at: raw.generated_at ?? null,
    last_close: last,
    vol_annualized_pct: num(raw.vol_annualized_pct),
    benchmark: raw.benchmark?.name ?? BENCHMARK_NAME,
    horizons,
    any_edge: horizons.some((h) => h.edge),
    status: 'experimental',
    label: EXPERIMENTAL_LABEL,
    investment_advice: false,
    signal: false,
    ml_gate: {
      promoted: !!raw.ml_model?.promoted,
      gates_passed: raw.ml_model?.gates_passed ?? null,
      gates_total: raw.ml_model?.gates_total ?? null,
      gates_required: raw.ml_model?.gates_required ?? null,
      note: raw.ml_model?.note ?? 'Our ML price model is experimental and is not used in this forecast.',
    },
  }
}

/* ── Formatting ─────────────────────────────────────────────────────────── */

export function fmtMoney(v: number | null | undefined, digits?: number): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const d = digits ?? (Math.abs(v) >= 1000 ? 0 : 2)
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`
}

export function fmtSignedPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}%`
}

/** "$219.50 – $257.30" */
export function fmtRange(r: Range | null | undefined, digits?: number): string {
  if (!r) return '—'
  return `${fmtMoney(r[0], digits)} – ${fmtMoney(r[1], digits)}`
}

/** "−7.2% / +8.8%" relative to the last close. */
export function fmtRangePct(r: [number | null, number | null] | null | undefined, digits = 1): string {
  if (!r || r[0] == null || r[1] == null) return '—'
  return `${fmtSignedPct(r[0], digits)} / ${fmtSignedPct(r[1], digits)}`
}

/** "Held 78% of 40 tests" / null when not measured. */
export function hitRateText(h: Pick<ForecastHorizonSummary, 'hit_rate_80' | 'hit_rate_tests'> | null | undefined): string | null {
  if (!h || h.hit_rate_80 == null || !h.hit_rate_tests) return null
  return `Held ${Math.round(h.hit_rate_80 * 100)}% of ${h.hit_rate_tests} tests`
}

/** Tone for the hit-rate chip: amber when the 80% range held far less often than 80%. */
export function hitRateTone(h: Pick<ForecastHorizonSummary, 'calibration'> | null | undefined): 'ok' | 'warn' | 'muted' {
  if (!h) return 'muted'
  if (h.calibration === 'under_covered') return 'warn'
  if (h.calibration === 'calibrated') return 'ok'
  return 'muted'
}

/** One-line plain description used for titles / screen readers. */
export function describeHorizon(ticker: string, h: ForecastHorizonSummary): string {
  const parts = [`${ticker} ${h.label}: 80% range ${fmtRange(h.range_80)}`]
  if (h.range_95) parts.push(`95% range ${fmtRange(h.range_95)}`)
  const hr = hitRateText(h)
  if (hr) parts.push(`${hr.toLowerCase()} in past walk-forward tests`)
  parts.push(h.edge_text)
  if (h.edge && h.midpoint != null) parts.push(`midpoint ${fmtMoney(h.midpoint)}`)
  parts.push(EXPERIMENTAL_LABEL)
  return parts.join('. ') + '.'
}

/** Position of `price` inside `range` as 0..100 (clamped), for the range bar marker. */
export function positionInRange(price: number | null | undefined, range: Range | null | undefined): number | null {
  if (price == null || !range || !(range[1] > range[0])) return null
  return Math.min(100, Math.max(0, ((price - range[0]) / (range[1] - range[0])) * 100))
}

/* ── Portfolio band ─────────────────────────────────────────────────────── */

export interface PortfolioPosition { symbol: string; market_value: number | null }

export interface PortfolioBand {
  h: number
  /** Value of the positions the band covers (today). */
  covered_value: number
  total_value: number
  covered_count: number
  total_count: number
  missing: string[]
  /** 80% / 95% range of the covered positions' value at the horizon. */
  range_80: Range | null
  range_95: Range | null
  range_80_pct: [number, number] | null
  /** Loss at the bottom of the 95% range (a VaR-style figure, ≥ 0). */
  downside_95: number | null
  downside_95_pct: number | null
  /** Value-weighted share of past tests that landed inside the holdings' 80% ranges. */
  avg_hit_rate_80: number | null
  min_tests: number | null
  any_edge: boolean
}

/**
 * Value range of the portfolio's covered holdings at horizon `h`.
 *
 * Each holding's 80% / 95% range (as % of its last close) is applied to its
 * current market value and the bounds are summed. Summing quantiles is exact
 * when holdings move together (perfect correlation), which makes this the
 * widest plausible range: diversification can only make the true range narrower.
 * Holdings without a ready forecast are left out and listed in `missing`.
 */
export function portfolioForecastBand(
  positions: readonly PortfolioPosition[],
  summaries: Readonly<Record<string, ForecastSummary | null | undefined>>,
  h: number,
): PortfolioBand {
  let covered = 0, total = 0, lo80 = 0, hi80 = 0, lo95 = 0, hi95 = 0
  let has95 = true, coveredCount = 0, hitW = 0, hitV = 0
  let minTests: number | null = null, anyEdge = false
  const missing: string[] = []
  for (const p of positions) {
    const v = p.market_value
    if (v == null || !Number.isFinite(v) || v <= 0) continue
    total += v
    const row = pickHorizon(summaries[p.symbol.toUpperCase()] ?? summaries[p.symbol], h)
    const r80 = row?.range_80_pct
    if (!row || !r80 || r80[0] == null || r80[1] == null) {
      missing.push(p.symbol)
      continue
    }
    covered += v
    coveredCount += 1
    lo80 += v * (1 + r80[0] / 100)
    hi80 += v * (1 + r80[1] / 100)
    const r95 = row.range_95_pct
    if (r95 && r95[0] != null && r95[1] != null) {
      lo95 += v * (1 + r95[0] / 100)
      hi95 += v * (1 + r95[1] / 100)
    } else {
      has95 = false
    }
    if (row.hit_rate_80 != null && row.hit_rate_tests) {
      hitW += v * row.hit_rate_80
      hitV += v
      minTests = minTests == null ? row.hit_rate_tests : Math.min(minTests, row.hit_rate_tests)
    }
    anyEdge = anyEdge || row.edge
  }
  const ok = coveredCount > 0
  const r2 = (x: number) => Math.round(x * 100) / 100
  const downside = ok && has95 ? Math.max(0, covered - lo95) : null
  return {
    h,
    covered_value: r2(covered),
    total_value: r2(total),
    covered_count: coveredCount,
    total_count: coveredCount + missing.length,
    missing,
    range_80: ok ? [r2(lo80), r2(hi80)] : null,
    range_95: ok && has95 ? [r2(lo95), r2(hi95)] : null,
    range_80_pct: ok ? [r2((lo80 / covered - 1) * 100), r2((hi80 / covered - 1) * 100)] : null,
    downside_95: downside != null ? r2(downside) : null,
    downside_95_pct: downside != null && covered > 0 ? r2((downside / covered) * 100) : null,
    avg_hit_rate_80: hitV > 0 ? Math.round((hitW / hitV) * 1000) / 1000 : null,
    min_tests: minTests,
    any_edge: anyEdge,
  }
}
