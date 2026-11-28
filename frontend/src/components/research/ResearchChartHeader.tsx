'use client'

import { GitCompareArrows, Link2, Loader2, RefreshCw, Sparkles, Star, X } from 'lucide-react'
import IntentLink from '@/components/nav/IntentLink'
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { sanitizeQuoteSummaryCompanyName } from '@/lib/company-display-name'
import type { TickerInfo } from '@/app/api/quotes/ticker/route'
import type { ChartSeriesType } from '@/components/Chart'
import TickerLogo from '@/components/TickerLogo'
import EarningsBadge from '@/components/earnings/EarningsBadge'
import { CardSkeleton as Skeleton } from './ResearchCard'
import { buildCopilotHref } from '@/lib/copilot-handoff'
import { compareHref } from '@/lib/compare'
import { stockPath } from '@/lib/stockPage/symbol'
import type { ExtendedBadge } from '@/lib/canonicalQuote'
import { DESKTOP_PERIODS } from '@/lib/researchPrefs'
import { exchangeLabel, fmtChange, fmtNum, fmtSigned, toneText } from '@/lib/researchTechnicals'

export type ResearchChartPeriod = '1D' | '5D' | '1M' | '3M' | '6M' | '1Y' | '2Y' | '5Y'

/**
 * Renders a popover on document.body, anchored under its button. Rendering it
 * inline left it clipped by the card (overflow hidden / own stacking context).
 * Marked with data-chart-settings-portal so outside-click handlers treat
 * clicks inside it as "inside".
 */
export function AnchoredPopover({
  anchor,
  children,
  align = 'right',
}: {
  anchor: HTMLElement | null
  children: ReactNode
  /** Which anchor edge the popover lines up with. */
  align?: 'left' | 'right'
}) {
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number; maxHeight: number } | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  useLayoutEffect(() => {
    if (!anchor) return
    const update = () => {
      const r = anchor.getBoundingClientRect()
      const top = r.bottom + 8
      const maxHeight = Math.max(160, window.innerHeight - top - 8)
      setPos(
        align === 'left'
          ? { top, left: Math.max(8, Math.min(r.left, window.innerWidth - 8 - 224)), maxHeight }
          : { top, right: Math.max(8, window.innerWidth - r.right), maxHeight },
      )
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [anchor, align])
  if (!mounted || !pos) return null
  return createPortal(
    <div
      data-chart-settings-portal
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        right: pos.right,
        maxHeight: pos.maxHeight,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 1000,
      }}
    >
      {children}
    </div>,
    document.body,
  )
}

// ── Chart settings panel (desktop settings icon; moved from the old header) ──

export interface ChartSettingsProps {
  chartPeriod: ResearchChartPeriod
  setChartPeriod: (p: ResearchChartPeriod) => void
  chartSeriesType: ChartSeriesType
  setChartSeriesType: (t: ChartSeriesType) => void
  chartShowMa: boolean
  setChartShowMa: (v: boolean) => void
  chartShowVolume: boolean
  setChartShowVolume: (v: boolean) => void
  chartLogScale: boolean
  setChartLogScale: (v: boolean) => void
  chartShowGrid: boolean
  setChartShowGrid: (v: boolean) => void
  onResetChart?: () => void
  onClose: () => void
}

const pill = (active: boolean) =>
  cn(
    'rounded-md border px-2.5 py-1 text-[11px] font-medium tabular-nums transition-colors',
    active
      ? 'border-blue-600 bg-blue-600 text-white dark:border-blue-500 dark:bg-blue-500'
      : 'border-line-default text-fg-muted hover:text-fg-primary',
  )

export function ChartSettingsPanel(p: ChartSettingsProps) {
  const maAllowed = p.chartSeriesType === 'candlestick' || p.chartSeriesType === 'heikin-ashi'
  return (
    <div
      className="rs-card w-[min(100vw-2rem,22rem)] max-h-[70vh] space-y-4 overflow-y-auto p-4 text-left shadow-theme-lg"
      role="dialog"
      aria-label="Chart options"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-fg-primary">Chart settings</span>
        <button type="button" onClick={p.onClose} className="rounded p-1 text-fg-muted hover:text-fg-primary" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div>
        <div className="mb-2 text-[10px] uppercase tracking-wide text-fg-muted">Timeframe</div>
        <div className="flex flex-wrap gap-1.5">
          {DESKTOP_PERIODS.map((id) => (
            <button key={id} type="button" onClick={() => p.setChartPeriod(id)} className={pill(p.chartPeriod === id)}>
              {id}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-2 text-[10px] uppercase tracking-wide text-fg-muted">Chart type</div>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['candlestick', 'Candles'],
              ['heikin-ashi', 'Heikin-Ashi'],
              ['line', 'Line'],
              ['area', 'Area'],
              ['baseline', 'Baseline'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" onClick={() => p.setChartSeriesType(id)} className={pill(p.chartSeriesType === id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-2 text-[10px] uppercase tracking-wide text-fg-muted">Overlays &amp; display</div>
        <div className="space-y-2 text-xs text-fg-secondary">
          <label className="flex cursor-pointer select-none items-center gap-2">
            <input type="checkbox" checked={p.chartShowMa} onChange={(e) => p.setChartShowMa(e.target.checked)} disabled={!maAllowed} className="accent-blue-600" />
            <span className={maAllowed ? '' : 'opacity-40'}>SMA 20 / EMA 50</span>
          </label>
          <label className="flex cursor-pointer select-none items-center gap-2">
            <input type="checkbox" checked={p.chartShowVolume} onChange={(e) => p.setChartShowVolume(e.target.checked)} className="accent-blue-600" />
            Volume histogram
          </label>
          <label className="flex cursor-pointer select-none items-center gap-2">
            <input type="checkbox" checked={p.chartShowGrid} onChange={(e) => p.setChartShowGrid(e.target.checked)} className="accent-blue-600" />
            Grid lines
          </label>
          <label className="flex cursor-pointer select-none items-center gap-2">
            <input type="checkbox" checked={p.chartLogScale} onChange={(e) => p.setChartLogScale(e.target.checked)} className="accent-blue-600" />
            Logarithmic scale
          </label>
          {p.onResetChart && (
            <button
              type="button"
              onClick={p.onResetChart}
              className="mt-1 text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
              title="Chart settings are remembered between visits"
            >
              Reset chart settings
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Extended-hours pill ────────────────────────────────────────────────

/**
 * "Pre-market $353.09 (+3.14%)": the canonical quote's extended print, tinted
 * by direction. Hidden when there is no extended session print. Shown next to
 * (never as) the regular-session price.
 */
export function ExtendedPill({ badge, className }: { badge?: ExtendedBadge | null; className?: string }) {
  if (!badge) return null
  const when = badge.time
    ? new Date(badge.time).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'
    : undefined
  const pct = badge.changePercent === null ? null : `${fmtSigned(badge.changePercent, 2)}%`
  const tone = badge.changePercent === null ? 'neutral' : badge.up ? 'up' : 'down'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] tabular-nums',
        tone === 'up' && 'border-emerald-500/30 bg-emerald-500/10',
        tone === 'down' && 'border-red-500/30 bg-red-500/10',
        tone === 'neutral' && 'border-line-subtle',
        className,
      )}
      title={`${badge.label} trade${when ? ` at ${when}` : ''}, vs the regular-session close`}
      aria-label={badge.text}
      data-testid="extended-hours-badge"
    >
      <span className="text-fg-muted">{badge.label}</span>
      <span className="font-semibold text-fg-primary">${fmtNum(badge.price, 2)}</span>
      {pct && <span className={cn('font-medium', toneText(tone))}>({pct})</span>}
    </span>
  )
}

// ── Desktop header ──────────────────────────────────────────────────────

export function companyHeadline(symbol: string, name?: string | null): string {
  const raw = (name ?? '').trim()
  return raw ? sanitizeQuoteSummaryCompanyName(raw, symbol) : ''
}

export interface ResearchPriceHeaderProps {
  symbol: string
  tickerInfo: TickerInfo | undefined
  companyNameFallback?: string | null
  profileLoading: boolean
  priceInfo: {
    price: number
    change: number
    percent: number
    hasPrice?: boolean
    extended?: ExtendedBadge | null
  }
  quoteLoading: boolean
  priceTick: 'up' | 'down' | null
  inWatchlist: boolean
  watchlistBusy: boolean
  onWatchlistToggle: () => void
  onSyncData: () => void
  syncing: boolean
}

const iconBtn =
  'inline-flex h-9 w-9 items-center justify-center rounded-full border border-line-default text-fg-secondary transition-colors hover:text-fg-primary hover:bg-surface-hover disabled:opacity-50'

/** Desktop Research header: identity row + price row (design mock). */
export function ResearchPriceHeader(p: ResearchPriceHeaderProps) {
  const name = companyHeadline(p.symbol, p.tickerInfo?.name || p.companyNameFallback)
  const meta = [p.symbol, exchangeLabel(p.tickerInfo?.exchange_display || p.tickerInfo?.exchange), p.tickerInfo?.sector].filter(Boolean).join(' · ')
  const up = p.priceInfo.percent >= 0
  const hasPrice = p.priceInfo.hasPrice ?? p.priceInfo.price > 0
  return (
    <header className="space-y-3" data-testid="research-header">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <TickerLogo symbol={p.symbol} companyName={name || undefined} size={48} className="rounded-xl border border-line-subtle" />
          <div className="min-w-0">
            {name ? (
              <h1 className="truncate text-2xl font-bold leading-tight tracking-tight text-fg-primary">{name}</h1>
            ) : p.profileLoading ? (
              <Skeleton className="h-7 w-56" />
            ) : (
              <h1 className="truncate text-2xl font-bold leading-tight tracking-tight text-fg-primary">{p.symbol}</h1>
            )}
            <div className="mt-0.5 flex min-w-0 items-center gap-2">
              <p className="truncate text-[13px] text-fg-muted" data-testid="research-meta" title={p.tickerInfo?.industry || undefined}>
                {meta}
              </p>
              <EarningsBadge symbol={p.symbol} variant="mobile" />
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={p.onWatchlistToggle}
            disabled={p.watchlistBusy}
            aria-pressed={p.inWatchlist}
            aria-label={p.inWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
            title={p.inWatchlist ? 'In watchlist' : 'Add to watchlist'}
            className={iconBtn}
          >
            {p.watchlistBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Star className={cn('h-4 w-4', p.inWatchlist && 'fill-amber-400 text-amber-500')} />
            )}
          </button>
          <IntentLink href={compareHref([p.symbol])} className={iconBtn} aria-label={`Compare ${p.symbol}`} title="Compare">
            <GitCompareArrows className="h-4 w-4" />
          </IntentLink>
          {stockPath(p.symbol) && (
            <IntentLink
              href={stockPath(p.symbol) as string}
              className={iconBtn}
              aria-label={`Shareable ${p.symbol.toUpperCase()} stock page`}
              title="Shareable page"
              data-testid="shareable-stock-page"
            >
              <Link2 className="h-4 w-4" />
            </IntentLink>
          )}
          <button type="button" onClick={p.onSyncData} disabled={p.syncing} className={iconBtn} aria-label="Sync data" title="Sync data">
            {p.syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
          <IntentLink
            href={buildCopilotHref(p.symbol.toUpperCase())}
            data-testid="ask-copilot"
            aria-label={`Chat with Copilot about ${p.symbol.toUpperCase()}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-blue-600 px-4 text-[13px] font-semibold text-white transition hover:bg-blue-700"
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            Copilot
          </IntentLink>
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        {hasPrice ? (
          <div className="flex items-baseline gap-3 tabular-nums" data-testid="research-price">
            <span
              className={cn(
                'text-4xl font-semibold tracking-tight text-fg-primary',
                p.priceTick === 'up' && 'quote-price-flash-up',
                p.priceTick === 'down' && 'quote-price-flash-down',
              )}
            >
              ${fmtNum(p.priceInfo.price, 2)}
            </span>
            <span className={cn('text-lg font-medium', toneText(up ? 'up' : 'down'))} data-testid="research-change">
              {fmtChange(p.priceInfo.change, p.priceInfo.percent)}
            </span>
            {p.quoteLoading && <Loader2 className="h-4 w-4 animate-spin self-center text-fg-muted" aria-label="Updating quote" />}
          </div>
        ) : (
          <div className="flex items-baseline gap-3" aria-busy="true" aria-label="Loading quote">
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-6 w-32" />
          </div>
        )}
        <div className="flex items-center gap-3">
          {p.tickerInfo && p.tickerInfo.target_price > 0 && (
            <span className="text-[12px] tabular-nums text-fg-muted" title="Mean analyst price target">
              Analyst target ${fmtNum(p.tickerInfo.target_price, 2)}
            </span>
          )}
          {hasPrice && <ExtendedPill badge={p.priceInfo.extended} />}
        </div>
      </div>
    </header>
  )
}
