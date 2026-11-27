'use client'

/**
 * Mobile bottom-sheet stock detail (Apple Stocks style): grab handle, close,
 * share; big ticker + name; large regular-session price with change; range pills;
 * gradient line chart with a right axis; compact 3-column stat grid. Actions:
 * Research, price alert, add holding. Values are real or "—".
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { BellRing, Briefcase, Share2, X } from 'lucide-react'
import { fetchFundamentals } from '@/lib/api'
import { niceTicks, linePath, scaleLinear, valueDomain } from '@/lib/lineChart'
import { RANGES, dirClass, fmtLtp, fmtSigned, pctFrom, type HoldingRow, type RangeKey, type WatchQuote } from '@/lib/marketwatch'
import { fmtMoney, fmtPct, fmtQty } from '@/lib/portfolio'
import { extendedBadge } from '@/lib/canonicalQuote'
import { usePersistentState, oneOf } from '@/lib/persistentState'
import { Skeleton } from '@/components/Skeleton'
import { useBars } from './useBars'
import { researchHref } from './MarketwatchParts'

const W = 340
const H = 180
const AXIS = 40

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 })
const fmtCompact = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : compact.format(v))

function SheetChart({ symbol, range }: { symbol: string; range: RangeKey }) {
  const q = useBars(symbol, range)
  const closes = useMemo(() => (q.data ?? []).map((b) => b.close), [q.data])
  if (q.isLoading) return <Skeleton className="h-[180px] w-full" />
  if (closes.length < 2) return <div className="flex h-[180px] items-center justify-center text-xs text-fg-muted">No price history for this range</div>
  const [lo, hi] = valueDomain([{ values: closes }])
  const x = scaleLinear(0, closes.length - 1, 0, W - AXIS)
  const y = scaleLinear(lo, hi, H - 6, 6)
  const up = closes[closes.length - 1] >= closes[0]
  const color = up ? '#22c55e' : '#ef4444'
  const line = linePath(closes, x, y)
  const area = `${line} L${x(closes.length - 1)},${H} L${x(0)},${H} Z`
  const ticks = niceTicks(lo, hi, 4).filter((t) => t >= lo && t <= hi)
  const gid = `mw-grad-${symbol}-${range}`
  const chg = pctFrom(closes[0], closes[closes.length - 1])
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[180px] w-full" role="img" aria-label={`${symbol} daily closes over ${range}: ${fmtSigned(chg)}%`}>
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={0} x2={W - AXIS} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-line-subtle" strokeDasharray="2 4" />
            <text x={W - AXIS + 6} y={y(t) + 3} className="fill-fg-muted" fontSize={10} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {fmtLtp(t)}
            </text>
          </g>
        ))}
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" />
      </svg>
      <figcaption className={`mt-1 text-right text-[11px] tabular-nums ${dirClass(chg)}`}>{fmtSigned(chg)}% over {range} (daily closes)</figcaption>
    </figure>
  )
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <span className="text-[11px] text-fg-muted">{k}</span>
      <span className="truncate text-xs tabular-nums text-fg-primary">{v}</span>
    </div>
  )
}

export default function MobileStockSheet({
  symbol, name, quote, positions, open, onClose, onAlert, onHolding,
}: {
  symbol: string | null
  name?: string | null
  quote?: WatchQuote
  positions: HoldingRow[]
  open: boolean
  onClose: () => void
  onAlert: (s: string) => void
  onHolding: (s: string) => void
}) {
  const [range, setRange] = usePersistentState<RangeKey>('marketwatch.mobile.range', '3M', { validate: oneOf(RANGES) })
  const [shared, setShared] = useState(false)
  const fund = useQuery({
    queryKey: ['marketwatch', 'fundamentals', symbol],
    queryFn: () => fetchFundamentals(symbol as string),
    enabled: open && !!symbol,
    staleTime: 30 * 60_000,
  })

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open || !symbol) return null
  const f = fund.data
  const ext = extendedBadge(quote?.extended ? { ...quote.extended, change: null, time: null } : null)
  const dash = fund.isLoading ? '…' : '—'

  const share = async () => {
    const url = `${window.location.origin}${researchHref(symbol)}`
    try {
      if (navigator.share) await navigator.share({ title: symbol, url })
      else {
        await navigator.clipboard.writeText(url)
        setShared(true)
        setTimeout(() => setShared(false), 1500)
      }
    } catch {
      /* user cancelled */
    }
  }

  return (
    <div className="fixed inset-0 z-[55] flex items-end bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={`${symbol} details`} className="max-h-[92vh] w-full overflow-y-auto rounded-t-[28px] bg-surface-base px-4 pb-8 pt-2">
        <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-surface-active" aria-hidden />
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold tracking-tight text-fg-primary">{symbol}</h2>
            <p className="truncate text-sm text-fg-muted">{name ?? f?.company_name ?? ' '}</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={share} aria-label={shared ? 'Link copied' : 'Share'} className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-raised text-fg-secondary">
              <Share2 className="h-4 w-4" />
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-raised text-fg-secondary">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-3 min-h-[3.5rem]">
          {!quote ? (
            <div className="space-y-2"><Skeleton className="h-8 w-36" /><Skeleton className="h-4 w-24" /></div>
          ) : quote.unavailable ? (
            <p className="text-sm text-fg-muted">No live quote right now.</p>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-[32px] font-semibold leading-none tabular-nums text-fg-primary">{fmtLtp(quote.price)}</span>
                <span className={`text-base font-medium tabular-nums ${dirClass(quote.change)}`}>
                  {fmtSigned(quote.change)} ({fmtSigned(quote.change_percent)}%)
                </span>
              </div>
              <p className="mt-1 text-[11px] text-fg-muted">
                Regular session{quote.stale ? ' · delayed' : ''}
                {ext && (
                  <span className="ml-2 tabular-nums">
                    · {ext.label} {ext.price.toFixed(2)}{' '}
                    {ext.changePercent != null && <span className={dirClass(ext.changePercent)}>{fmtSigned(ext.changePercent)}%</span>}
                  </span>
                )}
              </p>
            </>
          )}
        </div>

        <div role="tablist" aria-label="Chart range" className="mt-4 flex justify-between">
          {RANGES.map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={range === r}
              onClick={() => setRange(r)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${range === r ? 'bg-fg-primary text-surface-base' : 'text-fg-muted'}`}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="mt-3">
          <SheetChart symbol={symbol} range={range} />
        </div>

        <div className="mt-4 grid grid-cols-3 gap-x-4 border-t border-line-subtle pt-3">
          <div>
            <Cell k="Open" v={fmtLtp(quote?.open)} />
            <Cell k="High" v={fmtLtp(quote?.high)} />
            <Cell k="Low" v={fmtLtp(quote?.low)} />
          </div>
          <div>
            <Cell k="Vol" v={fmtCompact(quote?.volume)} />
            <Cell k="P/E" v={f?.pe_ratio != null ? f.pe_ratio.toFixed(2) : dash} />
            <Cell k="Mkt Cap" v={f?.market_cap != null ? fmtCompact(f.market_cap) : dash} />
          </div>
          <div>
            <Cell k="52W H" v={f?.week_52_high != null ? fmtLtp(f.week_52_high) : dash} />
            <Cell k="52W L" v={f?.week_52_low != null ? fmtLtp(f.week_52_low) : dash} />
            <Cell k="Prev" v={fmtLtp(quote?.previous_close)} />
          </div>
        </div>

        {positions.length > 0 && (
          <div className="mt-4 border-t border-line-subtle pt-3">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">Your position</p>
            {positions.map((p) => (
              <div key={p.portfolio_id} className="flex justify-between py-1 text-xs tabular-nums">
                <span className="text-fg-secondary">
                  {fmtQty(p.quantity)} @ {fmtLtp(p.avg_cost)} · {p.portfolio_name}{p.simulated ? ' (paper)' : ''}
                </span>
                <span className={dirClass(p.unrealized_pnl)}>
                  {fmtMoney(p.unrealized_pnl, { signed: true })} {fmtPct(p.unrealized_pnl_percent)}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 grid grid-cols-3 gap-2">
          <Link href={researchHref(symbol)} className="flex h-11 items-center justify-center rounded-xl bg-surface-raised text-sm font-semibold text-fg-primary">Research</Link>
          <button type="button" onClick={() => onAlert(symbol)} className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-surface-raised text-sm font-semibold text-fg-primary">
            <BellRing className="h-4 w-4" /> Alert
          </button>
          <button type="button" onClick={() => onHolding(symbol)} className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-surface-raised text-sm font-semibold text-fg-primary">
            <Briefcase className="h-4 w-4" /> Holding
          </button>
        </div>
      </div>
    </div>
  )
}
