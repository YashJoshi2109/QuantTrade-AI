'use client'

import { useMemo } from 'react'
import { formatNumber, isNumber } from '@/lib/format'
import type { TickerInfo } from '@/app/api/quotes/ticker/route'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface EarningsShortInterestPanelProps {
  symbol: string
  tickerInfo: TickerInfo | undefined
}

/* ------------------------------------------------------------------ */
/*  Small reusable pieces                                              */
/* ------------------------------------------------------------------ */

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-slate-900/40">
      <span className="text-xs text-slate-400 truncate">{label}</span>
      <span className="text-sm font-semibold text-white tabular-nums">{value}</span>
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
        <span className="text-xs text-slate-400">{label}</span>
        <span className="text-xs font-semibold text-white tabular-nums">{display}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
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

function fmtPercent(val: unknown): string {
  if (!isNumber(val)) return 'N/A'
  return `${(val * 100).toFixed(2)}%`
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function EarningsShortInterestPanel({
  symbol,
  tickerInfo,
}: EarningsShortInterestPanelProps) {
  const earningsDate = tickerInfo?.earnings_date
  const hasEarnings = earningsDate && earningsDate !== 'N/A' && earningsDate !== ''

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

  if (!tickerInfo) {
    return (
      <div className="hud-panel rounded-xl border border-slate-800/50 p-6">
        <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
          Loading data for {symbol}...
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ---- Earnings Card ---- */}
      <div className="hud-panel rounded-xl border border-slate-800/50 p-5">
        <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-3">
          Earnings
        </h3>

        {hasEarnings ? (
          <div className="flex items-start gap-4">
            {/* Calendar icon + date */}
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

            {/* EPS data */}
            <div className="flex-1 space-y-2">
              <p className="text-slate-300 text-sm font-medium">
                Next Earnings Report
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-slate-900/60 px-3 py-2">
                  <span className="text-[10px] uppercase text-slate-500 block">EPS (TTM)</span>
                  <span className="text-white font-semibold text-sm">
                    {isNumber(tickerInfo.eps) ? `$${formatNumber(tickerInfo.eps)}` : 'N/A'}
                  </span>
                </div>
                <div className="rounded-lg bg-slate-900/60 px-3 py-2">
                  <span className="text-[10px] uppercase text-slate-500 block">Fwd EPS</span>
                  <span className="text-white font-semibold text-sm">
                    {isNumber(tickerInfo.forward_eps)
                      ? `$${formatNumber(tickerInfo.forward_eps)}`
                      : 'N/A'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-slate-500 text-sm">No upcoming earnings date available.</p>
        )}
      </div>

      {/* ---- Short Interest ---- */}
      <div className="hud-panel rounded-xl border border-slate-800/50 p-5">
        <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-4">
          Short Interest
        </h3>

        <div className="space-y-4">
          <GaugeBar
            label="Short Ratio (Days to Cover)"
            value={tickerInfo.short_ratio}
            max={10}
            color="#f59e0b"
          />
          <GaugeBar
            label="Short % of Float"
            value={
              isNumber(tickerInfo.short_percent_of_float)
                ? tickerInfo.short_percent_of_float * 100
                : undefined
            }
            max={50}
            color="#ef4444"
            suffix="%"
          />
        </div>

        {/* Contextual note */}
        <div className="mt-4 rounded-lg bg-slate-900/40 px-3 py-2">
          <p className="text-[10px] text-slate-500 leading-relaxed">
            {isNumber(tickerInfo.short_percent_of_float) &&
            tickerInfo.short_percent_of_float > 0.2
              ? 'Elevated short interest may indicate bearish sentiment or potential squeeze conditions.'
              : 'Short interest is within typical range for this stock.'}
          </p>
        </div>
      </div>

      {/* ---- Key Statistics Grid ---- */}
      <div className="hud-panel rounded-xl border border-slate-800/50 p-5">
        <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-3">
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
