'use client'

import Link from 'next/link'
import { AlertTriangle, Briefcase, ChevronLeft, ChevronRight, Coins, Loader2, LogIn } from 'lucide-react'
import TickerLogo from '@/components/TickerLogo'
import { dayLabel, weekRangeLabel } from '@/lib/calendarDates'
import { fmtMoney, fmtPerShare, fmtShortDate, fmtYield, STATUS_TEXT, type DividendRow } from '@/lib/dividends'
import {
  CalendarNote,
  IncomeChart,
  IncomeNote,
  PER_DAY_PREVIEW,
  SCOPES,
  useDividendsController,
  type DividendsController,
} from './DividendsParts'

function Income({ c }: { c: DividendsController }) {
  const d = c.incomeData
  if (c.authLoading) return null
  if (!c.isAuthenticated) {
    return (
      <div className="rounded-2xl border border-line-subtle bg-surface-raised p-4">
        <p className="text-sm font-semibold text-fg-primary">Projected dividend income</p>
        <p className="mt-1 text-xs text-fg-muted">Sign in and track a portfolio to see your next 12 months of dividends.</p>
        <Link href="/auth" className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-[#fff]"><LogIn className="h-4 w-4" /> Sign in</Link>
      </div>
    )
  }
  if (c.income.isLoading) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-fg-muted" /></div>
  if (c.income.error || !d) {
    return <div className="flex items-center gap-2 rounded-xl border border-line-subtle bg-surface-raised p-4 text-sm text-fg-secondary"><AlertTriangle className="h-4 w-4 text-amber-500" /> Could not load projected income.</div>
  }
  if (d.holding_count === 0) {
    return (
      <div className="rounded-2xl border border-line-subtle bg-surface-raised p-4">
        <p className="text-sm font-semibold text-fg-primary">Projected dividend income</p>
        <p className="mt-1 text-xs text-fg-muted">{d.has_tracked_portfolio || c.portfolioId ? 'This portfolio has no open holdings yet.' : 'Add your holdings to a tracked portfolio to project dividend income.'}</p>
        <Link href="/portfolio" className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line-default px-4 py-2 text-sm font-semibold text-fg-primary"><Briefcase className="h-4 w-4" /> Go to Portfolio</Link>
      </div>
    )
  }
  return (
    <section className="rounded-2xl border border-line-subtle bg-surface-raised p-4" aria-label="Projected dividend income">
      <p className="text-xs font-semibold uppercase tracking-wide text-fg-secondary">Next 12 months</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-fg-primary" data-testid="income-total">{fmtMoney(d.total_12m)}</p>
      <p className="text-[11px] text-fg-muted">≈ {fmtMoney(d.total_12m != null ? d.total_12m / 12 : null)}/mo · yield {fmtYield(d.portfolio_yield_pct)}</p>
      <select
        aria-label="Portfolio"
        className="mt-3 w-full rounded-lg border border-line-default bg-surface-base px-2.5 py-2 text-xs text-fg-primary"
        value={c.portfolioId ?? ''}
        onChange={(e) => c.setPortfolioId(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">All tracked portfolios</option>
        {d.portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}{p.kind === 'paper' ? ' (simulated)' : ''}</option>)}
      </select>
      <div className="mt-4"><IncomeChart data={d} compact /></div>
      <ul className="mt-4 space-y-2">
        {d.holdings.map((h) => (
          <li key={h.symbol} className="rounded-xl border border-line-subtle bg-surface-base p-3">
            <div className="flex items-center gap-2">
              <TickerLogo symbol={h.symbol} size={28} />
              <Link href={`/research?symbol=${encodeURIComponent(h.symbol)}`} className="min-w-0 flex-1">
                <span className="block font-semibold text-fg-primary">{h.symbol}</span>
                <span className="block truncate text-[11px] text-fg-muted">
                  {h.shares.toLocaleString('en-US', { maximumFractionDigits: 4 })} sh · {h.status === 'projected' ? h.frequency_label : STATUS_TEXT[h.status]}
                </span>
              </Link>
              <span className="text-right">
                <span className="block font-semibold tabular-nums text-fg-primary">{fmtMoney(h.projected_income)}</span>
                <span className="block text-[10px] text-fg-muted">12-mo</span>
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-[repeat(3,minmax(0,1fr))] gap-2 text-[11px]">
              <div><dt className="text-fg-muted">Per payment</dt><dd className="tabular-nums text-fg-primary">{fmtPerShare(h.amount_per_share)}</dd></div>
              <div><dt className="text-fg-muted">Yield</dt><dd className="tabular-nums text-fg-primary">{fmtYield(h.yield_pct)}</dd></div>
              <div><dt className="text-fg-muted">Next ex / pay</dt><dd className="text-fg-primary">{fmtShortDate(h.next_ex_date)} / {fmtShortDate(h.next_pay_date)}</dd></div>
            </dl>
          </li>
        ))}
      </ul>
      <div className="mt-3"><IncomeNote lag={d.assumptions?.pay_lag_days_default} /></div>
    </section>
  )
}

function Card({ r }: { r: DividendRow }) {
  return (
    <li className="rounded-xl border border-line-subtle bg-surface-raised p-3" data-testid="dividend-card">
      <div className="flex items-center gap-3">
        <TickerLogo symbol={r.symbol} size={30} />
        <Link href={`/research?symbol=${encodeURIComponent(r.symbol)}`} className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="font-semibold text-fg-primary">{r.symbol}</span>
            {r.in_portfolio && <span className="rounded bg-emerald-500/10 px-1 text-[9px] font-bold uppercase text-emerald-700 dark:text-emerald-400">Held</span>}
            {r.in_watchlist && <span className="rounded bg-indigo-500/10 px-1 text-[9px] font-bold uppercase text-indigo-600 dark:text-indigo-400">Watch</span>}
          </span>
          <span className="block truncate text-[11px] text-fg-muted">{r.name || '—'}</span>
        </Link>
        <span className="text-right">
          <span className="block font-semibold tabular-nums text-fg-primary">{fmtPerShare(r.amount)}</span>
          <span className="block text-[10px] text-fg-muted">{r.frequency_label || '—'}</span>
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-[repeat(3,minmax(0,1fr))] gap-2 text-[11px]">
        <div><dt className="text-fg-muted">Yield</dt><dd className="tabular-nums text-fg-primary">{fmtYield(r.yield_pct)}</dd></div>
        <div><dt className="text-fg-muted">Annual</dt><dd className="tabular-nums text-fg-primary">{fmtPerShare(r.annual_dividend)}</dd></div>
        <div><dt className="text-fg-muted">Pays</dt><dd className="text-fg-primary">{fmtShortDate(r.pay_date)}</dd></div>
      </dl>
    </li>
  )
}

export default function DividendsMobile() {
  const c = useDividendsController()
  const data = c.cal.data
  return (
    <div className="space-y-4 pt-3">
      <div className="flex items-center gap-2">
        <Coins className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        <h1 className="text-lg font-bold text-fg-primary">Dividends</h1>
      </div>

      <Income c={c} />

      <h2 className="pt-2 text-base font-semibold text-fg-primary">Ex-dividend calendar</h2>
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => c.shiftWeek(-1)} aria-label="Previous week" className="flex h-9 w-9 items-center justify-center rounded-full border border-line-subtle bg-surface-raised text-fg-secondary active:scale-95"><ChevronLeft className="h-4 w-4" /></button>
        <div className="text-center">
          <p className="text-sm font-semibold text-fg-primary" aria-live="polite">{weekRangeLabel(c.monday)}</p>
          <button type="button" onClick={c.goToday} className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400">Jump to today</button>
        </div>
        <button type="button" onClick={() => c.shiftWeek(1)} aria-label="Next week" className="flex h-9 w-9 items-center justify-center rounded-full border border-line-subtle bg-surface-raised text-fg-secondary active:scale-95"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide" role="tablist" aria-label="Day">
        <button type="button" role="tab" aria-selected={c.day === null} onClick={() => c.setDay(null)}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${c.day === null ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' : 'border-line-subtle bg-surface-raised text-fg-secondary'}`}>
          Week <span className="opacity-70">{c.calLoading ? '' : data?.total ?? 0}</span>
        </button>
        {c.days.map((d) => (
          <button key={d} type="button" role="tab" aria-selected={c.day === d} onClick={() => c.setDay(d)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${c.day === d ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' : 'border-line-subtle bg-surface-raised text-fg-secondary'}`}>
            {dayLabel(d).split(',')[0]}{d === c.today ? ' •' : ''} <span className="opacity-70">{c.calLoading ? '' : c.grouped[d]?.length ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide" role="radiogroup" aria-label="Stocks">
        {SCOPES.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={c.scope === o.id} disabled={o.needsAuth && !c.isAuthenticated} onClick={() => c.setScope(o.id)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${c.scope === o.id ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'border-line-subtle bg-surface-raised text-fg-secondary'}`}>
            {o.label}
          </button>
        ))}
      </div>

      {c.calError ? (
        <div className="flex items-center gap-2 rounded-xl border border-line-subtle bg-surface-raised p-4 text-sm text-fg-secondary"><AlertTriangle className="h-4 w-4 text-amber-500" /> Could not load the dividend calendar.</div>
      ) : c.calLoading ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-fg-muted" /></div>
      ) : data && !data.source_ok ? (
        <div className="flex items-center gap-2 rounded-xl border border-line-subtle bg-surface-raised p-4 text-sm text-fg-secondary"><AlertTriangle className="h-4 w-4 text-amber-500" /> Dividend calendar data is unavailable right now.</div>
      ) : (
        <div className="space-y-5">
          {c.visibleDays.map((d) => {
            const rows = c.grouped[d] ?? []
            const open = c.expanded[d]
            const shown = open ? rows : rows.slice(0, PER_DAY_PREVIEW)
            return (
              <section key={d} aria-label={`Ex-dividend ${dayLabel(d, 'long')}`}>
                <h3 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-fg-secondary">
                  <span>Ex {dayLabel(d, 'long')}{d === c.today ? ' · Today' : ''}</span>
                  <span className="font-normal normal-case text-fg-muted">{rows.length}</span>
                </h3>
                {rows.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-line-subtle py-4 text-center text-xs text-fg-muted">{c.scope !== 'all' ? 'None of your stocks.' : 'No ex-dividend dates.'}</p>
                ) : (
                  <ul className="space-y-2">{shown.map((r) => <Card key={`${r.symbol}-${r.ex_date}-${r.amount}`} r={r} />)}</ul>
                )}
                {!open && rows.length > PER_DAY_PREVIEW && (
                  <button type="button" onClick={() => c.setExpanded((e) => ({ ...e, [d]: true }))} className="mt-2 w-full rounded-lg border border-line-subtle py-2 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                    Show all {rows.length}
                  </button>
                )}
              </section>
            )
          })}
        </div>
      )}
      <CalendarNote />
    </div>
  )
}
