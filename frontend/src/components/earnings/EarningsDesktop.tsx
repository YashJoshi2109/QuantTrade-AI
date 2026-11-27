'use client'

import Link from 'next/link'
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { SkeletonDataTable } from '@/components/ui/data-skeletons'
import AppLayout from '@/components/AppLayout'
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
  'rounded-lg border border-line-default bg-surface-base px-2.5 py-1.5 text-sm text-fg-primary focus:outline-none focus:ring-2 focus:ring-indigo-500/40'

function Row({ r }: { r: EarningsRow }) {
  return (
    <tr className="border-t border-line-subtle hover:bg-surface-raised/40" data-testid="earnings-row">
      <td className="px-4 py-2.5">
        <Link href={`/research?symbol=${encodeURIComponent(r.symbol)}`} className="flex items-center gap-2">
          <TickerLogo symbol={r.symbol} size={24} />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="font-semibold text-fg-primary">{r.symbol}</span>
              {r.in_portfolio && <span className="rounded bg-emerald-500/10 px-1 text-[9px] font-bold uppercase text-emerald-700 dark:text-emerald-400">Held</span>}
              {r.in_watchlist && <span className="rounded bg-indigo-500/10 px-1 text-[9px] font-bold uppercase text-indigo-600 dark:text-indigo-400">Watch</span>}
            </span>
            <span className="block max-w-[220px] truncate text-[11px] text-fg-muted">{r.name || '—'}</span>
          </span>
        </Link>
      </td>
      <td className="px-3 py-2.5"><HourPill hour={r.hour} /></td>
      <td className="px-3 py-2.5 text-right tabular-nums text-fg-secondary">{fmtEps(r.eps_estimate)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-fg-primary">{fmtEps(r.eps_actual)}</td>
      <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${SURPRISE_CLASS[surpriseTone(r.eps_surprise_pct)]}`}>{fmtSurprise(r.eps_surprise_pct)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-fg-secondary">{fmtRevenue(r.revenue_estimate)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-fg-primary">{fmtRevenue(r.revenue_actual)}</td>
      <td className={`px-3 py-2.5 text-right tabular-nums ${SURPRISE_CLASS[surpriseTone(r.revenue_surprise_pct)]}`}>{fmtSurprise(r.revenue_surprise_pct)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-fg-secondary">{formatMarketCap(r.market_cap)}</td>
      <td className="px-2 py-2.5 text-right"><AlertLink symbol={r.symbol} /></td>
    </tr>
  )
}

export default function EarningsDesktop() {
  const c = useEarningsController()
  return (
    <AppLayout>
      <div className="mx-auto max-w-[1280px] px-6 py-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-2.5">
              <CalendarDays className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-fg-primary">Earnings calendar</h1>
              <p className="mt-0.5 text-xs text-fg-muted">
                Upcoming and recent reports: time, EPS and revenue estimates vs. actuals, and surprise.{' '}
                <Link href="/alerts" className="text-indigo-600 hover:underline dark:text-indigo-400">Set an earnings alert</Link> to be notified N days before a report.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => c.shiftWeek(-1)} aria-label="Previous week" className="rounded-lg border border-line-default p-2 text-fg-secondary hover:bg-surface-raised">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[170px] text-center text-sm font-semibold text-fg-primary" aria-live="polite">{weekRangeLabel(c.monday)}</span>
            <button type="button" onClick={() => c.shiftWeek(1)} aria-label="Next week" className="rounded-lg border border-line-default p-2 text-fg-secondary hover:bg-surface-raised">
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={c.goToday}
              disabled={c.isThisWeek && (c.day === null || c.day === c.today)}
              className="rounded-lg border border-line-default px-3 py-1.5 text-sm font-medium text-fg-primary hover:bg-surface-raised disabled:opacity-50"
            >
              Today
            </button>
          </div>
        </div>

        {/* filters */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-xl border border-line-subtle bg-surface-base p-1" role="radiogroup" aria-label="Companies">
            {scopeOptions.map((o) => {
              const locked = o.needsAuth && !c.isAuthenticated
              return (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={c.scope === o.id}
                  disabled={locked}
                  title={locked ? 'Sign in to filter by your watchlist or portfolio' : undefined}
                  onClick={() => c.setScope(o.id)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                    c.scope === o.id ? 'border border-indigo-500/20 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' : 'text-fg-muted hover:text-fg-primary'
                  }`}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
          <label className="flex items-center gap-2 text-xs text-fg-secondary">
            Market cap
            <select className={selectCls} value={c.cap} onChange={(e) => c.setCap(e.target.value as typeof c.cap)}>
              <option value="">All sizes</option>
              {capOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-fg-secondary">
            Sector
            <select className={selectCls} value={c.sector} onChange={(e) => c.setSector(e.target.value)}>
              <option value="">All sectors</option>
              {c.sector && !c.sectors.includes(c.sector) && <option value={c.sector}>{c.sector}</option>}
              {c.sectors.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {c.filtersActive && (
            <button type="button" onClick={c.clearFilters} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">Clear filters</button>
          )}
          {!c.isAuthenticated && !c.authLoading && (
            <span className="text-xs text-fg-muted"><Link href="/auth" className="text-indigo-600 hover:underline dark:text-indigo-400">Sign in</Link> to see only your watchlist or holdings.</span>
          )}
          {c.fetching && !c.loading && <Loader2 className="h-4 w-4 animate-spin text-fg-muted" aria-label="Refreshing" />}
        </div>

        {/* day strip */}
        <div className="mb-4 grid grid-cols-[repeat(6,minmax(0,1fr))] gap-2" role="tablist" aria-label="Day">
          <button
            type="button"
            role="tab"
            aria-selected={c.day === null}
            onClick={() => c.setDay(null)}
            className={`rounded-xl border px-3 py-2 text-left ${c.day === null ? 'border-indigo-500/40 bg-indigo-500/10' : 'border-line-subtle bg-surface-base hover:bg-surface-raised'}`}
          >
            <span className="block text-xs font-semibold text-fg-primary">Whole week</span>
            <span className="block text-[11px] text-fg-muted">{c.loading ? '…' : `${c.data?.total ?? 0} report${c.data?.total === 1 ? '' : 's'}`}</span>
          </button>
          {c.days.map((d) => {
            const n = c.grouped[d]?.length ?? 0
            const isToday = d === c.today
            return (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={c.day === d}
                onClick={() => c.setDay(d)}
                className={`rounded-xl border px-3 py-2 text-left ${c.day === d ? 'border-indigo-500/40 bg-indigo-500/10' : 'border-line-subtle bg-surface-base hover:bg-surface-raised'}`}
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold text-fg-primary">
                  {dayLabel(d)}
                  {isToday && <span className="rounded bg-amber-500/15 px-1 text-[9px] font-bold uppercase text-amber-700 dark:text-amber-400">Today</span>}
                </span>
                <span className="block text-[11px] text-fg-muted">{c.loading ? '…' : `${n} report${n === 1 ? '' : 's'}`}</span>
              </button>
            )
          })}
        </div>

        {c.error ? (
          <div className="hud-card flex items-center gap-3 p-6 text-sm text-fg-secondary">
            <AlertTriangle className="h-5 w-5 text-amber-500" /> Could not load the earnings calendar: {c.error.message}
          </div>
        ) : c.loading ? (
          <div className="hud-card overflow-hidden p-0"><SkeletonDataTable rows={10} columns={10} rowHeight={61} /></div>
        ) : c.data && !c.data.sources.finnhub && !c.data.sources.nasdaq ? (
          <div className="hud-card flex items-center gap-3 p-6 text-sm text-fg-secondary">
            <AlertTriangle className="h-5 w-5 text-amber-500" /> Earnings data is unavailable right now. Try again in a few minutes.
          </div>
        ) : (
          <div className="space-y-4">
            {c.visibleDays.map((d) => {
              const rows = c.grouped[d] ?? []
              const open = c.expanded[d] || c.day !== null
              const shown = open ? rows : rows.slice(0, PER_DAY_PREVIEW)
              return (
                <section key={d} className="hud-card overflow-hidden p-0" aria-label={dayLabel(d, 'long')}>
                  <header className="flex items-center justify-between border-b border-line-subtle px-4 py-2.5">
                    <h2 className="text-sm font-semibold text-fg-primary">
                      {dayLabel(d, 'long')}
                      {d === c.today && <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700 dark:text-amber-400">Today</span>}
                    </h2>
                    <span className="text-xs text-fg-muted">{rows.length} report{rows.length === 1 ? '' : 's'}</span>
                  </header>
                  {rows.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-fg-muted">
                      {c.filtersActive ? 'No reports match these filters.' : 'No reports scheduled.'}
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="whitespace-nowrap text-left text-[11px] uppercase tracking-wide text-fg-muted">
                            <th className="px-4 py-2 font-medium">Company</th>
                            <th className="px-3 py-2 font-medium">Time</th>
                            <th className="px-3 py-2 text-right font-medium">EPS est.</th>
                            <th className="px-3 py-2 text-right font-medium">EPS actual</th>
                            <th className="px-3 py-2 text-right font-medium">Surprise</th>
                            <th className="px-3 py-2 text-right font-medium">Rev. est.</th>
                            <th className="px-3 py-2 text-right font-medium">Rev. actual</th>
                            <th className="px-3 py-2 text-right font-medium">Rev. surprise</th>
                            <th className="px-3 py-2 text-right font-medium">Mkt cap</th>
                            <th className="px-2 py-2"><span className="sr-only">Alert</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {shown.map((r) => <Row key={`${r.symbol}-${r.date}`} r={r} />)}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {!open && rows.length > PER_DAY_PREVIEW && (
                    <button
                      type="button"
                      onClick={() => c.setExpanded((e) => ({ ...e, [d]: true }))}
                      className="w-full border-t border-line-subtle py-2 text-xs font-medium text-indigo-600 hover:bg-surface-raised dark:text-indigo-400"
                    >
                      Show all {rows.length} (largest companies shown first)
                    </button>
                  )}
                </section>
              )
            })}
            {c.day === null && c.weekendRows.length > 0 && (
              <p className="text-xs text-fg-muted">{c.weekendRows.length} report(s) dated on the weekend are not shown.</p>
            )}
            {c.data?.truncated && <p className="text-xs text-fg-muted">Showing the first {c.data.rows.length} of {c.data.total}. Narrow the filters to see the rest.</p>}
          </div>
        )}
        <div className="mt-5"><SourceNote sources={c.data?.sources} /></div>
      </div>
    </AppLayout>
  )
}
