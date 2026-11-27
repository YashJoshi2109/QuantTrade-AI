'use client'

/**
 * Desktop detail pane for the selected Marketwatch symbol: canonical quote,
 * day range, a 3-month close chart from stored daily bars, the user's position
 * (server-computed P&L, same as the Portfolio page) and active price alerts.
 * Every figure is real or shown as "—"; nothing is estimated here.
 */
import { useMemo } from 'react'
import Link from 'next/link'
import { ArrowUpRight, BellRing, Briefcase, GitCompareArrows, MousePointerClick } from 'lucide-react'
import { useBars } from './useBars'
import { describeAlert, useAlerts } from '@/lib/alerts'
import { extendedBadge } from '@/lib/canonicalQuote'
import { compareHref } from '@/lib/compare'
import { linePath, scaleLinear, valueDomain } from '@/lib/lineChart'
import { dirClass, fmtLtp, fmtSigned, pctFrom, rangePosition, type HoldingRow, type WatchQuote } from '@/lib/marketwatch'
import { fmtMoney, fmtPct, fmtQty } from '@/lib/portfolio'
import { Skeleton } from '@/components/Skeleton'
import TickerLogo from '@/components/TickerLogo'
import { researchHref } from './MarketwatchParts'

const W = 320
const H = 96

function MiniChart({ symbol }: { symbol: string }) {
  const q = useBars(symbol, '3M')
  const closes = useMemo(() => (q.data ?? []).map((b) => b.close as number | null), [q.data])
  if (q.isLoading) return <Skeleton className="h-24 w-full" />
  const valid = closes.filter((v): v is number => v != null)
  if (valid.length < 2) return <div className="flex h-24 items-center justify-center text-xs text-fg-muted">No price history stored yet</div>
  const [lo, hi] = valueDomain([{ values: closes }])
  const x = scaleLinear(0, closes.length - 1, 2, W - 2)
  const y = scaleLinear(lo, hi, H - 4, 4)
  const first = valid[0]
  const last = valid[valid.length - 1]
  const up = last >= first
  const stroke = up ? '#10b981' : '#ef4444'
  const bars = q.data ?? []
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" preserveAspectRatio="none" role="img" aria-label={`${symbol} daily closes, last ${bars.length} sessions`}>
        <path d={linePath(closes, x, y)} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="mt-1 flex justify-between text-[10px] tabular-nums text-fg-muted">
        <span>{bars[0] ? new Date(bars[0].timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
        <span className={dirClass(last - first)}>{fmtSigned(pctFrom(first, last))}% over {bars.length} sessions</span>
        <span>{bars.length ? new Date(bars[bars.length - 1].timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
      </figcaption>
    </figure>
  )
}

export default function InstrumentPanel({
  symbol, name, quote, quoteLoading, positions, onAlert, onHolding, compareWith,
}: {
  symbol: string | null
  name?: string | null
  quote?: WatchQuote
  quoteLoading: boolean
  positions: HoldingRow[]
  onAlert: (s: string) => void
  onHolding: (s: string) => void
  compareWith: string[]
}) {
  const alerts = useAlerts(!!symbol)
  const mine = useMemo(() => (alerts.data?.alerts ?? []).filter((a) => a.symbol === symbol && a.status !== 'triggered'), [alerts.data, symbol])

  if (!symbol) {
    return (
      <div className="flex h-full min-h-[24rem] flex-col items-center justify-center p-8 text-center">
        <MousePointerClick className="mb-3 h-6 w-6 text-fg-muted" aria-hidden />
        <p className="text-sm font-medium text-fg-primary">Select a symbol</p>
        <p className="mt-1 max-w-[16rem] text-xs text-fg-muted">Click a row or use ↑ ↓. Press / to search and add.</p>
      </div>
    )
  }

  const ext = extendedBadge(quote?.extended ? { ...quote.extended, change: null, time: null } : null)
  const pos = rangePosition(quote?.price ?? null, quote?.low ?? null, quote?.high ?? null)
  const others = compareWith.filter((s) => s !== symbol).slice(0, 3)

  return (
    <div className="space-y-4 p-4">
      <header className="flex items-start gap-3">
        <TickerLogo symbol={symbol} size={36} companyName={name ?? undefined} />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-fg-primary">{symbol}</h2>
          <p className="truncate text-xs text-fg-muted">{name ?? ' '}</p>
        </div>
        <Link href={researchHref(symbol)} className="inline-flex items-center gap-1 rounded-md border border-line-default px-2 py-1 text-xs font-semibold text-fg-secondary hover:bg-surface-hover">
          Research <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </header>

      <section aria-label="Quote">
        {quoteLoading && !quote ? (
          <div className="space-y-2"><Skeleton className="h-7 w-32" /><Skeleton className="h-3.5 w-24" /></div>
        ) : !quote || quote.unavailable ? (
          <p className="text-sm text-fg-muted">No live quote right now.</p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="tabular-nums text-2xl font-semibold text-fg-primary">{fmtLtp(quote.price)}</span>
              <span className={`tabular-nums text-sm font-medium ${dirClass(quote.change)}`}>
                {fmtSigned(quote.change)} ({fmtSigned(quote.change_percent)}%)
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-fg-muted">
              Regular session{quote.as_of ? ` · as of ${new Date(quote.as_of).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
              {quote.stale ? ' · delayed' : ''}
            </p>
            {ext && (
              <p className="mt-1 text-xs tabular-nums text-fg-secondary">
                {ext.label} <span className="font-medium text-fg-primary">{ext.price.toFixed(2)}</span>{' '}
                {ext.changePercent != null && <span className={dirClass(ext.changePercent)}>{fmtSigned(ext.changePercent)}%</span>}
              </p>
            )}
          </>
        )}
      </section>

      <section aria-label="Day range" className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div className="col-span-2">
          <div className="mb-1 flex justify-between tabular-nums text-fg-muted">
            <span>L {fmtLtp(quote?.low)}</span>
            <span className="text-[10px] uppercase tracking-wide">Day range</span>
            <span>H {fmtLtp(quote?.high)}</span>
          </div>
          <div className="relative h-1.5 rounded-full bg-surface-active">
            {pos != null && <span className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded bg-fg-primary" style={{ left: `calc(${(pos * 100).toFixed(1)}% - 1px)` }} />}
          </div>
        </div>
        <Kv k="Open" v={fmtLtp(quote?.open)} />
        <Kv k="Prev. close" v={fmtLtp(quote?.previous_close)} />
        <Kv k="Volume" v={quote?.volume != null ? quote.volume.toLocaleString('en-US') : '—'} />
        <Kv k="Source" v={quote?.source ?? '—'} />
      </section>

      <section aria-label="Price history" className="rounded-lg border border-line-subtle p-3">
        <MiniChart symbol={symbol} />
      </section>

      <section aria-label="Your position">
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">Your position</h3>
          <button type="button" onClick={() => onHolding(symbol)} className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            <Briefcase className="h-3.5 w-3.5" /> Add holding
          </button>
        </div>
        {positions.length === 0 ? (
          <p className="text-xs text-fg-muted">Not held in any portfolio.</p>
        ) : (
          <ul className="space-y-1.5">
            {positions.map((p) => (
              <li key={`${p.portfolio_id}`} className="rounded-md bg-surface-raised px-2.5 py-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-fg-secondary">{p.portfolio_name}{p.simulated && <span className="ml-1 text-amber-600 dark:text-amber-400">(paper)</span>}</span>
                  <span className={`tabular-nums font-semibold ${dirClass(p.unrealized_pnl)}`}>{fmtMoney(p.unrealized_pnl, { signed: true })}</span>
                </div>
                <div className="mt-0.5 flex justify-between tabular-nums text-fg-muted">
                  <span>{fmtQty(p.quantity)} @ {fmtLtp(p.avg_cost)}</span>
                  <span>{fmtMoney(p.market_value)} · {fmtPct(p.unrealized_pnl_percent)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Price alerts">
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">Alerts</h3>
          <button type="button" onClick={() => onAlert(symbol)} className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            <BellRing className="h-3.5 w-3.5" /> New alert
          </button>
        </div>
        {alerts.isLoading ? (
          <Skeleton className="h-8 w-full" />
        ) : mine.length === 0 ? (
          <p className="text-xs text-fg-muted">No active alerts.</p>
        ) : (
          <ul className="space-y-1">
            {mine.map((a) => (
              <li key={a.id} className="flex justify-between rounded-md bg-surface-raised px-2.5 py-1.5 text-xs tabular-nums text-fg-secondary">
                <span>{describeAlert(a)}</span>
                {a.status === 'paused' && <span className="text-fg-muted">paused</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {others.length > 0 && (
        <Link href={compareHref([symbol, ...others])} className="flex items-center justify-center gap-1.5 rounded-lg border border-line-subtle py-2 text-xs font-medium text-fg-secondary hover:bg-surface-hover">
          <GitCompareArrows className="h-3.5 w-3.5" /> Compare with {others.join(', ')}
        </Link>
      )}
    </div>
  )
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-fg-muted">{k}</span>
      <span className="truncate tabular-nums text-fg-primary">{v}</span>
    </div>
  )
}
