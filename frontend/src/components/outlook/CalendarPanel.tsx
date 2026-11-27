'use client'

/** Upcoming catalysts (earnings, ex-dividend, high-impact US macro) with the move options price for each. */
import { useMemo, useState } from 'react'
import { CalendarDays, Coins, Landmark } from 'lucide-react'
import TickerLogo from '@/components/TickerLogo'
import {
  DEFAULT_CALENDAR,
  fmtDate,
  fmtPct,
  fmtPerShare,
  parseSymbols,
  useOutlookCalendar,
  type CalendarEvent,
} from '@/lib/outlook'
import { Bone, Disclaimer, EmptyState, ErrorState, Field, inputCls, Panel, QualityBadge, Segmented, type OutlookController } from './OutlookParts'

type Source = 'popular' | 'portfolio' | 'custom'

const TYPE_ICON = {
  earnings: CalendarDays,
  dividend: Coins,
  macro: Landmark,
} as const

function ImpliedChip({ e }: { e: CalendarEvent }) {
  const i = e.implied
  if (!i) return <span className="text-[11px] text-fg-muted">No option read</span>
  const headline = i.event_move_pct ?? i.move_pct
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5 text-right">
      <span
        className="rounded-md border border-indigo-500/25 bg-indigo-500/10 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-indigo-700 dark:text-indigo-300"
        title={i.event_move_pct != null ? 'Event-day move implied by the term structure' : `Straddle move to ${i.expiration}`}
      >
        ±{fmtPct(headline)}
      </span>
      <span className="text-[10px] text-fg-muted">
        {i.event_move_pct != null ? 'event' : `to ${fmtDate(i.expiration)}`}
      </span>
      <QualityBadge q={i.quality} />
    </span>
  )
}

function detailText(e: CalendarEvent): string {
  if (e.type === 'earnings') {
    const bits = [e.hour ? e.hour.toUpperCase() : null, e.detail, e.eps_estimate != null ? `EPS est. ${e.eps_estimate}` : null]
    return bits.filter(Boolean).join(' · ') || 'Time not announced'
  }
  if (e.type === 'dividend') {
    const bits = [e.amount != null ? `${fmtPerShare(e.amount)} / share` : null,
      e.amount_pct != null ? `${fmtPct(e.amount_pct, 2)} of price` : null,
      e.pay_date ? `pays ${fmtDate(e.pay_date)}` : null]
    return bits.filter(Boolean).join(' · ') || 'Amount not announced'
  }
  const fp = [e.forecast != null && e.forecast !== '' ? `forecast ${e.forecast}${e.unit || ''}` : null,
    e.prior != null && e.prior !== '' ? `prior ${e.prior}${e.unit || ''}` : null]
  return [e.time, ...fp].filter(Boolean).join(' · ') || 'US high-impact release'
}

function dayHeading(iso: string, today: string): string {
  const base = new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
  return iso === today ? `Today · ${base}` : base
}

export function CalendarPanel({ c, compact = false }: { c: OutlookController; compact?: boolean }) {
  const [source, setSource] = useState<Source>('popular')
  const [custom, setCustom] = useState('AAPL, MSFT, NVDA, JPM, KO')
  const [days, setDays] = useState(30)
  const held = useMemo(() => c.holdings.map((h) => h.symbol).slice(0, 12), [c.holdings])
  const symbols = useMemo(() => {
    if (source === 'portfolio') return held
    if (source === 'custom') return parseSymbols(custom)
    return DEFAULT_CALENDAR
  }, [source, held, custom])
  const q = useOutlookCalendar(symbols, days)
  const d = q.data
  const grouped = useMemo(() => {
    const g: [string, CalendarEvent[]][] = []
    for (const e of d?.events ?? []) {
      const last = g[g.length - 1]
      if (last && last[0] === e.date) last[1].push(e)
      else g.push([e.date, [e]])
    }
    return g
  }, [d])

  return (
    <Panel
      compact={compact}
      title="Event calendar"
      subtitle="Catalysts ahead and the move the option market prices through each one."
      right={q.isFetching && !q.isLoading ? <span className="text-[11px] text-fg-muted">Updating…</span> : undefined}
    >
      <div className={`mb-4 flex gap-3 ${compact ? 'flex-col' : 'flex-wrap items-end justify-between'}`}>
        <Segmented<Source>
          label="Symbols"
          size={compact ? 'sm' : 'md'}
          value={source}
          onChange={setSource}
          options={[
            { id: 'popular', label: 'Popular' },
            { id: 'portfolio', label: 'My portfolio', disabled: !c.isAuthenticated || !held.length, title: !c.isAuthenticated ? 'Sign in to use your portfolio' : !held.length ? 'Your portfolio has no holdings' : undefined },
            { id: 'custom', label: 'Custom' },
          ]}
        />
        <div className="flex items-end gap-2">
          {source === 'custom' && (
            <Field label="Symbols (max 12)">
              <input className={`${inputCls} ${compact ? '' : 'w-64'} uppercase`} value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Custom symbols" />
            </Field>
          )}
          <Field label="Window">
            <select className={`${inputCls} w-28`} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Window">
              <option value={14}>2 weeks</option>
              <option value={30}>30 days</option>
              <option value={42}>6 weeks</option>
            </select>
          </Field>
        </div>
      </div>

      {q.isLoading ? (
        <div className="space-y-4" aria-busy>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-line-subtle">
              <div className="border-b border-line-subtle px-4 py-2.5"><Bone className="h-3 w-44" /></div>
              {Array.from({ length: 2 }).map((_, j) => (
                <div key={j} className="flex items-center gap-3 px-4 py-3">
                  <Bone className="h-7 w-7 rounded-full" />
                  <div className="flex-1 space-y-1.5"><Bone className="h-3 w-32" /><Bone className="h-2.5 w-56" /></div>
                  <Bone className="h-5 w-20" />
                </div>
              ))}
            </div>
          ))}
          <p className="text-[11px] text-fg-muted">Reading option chains for each event…</p>
        </div>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !symbols.length ? (
        <EmptyState>Add at least one valid symbol.</EmptyState>
      ) : !grouped.length ? (
        <EmptyState>No earnings, ex-dividend dates or high-impact macro releases in this window.</EmptyState>
      ) : (
        <div className="space-y-3">
          {grouped.map(([day, events]) => (
            <section key={day} className="overflow-hidden rounded-xl border border-line-subtle bg-surface-base" aria-label={dayHeading(day, d?.today || '')}>
              <header className="flex items-center justify-between border-b border-line-subtle px-4 py-2">
                <h3 className="text-xs font-semibold text-fg-primary">{dayHeading(day, d?.today || '')}</h3>
                <span className="text-[11px] text-fg-muted">{events.length} event{events.length === 1 ? '' : 's'}</span>
              </header>
              <ul className="divide-y divide-line-subtle">
                {events.map((e, i) => {
                  const Icon = TYPE_ICON[e.type]
                  return (
                    <li key={`${e.type}-${e.symbol}-${e.title}-${i}`} className={`flex gap-3 px-4 py-2.5 ${compact ? 'flex-col' : 'items-center'}`}>
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        {e.type === 'macro' ? (
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400"><Icon className="h-3.5 w-3.5" /></span>
                        ) : (
                          <TickerLogo symbol={e.symbol || ''} size={28} />
                        )}
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-fg-primary">
                            {e.type !== 'macro' && <Icon className={`h-3.5 w-3.5 shrink-0 ${e.type === 'earnings' ? 'text-amber-500' : 'text-emerald-500'}`} />}
                            {e.title}
                          </p>
                          <p className="truncate text-[11px] tabular-nums text-fg-muted">{detailText(e)}</p>
                          {e.date_note && <p className="text-[10px] text-amber-600 dark:text-amber-400">{e.date_note}</p>}
                        </div>
                      </div>
                      <div className={compact ? 'flex items-center justify-between' : 'shrink-0'}>
                        {compact && <span className="text-[10px] text-fg-muted">{e.type === 'macro' ? 'SPY priced move' : 'Priced move'}</span>}
                        {e.type === 'dividend' ? <span className="text-[11px] text-fg-muted">Price drops by about the dividend on the ex-date</span> : <ImpliedChip e={e} />}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      <div className="mt-4 space-y-2">
        <p className="text-[11px] leading-relaxed text-fg-muted">
          Priced move: the event-day move implied by the gap in implied volatility between the expiries either side of the
          event (term-structure method); when no earlier expiry exists, the at-the-money straddle to the first expiry after it.
          Macro rows use SPY options. {d && !d.macro_available && 'Macro releases are unavailable right now.'} Sources: Finnhub
          (earnings, macro), Nasdaq/yfinance (dividends), Public.com/yfinance (options).
        </p>
        <Disclaimer compact={compact} />
      </div>
    </Panel>
  )
}
