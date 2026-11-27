'use client'

import Link from 'next/link'
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import TickerLogo from '@/components/TickerLogo'
import { formatMarketCap } from '@/lib/valuation'
import {
  dayLabel,
  fmtEps,
  fmtRevenue,
  fmtSurprise,
  SURPRISE_CLASS,
  surpriseTone,
  weekRangeLabel,
  type EarningsRow,
} from '@/lib/earnings'
import {
  AlertLink,
  capOptions,
  HourPill,
  PER_DAY_PREVIEW,
  scopeOptions,
  SourceNote,
  useEarningsController,
} from './EarningsParts'

const selectCls =
  'w-full rounded-lg border border-line-default bg-surface-base px-2.5 py-2 text-xs text-fg-primary focus:outline-none focus:ring-2 focus:ring-indigo-500/40'

function Card({ r }: { r: EarningsRow }) {
  return (
    <li className="rounded-xl border border-line-subtle bg-surface-raised p-3" data-testid="earnings-card">
      <div className="flex items-center gap-3">
        <TickerLogo symbol={r.symbol} size={32} />
        <Link href={`/research?symbol=${encodeURIComponent(r.symbol)}`} className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="font-semibold text-fg-primary">{r.symbol}</span>
            <HourPill hour={r.hour} />
            {r.in_portfolio && <span className="rounded bg-emerald-500/10 px-1 text-[9px] font-bold uppercase text-emerald-700 dark:text-emerald-400">Held</span>}
            {r.in_watchlist && <span className="rounded bg-indigo-500/10 px-1 text-[9px] font-bold uppercase text-indigo-600 dark:text-indigo-400">Watch</span>}
          </span>
          <span className="block truncate text-[11px] text-fg-muted">{r.name || '—'} · {formatMarketCap(r.market_cap)}</span>
        </Link>
        <AlertLink symbol={r.symbol} compact />
      </div>
      <dl className="mt-2 grid grid-cols-[repeat(3,minmax(0,1fr))] gap-2 text-[11px]">
        <div>
          <dt className="text-fg-muted">EPS est. / act.</dt>
          <dd className="tabular-nums text-fg-primary">{fmtEps(r.eps_estimate)} / <span className="font-semibold">{fmtEps(r.eps_actual)}</span></dd>
        </div>
        <div>
          <dt className="text-fg-muted">EPS surprise</dt>
          <dd className={`tabular-nums font-semibold ${SURPRISE_CLASS[surpriseTone(r.eps_surprise_pct)]}`}>{fmtSurprise(r.eps_surprise_pct)}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Revenue est. / act.</dt>
          <dd className="tabular-nums text-fg-primary">{fmtRevenue(r.revenue_estimate)} / {fmtRevenue(r.revenue_actual)}</dd>
        </div>
      </dl>
    </li>
  )
}

export default function EarningsMobile() {
  const c = useEarningsController()
  return (
    <div className="space-y-4 pt-3">
      <div className="flex items-center gap-2">
        <CalendarDays className="h-5 w-5 text-amber-500" />
        <h1 className="text-lg font-bold text-fg-primary">Earnings calendar</h1>
        {c.fetching && !c.loading && <Loader2 className="h-4 w-4 animate-spin text-fg-muted" aria-label="Refreshing" />}
      </div>

      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => c.shiftWeek(-1)} aria-label="Previous week" className="flex h-9 w-9 items-center justify-center rounded-full border border-line-subtle bg-surface-raised text-fg-secondary active:scale-95">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold text-fg-primary" aria-live="polite">{weekRangeLabel(c.monday)}</p>
          <button type="button" onClick={c.goToday} className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400">Jump to today</button>
        </div>
        <button type="button" onClick={() => c.shiftWeek(1)} aria-label="Next week" className="flex h-9 w-9 items-center justify-center rounded-full border border-line-subtle bg-surface-raised text-fg-secondary active:scale-95">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* day chips */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide" role="tablist" aria-label="Day">
        <button
          type="button"
          role="tab"
          aria-selected={c.day === null}
          onClick={() => c.setDay(null)}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${c.day === null ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' : 'border-line-subtle bg-surface-raised text-fg-secondary'}`}
        >
          Week <span className="opacity-70">{c.loading ? '' : c.data?.total ?? 0}</span>
        </button>
        {c.days.map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={c.day === d}
            onClick={() => c.setDay(d)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${c.day === d ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' : 'border-line-subtle bg-surface-raised text-fg-secondary'}`}
          >
            {dayLabel(d).split(',')[0]}{d === c.today ? ' •' : ''} <span className="opacity-70">{c.loading ? '' : c.grouped[d]?.length ?? 0}</span>
          </button>
        ))}
      </div>

      {/* filters */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide" role="radiogroup" aria-label="Companies">
        {scopeOptions.map((o) => {
          const locked = o.needsAuth && !c.isAuthenticated
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={c.scope === o.id}
              disabled={locked}
              onClick={() => c.setScope(o.id)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${c.scope === o.id ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'border-line-subtle bg-surface-raised text-fg-secondary'}`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
      <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-2">
        <select aria-label="Market cap" className={selectCls} value={c.cap} onChange={(e) => c.setCap(e.target.value as typeof c.cap)}>
          <option value="">All sizes</option>
          {capOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <select aria-label="Sector" className={selectCls} value={c.sector} onChange={(e) => c.setSector(e.target.value)}>
          <option value="">All sectors</option>
          {c.sector && !c.sectors.includes(c.sector) && <option value={c.sector}>{c.sector}</option>}
          {c.sectors.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {!c.isAuthenticated && !c.authLoading && (
        <p className="text-[11px] text-fg-muted"><Link href="/auth" className="text-indigo-600 dark:text-indigo-400">Sign in</Link> to filter by your watchlist or holdings.</p>
      )}
      {c.filtersActive && (
        <button type="button" onClick={c.clearFilters} className="text-xs font-medium text-indigo-600 dark:text-indigo-400">Clear filters</button>
      )}

      {c.error ? (
        <div className="flex items-center gap-2 rounded-xl border border-line-subtle bg-surface-raised p-4 text-sm text-fg-secondary">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" /> Could not load the earnings calendar.
        </div>
      ) : c.loading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-fg-muted" /></div>
      ) : c.data && !c.data.sources.finnhub && !c.data.sources.nasdaq ? (
        <div className="flex items-center gap-2 rounded-xl border border-line-subtle bg-surface-raised p-4 text-sm text-fg-secondary">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" /> Earnings data is unavailable right now.
        </div>
      ) : (
        <div className="space-y-5">
          {c.visibleDays.map((d) => {
            const rows = c.grouped[d] ?? []
            const open = c.expanded[d]
            const shown = open ? rows : rows.slice(0, PER_DAY_PREVIEW)
            return (
              <section key={d} aria-label={dayLabel(d, 'long')}>
                <h2 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-fg-secondary">
                  <span>{dayLabel(d, 'long')}{d === c.today ? ' · Today' : ''}</span>
                  <span className="font-normal normal-case text-fg-muted">{rows.length} report{rows.length === 1 ? '' : 's'}</span>
                </h2>
                {rows.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-line-subtle py-4 text-center text-xs text-fg-muted">
                    {c.filtersActive ? 'No reports match these filters.' : 'No reports scheduled.'}
                  </p>
                ) : (
                  <ul className="space-y-2">{shown.map((r) => <Card key={`${r.symbol}-${r.date}`} r={r} />)}</ul>
                )}
                {!open && rows.length > PER_DAY_PREVIEW && (
                  <button
                    type="button"
                    onClick={() => c.setExpanded((e) => ({ ...e, [d]: true }))}
                    className="mt-2 w-full rounded-lg border border-line-subtle py-2 text-xs font-medium text-indigo-600 dark:text-indigo-400"
                  >
                    Show all {rows.length}
                  </button>
                )}
              </section>
            )
          })}
        </div>
      )}
      <SourceNote sources={c.data?.sources} />
    </div>
  )
}
