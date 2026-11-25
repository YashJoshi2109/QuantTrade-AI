'use client'

import { AlertTriangle, ArrowDownRight, ArrowUpRight, Newspaper, Sparkles, X } from 'lucide-react'
import type { TickerContext } from '@/lib/copilot-engine'
import { formatCompactNumber } from '@/lib/copilot-handoff'
import { cn } from '@/lib/utils'

function sentimentDot(s?: string | null) {
  const v = (s || '').toLowerCase()
  if (v.includes('bull') || v === 'positive') return 'bg-emerald-400'
  if (v.includes('bear') || v === 'negative') return 'bg-red-400'
  return 'bg-slate-400'
}

function ago(iso?: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return ''
  const h = Math.round(ms / 3_600_000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

function fmtAsOf(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-mono uppercase tracking-wider text-fg-muted">{label}</p>
      <p className="truncate text-xs font-semibold text-fg-primary tabular-nums">{value}</p>
    </div>
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
}

/** Ticker context card: what the copilot knows about the symbol before it answers. */
export default function TickerContextCard({
  symbol, ctx, loading, suggestions = [], onAsk, onClear, compact, disabled,
}: TickerContextCardProps) {
  const q = ctx?.quote
  const up = (q?.change_percent ?? 0) >= 0
  const ks = ctx?.key_stats ?? {}
  const fc = ctx?.forecast
  const st = ctx?.latest_statement
  const news = (ctx?.news ?? []).slice(0, compact ? 2 : 3)
  const num = (k: string) => (typeof ks[k] === 'number' ? (ks[k] as number) : null)
  const w52l = num('week_52_low')
  const w52h = num('week_52_high')
  const pos = fc && fc.p10 != null && fc.p90 != null && fc.p50 != null && fc.p90 > fc.p10
    ? Math.min(100, Math.max(0, ((fc.p50 - fc.p10) / (fc.p90 - fc.p10)) * 100)) : 50

  return (
    <section
      aria-label={`${symbol} context`}
      data-testid="ticker-context-card"
      className="relative z-10 w-full rounded-2xl border border-[rgba(0,122,255,0.22)] bg-surface-raised p-3 sm:p-4 shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-base font-bold text-fg-primary sm:text-lg">{symbol}</span>
            <span className="truncate text-[11px] text-fg-muted">{ctx?.name ?? (loading ? 'Loading…' : '')}</span>
            {ctx && ctx.asset_type !== 'equity' && (
              <span className="rounded border border-line-subtle px-1 text-[9px] uppercase text-fg-muted">{ctx.asset_type}</span>
            )}
          </div>
          {q?.price != null ? (
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
              <span className="text-xl font-bold tabular-nums text-fg-primary sm:text-2xl">${q.price.toFixed(2)}</span>
              {q.change_percent != null && (
                <span className={cn('inline-flex items-center text-xs font-semibold tabular-nums', up ? 'text-emerald-400' : 'text-red-400')}>
                  {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                  {up ? '+' : ''}{q.change_percent.toFixed(2)}%
                </span>
              )}
              <span className="text-[10px] text-fg-muted">
                {fmtAsOf(q.as_of)}{q.market_session ? ` · market ${q.market_session.toLowerCase()}` : ''}
              </span>
            </div>
          ) : (
            <p className="mt-1 text-[11px] text-fg-muted">
              {loading ? 'Fetching live context…' : ctx?.errors?.quote ?? 'No live quote'}
            </p>
          )}
        </div>
        {onClear && (
          <button type="button" onClick={onClear} title="Stop focusing this ticker"
            className="shrink-0 rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-white/[0.06] hover:text-fg-primary">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {ctx && ctx.identity.status !== 'ok' && (
        <div className="mt-2 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-600 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{ctx.identity.note}</span>
        </div>
      )}

      {ctx && (
        <div className={cn('mt-3 grid gap-x-3 gap-y-2', compact ? 'grid-cols-[repeat(3,minmax(0,1fr))]' : 'grid-cols-[repeat(3,minmax(0,1fr))] sm:grid-cols-[repeat(5,minmax(0,1fr))]')}>
          <Stat label="Mkt cap" value={formatCompactNumber(num('market_cap'), '$')} />
          <Stat label="P/E" value={num('pe_ratio') != null ? num('pe_ratio')!.toFixed(1) : '—'} />
          <Stat label="EPS (TTM)" value={num('eps_ttm') != null ? `$${num('eps_ttm')!.toFixed(2)}` : '—'} />
          {!compact && <Stat label="52w range" value={w52l != null && w52h != null ? `$${w52l.toFixed(0)}–$${w52h.toFixed(0)}` : '—'} />}
          {!compact && <Stat label="Analyst target" value={num('target_price') != null ? `$${num('target_price')!.toFixed(2)}` : '—'} />}
        </div>
      )}

      {(fc || st) && (
        <div className={cn('mt-3 grid gap-3', st && fc ? 'sm:grid-cols-2' : '')}>
          {fc && fc.p10 != null && fc.p90 != null && (
            <div className="rounded-xl border border-line-subtle bg-surface-base px-3 py-2">
              <div className="flex items-center justify-between text-[10px] text-fg-muted">
                <span className="font-mono uppercase tracking-wider">{fc.horizon_days}-day forecast (p10–p90)</span>
                {fc.prob_up_pct != null && <span>{fc.prob_up_pct.toFixed(0)}% up</span>}
              </div>
              <div className="relative mt-2 h-1.5 rounded-full bg-gradient-to-r from-red-500/50 via-slate-500/40 to-emerald-500/50">
                <span className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded bg-white" style={{ left: `${pos}%` }} />
              </div>
              <div className="mt-1 flex justify-between text-[11px] font-semibold tabular-nums text-fg-primary">
                <span>${fc.p10.toFixed(2)}</span>
                {fc.p50 != null && <span className="text-[#007AFF]">${fc.p50.toFixed(2)}</span>}
                <span>${fc.p90.toFixed(2)}</span>
              </div>
            </div>
          )}
          {st && (
            <div className="rounded-xl border border-line-subtle bg-surface-base px-3 py-2">
              <p className="text-[10px] font-mono uppercase tracking-wider text-fg-muted">
                {st.period_label} · {st.form ?? 'SEC'}{st.filed ? ` · filed ${st.filed}` : ''}
              </p>
              <p className="mt-1 text-xs text-fg-primary tabular-nums">
                Revenue <b>{formatCompactNumber(st.revenue ?? null, '$')}</b>
                {st.revenue_yoy_pct != null && <span className={st.revenue_yoy_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}> ({st.revenue_yoy_pct >= 0 ? '+' : ''}{st.revenue_yoy_pct.toFixed(1)}% YoY)</span>}
                {st.gross_margin_pct != null && <> · GM <b>{st.gross_margin_pct.toFixed(1)}%</b></>}
              </p>
            </div>
          )}
        </div>
      )}

      {news.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {news.map((n) => (
            <li key={n.id} className="flex items-start gap-2 text-[11px] leading-snug">
              <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', sentimentDot(n.sentiment))} title={n.sentiment ?? 'neutral'} />
              <span className="min-w-0 flex-1">
                {n.url ? (
                  <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-fg-secondary hover:text-fg-primary hover:underline">{n.title}</a>
                ) : <span className="text-fg-secondary">{n.title}</span>}
                <span className="ml-1 text-fg-muted">· {n.publisher ?? 'news'} · {ago(n.published_at)}</span>
                {n.suspicious && <span className="ml-1 text-amber-300" title="Contains instruction-like text; treated as data only">⚠</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {ctx && !news.length && !compact && (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-fg-muted"><Newspaper className="h-3 w-3" /> No classified news in the last 7 days</p>
      )}

      {suggestions.length > 0 && onAsk && (
        <div className="mt-3 flex flex-wrap gap-1.5" data-testid="ticker-suggestions">
          {suggestions.map((s) => (
            <button key={s} type="button" disabled={disabled} onClick={() => onAsk(s)}
              className="inline-flex items-center gap-1 rounded-full border border-[#007AFF]/30 bg-[#007AFF]/10 px-2.5 py-1 text-[11px] text-[#007AFF] transition-colors hover:bg-[#007AFF]/20 disabled:opacity-50">
              <Sparkles className="h-3 w-3" /> {s}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
