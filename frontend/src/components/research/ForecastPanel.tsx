'use client'

/**
 * Statistical price forecast — fan chart + horizon cards + honest accuracy.
 * Shared by desktop research page and mobile research (same component, responsive).
 * Data: GET /api/v1/forecast/{ticker} (ARIMA/ETS/Theta ensemble, GJR-GARCH bands).
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Info, LineChart, Loader2 } from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || ''

type Band = [number, number]
export interface ForecastPoint {
  h: number
  date: string
  point: number
  exp_return_pct: number
  prob_up: number
  bands: Record<'50' | '80' | '95', Band>
}
export interface ForecastResponse {
  ticker: string
  as_of: string
  last_close: number
  horizons: ForecastPoint[]
  path: ForecastPoint[]
  models: { weights: Record<string, number>; arima_order: number[]; volatility: string }
  vol_annualized_pct: number
  backtest: {
    origins: number
    period: [string | null, string | null]
    mase_vs_naive: Record<string, number | null>
    directional_accuracy: Record<string, number | null>
    directional_pvalue: Record<string, number | null>
    band_coverage: Record<string, Record<string, number | null>>
  }
  beats_naive: Record<string, boolean>
  method: string
  disclaimer: string
}

async function fetchForecast(symbol: string): Promise<ForecastResponse> {
  const res = await fetch(`${API_BASE}/api/v1/forecast/${encodeURIComponent(symbol)}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(typeof body?.detail === 'string' ? body.detail : `Forecast unavailable (${res.status})`)
  }
  return res.json()
}

const HLABEL: Record<number, string> = { 1: '1 day', 5: '1 week', 20: '1 month' }
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

function FanChart({ data }: { data: ForecastResponse }) {
  const W = 640, H = 220
  const g = useMemo(() => buildFanGeometry(data, W, H), [data])
  const ticks = [0, 5, 10, 15, 20].filter((i) => i <= data.path.length)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
      aria-label={`${data.ticker} 20-day forecast fan chart with 50, 80 and 95 percent bands`}>
      <polygon points={g.area('95')} className="fill-blue-500/10" />
      <polygon points={g.area('80')} className="fill-blue-500/15" />
      <polygon points={g.area('50')} className="fill-blue-500/25" />
      {/* naive / random-walk reference: price stays where it is */}
      <line x1={g.x(0)} x2={g.x(data.path.length)} y1={g.naiveY} y2={g.naiveY}
        className="stroke-fg-muted" strokeDasharray="4 4" strokeWidth={1} />
      <polyline points={g.line} fill="none" className="stroke-blue-400" strokeWidth={2} />
      <circle cx={g.x(0)} cy={g.naiveY} r={3.5} className="fill-white" />
      {ticks.map((i) => (
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

export default function ForecastPanel({ symbol }: { symbol: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['forecast', symbol],
    queryFn: () => fetchForecast(symbol),
    enabled: !!symbol,
    staleTime: 30 * 60 * 1000,
    retry: 1,
  })

  return (
    <div className="col-span-12 hud-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <LineChart className="w-4 h-4 text-blue-400" />
          <h3 className="font-bold text-sm text-white tracking-wide">Price Forecast Range</h3>
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-line-subtle text-fg-muted">Statistical</span>
        </div>
        {data && <span className="text-[10px] text-fg-muted">As of close {data.as_of} · {data.vol_annualized_pct}% annualized volatility</span>}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 h-40 text-sm text-fg-muted">
          <Loader2 className="w-4 h-4 animate-spin" /> Fitting models on 2 years of prices…
        </div>
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
                <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-blue-500/40" />50% range</span>
                <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-blue-500/20" />80%</span>
                <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-blue-500/10" />95%</span>
                <span className="flex items-center gap-1"><span className="w-3 border-t border-dashed border-fg-muted" />No-change baseline</span>
              </div>
            </div>
            <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-2">
              {data.horizons.map((h) => {
                const beats = data.beats_naive[String(h.h)]
                return (
                  <div key={h.h} className="rounded-xl border border-line-subtle bg-surface-raised/40 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-fg-secondary">{HLABEL[h.h] ?? `${h.h}d`} · {h.date}</span>
                      <span className={`text-[10px] font-mono ${h.exp_return_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {h.exp_return_pct >= 0 ? '+' : ''}{h.exp_return_pct.toFixed(2)}%
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-white font-mono">
                      80% range {money(h.bands['80'][0])} – {money(h.bands['80'][1])}
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-fg-muted">
                      <span>Midpoint {money(h.point)} · P(up) {pct(h.prob_up)}</span>
                      <span className={beats ? 'text-emerald-400' : 'text-amber-400'}>
                        {beats ? 'Beat baseline in tests' : 'No edge vs baseline'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Out-of-sample accuracy — shown, not hidden */}
          <div className="mt-4 rounded-xl border border-line-subtle bg-surface-raised/30 p-3">
            <div className="text-[11px] font-semibold text-fg-secondary mb-2">
              How it did out of sample · {data.backtest.origins} walk-forward tests ({data.backtest.period[0]} → {data.backtest.period[1]})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] font-mono">
                <thead>
                  <tr className="text-fg-muted text-left">
                    <th className="py-1 pr-3 font-medium">Horizon</th>
                    <th className="py-1 pr-3 font-medium" title="Mean absolute error relative to the no-change baseline; below 1.00 is better than the baseline">Error vs baseline</th>
                    <th className="py-1 pr-3 font-medium">Direction hit rate</th>
                    <th className="py-1 font-medium" title="Share of past outcomes that landed inside the 80% / 95% range">Range coverage 80 / 95</th>
                  </tr>
                </thead>
                <tbody className="text-fg-secondary">
                  {data.horizons.map(({ h }) => {
                    const k = String(h)
                    const m = data.backtest.mase_vs_naive[k]
                    const cov = data.backtest.band_coverage[k] ?? {}
                    return (
                      <tr key={k} className="border-t border-line-subtle">
                        <td className="py-1 pr-3">{HLABEL[h] ?? `${h}d`}</td>
                        {/* green only when the edge is also statistically supported (beats_naive), not for 0.98 noise */}
                        <td className={`py-1 pr-3 ${data.beats_naive[k] ? 'text-emerald-400' : 'text-fg-secondary'}`}>{m?.toFixed(2) ?? '—'}×</td>
                        <td className="py-1 pr-3">{pct(data.backtest.directional_accuracy[k])} <span className="text-fg-muted">(p={data.backtest.directional_pvalue[k]?.toFixed(2) ?? '—'})</span></td>
                        <td className="py-1">{pct(cov['80'])} / {pct(cov['95'])}</td>
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
              {data.disclaimer} Models: ARIMA{data.models.arima_order.length ? ` (${data.models.arima_order.join(',')})` : ''}, ETS, Theta and drift on log price, combined by past accuracy; ranges from {data.models.volatility} volatility, calibrated on the tests above.
            </span>
          </div>
        </>
      )}
    </div>
  )
}
