'use client'

import { AlertTriangle, ArrowDownRight, ArrowUpRight, ChevronDown, X } from 'lucide-react'
import type { TickerContext } from '@/lib/copilot-engine'
import { formatCompactNumber } from '@/lib/copilot-handoff'
import { formatAge } from '@/lib/copilot-trust'
import { cn } from '@/lib/utils'
import { hitRateText, positionInRange } from '@/lib/forecastSummary'

function fmtAsOf(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function ago(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : formatAge(d, Date.now())
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-[var(--cp-ink-3)]">{label}</dt>
      <dd className="truncate text-[14px] font-semibold tabular-nums text-[var(--cp-ink)]">{value}</dd>
    </div>
  )
}

/** Price change in neutral ink: a normal daily move is information, not an alarm. */
function Change({ pct }: { pct: number }) {
  const up = pct >= 0
  const Arrow = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className="inline-flex items-center gap-0.5 text-[14px] font-medium tabular-nums text-[var(--cp-ink-2)]">
      <Arrow className={cn('h-4 w-4', up ? 'text-[var(--cp-up)]' : 'text-[var(--cp-down)]')} aria-hidden />
      <span className="sr-only">{up ? 'up' : 'down'} </span>
      <span>{`${up ? '+' : ''}${pct.toFixed(2)}%`}</span>
    </span>
  )
}

export interface TickerContextCardProps {
  symbol: string
  ctx: TickerContext | null
  loading?: boolean
  suggestions?: string[]
  onAsk?: (q: string) => void
  onClear?: () => void
  compact?: boolean
  disabled?: boolean
  /** 'bar': one-line strip pinned above a conversation; expands to the card. */
  variant?: 'card' | 'bar'
  expanded?: boolean
  onToggle?: () => void
}

/** What the copilot knows about the ticker before it answers. */
export default function TickerContextCard({
  symbol, ctx, loading, suggestions = [], onAsk, onClear, compact, disabled, variant = 'card', expanded, onToggle,
}: TickerContextCardProps) {
  const q = ctx?.quote
  const ks = ctx?.key_stats ?? {}
  const fc = ctx?.forecast
  const st = ctx?.latest_statement
  const news = (ctx?.news ?? []).slice(0, compact ? 2 : 3)
  const num = (k: string) => (typeof ks[k] === 'number' ? (ks[k] as number) : null)
  const w52l = num('week_52_low')
  const w52h = num('week_52_high')
  // Marker = last price (neutral). The midpoint is drawn only when the model beat ARIMA(0,1,0).
  const fcRange: [number, number] | null = fc && fc.p10 != null && fc.p90 != null ? [fc.p10, fc.p90] : null
  const pricePos = positionInRange(q?.price ?? null, fcRange)
  const fcHit = fc ? hitRateText({ hit_rate_80: fc.hit_rate_80 ?? null, hit_rate_tests: fc.hit_rate_tests ?? null }) : null
  const fcEdge = fc?.reliability === 'edge_in_backtest'

  const clearBtn = onClear && (
    <button
      type="button"
      onClick={onClear}
      aria-label={`Stop focusing on ${symbol}`}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--cp-ink-3)] hover:bg-[var(--cp-sunken)] hover:text-[var(--cp-ink)]"
    >
      <X className="h-4 w-4" aria-hidden />
    </button>
  )

  if (variant === 'bar' && !expanded) {
    return (
      <section aria-label={`${symbol} context`} data-testid="ticker-context-bar" className="flex min-h-[48px] items-center gap-3 rounded-xl border border-[var(--cp-line)] bg-[var(--cp-panel)] py-1.5 pl-3 pr-1">
        <span className="text-[14px] font-semibold text-[var(--cp-ink)]">{symbol}</span>
        {loading && !q ? (
          <span aria-hidden className="cp-skeleton h-3.5 w-40" />
        ) : q?.price != null ? (
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
            <span className="text-[14px] font-semibold tabular-nums text-[var(--cp-ink)]">${q.price.toFixed(2)}</span>
            {q.change_percent != null && <Change pct={q.change_percent} />}
            <span className="truncate text-[12px] text-[var(--cp-ink-3)]">as of {fmtAsOf(q.as_of)}</span>
          </span>
        ) : (
          <span className="text-[13px] text-[var(--cp-ink-3)]">No live quote</span>
        )}
        <span className="ml-auto flex items-center">
          {onToggle && (
            <button type="button" onClick={onToggle} aria-expanded={false}
              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2 text-[13px] text-[var(--cp-ink-2)] hover:bg-[var(--cp-sunken)]">
              Details <ChevronDown className="h-4 w-4" aria-hidden />
            </button>
          )}
          {clearBtn}
        </span>
      </section>
    )
  }

  return (
    <section
      aria-label={`${symbol} context`}
      data-testid="ticker-context-card"
      className="w-full rounded-2xl border border-[var(--cp-line)] bg-[var(--cp-panel)] p-4 shadow-[var(--cp-shadow)] sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[18px] font-semibold text-[var(--cp-ink)]">{symbol}</span>
            <span className="truncate text-[14px] text-[var(--cp-ink-3)]">{ctx?.name ?? ''}</span>
            {ctx && ctx.asset_type !== 'equity' && (
              <span className="rounded border border-[var(--cp-line)] px-1 text-[11px] text-[var(--cp-ink-3)]">{ctx.asset_type}</span>
            )}
          </div>
          {loading && !q ? (
            <div aria-hidden className="mt-2 space-y-2">
              <div className="cp-skeleton h-7 w-44" />
              <div className="cp-skeleton h-3 w-56" />
            </div>
          ) : q?.price != null ? (
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
              <span className="text-[26px] font-semibold tabular-nums text-[var(--cp-ink)]">${q.price.toFixed(2)}</span>
              {q.change_percent != null && <Change pct={q.change_percent} />}
              <span className="text-[13px] text-[var(--cp-ink-3)]">
                as of {fmtAsOf(q.as_of)}{q.market_session ? `, market ${q.market_session.toLowerCase()}` : ''}
              </span>
            </div>
          ) : (
            <p className="mt-1 text-[14px] text-[var(--cp-ink-3)]">{ctx?.errors?.quote ?? 'No live quote right now'}</p>
          )}
        </div>
        <div className="flex items-center">
          {variant === 'bar' && onToggle && (
            <button type="button" onClick={onToggle} aria-expanded
              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2 text-[13px] text-[var(--cp-ink-2)] hover:bg-[var(--cp-sunken)]">
              Less <ChevronDown className="h-4 w-4 rotate-180" aria-hidden />
            </button>
          )}
          {clearBtn}
        </div>
      </div>

      {ctx && ctx.identity.status !== 'ok' && (
        <div className="mt-3 flex gap-2 rounded-lg border border-[var(--cp-caution-line)] bg-[var(--cp-caution-soft)] px-3 py-2 text-[13px] text-[var(--cp-caution-ink)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{ctx.identity.note}</span>
        </div>
      )}

      {loading && !ctx ? (
        <div aria-hidden className="mt-4 grid grid-cols-[repeat(3,minmax(0,1fr))] gap-3">
          {[0, 1, 2].map((i) => <div key={i} className="cp-skeleton h-9" />)}
        </div>
      ) : ctx ? (
        <dl className={cn('mt-4 grid gap-x-4 gap-y-3', compact ? 'grid-cols-[repeat(3,minmax(0,1fr))]' : 'grid-cols-[repeat(3,minmax(0,1fr))] sm:grid-cols-[repeat(5,minmax(0,1fr))]')}>
          <Stat label="Market cap" value={formatCompactNumber(num('market_cap'), '$')} />
          <Stat label="P/E" value={num('pe_ratio') != null ? num('pe_ratio')!.toFixed(1) : '—'} />
          <Stat label="EPS (TTM)" value={num('eps_ttm') != null ? `$${num('eps_ttm')!.toFixed(2)}` : '—'} />
          {!compact && <Stat label="52-week range" value={w52l != null && w52h != null ? `$${w52l.toFixed(0)}–$${w52h.toFixed(0)}` : '—'} />}
          {!compact && <Stat label="Analyst target" value={num('target_price') != null ? `$${num('target_price')!.toFixed(2)}` : '—'} />}
        </dl>
      ) : null}

      {(fc || st) && (
        <div className={cn('mt-4 grid gap-3', st && fc && !compact ? 'sm:grid-cols-2' : '')}>
          {fc && fc.p10 != null && fc.p90 != null && (
            <div className="rounded-xl border border-[var(--cp-line)] bg-[var(--cp-canvas)] px-3.5 py-3">
              <p className="text-[13px] text-[var(--cp-ink-2)]">
                <span className="font-semibold text-[var(--cp-ink)]">{fc.horizon_days}-day 80% range</span>, experimental model
              </p>
              <div className="relative mt-3 h-1.5 rounded-full bg-[var(--cp-line)]" aria-hidden>
                {pricePos != null && (
                  <span className="absolute top-1/2 h-3.5 w-1 -translate-y-1/2 rounded bg-[var(--cp-ink-2)]" style={{ left: `calc(${pricePos}% - 2px)` }} />
                )}
              </div>
              <div className="mt-1.5 flex justify-between text-[13px] font-semibold tabular-nums text-[var(--cp-ink)]">
                <span>${fc.p10.toFixed(2)}</span>
                {fcEdge && fc.p50 != null && <span className="text-[var(--cp-ink-2)]">mid ${fc.p50.toFixed(2)}</span>}
                <span>${fc.p90.toFixed(2)}</span>
              </div>
              <p className="mt-1 text-[12px] leading-snug text-[var(--cp-ink-3)]" data-testid="copilot-forecast-honesty">
                {fcHit ? `${fcHit} in past walk-forward tests. ` : ''}
                {fc.edge_vs_benchmark ?? (fcEdge ? 'Beat ARIMA(0,1,0) in tests' : 'No edge vs ARIMA(0,1,0)')}
                {fcEdge ? '.' : ', so it shows how far, not which way.'} Not a price target or signal.
              </p>
            </div>
          )}
          {st && (
            <div className="rounded-xl border border-[var(--cp-line)] bg-[var(--cp-canvas)] px-3.5 py-3">
              <p className="text-[13px] text-[var(--cp-ink-2)]">
                <span className="font-semibold text-[var(--cp-ink)]">{st.period_label}</span> {st.form ?? 'SEC filing'}{st.filed ? `, filed ${st.filed}` : ''}
              </p>
              <p className="mt-2 text-[14px] tabular-nums text-[var(--cp-ink)]">
                Revenue <b className="font-semibold">{formatCompactNumber(st.revenue ?? null, '$')}</b>
                {st.revenue_yoy_pct != null && <span className="text-[var(--cp-ink-2)]"> ({st.revenue_yoy_pct >= 0 ? '+' : ''}{st.revenue_yoy_pct.toFixed(1)}% YoY)</span>}
              </p>
              {st.gross_margin_pct != null && (
                <p className="text-[14px] tabular-nums text-[var(--cp-ink)]">Gross margin <b className="font-semibold">{st.gross_margin_pct.toFixed(1)}%</b></p>
              )}
            </div>
          )}
        </div>
      )}

      {news.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-[var(--cp-line)] pt-3">
          {news.map((n) => (
            <li key={n.id} className="text-[14px] leading-snug">
              {n.url ? (
                <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-[var(--cp-ink)] underline-offset-2 hover:underline">{n.title}</a>
              ) : <span className="text-[var(--cp-ink)]">{n.title}</span>}
              <span className="ml-1.5 text-[12px] text-[var(--cp-ink-3)]">{n.publisher ?? 'News'}{n.published_at ? `, ${ago(n.published_at)}` : ''}</span>
              {n.suspicious && <span className="ml-1.5 text-[12px] text-[var(--cp-caution-ink)]">contains instruction-like text, treated as data only</span>}
            </li>
          ))}
        </ul>
      )}

      {suggestions.length > 0 && onAsk && (
        <ul className="mt-4 flex flex-wrap gap-2" data-testid="ticker-suggestions">
          {suggestions.map((s) => (
            <li key={s}>
              <button type="button" disabled={disabled} onClick={() => onAsk(s)}
                className="min-h-[36px] rounded-full border border-[var(--cp-line-strong)] bg-[var(--cp-panel)] px-3.5 py-1.5 text-left text-[14px] text-[var(--cp-ink)] hover:border-[var(--cp-accent)] hover:text-[var(--cp-accent-ink)] disabled:opacity-60">
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
