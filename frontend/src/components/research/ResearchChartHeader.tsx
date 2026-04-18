'use client'

import { motion } from 'framer-motion'
import {
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  Star,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react'
import type { Ref } from 'react'
import { QuoteActivityFlash } from '@/components/QuoteActivityFlash'
import { formatNumber, formatPercent, isNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { sanitizeQuoteSummaryCompanyName } from '@/lib/company-display-name'
import type { TickerInfo } from '@/app/api/quotes/ticker/route'
import type { ChartSeriesType } from '@/components/Chart'
import TickerLogo from '@/components/TickerLogo'

export type ResearchChartPeriod = '1D' | '5D' | '1M' | '3M' | '6M' | '1Y' | '2Y' | '5Y'

export interface ResearchChartHeaderProps {
  selectedSymbol: string
  tickerInfo: TickerInfo | undefined
  /** When Yahoo profile is slow/missing, use Finviz/backend fundamentals name */
  companyNameFallback?: string | null
  /** True while `/api/quotes/ticker` is still resolving */
  profileLoading?: boolean
  chartPeriod: ResearchChartPeriod
  chartSeriesType: ChartSeriesType
  chartShowMa: boolean
  setChartPeriod: (p: ResearchChartPeriod) => void
  setChartSeriesType: (t: ChartSeriesType) => void
  setChartShowMa: (v: boolean) => void
  priceInfo: {
    price: number
    change: number
    percent: number
    volume?: number | null
    dataSource?: string
    latency?: number
  }
  quoteLoading: boolean
  priceTick: 'up' | 'down' | null
  quoteActivityFingerprint: number
  priceDataLength: number
  advancedOpen: boolean
  setAdvancedOpen: (o: boolean | ((b: boolean) => boolean)) => void
  advancedRef: Ref<HTMLDivElement>
  inWatchlist: boolean
  watchlistBusy: boolean
  onWatchlistToggle: () => void
  onSyncData: () => void
  syncing: boolean
}

export function ResearchChartHeader({
  selectedSymbol,
  tickerInfo,
  companyNameFallback,
  profileLoading = false,
  chartPeriod,
  chartSeriesType,
  chartShowMa,
  setChartPeriod,
  setChartSeriesType,
  setChartShowMa,
  priceInfo,
  quoteLoading,
  priceTick,
  quoteActivityFingerprint,
  priceDataLength,
  advancedOpen,
  setAdvancedOpen,
  advancedRef,
  inWatchlist,
  watchlistBusy,
  onWatchlistToggle,
  onSyncData,
  syncing,
}: ResearchChartHeaderProps) {
  const isPositive = isNumber(priceInfo.percent) ? priceInfo.percent >= 0 : false

  const rawCompany =
    tickerInfo?.name?.trim() ||
    (typeof companyNameFallback === 'string' ? companyNameFallback.trim() : '') ||
    ''
  const companyName = rawCompany
    ? sanitizeQuoteSummaryCompanyName(rawCompany, selectedSymbol)
    : ''
  const headline = companyName || selectedSymbol

  const quoteStatusStrip = (
    <div
      className={cn(
        'flex w-full flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-slate-800/90',
        'bg-slate-950/70 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-sm sm:gap-x-3',
      )}
      aria-label="Quote feed status"
    >
      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Live quote</span>
      <span className="hidden h-3 w-px bg-slate-700 sm:block" aria-hidden />
      {priceInfo.dataSource && !quoteLoading ? (
        <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-400">
          {priceInfo.dataSource}
        </span>
      ) : quoteLoading ? (
        <span className="rounded-md border border-slate-700/80 bg-slate-900/60 px-2 py-0.5 font-mono text-[10px] text-slate-500">
          Connecting…
        </span>
      ) : null}
      {isNumber(priceInfo.latency) && priceInfo.latency < 500 && !quoteLoading && (
        <span className="rounded-md border border-cyan-500/25 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] text-cyan-300">
          {priceInfo.latency}ms
        </span>
      )}
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] text-slate-600">Activity</span>
        <QuoteActivityFlash fingerprint={quoteActivityFingerprint} />
      </div>
      <span className="hidden h-3 w-px bg-slate-700 sm:block" aria-hidden />
      {/* Inline period selector — always visible */}
      <div className="flex items-center gap-0.5">
        {(['1D', '5D', '1M', '3M', '6M', '1Y'] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setChartPeriod(p)}
            className={cn(
              'rounded px-1.5 py-0.5 font-mono text-[10px] font-bold transition-colors',
              chartPeriod === p
                ? p === '1D' || p === '5D'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50',
            )}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="relative overflow-hidden border-b border-blue-500/10">
      {/* Flowing mesh + gradient (atmospheric, low contrast) */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.55]"
        aria-hidden
      >
        <div
          className={cn(
            'absolute -inset-[35%] animate-research-flow bg-[length:400%_400%]',
            'bg-gradient-to-br from-[rgba(0,122,255,0.22)] via-[rgba(99,102,241,0.12)] to-[rgba(6,182,212,0.18)]',
          )}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0e1a] via-[#0a0e1a]/88 to-transparent" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(0,122,255,0.25),transparent)]" />
        <div
          className="absolute inset-y-0 -left-1/3 w-1/2 bg-gradient-to-r from-white/[0.04] to-transparent animate-research-sheen opacity-40"
          style={{ animationDelay: '1.2s' }}
        />
      </div>

      <div className="relative z-10 flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
        <motion.div
          className="min-w-0 flex-1 space-y-3"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <TickerLogo
              symbol={selectedSymbol}
              companyName={companyName || undefined}
              size={40}
              className="rounded-xl border border-blue-500/20 hidden sm:block"
            />
            <div className="min-w-0">
            <h2 className="font-display text-2xl font-black leading-[1.15] tracking-tight text-white sm:text-3xl">
              <span className="block break-words">{headline}</span>
            </h2>
            {profileLoading && !companyName && (
              <p className="mt-1.5 text-[11px] text-slate-500">Loading company profile…</p>
            )}
            <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-2">
              {companyName ? (
                <span className="rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 font-mono text-xs font-bold uppercase tracking-wider text-blue-200">
                  {selectedSymbol}
                </span>
              ) : null}
              {tickerInfo?.exchange_display && (
                <span className="rounded-md border border-blue-500/25 bg-blue-500/10 px-2 py-0.5 font-mono text-[10px] text-blue-300">
                  {tickerInfo.exchange_display}
                </span>
              )}
              {tickerInfo?.sector && (
                <span className="rounded-md border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-300">
                  {tickerInfo.sector}
                </span>
              )}
              {tickerInfo?.industry && (
                <span className="hidden max-w-[14rem] truncate text-[10px] text-slate-500 lg:inline">
                  {tickerInfo.industry}
                </span>
              )}
            </div>
          </div>
          </div>

          {(priceInfo.price > 0 || quoteLoading || priceDataLength > 0) && (
            <div className="flex flex-wrap items-end gap-3">
              <span
                className={cn(
                  'font-mono text-2xl font-black text-white transition-colors duration-300 sm:text-3xl',
                  priceTick === 'up' && 'quote-price-flash-up',
                  priceTick === 'down' && 'quote-price-flash-down',
                )}
              >
                ${formatNumber(priceInfo.price, 2)}
                {quoteLoading && (
                  <Loader2 className="ml-2 inline h-4 w-4 animate-spin text-blue-400" />
                )}
              </span>
              <span
                className={cn(
                  'flex items-center gap-1 rounded-lg border px-2.5 py-1 text-sm font-bold',
                  isPositive
                    ? 'border-green-500/25 bg-green-500/10 text-green-400'
                    : 'border-red-500/25 bg-red-500/10 text-red-400',
                )}
              >
                {isPositive ? (
                  <TrendingUp className="h-3.5 w-3.5" />
                ) : (
                  <TrendingDown className="h-3.5 w-3.5" />
                )}
                {isPositive ? '+' : ''}
                {formatPercent(priceInfo.percent, 2)}
              </span>
              {isNumber(priceInfo.volume) && priceInfo.volume > 0 && (
                <span className="font-mono text-[11px] text-slate-500">
                  Vol {formatNumber(priceInfo.volume / 1_000_000, 2)}M
                </span>
              )}
              {tickerInfo && tickerInfo.target_price > 0 && (
                <span className="hidden font-mono text-[11px] text-[#007AFF] sm:inline">
                  PT ${formatNumber(tickerInfo.target_price, 2)}
                </span>
              )}
            </div>
          )}
        </motion.div>

        <motion.div
          className="flex w-full flex-shrink-0 flex-col gap-2.5 lg:w-auto lg:min-w-[17.5rem] xl:min-w-[19rem]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.08, duration: 0.35 }}
        >
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
            type="button"
            onClick={onWatchlistToggle}
            disabled={watchlistBusy}
            aria-pressed={inWatchlist}
            className={cn(
              'hud-card group flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-all disabled:opacity-50',
              inWatchlist
                ? 'border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/20'
                : 'bg-amber-500/5 text-amber-500 hover:border-amber-500/30 hover:text-amber-400',
            )}
          >
            <Star
              className={cn(
                'h-4 w-4 shrink-0',
                inWatchlist ? 'fill-amber-400 text-amber-300' : 'text-amber-500 group-hover:fill-amber-400/40',
              )}
              aria-hidden
            />
            {watchlistBusy ? 'Saving…' : inWatchlist ? 'In watchlist' : 'Watchlist'}
            </button>
            <button
            type="button"
            onClick={onSyncData}
            disabled={syncing}
            className="hud-card flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-slate-300 transition-all hover:border-blue-500/30 hover:text-white disabled:opacity-50"
          >
            {syncing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Sync Data
            </button>
            <div className="relative shrink-0" ref={advancedRef}>
            <button
              type="button"
              onClick={() => setAdvancedOpen((o) => !o)}
              className={cn(
                'hud-card flex items-center justify-center gap-2 border px-4 py-2 text-sm font-medium transition-all',
                advancedOpen
                  ? 'border-blue-500/40 bg-blue-500/20 text-blue-300'
                  : 'border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20',
              )}
              aria-expanded={advancedOpen}
              aria-haspopup="dialog"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Advanced
            </button>
              {advancedOpen ? (
              <div
                className="absolute right-0 top-full z-[80] mt-2 w-[min(100vw-2rem,18rem)] space-y-4 rounded-xl border border-slate-700/80 bg-[#0b0f14] p-4 text-left shadow-2xl"
                role="dialog"
                aria-label="Chart options"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-white">Chart</span>
                  <button
                    type="button"
                    onClick={() => setAdvancedOpen(false)}
                    className="rounded p-1 text-slate-500 hover:text-white"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div>
                  <div className="mb-2 text-[10px] uppercase tracking-wide text-slate-500">Period</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        ['1D', '1D'],
                        ['5D', '5D'],
                        ['1M', '1M'],
                        ['3M', '3M'],
                        ['6M', '6M'],
                        ['1Y', '1Y'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setChartPeriod(id)}
                        className={cn(
                          'rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors',
                          chartPeriod === id
                            ? 'border-blue-500/50 bg-blue-500/25 text-blue-200'
                            : 'border-slate-700/60 bg-slate-800/50 text-slate-400 hover:text-white',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-[10px] uppercase tracking-wide text-slate-500">Series</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        ['candlestick', 'OHLC'],
                        ['line', 'Line'],
                        ['area', 'Area'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setChartSeriesType(id)}
                        className={cn(
                          'rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors',
                          chartSeriesType === id
                            ? 'border-cyan-500/45 bg-cyan-500/20 text-cyan-200'
                            : 'border-slate-700/60 bg-slate-800/50 text-slate-400 hover:text-white',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={chartShowMa}
                    onChange={(e) => setChartShowMa(e.target.checked)}
                    disabled={chartSeriesType !== 'candlestick'}
                    className="rounded border-slate-600"
                  />
                  <span className={chartSeriesType !== 'candlestick' ? 'opacity-40' : ''}>
                    SMA 20 / EMA 50 overlays
                  </span>
                </label>
              </div>
              ) : null}
            </div>
          </div>
          {quoteStatusStrip}
        </motion.div>
      </div>
    </div>
  )
}
