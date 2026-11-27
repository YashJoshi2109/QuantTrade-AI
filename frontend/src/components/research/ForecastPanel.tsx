'use client'

/**
 * Statistical price forecast: fan chart, per-horizon ranges, the selected model
 * and why, and the out-of-sample test against the ARIMA(0,1,0) benchmark.
 * Shared by the desktop research page and mobile research (same component, responsive).
 * Data: GET /api/v1/forecast/{ticker} (SARIMAX + baselines, GJR-GARCH bands).
 * Honesty rules live in lib/forecastHonesty: experimental label, and without a
 * tested edge over ARIMA(0,1,0) only the range is shown (no midpoint, no P(up)).
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, FlaskConical, Info, LineChart } from 'lucide-react'
import { Skeleton } from '@/components/Skeleton'
import { ForecastRangeBar } from '@/components/forecast/ForecastBadge'
import { hitRateText, summarizeFullForecast, type ForecastHorizonSummary } from '@/lib/forecastSummary'
import {
  bandCalibration, BENCHMARK_NAME, CALIBRATION_TEXT, EDGE_TEXT, EXPERIMENTAL_LABEL, fmtP, horizonLabel,
  horizonReliability, mlStatusSentence, noEdgeReason,
  type CalibrationStatus, type HorizonEval, type MlModelStatus, type Reliability,
} from '@/lib/forecastHonesty'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || ''

type Band = [number, number]
export interface ForecastPoint {
  h: number
  date: string
  point: number
  exp_return_pct: number
  prob_up: number
  bands: Record<'50' | '80' | '95', Band>
  reliability?: Reliability
  calibration?: { status?: CalibrationStatus }
  model?: {
    primary?: string | null
    primary_label?: string | null
    served?: string
    served_label?: string
    centre?: 'model' | 'random_walk'
    exog?: string[]
    why?: string | null
  }
  eval?: HorizonEval & {
    rmse_ratio?: number | null
    dm_pvalue?: number | null
    dir_acc?: number | null
    dir_pvalue?: number | null
    holdout_origins?: number
    coverage?: Record<string, number | null> | null
  }
}
export interface ForecastResponse {
  ticker: string
  as_of: string
  last_close: number
  horizons: ForecastPoint[]
  path: ForecastPoint[]
  models: { weights: Record<string, number>; arima_order: number[]; volatility: string }
  model?: { name?: string; order?: number[]; exog_used?: Record<string, string[]>; volatility?: string }
  benchmark?: { name: string; description?: string }
  model_state?: { mode?: 'refit' | 'filtered'; refit_reason?: string | null; fit_date?: string; bars_since_fit?: number }
  exog_sources?: string[]
  vol_annualized_pct: number
  backtest: {
    origins: number
    period: [string | null, string | null]
    mase_vs_naive: Record<string, number | null>
    directional_accuracy: Record<string, number | null>
    directional_pvalue: Record<string, number | null>
    band_coverage: Record<string, Record<string, number | null>>
    dm_pvalue_holm?: Record<string, number | null>
  }
  beats_naive: Record<string, boolean>
  method: string
  disclaimer: string
  status?: 'experimental'
  label?: string
  ml_model?: MlModelStatus
}

async function fetchForecast(symbol: string): Promise<ForecastResponse> {
  const res = await fetch(`${API_BASE}/api/v1/forecast/${encodeURIComponent(symbol)}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(typeof body?.detail === 'string' ? body.detail : `Forecast unavailable (${res.status})`)
  }
  return res.json()
}

const money = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pct = (v: number | null | undefined, d = 0) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`)

/* ── Fan chart (inline SVG, no chart lib) ─────────────────────────────── */

export function buildFanGeometry(data: ForecastResponse, width: number, height: number, pad = 28) {
  const pts = data.path
  const all = pts.flatMap((p) => [p.bands['95'][0], p.bands['95'][1]]).concat(data.last_close)
  const lo = Math.min(...all), hi = Math.max(...all)
  const span = hi - lo || 1
  const x = (i: number) => pad + (i / pts.length) * (width - pad * 2) // i=0 → today
  const y = (v: number) => height - pad - ((v - lo) / span) * (height - pad * 2)
  const area = (lvl: '50' | '80' | '95') => {
    const top = [`${x(0)},${y(data.last_close)}`, ...pts.map((p, i) => `${x(i + 1)},${y(p.bands[lvl][1])}`)]
    const bot = pts.map((p, i) => `${x(i + 1)},${y(p.bands[lvl][0])}`).reverse()
    return [...top, ...bot].join(' ')
  }
  const line = [`${x(0)},${y(data.last_close)}`, ...pts.map((p, i) => `${x(i + 1)},${y(p.point)}`)].join(' ')
  return { area, line, x, y, lo, hi, naiveY: y(data.last_close) }
}

export function fanTicks(n: number): number[] {
  const t = n > 20 ? [0, 5, 20, 40, 60] : [0, 5, 10, 15, 20]
  return t.filter((i) => i <= n)
}

function FanChart({ data }: { data: ForecastResponse }) {
  const W = 640, H = 220
  const g = useMemo(() => buildFanGeometry(data, W, H), [data])
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
      aria-label={`${data.ticker} ${data.path.length}-day forecast fan chart: median with 80 and 95 percent ranges`}>
      <polygon points={g.area('95')} className="fill-blue-500/10" />
      <polygon points={g.area('80')} className="fill-blue-500/20" />
      {/* ARIMA(0,1,0) benchmark: price stays where it is */}
      <line x1={g.x(0)} x2={g.x(data.path.length)} y1={g.naiveY} y2={g.naiveY}
        className="stroke-fg-muted" strokeDasharray="4 4" strokeWidth={1} />
      <polyline points={g.line} fill="none" className="stroke-blue-400" strokeWidth={2} />
      <circle cx={g.x(0)} cy={g.naiveY} r={3.5} className="fill-white" />
      {fanTicks(data.path.length).map((i) => (
        <text key={i} x={g.x(i)} y={H - 8} textAnchor="middle" className="fill-fg-muted" fontSize={13}>
          {i === 0 ? 'Today' : `+${i}d`}
        </text>
      ))}
      <text x={W - 4} y={g.y(g.hi) + 4} textAnchor="end" className="fill-fg-muted" fontSize={13}>{money(g.hi)}</text>
      <text x={W - 4} y={g.y(g.lo)} textAnchor="end" className="fill-fg-muted" fontSize={13}>{money(g.lo)}</text>
    </svg>
  )
}

/* ── Panel ────────────────────────────────────────────────────────────── */

/** Same footprint as the loaded panel: chart on the left, four horizon cards on the right. */
export function ForecastPanelSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-5" data-testid="forecast-panel-skeleton" aria-busy="true" aria-label="Loading forecast">
      <div className="lg:col-span-3 rounded-xl border border-line-subtle bg-surface-raised/30 p-3">
        <Skeleton className="h-[180px] w-full sm:h-[200px]" />
        <div className="mt-2 flex gap-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-2.5 w-16" />)}
        </div>
      </div>
      <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-line-subtle bg-surface-raised/40 p-3 space-y-2">
            <div className="flex justify-between"><Skeleton className="h-3 w-24" /><Skeleton className="h-3 w-28" /></div>
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-1.5 w-full" />
            <Skeleton className="h-2.5 w-32" />
          </div>
        ))}
      </div>
    </div>
  )
}

function HorizonCard({ data, row, summary }: { data: ForecastResponse; row: ForecastPoint; summary?: ForecastHorizonSummary | null }) {
  // Without a tested edge the midpoint is noise: range only, no colour, no P(up).
  const rel = horizonReliability(data, row.h)
  const beats = rel === 'edge_in_backtest'
  const cal = CALIBRATION_TEXT[bandCalibration(data, row.h)]
  const dirTone = row.exp_return_pct >= 0 ? 'text-emerald-400' : 'text-red-400'
  return (
    <div className="rounded-xl border border-line-subtle bg-surface-raised/40 p-3" data-testid={`forecast-horizon-${row.h}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-fg-secondary">{horizonLabel(row.h)} · {row.date}</span>
        <span className={`text-[10px] ${beats ? 'text-emerald-400' : 'text-amber-400'}`}>{EDGE_TEXT[rel]}</span>
      </div>
      <div className="mt-1 text-sm text-white font-mono">
        80% range {money(row.bands['80'][0])} – {money(row.bands['80'][1])}
      </div>
      <div className="text-[10px] text-fg-muted font-mono">
        95% range {money(row.bands['95'][0])} – {money(row.bands['95'][1])}
      </div>
      {summary && <ForecastRangeBar row={summary} price={data.last_close} className="mt-2" />}
      {beats && (
        <div className="mt-1 text-[10px] text-fg-muted">
          Midpoint {money(row.point)} <span className={`font-mono ${dirTone}`}>({row.exp_return_pct >= 0 ? '+' : ''}{row.exp_return_pct.toFixed(2)}%)</span> · P(up) {pct(row.prob_up)}
        </div>
      )}
      <div className={`mt-1 text-[10px] ${cal.tone === 'warn' ? 'text-amber-400' : cal.tone === 'ok' ? 'text-fg-secondary' : 'text-fg-muted'}`}>
        {cal.label}
        {summary && hitRateText(summary) && (
          <span className="text-fg-muted" title="Share of held-out walk-forward tests whose outcome landed inside the 80% range">
            {' '}· {hitRateText(summary)}
          </span>
        )}
      </div>
    </div>
  )
}

export default function ForecastPanel({ symbol }: { symbol: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['forecast', symbol],
    queryFn: () => fetchForecast(symbol),
    enabled: !!symbol,
    staleTime: 30 * 60 * 1000,
    retry: 1,
  })
  const bench = data?.benchmark?.name ?? BENCHMARK_NAME
  const summary = useMemo(() => summarizeFullForecast(data), [data])

  return (
    <div className="col-span-12 hud-panel p-4 sm:p-5" data-testid="forecast-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <LineChart className="w-4 h-4 text-blue-400" />
          <h3 className="font-bold text-sm text-white tracking-wide">Price Forecast Range</h3>
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-line-subtle text-fg-muted">Statistical</span>
          <span
            className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-amber-400/40 bg-amber-400/10 text-amber-300"
            data-testid="forecast-experimental-badge"
          >
            <FlaskConical className="w-3 h-3" />
            {data?.label ?? EXPERIMENTAL_LABEL}
          </span>
        </div>
        {data && <span className="text-[10px] text-fg-muted">As of close {data.as_of} · {data.vol_annualized_pct}% annualized volatility</span>}
      </div>

      {isLoading ? (
        <>
          <p className="mb-2 text-[11px] text-fg-muted">Testing models on 2 years of prices…</p>
          <ForecastPanelSkeleton />
        </>
      ) : error || !data ? (
        <div className="flex items-start gap-2 rounded-xl border border-line-subtle bg-surface-raised/40 p-4 text-xs text-fg-muted">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          {(error as Error)?.message || 'Forecast unavailable for this symbol.'}
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="lg:col-span-3 rounded-xl border border-line-subtle bg-surface-raised/30 p-2">
              <FanChart data={data} />
              <div className="flex flex-wrap gap-3 px-2 pb-1 text-[10px] text-fg-muted">
                <span className="flex items-center gap-1"><span className="w-3 border-t-2 border-blue-400" />Median</span>
                <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-blue-500/30" />80% range</span>
                <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-blue-500/10" />95% range</span>
                <span className="flex items-center gap-1"><span className="w-3 border-t border-dashed border-fg-muted" />{bench} (no change)</span>
              </div>
            </div>
            <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
              {data.horizons.map((row) => (
                <HorizonCard key={row.h} data={data} row={row} summary={summary?.horizons.find((x) => x.h === row.h)} />
              ))}
            </div>
          </div>

          {/* Selected model per horizon, and why */}
          <div className="mt-4 rounded-xl border border-line-subtle bg-surface-raised/30 p-3" data-testid="forecast-model-selection">
            <div className="text-[11px] font-semibold text-fg-secondary mb-2">
              Model chosen for each horizon{data.model?.name ? ` · family ${data.model.name}` : ''}
            </div>
            <ul className="space-y-1.5">
              {data.horizons.map((row) => (
                <li key={row.h} className="text-[11px] leading-relaxed text-fg-muted">
                  <span className="text-fg-secondary font-semibold">{horizonLabel(row.h)}:</span>{' '}
                  <span className="text-white">{row.model?.primary_label ?? '—'}</span>
                  {row.model?.centre === 'random_walk' && <> → range centred on <span className="text-fg-secondary">{bench}</span></>}
                  {row.model?.why ? <> — {row.model.why}</> : null}
                </li>
              ))}
            </ul>
          </div>

          {/* Out-of-sample test vs the benchmark — shown, not hidden */}
          <div className="mt-4 rounded-xl border border-line-subtle bg-surface-raised/30 p-3" data-testid="forecast-eval-table">
            <div className="text-[11px] font-semibold text-fg-secondary mb-2">
              Out-of-sample test vs {bench} · {data.backtest.origins} walk-forward origins ({data.backtest.period[0]} → {data.backtest.period[1]}); scores from the later half
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[11px] font-mono">
                <thead>
                  <tr className="text-fg-muted text-left">
                    <th className="py-1 pr-3 font-medium">Horizon</th>
                    <th className="py-1 pr-3 font-medium">Selected model</th>
                    <th className="py-1 pr-3 font-medium" title={`Mean absolute error divided by ${bench}'s; below 1.00 is better`}>Error vs {bench}</th>
                    <th className="py-1 pr-3 font-medium" title="Diebold-Mariano test vs the benchmark, Holm-adjusted across horizons">DM p</th>
                    <th className="py-1 pr-3 font-medium" title="Direction hit rate; Pesaran-Timmermann p-value">Direction</th>
                    <th className="py-1 pr-3 font-medium" title="Share of later outcomes inside the 80% / 95% range">Range 80 / 95</th>
                    <th className="py-1 font-medium">Edge</th>
                  </tr>
                </thead>
                <tbody className="text-fg-secondary">
                  {data.horizons.map((row) => {
                    const k = String(row.h)
                    const ev = row.eval
                    const m = ev?.rel_mae ?? data.backtest.mase_vs_naive[k]
                    const cov = ev?.coverage ?? data.backtest.band_coverage[k] ?? {}
                    const beats = horizonReliability(data, row.h) === 'edge_in_backtest'
                    const reason = noEdgeReason(ev)
                    return (
                      <tr key={k} className="border-t border-line-subtle align-top">
                        <td className="py-1 pr-3">{horizonLabel(row.h)}</td>
                        <td className="py-1 pr-3 font-sans">{row.model?.primary_label ?? '—'}</td>
                        <td className={`py-1 pr-3 ${beats ? 'text-emerald-400' : ''}`}>{m != null ? `${m.toFixed(2)}×` : '—'}</td>
                        <td className="py-1 pr-3">{fmtP(ev?.dm_pvalue_holm ?? data.backtest.dm_pvalue_holm?.[k])}</td>
                        <td className="py-1 pr-3">{pct(ev?.dir_acc ?? data.backtest.directional_accuracy[k])} <span className="text-fg-muted">(p={fmtP(ev?.dir_pvalue ?? data.backtest.directional_pvalue[k])})</span></td>
                        <td className="py-1 pr-3">{pct(cov?.['80'])} / {pct(cov?.['95'])}</td>
                        <td className={`py-1 font-sans ${beats ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {beats ? 'Yes' : 'No'}{reason ? <span className="text-fg-muted"> · {reason}</span> : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-3 flex items-start gap-2 text-[10px] text-fg-muted leading-relaxed">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400/80 mt-0.5" />
            <span>
              <strong className="text-fg-secondary">Experimental — not investment advice.</strong>{' '}
              {mlStatusSentence(data.ml_model)}{' '}
              {data.disclaimer} {data.method}
              {data.model_state?.fit_date && (
                <> Parameters fitted {data.model_state.fit_date}
                  {data.model_state.mode === 'filtered' ? `; ${data.model_state.bars_since_fit ?? 0} newer bars updated by Kalman filter, no refit.` : '.'}</>
              )}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
