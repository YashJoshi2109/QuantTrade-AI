'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatNumber, formatPercent, isNumber } from '@/lib/format'
import type { TickerInfo } from '@/app/api/quotes/ticker/route'
import type { EarningsQuarter } from '@/app/api/quotes/earnings/route'
import { Skeleton } from '@/components/Skeleton'
import { fmtCompact, fmtSignedPct, shortVolumeTone, useShortInterest } from '@/lib/publicData'
import { SourceLine } from './SourceLine'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface EarningsShortInterestPanelProps {
  symbol: string
  tickerInfo: TickerInfo | undefined
  loading?: boolean
  error?: boolean
  onRetry?: () => void
}

/* ------------------------------------------------------------------ */
/*  Small reusable pieces                                              */
/* ------------------------------------------------------------------ */

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-surface-raised">
      <span className="text-xs text-fg-muted truncate">{label}</span>
      <span className="text-sm font-semibold text-fg-primary tabular-nums">{value}</span>
  </div>
  )
}

function GaugeBar({
  label,
  value,
  max,
  color,
  suffix = '',
}: {
  label: string
  value: number | undefined | null
  max: number
  color: string
  suffix?: string
}) {
  const pct = isNumber(value) ? Math.min((value / max) * 100, 100) : 0
  const display = isNumber(value) ? `${formatNumber(value, 2)}${suffix}` : 'N/A'

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-fg-muted">{label}</span>
        <span className="text-xs font-semibold text-fg-primary tabular-nums">{display}</span>
      </div>
      <div className="h-2 rounded-full bg-surface-raised overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Formatters                                                         */
/* ------------------------------------------------------------------ */

function fmtLargeNumber(val: unknown): string {
  if (!isNumber(val)) return 'N/A'
  if (Math.abs(val) >= 1e12) return `${(val / 1e12).toFixed(2)}T`
  if (Math.abs(val) >= 1e9) return `${(val / 1e9).toFixed(2)}B`
  if (Math.abs(val) >= 1e6) return `${(val / 1e6).toFixed(2)}M`
  if (Math.abs(val) >= 1e3) return `${(val / 1e3).toFixed(1)}K`
  return formatNumber(val, 2)
}

function fmtPrice(val: unknown): string {
  if (!isNumber(val)) return 'N/A'
  return `$${formatNumber(val, 2)}`
}

// /api/quotes/ticker returns percent-unit numbers (0.33 means 0.33%), so no x100 here.
function fmtPercent(val: unknown): string {
  return formatPercent(val)
}

/* ------------------------------------------------------------------ */
/*  Short interest card                                                */
/* ------------------------------------------------------------------ */

function ShortInterestCard({ symbol, tickerInfo, showQuoteFeed }: { symbol: string; tickerInfo: TickerInfo; showQuoteFeed: boolean }) {
  const { data, isLoading } = useShortInterest(symbol)
  const finraOk = data?.status === 'ok' && !!(data.short_interest || data.short_volume?.days.length)
  const syncing = isLoading || (data?.syncing && !finraOk)

  if (syncing) {
    return (
      <div className="hud-panel rounded-xl border border-line-subtle p-5" aria-busy data-testid="short-interest-skeleton">
        <h3 className="text-xs uppercase tracking-wider text-fg-muted font-semibold mb-4">Short Interest</h3>
        <div className="space-y-3">
          <Skeleton className="h-4 w-2/3 bg-slate-200 dark:bg-white/10" />
          <Skeleton className="h-2 w-full bg-slate-200 dark:bg-white/10" />
          <Skeleton className="h-2 w-full bg-slate-200 dark:bg-white/10" />
        </div>
      </div>
    )
  }

  if (finraOk && data) {
    const si = data.short_interest
    const sv = data.short_volume
    const ratio = sv?.avg_short_ratio_pct ?? null
    const hist = (data.history ?? []).slice(-8)
    const vals = hist.map((h) => h.shares_short ?? 0)
    const maxShort = Math.max(...vals, 1)
    const minShort = Math.min(...vals)
    // bars span the min..max range (20%..100% height) so bi-monthly changes are visible
    const barPct = (v: number) => (maxShort > minShort ? 20 + ((v - minShort) / (maxShort - minShort)) * 80 : 100)
    return (
      <div className="hud-panel rounded-xl border border-line-subtle p-5" data-testid="short-interest-finra">
        <h3 className="text-xs uppercase tracking-wider text-fg-muted font-semibold mb-4">Short Interest</h3>
        {si && (
          <div className="grid grid-cols-2 gap-2 mb-4">
            <StatCell label={`Shares short (${si.settlement_date})`} value={fmtCompact(si.shares_short)} />
            <StatCell label="Change vs prior" value={fmtSignedPct(si.change_pct)} />
          </div>
        )}
        <div className="space-y-4">
          {si && <GaugeBar label="Days to Cover" value={si.days_to_cover} max={10} color="#f59e0b" />}
          {ratio !== null && (
            <GaugeBar label={`Off-exchange short-sale volume (avg ${sv?.days.length ?? 0}d)`} value={ratio} max={100} color="#ef4444" suffix="%" />
          )}
        </div>
        {hist.length > 1 && (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-[10px] text-fg-muted">
              <span>Shares short, last {hist.length} settlements</span>
              <span className="tabular-nums">{fmtCompact(minShort)}–{fmtCompact(maxShort)}</span>
            </div>
            <div className="flex h-12 items-end gap-1" aria-label="Short interest by settlement date">
              {hist.map((h) => (
                <div key={h.settlement_date} className="flex-1 rounded-t bg-amber-500/70" style={{ height: `${barPct(h.shares_short ?? 0)}%` }} title={`${h.settlement_date}: ${fmtCompact(h.shares_short)}`} />
              ))}
            </div>
          </div>
        )}
        <div className="mt-4 rounded-lg bg-surface-raised px-3 py-2">
          <p className="text-[10px] text-fg-muted leading-relaxed">
            Short interest is reported twice a month and published about 7 business days after settlement.
            Short-sale volume covers off-exchange trades reported to FINRA and includes market-maker hedging; it is not short interest.
            {shortVolumeTone(ratio) === 'high' ? ' Short-sale volume is above 55% of reported volume.' : ''}
          </p>
        </div>
        <SourceLine attribution={data.attribution} testId="short-interest-source" />
      </div>
    )
  }

  if (!showQuoteFeed) {
    if (data?.status === 'disabled') {
      return (
        <div className="hud-panel rounded-xl border border-line-subtle p-5" data-testid="short-interest-disabled">
          <h3 className="text-xs uppercase tracking-wider text-fg-muted font-semibold mb-2">Short Interest</h3>
          <p className="text-xs text-fg-muted">No short-interest figures for {symbol}. FINRA short-interest data is not shown until FINRA display terms are cleared.</p>
        </div>
      )
    }
    return null
  }

  // Quote-feed fallback (Yahoo Finance key statistics via /api/quotes/ticker; already in percent units)
  return (
    <div className="hud-panel rounded-xl border border-line-subtle p-5" data-testid="short-interest-quote">
      <h3 className="text-xs uppercase tracking-wider text-fg-muted font-semibold mb-4">Short Interest</h3>
      <div className="space-y-4">
        <GaugeBar label="Short Ratio (Days to Cover)" value={tickerInfo.short_ratio} max={10} color="#f59e0b" />
        <GaugeBar label="Short % of Float" value={tickerInfo.short_percent_of_float} max={50} color="#ef4444" suffix="%" />
      </div>
      <div className="mt-4 rounded-lg bg-surface-raised px-3 py-2">
        <p className="text-[10px] text-fg-muted leading-relaxed">
          {isNumber(tickerInfo.short_percent_of_float) && tickerInfo.short_percent_of_float > 20
            ? 'Elevated short interest may indicate bearish sentiment or potential squeeze conditions.'
            : 'Short interest is within typical range for this stock.'}
        </p>
      </div>
      <p className="mt-3 text-[11px] text-fg-muted">Source: Yahoo Finance key statistics (exchange-reported short interest), as of the latest update</p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function EarningsShortInterestPanel({
  symbol,
  tickerInfo,
  loading = false,
  error = false,
  onRetry,
}: EarningsShortInterestPanelProps) {
  // Fetch quarterly earnings history from Finnhub
  const { data: earningsData } = useQuery<{ quarters: EarningsQuarter[] }>({
    queryKey: ['earnings-history', symbol],
    queryFn: async () => {
      const res = await fetch(`/api/quotes/earnings?symbol=${encodeURIComponent(symbol)}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 60 * 60_000,
    enabled: !!symbol,
  })
  const earningsQuarters = earningsData?.quarters ?? []

  const earningsDate = tickerInfo?.earnings_date
  const hasEarnings = earningsDate && earningsDate !== 'N/A' && earningsDate !== ''

  const showShortInterest =
    !!tickerInfo &&
    ((isNumber(tickerInfo.short_ratio) && tickerInfo.short_ratio > 0) ||
      (isNumber(tickerInfo.short_percent_of_float) && tickerInfo.short_percent_of_float > 0))

  const keyStats = useMemo(() => {
    if (!tickerInfo) return []
    return [
      { label: 'Market Cap', value: fmtLargeNumber(tickerInfo.market_cap) },
      { label: 'P/E Ratio', value: formatNumber(tickerInfo.pe_ratio) },
      { label: 'Forward P/E', value: formatNumber(tickerInfo.forward_pe) },
      { label: 'Dividend Yield', value: fmtPercent(tickerInfo.dividend_yield) },
      { label: 'Avg Volume', value: fmtLargeNumber(tickerInfo.avg_volume) },
      { label: 'Volume', value: fmtLargeNumber(tickerInfo.volume) },
      { label: 'High Today', value: fmtPrice(tickerInfo.day_high) },
      { label: 'Low Today', value: fmtPrice(tickerInfo.day_low) },
      { label: 'Open', value: fmtPrice(tickerInfo.open) },
      { label: 'Prev Close', value: fmtPrice(tickerInfo.prev_close) },
      { label: '52W High', value: fmtPrice(tickerInfo.week_52_high) },
      { label: '52W Low', value: fmtPrice(tickerInfo.week_52_low) },
    ]
  }, [tickerInfo])

  if (loading && !tickerInfo) {
    return (
      <div className="hud-panel rounded-xl border border-line-subtle p-6">
        <div className="flex h-32 flex-col items-center justify-center gap-2 text-fg-muted">
          <span className="text-sm">Loading data for {symbol}…</span>
          <span className="text-[11px] text-fg-muted">Fetching quote summary…</span>
        </div>
      </div>
    )
  }

  if (error && !tickerInfo) {
    return (
      <div className="hud-panel rounded-xl border border-amber-500/20 bg-amber-950/10 p-6">
        <div className="flex h-32 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-fg-secondary">
            Could not load earnings &amp; short interest for <span className="font-mono text-fg-primary">{symbol}</span>.
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg border border-blue-500/40 bg-blue-500/15 px-4 py-2 text-sm font-medium text-blue-300 hover:bg-blue-500/25"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    )
  }

  if (!tickerInfo) {
    return (
      <div className="hud-panel rounded-xl border border-line-subtle p-6">
        <div className="flex h-32 flex-col items-center justify-center gap-2 text-fg-muted">
          <span className="text-sm">No quote data for {symbol}.</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="text-xs text-blue-400 underline hover:text-blue-300"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ---- Earnings Card (only when next date is known) ---- */}
      {hasEarnings && (
        <div className="hud-panel rounded-xl border border-line-subtle p-5">
          <h3 className="text-xs uppercase tracking-wider text-fg-muted font-semibold mb-3">
            Earnings
          </h3>

          <div className="flex items-start gap-4">
            <div className="flex flex-col items-center justify-center rounded-xl bg-blue-600/10 border border-blue-500/20 px-4 py-3 min-w-[90px]">
              <svg
                className="w-5 h-5 text-blue-400 mb-1"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
                />
              </svg>
              <span className="text-blue-400 text-xs font-bold tracking-wide">
                {earningsDate}
              </span>
            </div>

            <div className="flex-1 space-y-2">
              <p className="text-fg-secondary text-sm font-medium">
                Next Earnings Report
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-surface-raised px-3 py-2">
                  <span className="text-[10px] uppercase text-fg-muted block">EPS (TTM)</span>
                  <span className="text-fg-primary font-semibold text-sm">
                    {isNumber(tickerInfo.eps) ? `$${formatNumber(tickerInfo.eps)}` : 'N/A'}
                  </span>
                </div>
                <div className="rounded-lg bg-surface-raised px-3 py-2">
                  <span className="text-[10px] uppercase text-fg-muted block">Fwd EPS</span>
                  <span className="text-fg-primary font-semibold text-sm">
                    {isNumber(tickerInfo.forward_eps)
                      ? `$${formatNumber(tickerInfo.forward_eps)}`
                      : 'N/A'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- Earnings History Chart (Finnhub) ---- */}
      {earningsQuarters.length > 0 && (
        <div className="hud-panel rounded-xl border border-line-subtle p-5">
          <h3 className="text-xs uppercase tracking-wider text-fg-muted font-semibold mb-4">
            Earnings History — EPS Actual vs Estimate
          </h3>
          <div className="flex items-end gap-3 justify-center h-32">
            {earningsQuarters.slice(0, 8).reverse().map((q, i) => {
              const maxEps = Math.max(
                ...earningsQuarters.map((e) => Math.max(Math.abs(e.actual ?? 0), Math.abs(e.estimate ?? 0))),
                0.01,
              )
              const actualH = q.actual != null ? Math.abs(q.actual / maxEps) * 100 : 0
              const estH = q.estimate != null ? Math.abs(q.estimate / maxEps) * 100 : 0
              const beat = q.actual != null && q.estimate != null && q.actual >= q.estimate
              return (
                <div key={`${q.period}-${i}`} className="flex flex-col items-center gap-1 flex-1 max-w-[60px]">
                  <div className="flex items-end gap-0.5 h-20">
                    {q.estimate != null && (
                      <div
                        className="w-3 rounded-t bg-line-default transition-all"
                        style={{ height: `${Math.max(estH, 4)}%` }}
                        title={`Est: $${q.estimate.toFixed(2)}`}
                      />
                    )}
                    {q.actual != null && (
                      <div
                        className={`w-3 rounded-t transition-all ${beat ? 'bg-emerald-500' : 'bg-red-400'}`}
                        style={{ height: `${Math.max(actualH, 4)}%` }}
                        title={`Actual: $${q.actual.toFixed(2)}`}
                      />
                    )}
                  </div>
                  <span className="text-[9px] text-fg-muted text-center leading-tight">
                    Q{q.quarter} {String(q.year).slice(-2)}
                  </span>
                  {q.actual != null && (
                    <span className={`text-[9px] font-mono font-bold ${beat ? 'text-emerald-400' : 'text-red-400'}`}>
                      ${q.actual.toFixed(2)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex items-center justify-center gap-4 mt-3 text-[10px] text-fg-muted">
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-sm bg-line-default" /> Estimate
            </span>
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-sm bg-emerald-500" /> Beat
            </span>
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-sm bg-red-400" /> Miss
            </span>
          </div>
        </div>
      )}

      {/* ---- Short Interest: FINRA (when enabled) else the quote feed; omitted when neither has figures ---- */}
      <ShortInterestCard symbol={symbol} tickerInfo={tickerInfo} showQuoteFeed={showShortInterest} />

      {/* ---- Key Statistics Grid ---- */}
      <div className="hud-panel rounded-xl border border-line-subtle p-5">
        <h3 className="text-xs uppercase tracking-wider text-fg-muted font-semibold mb-3">
          Key Statistics
        </h3>
        <div className="grid grid-cols-2 gap-1.5">
          {keyStats.map((stat) => (
            <StatCell key={stat.label} label={stat.label} value={stat.value} />
          ))}
        </div>
      </div>
    </div>
  )
}
