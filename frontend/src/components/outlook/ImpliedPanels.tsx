'use client'

/**
 * Per-symbol panels: implied move by expiry, probability calculator, earnings
 * implied vs realized, and market-implied vs model ("perception vs model").
 * Shared by desktop and mobile; ``compact`` switches tables to stacked cards.
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

import {
  axisFor,
  defaultTarget,
  directionClass,
  fmtDate,
  fmtIv,
  fmtPct,
  fmtPrice,
  fmtProb,
  fmtRange,
  pctIn,
  pricingVerdict,
  rangePct,
  TIMING_TEXT,
  useEarningsOutlook,
  useImplied,
  usePerception,
  useProbability,
  type ExpiryOutlook,
  type ImpliedResponse,
  type Range,
} from '@/lib/outlook'
import {
  ChartSkeleton,
  EmptyState,
  ErrorState,
  Field,
  inputCls,
  Panel,
  QualityBadge,
  Stat,
  StatSkeleton,
  TableSkeleton,
  useDebounced,
  Bone,
  SpotNotice,
} from './OutlookParts'

const METHOD_TEXT: Record<ExpiryOutlook['smile_method'], string> = {
  smile: 'Smile (Breeden-Litzenberger)',
  atm_last: 'Flat vol, last trades',
  straddle_flat: 'Flat vol, straddle',
}

/** Headline: the expiry closest to ~30 calendar days (the usual "one month" read). */
export function headlineExpiry(rows: ExpiryOutlook[]): ExpiryOutlook | null {
  if (!rows.length) return null
  return rows.reduce((best, r) => (Math.abs(r.days - 30) < Math.abs(best.days - 30) ? r : best), rows[0])
}

function RangeBar({ r, axis, spot, tone = 'indigo', thin = false }: { r: Range | null | undefined; axis: [number, number]; spot?: number | null; tone?: 'indigo' | 'amber'; thin?: boolean }) {
  if (!r || r[0] == null || r[1] == null) return <div className={`${thin ? 'h-1.5' : 'h-2'} rounded-full bg-slate-400/20 dark:bg-white/10`} />
  const a = pctIn(r[0], axis[0], axis[1])
  const b = pctIn(r[1], axis[0], axis[1])
  const bar = tone === 'indigo' ? 'bg-indigo-500/70 dark:bg-indigo-400/70' : 'bg-amber-500/70 dark:bg-amber-400/70'
  return (
    <div className={`relative ${thin ? 'h-1.5' : 'h-2'} rounded-full bg-slate-400/20 dark:bg-white/10`}>
      <div className={`absolute inset-y-0 rounded-full ${bar}`} style={{ left: `${a}%`, width: `${Math.max(b - a, 0.8)}%` }} />
      {spot != null && <div className="absolute -inset-y-1 w-px bg-fg-primary opacity-70" style={{ left: `${pctIn(spot, axis[0], axis[1])}%` }} />}
    </div>
  )
}

// ── implied move by expiry ──────────────────────────────────────────────────

export function ImpliedPanel({ symbol, compact = false }: { symbol: string; compact?: boolean }) {
  const q = useImplied(symbol)
  const d = q.data
  const head = d ? headlineExpiry(d.expiries) : null
  const axis = useMemo(() => (d ? axisFor(d.expiries.map((e) => e.range_68), [d.spot]) : null), [d])

  return (
    <Panel
      compact={compact}
      title={`Implied move · ${symbol}`}
      label="Implied move by expiry"
      subtitle="Expected move to each expiry from the at-the-money straddle, and the 68% range from the option smile."
      right={d && <span className="text-[11px] text-fg-muted">Source: {d.source || '—'}</span>}
    >
      <SpotNotice meta={d} spot={d?.spot} />
      <div className={`mb-4 grid gap-2 ${compact ? 'grid-cols-[repeat(2,minmax(0,1fr))]' : 'grid-cols-[repeat(4,minmax(0,1fr))]'}`}>
        {q.error && !d ? null : q.isLoading || !d ? (
          Array.from({ length: 4 }).map((_, i) => <StatSkeleton key={i} />)
        ) : (
          <>
            <Stat label="Spot" value={fmtPrice(d.spot)} sub={`r = ${(d.risk_free_rate * 100).toFixed(2)}%`} />
            <Stat
              label={`Implied move · ${head ? fmtDate(head.expiration) : '—'}`}
              value={head?.straddle ? `±${fmtPct(head.straddle.move_pct)}` : '—'}
              sub={head?.straddle ? `±${fmtPrice(head.straddle.move)} · ${head.days}d` : undefined}
            />
            <Stat label="ATM implied vol" value={fmtIv(head?.atm_iv)} sub={head ? `1σ ±${fmtPct(head.one_sigma_pct)}` : undefined} />
            <Stat label="68% range" value={<span className="text-sm">{fmtRange(head?.range_68)}</span>} sub={head ? `P(above spot) ${fmtProb(head.prob_above_spot)}` : undefined} />
          </>
        )}
      </div>

      {q.isLoading ? (
        <TableSkeleton rows={6} cols={compact ? 3 : 7} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d || !d.expiries.length ? (
        <EmptyState>No priced expiries for {symbol}.</EmptyState>
      ) : compact ? (
        <ul className="space-y-2">
          {d.expiries.map((e) => (
            <li key={e.expiration} className="rounded-xl border border-line-subtle bg-surface-base p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-fg-primary">
                  {fmtDate(e.expiration)} <span className="text-xs font-normal text-fg-muted">{e.days}d</span>
                </span>
                <span className="text-sm font-semibold tabular-nums text-fg-primary">{e.straddle ? `±${fmtPct(e.straddle.move_pct)}` : '—'}</span>
              </div>
              {axis && <div className="mt-2"><RangeBar r={e.range_68} axis={axis} spot={d.spot} /></div>}
              <div className="mt-2 flex items-center justify-between gap-2 text-[11px] tabular-nums text-fg-muted">
                <span>{fmtRange(e.range_68)}</span>
                <span>IV {fmtIv(e.atm_iv)}</span>
                <QualityBadge q={e.quality} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="whitespace-nowrap text-left text-[11px] uppercase tracking-wide text-fg-muted">
                <th className="py-2 pr-3 font-medium">Expiry</th>
                <th className="px-3 py-2 text-right font-medium">Implied move</th>
                <th className="px-3 py-2 text-right font-medium">Straddle</th>
                <th className="px-3 py-2 text-right font-medium">ATM IV</th>
                <th className="px-3 py-2 font-medium">68% range</th>
                <th className="w-[22%] px-3 py-2 font-medium"><span className="sr-only">Range chart</span></th>
                <th className="px-3 py-2 text-right font-medium">P(above spot)</th>
                <th className="py-2 pl-3 font-medium">Quotes</th>
              </tr>
            </thead>
            <tbody>
              {d.expiries.map((e) => (
                <tr key={e.expiration} className="border-t border-line-subtle">
                  <td className="whitespace-nowrap py-2.5 pr-3">
                    <span className="font-semibold text-fg-primary">{fmtDate(e.expiration, true)}</span>
                    <span className="ml-1.5 text-xs text-fg-muted">{e.days}d</span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-fg-primary">
                    {e.straddle ? `±${fmtPct(e.straddle.move_pct)}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-fg-secondary" title={e.straddle ? `${fmtPrice(e.straddle.strike)} strike` : undefined}>
                    {e.straddle ? `±${fmtPrice(e.straddle.move)}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-fg-secondary">{fmtIv(e.atm_iv)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-fg-secondary">{fmtRange(e.range_68)}</td>
                  <td className="px-3 py-2.5">{axis && <RangeBar r={e.range_68} axis={axis} spot={d.spot} />}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-fg-secondary">{fmtProb(e.prob_above_spot)}</td>
                  <td className="py-2.5 pl-3" title={METHOD_TEXT[e.smile_method]}><QualityBadge q={e.quality} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-fg-muted">
        Implied move = at-the-money straddle × e<sup>rT</sup>, the option market’s expected absolute move to expiry. Ranges
        and P(above) come from the risk-neutral distribution (Breeden-Litzenberger on the implied-vol smile; strikes with
        wide or one-sided quotes are ignored). Vertical tick = spot.
      </p>
    </Panel>
  )
}

// ── probability calculator ──────────────────────────────────────────────────

function DensityChart({ curve, target, spot, compact = false }: { curve: NonNullable<ExpiryOutlook['curve']>; target: number; spot: number; compact?: boolean }) {
  const W = compact ? 400 : 640
  const H = compact ? 140 : 170
  const pad = 4
  if (curve.length < 3) return null
  const x0 = curve[0].price
  const x1 = curve[curve.length - 1].price
  const ymax = Math.max(...curve.map((p) => p.density)) || 1
  const sx = (x: number) => pad + ((x - x0) / (x1 - x0)) * (W - 2 * pad)
  const sy = (y: number) => H - 18 - (y / ymax) * (H - 30)
  const line = curve.map((p, i) => `${i ? 'L' : 'M'}${sx(p.price).toFixed(1)},${sy(p.density).toFixed(1)}`).join(' ')
  const above = curve.filter((p) => p.price >= target)
  const area = above.length > 1
    ? `M${sx(Math.max(target, x0)).toFixed(1)},${sy(0)} ` +
      above.map((p) => `L${sx(p.price).toFixed(1)},${sy(p.density).toFixed(1)}`).join(' ') +
      ` L${sx(above[above.length - 1].price).toFixed(1)},${sy(0)} Z`
    : ''
  const tx = Math.min(Math.max(target, x0), x1)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Risk-neutral price distribution at expiry">
      <line x1={pad} x2={W - pad} y1={sy(0)} y2={sy(0)} className="stroke-line-default" strokeWidth={1} />
      {area && <path d={area} className="fill-indigo-500/20" />}
      <path d={line} fill="none" className="stroke-indigo-500" strokeWidth={1.75} />
      <line x1={sx(spot)} x2={sx(spot)} y1={8} y2={sy(0)} className="stroke-fg-muted" strokeDasharray="3 3" />
      <line x1={sx(tx)} x2={sx(tx)} y1={8} y2={sy(0)} className="stroke-amber-500" strokeWidth={1.5} />
      <text x={sx(x0)} y={H - 4} className="fill-fg-muted text-[11px]" textAnchor="start">{fmtPrice(x0, 0)}</text>
      <text x={sx(x1)} y={H - 4} className="fill-fg-muted text-[11px]" textAnchor="end">{fmtPrice(x1, 0)}</text>
      <text x={sx(spot)} y={H - 4} className="fill-fg-muted text-[11px]" textAnchor="middle">spot</text>
    </svg>
  )
}

export function ProbabilityPanel({ symbol, compact = false }: { symbol: string; compact?: boolean }) {
  const implied = useImplied(symbol)
  const d: ImpliedResponse | undefined = implied.data
  const [targetText, setTargetText] = useState('')
  const [expiration, setExpiration] = useState<string | null>(null)

  useEffect(() => {
    setTargetText('')
    setExpiration(null)
  }, [symbol])
  useEffect(() => {
    if (!d) return
    if (!targetText) {
      const t = defaultTarget(d.spot)
      if (t) setTargetText(String(t))
    }
    if (!expiration) setExpiration(headlineExpiry(d.expiries)?.expiration ?? null)
  }, [d, targetText, expiration])

  const target = useDebounced(Number(targetText) > 0 ? Number(targetText) : null)
  const p = useProbability(symbol, target, expiration)
  const future = useMemo(() => (d ? d.expirations.filter((e) => e > (d.generated_at || '').slice(0, 10)) : []), [d])
  const res = p.data
  const loading = implied.isLoading || (p.isLoading && !!target && !!expiration)

  return (
    <Panel
      compact={compact}
      title="Probability by a date"
      subtitle="Risk-neutral chance of finishing above or below your price at an expiry, read off the option chain."
    >
      <div className={`grid gap-3 ${compact ? 'grid-cols-[repeat(2,minmax(0,1fr))]' : 'grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]'}`}>
        <Field label="Price">
          <input
            inputMode="decimal"
            className={inputCls}
            value={targetText}
            onChange={(e) => setTargetText(e.target.value.replace(/[^0-9.]/g, ''))}
            aria-label="Target price"
          />
        </Field>
        <Field label="By expiry">
          <select className={inputCls} value={expiration ?? ''} onChange={(e) => setExpiration(e.target.value || null)} aria-label="Expiry" disabled={!future.length}>
            {!future.length && <option value="">—</option>}
            {future.map((e) => <option key={e} value={e}>{fmtDate(e, true)}</option>)}
          </select>
        </Field>
      </div>

      <div className="mt-4 grid grid-cols-[repeat(2,minmax(0,1fr))] gap-2">
        {(p.error || implied.error || !target) && !res ? null : loading || !res ? (
          <>
            <StatSkeleton big />
            <StatSkeleton big />
          </>
        ) : (
          <>
            <Stat big label={`Above ${fmtPrice(res.probability.target)}`} value={fmtProb(res.probability.prob_above)} sub={`IV at price ${fmtIv(res.probability.iv_at_target)}`} />
            <Stat big label={`Below ${fmtPrice(res.probability.target)}`} value={fmtProb(res.probability.prob_below)} sub={`by ${fmtDate(res.expiration, true)}`} />
          </>
        )}
      </div>

      <div className="mt-4">
        {p.error ? (
          <ErrorState error={p.error} />
        ) : implied.error ? (
          <ErrorState error={implied.error} />
        ) : loading || !res?.expiry.curve ? (
          <ChartSkeleton height={compact ? 110 : 150} />
        ) : (
          <>
            <DensityChart curve={res.expiry.curve} target={res.probability.target} spot={res.expiry.spot} compact={compact} />
            <p className="mt-2 text-[11px] leading-relaxed text-fg-muted">
              Shaded = outcomes above your price. {res.method}.
              {res.expiration !== res.requested_date && ` Nearest listed expiry on or after your date: ${fmtDate(res.expiration, true)}.`}
              {' '}A flat-vol lognormal would say {fmtProb(res.probability.flat_iv_prob_above)} above; the gap is the skew.
            </p>
          </>
        )}
      </div>
    </Panel>
  )
}

// ── earnings: implied vs realized ───────────────────────────────────────────

export function EarningsPanel({ symbol, compact = false }: { symbol: string; compact?: boolean }) {
  const q = useEarningsOutlook(symbol)
  const d = q.data
  const imp = d?.implied
  const ref = imp?.event_move_pct ?? imp?.straddle_move_pct ?? null
  const maxAbs = Math.max(ref ?? 0, ...(d?.history ?? []).map((m) => Math.abs(m.move_pct)), 1)
  const verdict = pricingVerdict(d?.implied_vs_realized)

  return (
    <Panel compact={compact} title="Earnings: priced vs past moves" subtitle="The move options price for the next report, against how far this stock actually moved after past reports.">
      <div className={`grid gap-2 ${compact ? 'grid-cols-[repeat(2,minmax(0,1fr))]' : 'grid-cols-[repeat(4,minmax(0,1fr))]'}`}>
        {q.error && !d ? null : q.isLoading || !d ? (
          Array.from({ length: 4 }).map((_, i) => <StatSkeleton key={i} />)
        ) : (
          <>
            <Stat
              label="Next report"
              value={<span className="text-base">{d.next_earnings ? fmtDate(d.next_earnings.date, true) : '—'}</span>}
              sub={d.next_earnings ? [d.next_earnings.hour?.toUpperCase(), d.next_earnings.fiscal_period].filter(Boolean).join(' · ') || undefined : 'None scheduled in 60 days'}
            />
            <Stat label="Implied event move" value={imp?.event_move_pct != null ? `±${fmtPct(imp.event_move_pct)}` : '—'} sub={imp ? `straddle to ${fmtDate(imp.expiration)} ±${fmtPct(imp.straddle_move_pct)}` : undefined} />
            <Stat label="Avg past move" value={d.summary.avg_abs_move_pct != null ? `±${fmtPct(d.summary.avg_abs_move_pct)}` : '—'} sub={d.summary.count ? `median ±${fmtPct(d.summary.median_abs_move_pct)} · ${d.summary.count} reports` : undefined} />
            <Stat label="Implied / realized" value={d.implied_vs_realized != null ? `${d.implied_vs_realized.toFixed(2)}×` : '—'} sub={d.summary.count ? `${d.summary.up_count}/${d.summary.count} reports up` : undefined} />
          </>
        )}
      </div>

      <div className="mt-4">
        {q.isLoading ? (
          <ChartSkeleton height={compact ? 100 : 130} />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !d || !d.history.length ? (
          <EmptyState>No past earnings reactions on record for {symbol}{d && !d.next_earnings ? ' (ETFs and funds do not report earnings)' : ''}.</EmptyState>
        ) : (
          <>
            <div className="relative flex items-center gap-1" style={{ height: compact ? 100 : 130 }} role="img" aria-label="Past one-day earnings moves, oldest to newest">
              {ref != null && (
                <>
                  <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-amber-500/70" style={{ top: `${50 - (ref / maxAbs) * 50}%` }} />
                  <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-amber-500/70" style={{ top: `${50 + (ref / maxAbs) * 50}%` }} />
                </>
              )}
              <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-line-default" />
              {[...d.history].reverse().map((m) => {
                const h = (Math.abs(m.move_pct) / maxAbs) * 50
                const up = m.move_pct >= 0
                return (
                  <div key={m.date} className="relative h-full flex-1" title={`${fmtDate(m.date, true)} · ${TIMING_TEXT[m.timing]} · ${fmtPct(m.move_pct, 2, true)}`}>
                    <div
                      className={`absolute inset-x-[15%] rounded-sm ${up ? 'bg-emerald-500/80' : 'bg-rose-500/80'}`}
                      style={up ? { bottom: '50%', height: `${h}%` } : { top: '50%', height: `${h}%` }}
                    />
                  </div>
                )
              })}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-fg-muted">
              <span>{fmtDate(d.history[d.history.length - 1].date, true)}</span>
              <span>{fmtDate(d.history[0].date, true)}</span>
            </div>
            {verdict && <p className="mt-2 text-xs text-fg-secondary">{verdict}</p>}
            <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
              Bars: close-to-close reaction (report before the open: prior close to that day’s close; after the close: that
              close to the next). Dashed lines: ± the implied event move. {d.notes}
            </p>
          </>
        )}
      </div>
    </Panel>
  )
}

// ── perception vs model ─────────────────────────────────────────────────────

export function PerceptionPanel({ symbol, compact = false }: { symbol: string; compact?: boolean }) {
  const q = usePerception(symbol)
  const d = q.data
  const axis = useMemo(
    () => (d ? axisFor([...d.rows.map((r) => r.market.range_80), ...d.rows.map((r) => r.model?.range_80 ?? null)], [d.spot]) : null),
    [d],
  )

  return (
    <Panel
      compact={compact}
      title="Perception vs model"
      subtitle="Market-implied 80% range (option prices, risk-neutral) beside our statistical forecast’s 80% range for the same dates."
    >
      <div className="mb-3 flex flex-wrap items-center gap-4 text-[11px] text-fg-secondary">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-5 rounded-full bg-indigo-500/70" /> {d?.labels.market || 'Market-implied (options)'}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-5 rounded-full bg-amber-500/70" /> {d?.labels.model || 'QuantTrade statistical forecast'}</span>
      </div>
      {q.isLoading ? (
        <div className="space-y-4" aria-busy>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Bone className="h-3 w-40" />
              <Bone className="h-2 w-full" />
              <Bone className="h-2 w-full" />
            </div>
          ))}
          <p className="text-[11px] text-fg-muted">Fitting the forecast model can take up to a minute the first time a symbol is requested.</p>
        </div>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d || !d.rows.length || !axis ? (
        <EmptyState>No expiries within three months to compare for {symbol}.</EmptyState>
      ) : (
        <>
          <ul className="space-y-3.5">
            {d.rows.map((r) => {
              const mPct = rangePct(r.market.range_80, d.spot)
              const fPct = rangePct(r.model?.range_80 ?? null, d.spot)
              return (
                <li key={r.expiration}>
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                    <span className="font-semibold text-fg-primary">
                      {fmtDate(r.expiration, true)} <span className="font-normal text-fg-muted">{r.trading_days} sessions</span>
                    </span>
                    <span className="tabular-nums text-fg-muted">
                      Market {mPct ? `${fmtPct(mPct[0], 1, true)} / ${fmtPct(mPct[1], 1, true)}` : '—'}
                      {' · '}
                      Model {fPct ? `${fmtPct(fPct[0], 1, true)} / ${fmtPct(fPct[1], 1, true)}` : r.model ? '—' : 'beyond horizon'}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <RangeBar r={r.market.range_80} axis={axis} spot={d.spot} />
                    <RangeBar r={r.model?.range_80 ?? null} axis={axis} spot={d.spot} tone="amber" />
                  </div>
                  {r.model && !compact && (
                    <p className="mt-1 text-[11px] tabular-nums text-fg-muted">
                      Model centre {fmtPrice(r.model.point)} (<span className={directionClass(r.model.exp_return_pct)}>{fmtPct(r.model.exp_return_pct, 2, true)}</span>), P(up) {fmtProb(r.model.prob_up)} · options P(above spot) {fmtProb(r.market.prob_above_spot)}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="mt-2 flex justify-between text-[10px] tabular-nums text-fg-muted">
            <span>{fmtPrice(axis[0], 0)}</span>
            <span>spot {fmtPrice(d.spot)}</span>
            <span>{fmtPrice(axis[1], 0)}</span>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-fg-muted">
            {d.model
              ? `Model: ${d.model.name || 'SARIMAX'} as of ${fmtDate(d.model.as_of, true)}, volatility ${d.model.vol_annualized_pct ?? '—'}% annualised; forecast to ${d.model.horizon_max ?? '—'} sessions. `
              : 'The statistical forecast is unavailable for this symbol right now. '}
            A wider market range than the model usually reflects the volatility risk premium and event risk (earnings, macro) that a price-only model does not see.{' '}
            <Link prefetch={false} href={`/research?symbol=${encodeURIComponent(symbol)}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">Full forecast in Research</Link>
          </p>
        </>
      )}
    </Panel>
  )
}
