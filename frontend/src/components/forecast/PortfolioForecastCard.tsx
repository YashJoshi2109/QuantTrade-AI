'use client'

/**
 * Portfolio-level forecast range: where the holdings' combined value may be at
 * a horizon, from each holding's statistical forecast range. Shared by
 * PortfolioDesktop and PortfolioMobile (same component, responsive).
 *
 * Maths (lib/forecastSummary.portfolioForecastBand): each holding's range is
 * applied to its market value and the bounds are summed, which is exact if the
 * holdings move together and therefore the widest plausible range. Cash is not
 * included. Holdings without a forecast are listed, never guessed.
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { FlaskConical, Info } from 'lucide-react'
import { Skeleton } from '@/components/Skeleton'
import { EXPERIMENTAL_LABEL, horizonLabel } from '@/lib/forecastHonesty'
import { COMPACT_HORIZONS, DEFAULT_HORIZON, fmtMoney, fmtRange, fmtSignedPct, portfolioForecastBand, type PortfolioPosition } from '@/lib/forecastSummary'
import { useForecastSummaries } from '@/lib/useForecastSummaries'

export function PortfolioForecastSkeleton() {
  return (
    <div className="space-y-3" data-testid="portfolio-forecast-skeleton">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-2 w-full" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
      <Skeleton className="h-3 w-3/4" />
    </div>
  )
}

export default function PortfolioForecastCard({ holdings, className = '' }: { holdings: readonly PortfolioPosition[]; className?: string }) {
  const [h, setH] = useState<number>(DEFAULT_HORIZON)
  const symbols = useMemo(() => holdings.map((x) => x.symbol), [holdings])
  const { summaries, isLoading, isError, byTicker } = useForecastSummaries(symbols)
  const band = useMemo(() => portfolioForecastBand(holdings, summaries, h), [holdings, summaries, h])
  const pending = band.missing.filter((s) => byTicker[s.toUpperCase()]?.status === 'pending')

  if (holdings.length === 0) return null

  return (
    <section className={`hud-card p-4 ${className}`} aria-label="Portfolio forecast range" data-testid="portfolio-forecast">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-fg-primary">Forecast range</h3>
          <span className="inline-flex items-center gap-1 rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
            <FlaskConical className="h-3 w-3" /> {EXPERIMENTAL_LABEL}
          </span>
        </div>
        <div role="tablist" aria-label="Forecast horizon" className="flex rounded-lg border border-line-subtle p-0.5">
          {COMPACT_HORIZONS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={h === k}
              onClick={() => setH(k)}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${h === k ? 'bg-surface-active text-fg-primary' : 'text-fg-muted hover:text-fg-primary'}`}
            >
              {horizonLabel(k)}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <PortfolioForecastSkeleton />
      ) : isError ? (
        <p className="flex items-start gap-2 text-xs text-fg-muted"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Forecasts are unavailable right now.</p>
      ) : !band.range_80 ? (
        <p className="flex items-start gap-2 text-xs text-fg-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {pending.length > 0
            ? `Forecasts for ${pending.join(', ')} are being computed. This updates on its own.`
            : 'None of these holdings has a forecast yet (each needs about 20 months of daily prices).'}
        </p>
      ) : (
        <>
          <p className="text-[11px] text-fg-muted">Value of {band.covered_count === band.total_count ? 'all' : `${band.covered_count} of ${band.total_count}`} holdings in {horizonLabel(h)}, 80% range</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-fg-primary">{fmtRange(band.range_80, 0)}</p>
          <p className="text-[11px] tabular-nums text-fg-muted">
            {band.range_80_pct ? `${fmtSignedPct(band.range_80_pct[0])} / ${fmtSignedPct(band.range_80_pct[1])}` : '—'} vs today&rsquo;s {fmtMoney(band.covered_value, 0)}
          </p>

          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg border border-line-subtle bg-surface-raised/40 p-2">
              <dt className="text-[10px] text-fg-muted" title="Loss if the value ends at the bottom of the 95% range (a VaR-style figure: about a 1-in-40 outcome under the model).">
                Downside at 95% low
              </dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-fg-primary">
                {band.downside_95 != null ? `${fmtMoney(band.downside_95, 0)} (${band.downside_95_pct?.toFixed(1)}%)` : '—'}
              </dd>
            </div>
            <div className="rounded-lg border border-line-subtle bg-surface-raised/40 p-2">
              <dt className="text-[10px] text-fg-muted" title="Value-weighted share of past walk-forward tests in which each holding's price ended inside its 80% range.">
                Ranges held in tests
              </dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-fg-primary">
                {band.avg_hit_rate_80 != null ? `${Math.round(band.avg_hit_rate_80 * 100)}%` : '—'}
                {band.min_tests != null && <span className="font-normal text-fg-muted"> · ≥{band.min_tests} tests</span>}
              </dd>
            </div>
          </dl>

          <p className="mt-3 text-[11px] leading-relaxed text-fg-muted">
            Assumes the holdings move together, so this is the widest plausible range; diversification usually narrows it. Cash is not included.
            {band.missing.length > 0 && <> Not covered: {band.missing.join(', ')}{pending.length ? ' (computing)' : ''}.</>}
            {!band.any_edge && <> No holding&rsquo;s forecast beat ARIMA(0,1,0) at this horizon, so the range says how far prices may move, not which way.</>}
            {' '}Statistical ranges, not a signal or advice. <Link href="/mlops" className="underline hover:text-fg-primary">How the models are tested</Link>.
          </p>
        </>
      )}
    </section>
  )
}
