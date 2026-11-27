'use client'

import Link from 'next/link'
import { AlertTriangle, Briefcase, ChevronLeft, ChevronRight, Coins, Loader2, LogIn } from 'lucide-react'
import AppLayout from '@/components/AppLayout'
import TickerLogo from '@/components/TickerLogo'
import { dayLabel, weekRangeLabel } from '@/lib/calendarDates'
import {
  fmtMoney,
  fmtPerShare,
  fmtShortDate,
  fmtYield,
  STATUS_TEXT,
  type DividendRow,
} from '@/lib/dividends'
import {
  CalendarNote,
  IncomeChart,
  IncomeNote,
  PER_DAY_PREVIEW,
  SCOPES,
  useDividendsController,
  type DividendsController,
} from './DividendsParts'

function IncomeSection({ c }: { c: DividendsController }) {
  const d = c.incomeData
  if (c.authLoading) return null
  if (!c.isAuthenticated) {
    return (
      <section className="hud-card mb-6 flex items-center justify-between gap-4 p-5">
        <div>
          <h2 className="text-base font-semibold text-fg-primary">Projected dividend income</h2>
          <p className="mt-0.5 text-sm text-fg-muted">Sign in and track a portfolio to see your next 12 months of dividend income by month.</p>
        </div>
        <Link href="/auth" className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-[#fff] hover:bg-indigo-500">
          <LogIn className="h-4 w-4" /> Sign in
        </Link>
      </section>
    )
  }
  if (c.income.isLoading) {
    return <section className="hud-card mb-6 flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-fg-muted" /></section>
  }
  if (c.income.error || !d) {
    return (
      <section className="hud-card mb-6 flex items-center gap-3 p-5 text-sm text-fg-secondary">
        <AlertTriangle className="h-5 w-5 text-amber-500" /> Could not load projected income.
      </section>
    )
  }
  if (d.holding_count === 0) {
    return (
      <section className="hud-card mb-6 flex items-center justify-between gap-4 p-5">
        <div>
          <h2 className="text-base font-semibold text-fg-primary">Projected dividend income</h2>
          <p className="mt-0.5 text-sm text-fg-muted">
            {d.has_tracked_portfolio || c.portfolioId ? 'This portfolio has no open holdings yet.' : 'Add your holdings to a tracked portfolio to project dividend income.'}
          </p>
        </div>
        <Link href="/portfolio" className="inline-flex items-center gap-1.5 rounded-lg border border-line-default px-4 py-2 text-sm font-semibold text-fg-primary hover:bg-surface-raised">
          <Briefcase className="h-4 w-4" /> Go to Portfolio
        </Link>
      </section>
    )
  }
  return (
    <section className="hud-card mb-6 p-5" aria-label="Projected dividend income">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-fg-primary">Projected dividend income · next 12 months</h2>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-3xl font-bold tabular-nums text-fg-primary" data-testid="income-total">{fmtMoney(d.total_12m)}</span>
            <span className="text-sm text-fg-muted">
              ≈ {fmtMoney(d.total_12m != null ? d.total_12m / 12 : null)}/mo · portfolio yield {fmtYield(d.portfolio_yield_pct)}
            </span>
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-fg-secondary">
          Portfolio
          <select
            className="rounded-lg border border-line-default bg-surface-base px-2.5 py-1.5 text-sm text-fg-primary"
            value={c.portfolioId ?? ''}
            onChange={(e) => c.setPortfolioId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">All tracked portfolios</option>
            {d.portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}{p.kind === 'paper' ? ' (simulated)' : ''}</option>)}
          </select>
        </label>
      </div>
      <IncomeChart data={d} />
      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="whitespace-nowrap text-left text-[11px] uppercase tracking-wide text-fg-muted">
              <th className="py-2 pr-3 font-medium">Holding</th>
              <th className="px-3 py-2 text-right font-medium">Shares</th>
              <th className="px-3 py-2 font-medium">Frequency</th>
              <th className="px-3 py-2 text-right font-medium">Per payment</th>
              <th className="px-3 py-2 text-right font-medium">Annual / share</th>
              <th className="px-3 py-2 text-right font-medium">Yield</th>
              <th className="px-3 py-2 font-medium">Next ex-date</th>
              <th className="px-3 py-2 font-medium">Next pay</th>
              <th className="py-2 pl-3 text-right font-medium">12-mo income</th>
            </tr>
          </thead>
          <tbody>
            {d.holdings.map((h) => (
              <tr key={h.symbol} className="border-t border-line-subtle">
                <td className="py-2.5 pr-3">
                  <Link href={`/research?symbol=${encodeURIComponent(h.symbol)}`} className="flex items-center gap-2">
                    <TickerLogo symbol={h.symbol} size={22} />
                    <span>
                      <span className="block font-semibold text-fg-primary">{h.symbol}</span>
                      <span className="block max-w-[180px] truncate text-[11px] text-fg-muted">{h.name || '—'}</span>
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{h.shares.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                <td className="px-3 py-2.5 text-fg-secondary">
                  {h.status === 'projected' ? h.frequency_label : <span title={h.note || undefined} className="text-fg-muted">{STATUS_TEXT[h.status]}</span>}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmtPerShare(h.amount_per_share)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmtPerShare(h.annual_per_share)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmtYield(h.yield_pct)}</td>
                <td className="px-3 py-2.5 text-fg-secondary">{fmtShortDate(h.next_ex_date)}</td>
                <td className="px-3 py-2.5 text-fg-secondary">{fmtShortDate(h.next_pay_date)}</td>
                <td className="py-2.5 pl-3 text-right font-semibold tabular-nums text-fg-primary">{fmtMoney(h.projected_income)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4"><IncomeNote lag={d.assumptions?.pay_lag_days_default} /></div>
    </section>
  )
}

function CalRow({ r }: { r: DividendRow }) {
  return (
    <tr className="border-t border-line-subtle hover:bg-surface-raised/40" data-testid="dividend-row">
      <td className="px-4 py-2.5">
        <Link href={`/research?symbol=${encodeURIComponent(r.symbol)}`} className="flex items-center gap-2">
          <TickerLogo symbol={r.symbol} size={22} />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="font-semibold text-fg-primary">{r.symbol}</span>
              {r.in_portfolio && <span className="rounded bg-emerald-500/10 px-1 text-[9px] font-bold uppercase text-emerald-700 dark:text-emerald-400">Held</span>}
              {r.in_watchlist && <span className="rounded bg-indigo-500/10 px-1 text-[9px] font-bold uppercase text-indigo-600 dark:text-indigo-400">Watch</span>}
            </span>
            <span className="block max-w-[260px] truncate text-[11px] text-fg-muted">{r.name || '—'}</span>
          </span>
        </Link>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-fg-primary">{fmtPerShare(r.amount)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-fg-secondary">{fmtPerShare(r.annual_dividend)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-fg-primary">{fmtYield(r.yield_pct)}</td>
      <td className="px-3 py-2.5 text-fg-secondary">{r.frequency_label || '—'}</td>
      <td className="px-3 py-2.5 text-fg-secondary">{fmtShortDate(r.record_date)}</td>
      <td className="px-3 py-2.5 text-fg-secondary">{fmtShortDate(r.pay_date)}</td>
    </tr>
  )
}

export default function DividendsDesktop() {
  const c = useDividendsController()
  const data = c.cal.data
  return (
    <AppLayout>
      <div className="mx-auto max-w-[1280px] px-6 py-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2.5">
            <Coins className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-fg-primary">Dividends</h1>
            <p className="mt-0.5 text-xs text-fg-muted">Your projected dividend income, and every stock going ex-dividend this week.</p>
          </div>
        </div>

        <IncomeSection c={c} />

        <section aria-label="Ex-dividend calendar">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-fg-primary">Ex-dividend calendar</h2>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => c.shiftWeek(-1)} aria-label="Previous week" className="rounded-lg border border-line-default p-2 text-fg-secondary hover:bg-surface-raised"><ChevronLeft className="h-4 w-4" /></button>
              <span className="min-w-[170px] text-center text-sm font-semibold text-fg-primary" aria-live="polite">{weekRangeLabel(c.monday)}</span>
              <button type="button" onClick={() => c.shiftWeek(1)} aria-label="Next week" className="rounded-lg border border-line-default p-2 text-fg-secondary hover:bg-surface-raised"><ChevronRight className="h-4 w-4" /></button>
              <button type="button" onClick={c.goToday} className="rounded-lg border border-line-default px-3 py-1.5 text-sm font-medium text-fg-primary hover:bg-surface-raised">Today</button>
            </div>
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="flex gap-1 rounded-xl border border-line-subtle bg-surface-base p-1" role="radiogroup" aria-label="Stocks">
              {SCOPES.map((o) => {
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
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${c.scope === o.id ? 'border border-indigo-500/20 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' : 'text-fg-muted hover:text-fg-primary'}`}
                  >
                    {o.label}
                  </button>
                )
              })}
            </div>
            {c.cal.isFetching && !c.calLoading && <Loader2 className="h-4 w-4 animate-spin text-fg-muted" aria-label="Refreshing" />}
          </div>
          <div className="mb-4 grid grid-cols-[repeat(6,minmax(0,1fr))] gap-2" role="tablist" aria-label="Day">
            <button type="button" role="tab" aria-selected={c.day === null} onClick={() => c.setDay(null)}
              className={`rounded-xl border px-3 py-2 text-left ${c.day === null ? 'border-indigo-500/40 bg-indigo-500/10' : 'border-line-subtle bg-surface-base hover:bg-surface-raised'}`}>
              <span className="block text-xs font-semibold text-fg-primary">Whole week</span>
              <span className="block text-[11px] text-fg-muted">{c.calLoading ? '…' : `${data?.total ?? 0} ex-dates`}</span>
            </button>
            {c.days.map((d) => (
              <button key={d} type="button" role="tab" aria-selected={c.day === d} onClick={() => c.setDay(d)}
                className={`rounded-xl border px-3 py-2 text-left ${c.day === d ? 'border-indigo-500/40 bg-indigo-500/10' : 'border-line-subtle bg-surface-base hover:bg-surface-raised'}`}>
                <span className="flex items-center gap-1.5 text-xs font-semibold text-fg-primary">
                  {dayLabel(d)}
                  {d === c.today && <span className="rounded bg-amber-500/15 px-1 text-[9px] font-bold uppercase text-amber-700 dark:text-amber-400">Today</span>}
                </span>
                <span className="block text-[11px] text-fg-muted">{c.calLoading ? '…' : `${c.grouped[d]?.length ?? 0} going ex`}</span>
              </button>
            ))}
          </div>

          {c.calError ? (
            <div className="hud-card flex items-center gap-3 p-6 text-sm text-fg-secondary"><AlertTriangle className="h-5 w-5 text-amber-500" /> Could not load the dividend calendar.</div>
          ) : c.calLoading ? (
            <div className="hud-card flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-fg-muted" /></div>
          ) : data && !data.source_ok ? (
            <div className="hud-card flex items-center gap-3 p-6 text-sm text-fg-secondary"><AlertTriangle className="h-5 w-5 text-amber-500" /> Dividend calendar data is unavailable right now.</div>
          ) : (
            <div className="space-y-4">
              {c.visibleDays.map((d) => {
                const rows = c.grouped[d] ?? []
                const open = c.expanded[d] || c.day !== null
                const shown = open ? rows : rows.slice(0, PER_DAY_PREVIEW)
                return (
                  <section key={d} className="hud-card overflow-hidden p-0" aria-label={`Ex-dividend ${dayLabel(d, 'long')}`}>
                    <header className="flex items-center justify-between border-b border-line-subtle px-4 py-2.5">
                      <h3 className="text-sm font-semibold text-fg-primary">Ex-dividend {dayLabel(d, 'long')}</h3>
                      <span className="text-xs text-fg-muted">{rows.length} stock{rows.length === 1 ? '' : 's'}</span>
                    </header>
                    {rows.length === 0 ? (
                      <p className="px-4 py-6 text-center text-sm text-fg-muted">{c.scope !== 'all' ? 'None of your stocks go ex-dividend this day.' : 'No ex-dividend dates.'}</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="whitespace-nowrap text-left text-[11px] uppercase tracking-wide text-fg-muted">
                              <th className="px-4 py-2 font-medium">Stock</th>
                              <th className="px-3 py-2 text-right font-medium">Dividend</th>
                              <th className="px-3 py-2 text-right font-medium">Annual</th>
                              <th className="px-3 py-2 text-right font-medium">Yield</th>
                              <th className="px-3 py-2 font-medium">Frequency</th>
                              <th className="px-3 py-2 font-medium">Record</th>
                              <th className="px-3 py-2 font-medium">Pay date</th>
                            </tr>
                          </thead>
                          <tbody>{shown.map((r) => <CalRow key={`${r.symbol}-${r.ex_date}-${r.amount}`} r={r} />)}</tbody>
                        </table>
                      </div>
                    )}
                    {!open && rows.length > PER_DAY_PREVIEW && (
                      <button type="button" onClick={() => c.setExpanded((e) => ({ ...e, [d]: true }))}
                        className="w-full border-t border-line-subtle py-2 text-xs font-medium text-indigo-600 hover:bg-surface-raised dark:text-indigo-400">
                        Show all {rows.length} (highest yield first)
                      </button>
                    )}
                  </section>
                )
              })}
            </div>
          )}
          <div className="mt-4"><CalendarNote /></div>
        </section>
      </div>
    </AppLayout>
  )
}
