'use client'

/**
 * Hedge planner: protective put vs collar vs trimming, outcomes at expiry.
 * Educational calculator; no order of any kind is created.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  directionClass,
  fmtDate,
  fmtMoney,
  fmtPct,
  fmtPrice,
  fmtProb,
  normalizeSymbol,
  STRATEGY_COLORS,
  useHedge,
  type HedgeRequest,
  type HedgeResponse,
  type StrategyId,
} from '@/lib/outlook'
import {
  Bone,
  ChartSkeleton,
  Disclaimer,
  EmptyState,
  ErrorState,
  Field,
  inputCls,
  Panel,
  SpotNotice,
  TableSkeleton,
  useDebounced,
  type OutlookController,
} from './OutlookParts'

function PayoffChart({ d, compact = false }: { d: HedgeResponse; compact?: boolean }) {
  // viewBox close to the rendered width so 10px labels stay ~10-12px on screen
  const W = compact ? 400 : 1100
  const H = compact ? 220 : 300
  const L = 56
  const R = 12
  const T = 10
  const B = 26
  const ids = d.strategies.map((s) => s.id)
  const pts = d.curve
  if (pts.length < 2) return null
  const ys = pts.flatMap((p) => ids.map((id) => p[id]).filter((v): v is number => typeof v === 'number'))
  const y0 = Math.min(...ys, 0)
  const y1 = Math.max(...ys, 0)
  const x0 = pts[0].price
  const x1 = pts[pts.length - 1].price
  const sx = (x: number) => L + ((x - x0) / (x1 - x0)) * (W - L - R)
  const sy = (y: number) => T + (1 - (y - y0) / (y1 - y0 || 1)) * (H - T - B)
  const ticks = [y0, y0 / 2, 0, y1 / 2, y1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Profit and loss at expiry by strategy">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} className={t === 0 ? 'stroke-fg-muted' : 'stroke-line-subtle'} strokeWidth={t === 0 ? 1 : 0.75} />
          <text x={L - 6} y={sy(t) + 3} textAnchor="end" className="fill-fg-muted text-[10px] tabular-nums">{fmtMoney(t)}</text>
        </g>
      ))}
      <line x1={sx(d.spot)} x2={sx(d.spot)} y1={T} y2={H - B} className="stroke-fg-muted" strokeDasharray="3 3" />
      <text x={sx(d.spot)} y={H - 8} textAnchor="middle" className="fill-fg-muted text-[10px]">spot {fmtPrice(d.spot)}</text>
      <text x={L} y={H - 8} textAnchor="start" className="fill-fg-muted text-[10px]">{fmtPrice(x0, 0)}</text>
      <text x={W - R} y={H - 8} textAnchor="end" className="fill-fg-muted text-[10px]">{fmtPrice(x1, 0)}</text>
      {ids.map((id) => {
        const path = pts
          .filter((p) => typeof p[id] === 'number')
          .map((p, i) => `${i ? 'L' : 'M'}${sx(p.price).toFixed(1)},${sy(p[id] as number).toFixed(1)}`)
          .join(' ')
        return <path key={id} d={path} fill="none" stroke={STRATEGY_COLORS[id]} strokeWidth={id === 'unhedged' ? 1.5 : 2} strokeDasharray={id === 'unhedged' ? '5 4' : undefined} />
      })}
    </svg>
  )
}

export function HedgePanel({ c, compact = false }: { c: OutlookController; compact?: boolean }) {
  const [symbol, setSymbol] = useState(c.symbol)
  const [symbolDraft, setSymbolDraft] = useState(c.symbol)
  const [sharesText, setSharesText] = useState('100')
  const [expiration, setExpiration] = useState<string | null>(null)
  const [putStrike, setPutStrike] = useState<number | null>(null)
  const [callStrike, setCallStrike] = useState<number | null>(null)
  const [reducePct, setReducePct] = useState(50)
  const [fromHolding, setFromHolding] = useState<string>('')

  useEffect(() => {
    // Follow the page symbol unless the user picked one of their holdings here.
    if (!fromHolding) {
      setSymbol(c.symbol)
      setSymbolDraft(c.symbol)
    }
  }, [c.symbol, fromHolding])

  const changeSymbol = (s: string, shares?: number) => {
    setSymbol(s)
    setSymbolDraft(s)
    setExpiration(null)
    setPutStrike(null)
    setCallStrike(null)
    if (shares) setSharesText(String(shares))
  }

  const shares = useDebounced(Number(sharesText) > 0 ? Number(sharesText) : 0)
  const reduce = useDebounced(reducePct, 300)
  const body: HedgeRequest | null = useMemo(
    () => (symbol && shares > 0 ? { symbol, shares, expiration, put_strike: putStrike, call_strike: callStrike, reduce_pct: reduce } : null),
    [symbol, shares, expiration, putStrike, callStrike, reduce],
  )
  const q = useHedge(body)
  const d = q.data && q.data.symbol === symbol ? q.data : undefined
  const loading = q.isLoading || (q.isFetching && !d)
  const byId = (id: StrategyId) => d?.strategies.find((s) => s.id === id)

  return (
    <Panel
      compact={compact}
      title="Hedge planner"
      subtitle="Compare ways to protect a long stock position, measured at the option expiry. An educational calculator: nothing is bought or sold."
    >
      <div className={`grid gap-3 ${compact ? 'grid-cols-[repeat(2,minmax(0,1fr))]' : 'grid-cols-[repeat(6,minmax(0,1fr))]'}`}>
        {c.isAuthenticated && c.holdings.length > 0 && (
          <div className={compact ? 'col-span-2' : 'col-span-2'}>
            <Field label="From my portfolio">
              <select
                className={inputCls}
                value={fromHolding}
                onChange={(e) => {
                  const h = c.holdings.find((x) => x.symbol === e.target.value)
                  setFromHolding(e.target.value)
                  if (h) changeSymbol(h.symbol, h.quantity)
                }}
                aria-label="Holding"
              >
                <option value="">Choose a holding…</option>
                {c.holdings.map((h) => <option key={h.symbol} value={h.symbol}>{h.symbol} · {h.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })} sh</option>)}
              </select>
            </Field>
          </div>
        )}
        <Field label="Symbol">
          <input
            className={`${inputCls} font-semibold uppercase`}
            value={symbolDraft}
            onChange={(e) => setSymbolDraft(e.target.value.toUpperCase())}
            onBlur={() => { const s = normalizeSymbol(symbolDraft); if (s && s !== symbol) { setFromHolding(''); changeSymbol(s) } }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            aria-label="Hedge symbol"
            maxLength={10}
          />
        </Field>
        <Field label="Shares">
          <input inputMode="decimal" className={inputCls} value={sharesText} onChange={(e) => setSharesText(e.target.value.replace(/[^0-9.]/g, ''))} aria-label="Shares" />
        </Field>
        <Field label="Expiry">
          <select className={inputCls} value={d?.expiration ?? expiration ?? ''} onChange={(e) => { setExpiration(e.target.value || null); setPutStrike(null); setCallStrike(null) }} aria-label="Hedge expiry" disabled={!d}>
            {!d && <option value="">—</option>}
            {d?.expirations.map((e) => <option key={e} value={e}>{fmtDate(e, true)}</option>)}
          </select>
        </Field>
        <Field label="Put strike (floor)">
          <select className={inputCls} value={d?.put.strike ?? ''} onChange={(e) => setPutStrike(Number(e.target.value) || null)} aria-label="Put strike" disabled={!d}>
            {!d && <option value="">—</option>}
            {d?.put_strikes.map((k) => <option key={k} value={k}>{fmtPrice(k)} ({fmtPct((k / d.spot - 1) * 100, 1, true)})</option>)}
          </select>
        </Field>
        <Field label="Call strike (cap)">
          <select className={inputCls} value={d?.call?.strike ?? ''} onChange={(e) => setCallStrike(Number(e.target.value) || null)} aria-label="Call strike" disabled={!d}>
            {!d && <option value="">—</option>}
            {d && !d.call && <option value="">None priced</option>}
            {d?.call_strikes.filter((k) => k >= d.put.strike).map((k) => <option key={k} value={k}>{fmtPrice(k)} ({fmtPct((k / d.spot - 1) * 100, 1, true)})</option>)}
          </select>
        </Field>
        <div className={compact ? 'col-span-2' : 'col-span-2'}>
          <Field label={`Reduce position by ${reducePct}%`}>
            <input type="range" min={10} max={100} step={5} value={reducePct} onChange={(e) => setReducePct(Number(e.target.value))} className="w-full accent-indigo-600" aria-label="Reduce percent" />
          </Field>
        </div>
      </div>

      <div className="mt-4"><SpotNotice meta={d} spot={d?.spot} /></div>
      <div className={`grid gap-2 ${compact ? 'grid-cols-[repeat(2,minmax(0,1fr))]' : 'grid-cols-[repeat(4,minmax(0,1fr))]'}`}>
        {!body || (q.error && !d) ? null : loading || !d ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-line-subtle bg-surface-base px-3 py-2.5"><Bone className="h-2.5 w-20" /><Bone className="mt-2 h-5 w-24" /></div>
          ))
        ) : (
          <>
            <div className="rounded-xl border border-line-subtle bg-surface-base px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Position</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-fg-primary">{fmtMoney(d.position_value)}</p>
              <p className="text-[11px] tabular-nums text-fg-muted">{d.shares.toLocaleString('en-US', { maximumFractionDigits: 4 })} × {fmtPrice(d.spot)}</p>
            </div>
            <div className="rounded-xl border border-line-subtle bg-surface-base px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Put premium</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-fg-primary">{fmtPrice(d.put.premium)}</p>
              <p className="text-[11px] text-fg-muted">{fmtPrice(d.put.strike)} put · {d.put.basis === 'last' ? 'last trade' : 'mid'}</p>
            </div>
            <div className="rounded-xl border border-line-subtle bg-surface-base px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Call premium</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-fg-primary">{d.call ? fmtPrice(d.call.premium) : '—'}</p>
              <p className="text-[11px] text-fg-muted">{d.call ? `${fmtPrice(d.call.strike)} call · ${d.call.basis === 'last' ? 'last trade' : 'mid'}` : 'No priced call'}</p>
            </div>
            <div className="rounded-xl border border-line-subtle bg-surface-base px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Horizon</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-fg-primary">{d.days} days</p>
              <p className="text-[11px] text-fg-muted">to {fmtDate(d.expiration, true)}</p>
            </div>
          </>
        )}
      </div>

      <div className="mt-4">
        {loading ? (
          <TableSkeleton rows={4} cols={compact ? 3 : 6} />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !d ? (
          <EmptyState>Enter a symbol and a share count.</EmptyState>
        ) : compact ? (
          <ul className="space-y-2">
            {d.strategies.map((s) => (
              <li key={s.id} className="rounded-xl border border-line-subtle bg-surface-base p-3">
                <p className="flex items-center gap-2 text-sm font-semibold text-fg-primary"><span className="h-2 w-2 rounded-full" style={{ background: STRATEGY_COLORS[s.id] }} />{s.label}</p>
                <dl className="mt-2 grid grid-cols-[repeat(2,minmax(0,1fr))] gap-2 text-[11px]">
                  <div><dt className="text-fg-muted">Cost today</dt><dd className="tabular-nums text-fg-primary">{fmtMoney(s.upfront_cost)}</dd></div>
                  <div><dt className="text-fg-muted">Max loss</dt><dd className="tabular-nums text-fg-primary">{fmtMoney(s.max_loss)} ({fmtPct(s.max_loss_pct, 1)})</dd></div>
                  <div><dt className="text-fg-muted">Breakeven</dt><dd className="tabular-nums text-fg-primary">{fmtPrice(s.breakeven)}</dd></div>
                  <div><dt className="text-fg-muted">Max gain</dt><dd className="tabular-nums text-fg-primary">{s.max_gain == null ? 'Uncapped' : fmtMoney(s.max_gain)}</dd></div>
                </dl>
              </li>
            ))}
          </ul>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="whitespace-nowrap text-left text-[11px] uppercase tracking-wide text-fg-muted">
                  <th className="py-2 pr-3 font-medium">Strategy</th>
                  <th className="px-3 py-2 text-right font-medium">Cost today</th>
                  <th className="px-3 py-2 text-right font-medium">Max loss</th>
                  <th className="px-3 py-2 text-right font-medium">Max gain</th>
                  <th className="px-3 py-2 text-right font-medium">Breakeven</th>
                  <th className="px-3 py-2 text-right font-medium" title="Risk-neutral chance of finishing below breakeven">P(below breakeven)</th>
                  <th className="py-2 pl-3 font-medium">Trade-off</th>
                </tr>
              </thead>
              <tbody>
                {d.strategies.map((s) => (
                  <tr key={s.id} className="border-t border-line-subtle align-top">
                    <td className="whitespace-nowrap py-2.5 pr-3 font-semibold text-fg-primary">
                      <span className="mr-2 inline-block h-2 w-2 rounded-full align-middle" style={{ background: STRATEGY_COLORS[s.id] }} />{s.label}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${s.upfront_cost < 0 ? directionClass(1) : 'text-fg-primary'}`}>
                      {s.upfront_cost < 0 ? `${fmtMoney(-s.upfront_cost)} credit` : fmtMoney(s.upfront_cost)}
                      <span className="block text-[10px] text-fg-muted">{fmtPct(s.upfront_cost_pct, 2)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-fg-primary">{fmtMoney(s.max_loss)}<span className="block text-[10px] text-fg-muted">{fmtPct(s.max_loss_pct, 1)}</span></td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-fg-primary">{s.max_gain == null ? 'Uncapped' : fmtMoney(s.max_gain)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-fg-primary">{fmtPrice(s.breakeven)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-fg-secondary">{fmtProb(s.prob_below_breakeven)}</td>
                    <td className="max-w-[280px] py-2.5 pl-3 text-xs text-fg-muted">{s.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-4">
        {loading ? (
          <ChartSkeleton height={compact ? 150 : 220} />
        ) : d ? (
          <>
            <PayoffChart d={d} compact={compact} />
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-fg-secondary">
              {d.strategies.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4" style={{ background: STRATEGY_COLORS[s.id] }} />{s.label}</span>
              ))}
            </div>
            {byId('collar') && byId('protective_put') && (
              <p className="mt-2 text-xs text-fg-secondary">
                The collar costs {fmtMoney(Math.abs(byId('collar')!.upfront_cost))}{byId('collar')!.upfront_cost < 0 ? ' less than nothing (a net credit)' : ''} versus{' '}
                {fmtMoney(byId('protective_put')!.upfront_cost)} for the put alone, in exchange for giving up gains above {fmtPrice(d.call?.strike)}.
              </p>
            )}
          </>
        ) : null}
      </div>
      <div className="mt-4 space-y-2">
        {d && <p className="text-[11px] leading-relaxed text-fg-muted">{d.assumptions} Option quotes: {d.source || '—'}.</p>}
        <Disclaimer compact={compact} />
      </div>
    </Panel>
  )
}
