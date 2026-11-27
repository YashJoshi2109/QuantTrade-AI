'use client'

/**
 * Shared by DividendsDesktop and DividendsMobile: the page controller (week, day,
 * scope, filters, sort and selected row, persisted per user) and every piece both
 * layouts render: income card, stat cards, day cards, snapshot, history chart, notes.
 * All numbers come from /api/v1/dividends; unknown values render "—" with a reason.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { BellPlus, Briefcase, CalendarClock, CircleDollarSign, Coins, ExternalLink, Gauge, LogIn, Percent, Wallet } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import TickerLogo from '@/components/TickerLogo'
import { Skeleton } from '@/components/Skeleton'
import { addDays, dayFractions, dayLabel, parseDay, todayNY, weekDays, weekRangeLabel, weekStart } from '@/lib/calendarDates'
import { downloadCsv, toCsv } from '@/lib/csv'
import { isStr, objectOf, oneOf, usePersistentState } from '@/lib/persistentState'
import {
  DIVIDEND_CSV_HEADERS,
  FREQ_IDS,
  SORT_KEYS,
  SORT_OPTIONS,
  STATUS_TEXT,
  barFractions,
  daysUntil,
  dividendRowKey,
  dividendsCsv,
  filterDividendRows,
  fmtMoney,
  fmtPerShare,
  fmtShortDate,
  fmtYield,
  groupByExDate,
  historyBars,
  monthLabel,
  paymentTimeline,
  relDays,
  sortDividendRows,
  summarize,
  useDividendCalendar,
  useDividendHistory,
  useDividendIncome,
  type DividendRow,
  type DividendScope,
  type DividendSortKey,
  type FreqFilter,
  type IncomeResponse,
  type SortDir,
} from '@/lib/dividends'
import { Dash, GlassCard, MemberTags, StatCard, StateBox, ghostBtn, primaryBtn, type DayCardItem } from '@/components/calendar/CalendarKit'

export const PAGE = 100
export const SUBTITLE = 'Track ex-dividend events, distributions and portfolio income'

export const SCOPES: { id: DividendScope; label: string; needsAuth: boolean }[] = [
  { id: 'all', label: 'All stocks', needsAuth: false },
  { id: 'watchlist', label: 'My watchlist', needsAuth: true },
  { id: 'portfolio', label: 'My portfolio', needsAuth: true },
]

export const YIELD_TITLE =
  'Forward (indicated) yield = indicated annual dividend ÷ last price. Not trailing-12-month (TTM). An estimate: it assumes the current rate continues.'

export const REASON = {
  price: 'No recent price for this symbol (not in our database and no recent daily close)',
  yield: 'Needs both an indicated annual dividend and a price, consistent with the per-payment amount',
  annual: 'The source did not publish an indicated annual dividend',
  record: 'Record date not published by the source',
  pay: 'Pay date not announced yet',
  frequency: 'Frequency could not be inferred from the indicated annual ÷ per-payment amount',
  amount: 'Per-share amount not published by the source',
}

// ── persisted view state ─────────────────────────────────────────────────────

interface Prefs { scope: DividendScope; freq: FreqFilter; sort: { key: DividendSortKey; dir: SortDir }; portfolioId: number | null }
interface Cursor { monday: string; day: string | null; selected: string; q: string }

const PREFS_DEFAULT: Prefs = { scope: 'all', freq: 'all', sort: { key: 'yield', dir: 'desc' }, portfolioId: null }
const CURSOR_DEFAULT: Cursor = { monday: '', day: null, selected: '', q: '' }
const isDay = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(parseDay(v).getTime()) ? v : undefined)

const validatePrefs = objectOf<Prefs>(PREFS_DEFAULT, {
  scope: oneOf(['all', 'watchlist', 'portfolio'] as const),
  freq: oneOf(FREQ_IDS),
  sort: (v) => {
    const s = v as { key?: unknown; dir?: unknown } | null
    const key = oneOf(SORT_KEYS)(s?.key)
    const dir = oneOf(['asc', 'desc'] as const)(s?.dir)
    return key && dir ? { key, dir } : undefined
  },
  portfolioId: (v) => (v === null || (typeof v === 'number' && Number.isInteger(v) && v > 0) ? (v as number | null) : undefined),
})
const validateCursor = objectOf<Cursor>(CURSOR_DEFAULT, {
  monday: (v) => (v === '' ? '' : isDay(v)),
  day: (v) => (v === null ? null : isDay(v)),
  selected: isStr,
  q: (v) => (typeof v === 'string' ? v.slice(0, 60) : undefined),
})

export function useDividendsController() {
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const [prefs, setPrefs] = usePersistentState<Prefs>('dividends.prefs', PREFS_DEFAULT, { version: 1, validate: validatePrefs })
  // Week / day / selection are a "where was I" cursor: kept for a day, then back to this week.
  const [cursor, setCursor] = usePersistentState<Cursor>('dividends.cursor', CURSOR_DEFAULT, {
    version: 1, validate: validateCursor, maxAgeMs: 24 * 3600_000,
  })
  const [limit, setLimit] = useState(PAGE)

  const scope: DividendScope = !authLoading && !isAuthenticated ? 'all' : prefs.scope
  const thisMonday = weekStart(todayNY())
  const monday = cursor.monday || thisMonday
  const days = useMemo(() => weekDays(monday), [monday])

  const cal = useDividendCalendar(monday, addDays(monday, 6), scope, !authLoading)
  const income = useDividendIncome(prefs.portfolioId, isAuthenticated && !authLoading)
  const today = cal.data?.today || todayNY()

  const weekRows = useMemo(() => cal.data?.rows ?? [], [cal.data])
  const filtered = useMemo(() => filterDividendRows(weekRows, { freq: prefs.freq, q: cursor.q }), [weekRows, prefs.freq, cursor.q])
  const grouped = useMemo(() => groupByExDate(filtered, days), [filtered, days])
  const day = cursor.day && days.includes(cursor.day) ? cursor.day : null
  const visible = useMemo(
    () => sortDividendRows(day ? grouped[day] ?? [] : filtered, prefs.sort.key, prefs.sort.dir),
    [day, grouped, filtered, prefs.sort],
  )
  const selected = useMemo(() => visible.find((r) => dividendRowKey(r) === cursor.selected) ?? null, [visible, cursor.selected])

  const counts = days.map((d) => grouped[d]?.length ?? 0)
  const fr = dayFractions(counts)
  const dayItems: DayCardItem[] = [
    { id: null, title: 'Whole week', subtitle: weekRangeLabel(monday), count: filtered.length, frac: filtered.length ? 1 : 0 },
    ...days.map((d, i) => {
      const [wd, ...rest] = dayLabel(d).split(' ')
      return { id: d, title: wd.replace(',', ''), subtitle: rest.join(' '), count: counts[i], frac: fr[i], isToday: d === today }
    }),
  ]

  useEffect(() => setLimit(PAGE), [monday, day, scope, prefs.freq, cursor.q, prefs.sort])

  const patch = (p: Partial<Cursor>) => setCursor((c) => ({ ...c, ...p }))
  const setSort = (key: DividendSortKey) =>
    setPrefs((p) => ({
      ...p,
      sort: p.sort.key === key
        ? { key, dir: p.sort.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: SORT_OPTIONS.find((o) => o.key === key)?.defaultDir ?? 'desc' },
    }))

  return {
    isAuthenticated, authLoading,
    cal, calLoading: cal.isLoading || authLoading, calError: cal.error as Error | null,
    income, incomeData: income.data as IncomeResponse | undefined,
    today, monday, days, day, dayItems,
    weekRows, filtered, visible, shown: visible.slice(0, limit), more: Math.max(0, visible.length - limit),
    showMore: () => setLimit((l) => l + PAGE),
    selected, summary: useMemo(() => summarize(weekRows), [weekRows]),
    scope, freq: prefs.freq, q: cursor.q, sort: prefs.sort, portfolioId: prefs.portfolioId,
    setScope: (s: DividendScope) => setPrefs((p) => ({ ...p, scope: s })),
    setFreq: (f: FreqFilter) => setPrefs((p) => ({ ...p, freq: f })),
    setPortfolioId: (id: number | null) => setPrefs((p) => ({ ...p, portfolioId: id })),
    setQ: (q: string) => patch({ q }),
    setSort,
    setDay: (d: string | null) => patch({ day: d }),
    select: (r: DividendRow | null) => patch({ selected: r ? dividendRowKey(r) : '' }),
    isThisWeek: monday === weekStart(today),
    shiftWeek: (n: number) => patch({ monday: addDays(monday, 7 * n), day: null }),
    goToday: () => {
      const dow = parseDay(today).getUTCDay()
      patch({ monday: '', day: dow >= 1 && dow <= 5 ? today : null })
    },
    filtersActive: prefs.freq !== 'all' || !!cursor.q.trim(),
    clearFilters: () => { setPrefs((p) => ({ ...p, freq: 'all' })); patch({ q: '' }) },
    exportCsv: () => downloadCsv(`ex-dividends_${day ?? monday}.csv`, toCsv(DIVIDEND_CSV_HEADERS, dividendsCsv(visible))),
  }
}

export type DividendsController = ReturnType<typeof useDividendsController>

// ── cells ────────────────────────────────────────────────────────────────────

export const cell = {
  amount: (r: DividendRow) => (r.amount != null ? fmtPerShare(r.amount) : <Dash reason={REASON.amount} />),
  annual: (r: DividendRow) => (r.annual_dividend != null ? fmtPerShare(r.annual_dividend) : <Dash reason={REASON.annual} />),
  price: (r: DividendRow) => (r.price != null
    ? <span title={r.price_source === 'last_close' ? 'Latest daily close (yfinance)' : 'Last stored price'}>{fmtMoney(r.price)}</span>
    : <Dash reason={REASON.price} />),
  yield: (r: DividendRow) => (r.yield_pct != null ? fmtYield(r.yield_pct) : <Dash reason={REASON.yield} />),
  freq: (r: DividendRow) => r.frequency_label ?? <Dash reason={REASON.frequency} />,
  record: (r: DividendRow) => (r.record_date ? fmtShortDate(r.record_date) : <Dash reason={REASON.record} />),
  pay: (r: DividendRow) => (r.pay_date ? fmtShortDate(r.pay_date) : <Dash reason={REASON.pay} />),
}

export function CompanyCell({ r, size = 32, prefix }: { r: DividendRow; size?: number; prefix?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="cal-inset flex shrink-0 items-center justify-center rounded-xl border border-line-subtle p-1">
        <TickerLogo symbol={r.symbol} companyName={r.name} size={size - 8} />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="font-semibold text-fg-primary">{r.symbol}</span>
          <MemberTags watch={r.in_watchlist} held={r.in_portfolio} />
        </span>
        <span className="block max-w-[120px] truncate text-[11px] text-fg-muted" title={r.name || undefined}>{prefix && <span className="font-semibold text-fg-secondary">{prefix} · </span>}{r.name || '—'}</span>
      </span>
    </span>
  )
}

export function AlertBell({ symbol }: { symbol: string }) {
  return (
    <Link prefetch={false}
      href={`/alerts?symbol=${encodeURIComponent(symbol)}`}
      onClick={(e) => e.stopPropagation()}
      title={`Set a price alert for ${symbol}`}
      aria-label={`Set a price alert for ${symbol}`}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400"
    >
      <BellPlus className="h-4 w-4" />
    </Link>
  )
}

// ── stat cards ───────────────────────────────────────────────────────────────

export function DividendStats({ c, compact = false }: { c: DividendsController; compact?: boolean }) {
  const s = c.summary
  const loading = c.calLoading
  const noData = !!c.calError || (c.cal.data && !c.cal.data.source_ok)
  const todayN = c.weekRows.filter((r) => r.ex_date === c.today).length
  const inc = c.incomeData
  const icon = (n: ReactNode) => <span className={compact ? '[&>svg]:h-3.5 [&>svg]:w-3.5' : '[&>svg]:h-4 [&>svg]:w-4'}>{n}</span>
  return (
    <>
      <StatCard compact={compact} tone="sky" label="Going ex-dividend" icon={icon(<CalendarClock />)} loading={loading}
        value={noData ? null : s.total} reason="Dividend calendar unavailable"
        sub={noData ? 'Calendar unavailable' : c.isThisWeek ? `this week · ${todayN} today` : `week of ${fmtShortDate(c.monday)}`} />
      <StatCard compact={compact} tone="emerald" label={compact ? 'Top indicated yield' : 'Highest indicated yield'} icon={icon(<Percent />)} loading={loading}
        value={s.top?.yield_pct ?? null} format={(n) => `${n.toFixed(2)}%`}
        reason="No row this week has both an indicated annual dividend and a price"
        sub={s.top ? <span title={YIELD_TITLE}><Link prefetch={false} href={`/research?symbol=${encodeURIComponent(s.top.symbol)}`} className="font-semibold text-fg-secondary hover:underline">{s.top.symbol}</Link> · Nasdaq indicated ÷ last price</span> : 'No priced rows'} />
      <StatCard compact={compact} tone="indigo" label="Yield coverage" icon={icon(<Gauge />)} loading={loading}
        value={noData ? null : s.withYield} reason="Dividend calendar unavailable"
        bar={s.total ? s.withYield / s.total : 0}
        sub={s.total ? `of ${s.total.toLocaleString('en-US')} rows have price data` : 'No rows this week'} />
      {c.authLoading ? (
        <StatCard compact={compact} tone="violet" label="Your income" loading value={null} />
      ) : !c.isAuthenticated ? (
        <StatCard compact={compact} tone="violet" label="Your income" icon={icon(<Wallet />)} sub="Projected from your holdings">
          <Link href="/auth" className={`font-semibold text-indigo-600 hover:underline dark:text-indigo-400 ${compact ? 'text-xs' : 'text-sm'}`}>Sign in to connect holdings</Link>
        </StatCard>
      ) : (
        <StatCard compact={compact} tone="violet" label="Your income · 12 mo" icon={icon(<Wallet />)} loading={c.income.isLoading}
          value={inc?.total_12m ?? null} format={(n) => fmtMoney(n, n >= 1000 ? 0 : 2)}
          reason={c.income.error ? 'Could not load projected income' : inc?.holding_count === 0 ? 'No holdings in a tracked portfolio' : 'None of your holdings has a projectable regular dividend'}
          sub={c.income.error ? 'Projection unavailable' : inc ? (inc.holding_count ? `${inc.holding_count} holding${inc.holding_count === 1 ? '' : 's'} · projected` : 'Add holdings to a tracked portfolio') : ''} />
      )}
    </>
  )
}

// ── projected income ─────────────────────────────────────────────────────────

/** 12 monthly bars with values; an empty month is "—" (nothing projected), not $0. */
export function IncomeChart({ data, compact = false }: { data: IncomeResponse; compact?: boolean }) {
  const fr = barFractions(data.months.map((m) => m.total))
  const h = compact ? 110 : 150
  const thisMonth = data.today.slice(0, 7)
  return (
    <figure aria-label="Projected dividend income by month">
      <div className="grid grid-cols-[repeat(12,minmax(0,1fr))] items-end gap-1 sm:gap-2" style={{ height: h + 34 }}>
        {data.months.map((m, i) => {
          const syms = Array.from(new Set(m.payments.map((p) => p.symbol)))
          const est = m.payments.some((p) => p.estimated)
          const title = `${monthLabel(m.month, 'long')}: ${m.total > 0 ? fmtMoney(m.total) : 'nothing projected'}${syms.length ? ` (${syms.join(', ')})` : ''}${est ? ' · includes estimated pay dates' : ''}`
          return (
            <div key={m.month} className="group flex h-full min-w-0 flex-col items-center justify-end" title={title}>
              <span className={`mb-1 truncate tabular-nums text-fg-secondary ${compact ? 'text-[8px]' : 'text-[10px]'}`}>
                {m.total > 0 ? (compact ? `$${Math.round(m.total)}` : fmtMoney(m.total, 0)) : '—'}
              </span>
              <div
                className={`cal-grow-y w-full rounded-t-md bg-gradient-to-t from-sky-600/80 to-sky-400/80 transition-opacity group-hover:opacity-100 dark:from-sky-500/70 dark:to-cyan-300/70 ${m.month === thisMonth ? 'opacity-100' : 'opacity-85'}`}
                style={{ height: Math.max(fr[i] * h, m.total > 0 ? 3 : 0), ['--i' as string]: i }}
                data-testid="income-bar"
              />
              <span className={`mt-1 ${m.month === thisMonth ? 'font-semibold text-fg-primary' : 'text-fg-muted'} ${compact ? 'text-[9px]' : 'text-[11px]'}`}>{monthLabel(m.month)}</span>
            </div>
          )
        })}
      </div>
      <figcaption className="sr-only">
        {data.months.map((m) => `${monthLabel(m.month, 'long')} ${m.total > 0 ? fmtMoney(m.total) : 'none'}`).join('; ')}
      </figcaption>
    </figure>
  )
}

export const PROJECTION_TEXT =
  'Projected: current shares in your tracked portfolio(s) × the latest regular dividend per share, repeated at the company’s historical frequency. No growth or cuts assumed; specials are not projected.'

export function IncomeNote({ lag }: { lag?: number }) {
  return (
    <p className="text-[11px] leading-relaxed text-fg-muted">
      {PROJECTION_TEXT} Announced ex/pay dates are used when known; other pay dates are estimated (ex-date + the
      announced lag, else {lag ?? 21} days). Watchlist symbols have no share count, so they are not projected.
      Sources: yfinance dividend history, Nasdaq dividend calendar. Not a promise of future income.
    </p>
  )
}

function nextPayment(d: IncomeResponse) {
  const all = d.months.flatMap((m) => m.payments).filter((p) => p.pay_date >= d.today)
  all.sort((a, b) => a.pay_date.localeCompare(b.pay_date))
  return all[0] ?? null
}

export function IncomeCard({ c, compact = false }: { c: DividendsController; compact?: boolean }) {
  const d = c.incomeData
  const pad = compact ? 'p-4' : 'p-5'
  const head = (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-600 dark:text-sky-400">Portfolio income</p>
      <h2 className={`font-semibold text-fg-primary ${compact ? 'text-sm' : 'text-base'}`}>Projected dividend income</h2>
    </div>
  )
  if (c.authLoading || (c.isAuthenticated && c.income.isLoading)) {
    return (
      <GlassCard as="section" tone="sky" accent glow className={pad} aria-label="Loading projected income">
        {head}
        <div className="mt-3 flex items-end gap-2" style={{ height: compact ? 130 : 170 }}>
          {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="flex-1 rounded-t-md" height={`${30 + ((i * 37) % 60)}%`} />)}
        </div>
      </GlassCard>
    )
  }
  if (!c.isAuthenticated) {
    return (
      <GlassCard as="section" tone="sky" accent glow className={`${pad} flex flex-wrap items-center justify-between gap-4`}>
        <div>
          {head}
          <p className="mt-1 max-w-xl text-sm text-fg-muted">Sign in and track a portfolio to see your next 12 months of dividend cash flow, month by month, from your real holdings.</p>
        </div>
        <Link href="/auth" className={primaryBtn}><LogIn className="h-4 w-4" /> Sign in</Link>
      </GlassCard>
    )
  }
  if (c.income.error || !d) {
    return (
      <GlassCard as="section" tone="sky" className={pad}>
        {head}
        <StateBox tone="warn" title="Could not load projected income" body={(c.income.error as Error | null)?.message}
          actions={<button type="button" className={ghostBtn} onClick={() => c.income.refetch()}>Retry</button>} />
      </GlassCard>
    )
  }
  if (d.holding_count === 0) {
    return (
      <GlassCard as="section" tone="sky" accent className={`${pad} flex flex-wrap items-center justify-between gap-4`}>
        <div>
          {head}
          <p className="mt-1 text-sm text-fg-muted">
            {d.has_tracked_portfolio || c.portfolioId ? 'This portfolio has no open holdings yet.' : 'Add your holdings to a tracked portfolio to project dividend income.'}
          </p>
        </div>
        <Link href="/portfolio" className={ghostBtn}><Briefcase className="h-4 w-4" /> Go to Portfolio</Link>
      </GlassCard>
    )
  }
  const nxt = nextPayment(d)
  const projected = d.holdings.filter((h) => h.status === 'projected').length
  return (
    <GlassCard as="section" tone="sky" accent glow className={pad} aria-label="Projected dividend income">
      <div className="relative z-[1] mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          {head}
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className={`font-bold tabular-nums text-fg-primary ${compact ? 'text-2xl' : 'text-3xl'}`} data-testid="income-total">{fmtMoney(d.total_12m)}</span>
            <span className="text-xs tabular-nums text-fg-muted">
              next 12 months · ≈ {fmtMoney(d.total_12m != null ? d.total_12m / 12 : null)}/mo · <span title={YIELD_TITLE}>fwd yield</span>{' '}
              {d.portfolio_yield_pct != null ? fmtYield(d.portfolio_yield_pct) : <Dash reason="Needs a price for every holding" />}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-fg-muted">
            {projected} of {d.holding_count} holding{d.holding_count === 1 ? '' : 's'} projected
            {nxt && <> · next payment <span className="font-semibold text-fg-secondary">{nxt.symbol} {fmtMoney(nxt.income)}</span> on {fmtShortDate(nxt.pay_date)}{nxt.estimated ? ' (est.)' : ''}</>}
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-fg-secondary">
          Portfolio
          <select
            className="cal-solid h-8 rounded-lg border border-line-default px-2 text-sm text-fg-primary"
            value={c.portfolioId ?? ''}
            onChange={(e) => c.setPortfolioId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">All tracked portfolios</option>
            {d.portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}{p.kind === 'paper' ? ' (simulated)' : ''}</option>)}
          </select>
        </label>
      </div>
      <div className="relative z-[1]"><IncomeChart data={d} compact={compact} /></div>
      <details className="relative z-[1] mt-4 group">
        <summary className="cursor-pointer select-none text-xs font-semibold text-indigo-600 dark:text-indigo-400">Holdings breakdown ({d.holdings.length})</summary>
        <ul className="mt-2 divide-y divide-line-subtle text-sm">
          {d.holdings.map((h) => (
            <li key={h.symbol} className="flex items-center justify-between gap-3 py-2">
              <Link prefetch={false} href={`/research?symbol=${encodeURIComponent(h.symbol)}`} className="flex min-w-0 items-center gap-2">
                <TickerLogo symbol={h.symbol} companyName={h.name} size={22} />
                <span className="min-w-0">
                  <span className="block font-semibold text-fg-primary">{h.symbol} <span className="text-[11px] font-normal text-fg-muted">{h.shares.toLocaleString('en-US', { maximumFractionDigits: 4 })} sh</span></span>
                  <span className="block truncate text-[11px] text-fg-muted">
                    {h.status === 'projected' ? `${h.frequency_label} · ${fmtPerShare(h.amount_per_share)}/payment · next pay ${fmtShortDate(h.next_pay_date)}` : <span title={h.note || undefined}>{STATUS_TEXT[h.status]}</span>}
                  </span>
                </span>
              </Link>
              <span className="shrink-0 text-right font-semibold tabular-nums text-fg-primary">
                {h.projected_income != null ? fmtMoney(h.projected_income) : <Dash reason={h.note || STATUS_TEXT[h.status]} />}
              </span>
            </li>
          ))}
        </ul>
      </details>
      <div className="relative z-[1] mt-3"><IncomeNote lag={d.assumptions?.pay_lag_days_default} /></div>
    </GlassCard>
  )
}

// ── snapshot ─────────────────────────────────────────────────────────────────

export function PaymentTimeline({ r, today }: { r: DividendRow; today: string }) {
  const steps = paymentTimeline(r, today)
  return (
    <ol className="relative space-y-3 pl-5" aria-label="Payment timeline">
      <span className="absolute bottom-2 left-[5px] top-2 w-px bg-line-default" aria-hidden />
      {steps.map((s) => {
        const dot =
          s.state === 'past' ? 'bg-emerald-500 border-emerald-500'
            : s.state === 'today' ? 'bg-amber-500 border-amber-500 ring-4 ring-amber-500/20'
              : s.state === 'future' ? 'cal-solid border-sky-500'
                : 'cal-solid border-line-strong border-dashed'
        const rel = relDays(daysUntil(s.date, today))
        return (
          <li key={s.id} className="relative flex items-baseline justify-between gap-2 text-sm">
            <span className={`absolute -left-5 top-1 h-[11px] w-[11px] rounded-full border-2 ${dot}`} aria-hidden />
            <span className="text-fg-secondary">{s.label}</span>
            <span className="tabular-nums text-fg-primary">
              {s.date ? fmtShortDate(s.date) : <Dash reason={s.id === 'pay' ? REASON.pay : REASON.record} />}
              {rel && <span className="ml-1.5 text-[11px] text-fg-muted">{rel}</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export function HistoryChart({ symbol }: { symbol: string }) {
  const q = useDividendHistory(symbol)
  const h = q.data
  const bars = historyBars(h, 12)
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-fg-secondary">Dividend history</p>
        {h?.ttm_total != null && <p className="text-[11px] tabular-nums text-fg-muted" title="Sum of cash dividends with an ex-date in the last 365 days">TTM {fmtPerShare(h.ttm_total)} · {h.ttm_count} paid</p>}
      </div>
      {q.isLoading ? (
        <div className="flex h-20 items-end gap-1">{Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="flex-1" height={`${40 + ((i * 23) % 50)}%`} />)}</div>
      ) : q.error || !h || !h.available ? (
        <p className="cal-inset rounded-xl px-3 py-4 text-center text-xs text-fg-muted">Dividend history is unavailable right now.</p>
      ) : bars.length === 0 ? (
        <p className="cal-inset rounded-xl px-3 py-4 text-center text-xs text-fg-muted">No cash dividends recorded in the last 3 years.</p>
      ) : (
        <figure aria-label={`${symbol} dividend per share, last ${bars.length} payments`}>
          <div className="flex h-20 items-end gap-1">
            {bars.map((b, i) => (
              <div key={b.ex_date} title={`Ex ${fmtShortDate(b.ex_date)} ${b.ex_date.slice(0, 4)}: ${fmtPerShare(b.amount)}`}
                className="cal-grow-y flex-1 rounded-t bg-gradient-to-t from-emerald-600/80 to-emerald-400/80 hover:opacity-100 dark:from-emerald-500/70 dark:to-emerald-300/70"
                style={{ height: `${Math.max(4, b.frac * 100)}%`, ['--i' as string]: i }} />
            ))}
          </div>
          <figcaption className="mt-1 flex justify-between text-[10px] text-fg-muted">
            <span>{fmtShortDate(bars[0].ex_date)} {bars[0].ex_date.slice(0, 4)}</span>
            <span>per share · {h.frequency_label ?? 'irregular'} · yfinance</span>
            <span>{fmtShortDate(bars[bars.length - 1].ex_date)} {bars[bars.length - 1].ex_date.slice(0, 4)}</span>
          </figcaption>
        </figure>
      )}
    </div>
  )
}

export function DividendSnapshot({ r, today }: { r: DividendRow | null; today: string }) {
  if (!r) {
    return (
      <StateBox icon={<Coins className="h-7 w-7" />} title="Select a company" body="Pick a row to see its dividend, yield and payment timeline." />
    )
  }
  const kv = (label: string, v: ReactNode, title?: string) => (
    <div className="cal-inset min-w-0 rounded-xl px-3 py-2">
      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-fg-muted" title={title}>{label}</p>
      <p className="mt-0.5 truncate text-base font-semibold tabular-nums text-fg-primary">{v}</p>
    </div>
  )
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <CompanyCell r={r} size={40} />
        <Link prefetch={false} href={`/research?symbol=${encodeURIComponent(r.symbol)}`} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
          Research <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
      <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-2">
        {kv('Dividend / share', cell.amount(r))}
        {kv('Fwd yield', cell.yield(r), YIELD_TITLE)}
        {kv('Frequency', cell.freq(r))}
        {kv('Indicated annual', cell.annual(r))}
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold text-fg-secondary">Payment timeline</p>
        <PaymentTimeline r={r} today={today} />
      </div>
      <HistoryChart symbol={r.symbol} />
      <p className="flex gap-1.5 text-[11px] leading-relaxed text-fg-muted">
        <CircleDollarSign className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>Yield is an estimate: indicated annual dividend ÷ {r.price_source === 'last_close' ? 'latest daily close' : 'last stored price'} ({cell.price(r)}). Buy before the ex-date to receive this payment. Not investment advice.</span>
      </p>
    </div>
  )
}

export function CalendarNote() {
  return (
    <p className="text-[11px] leading-relaxed text-fg-muted">
      <strong className="font-semibold text-fg-secondary">Ex-date</strong>: own the shares before this day to receive the payment.{' '}
      <strong className="font-semibold text-fg-secondary">Record</strong>: shareholder-of-record date.{' '}
      <strong className="font-semibold text-fg-secondary">Pay</strong>: when cash is paid.{' '}
      <strong className="font-semibold text-fg-secondary">Fwd yield</strong> = indicated (forward) annual dividend ÷ last price
      (stored price, else latest daily close); not trailing-12-month (TTM). “—” = unknown (hover for why). Frequency is
      inferred from annual ÷ per-payment amount. Sources: Nasdaq dividend calendar, yfinance. Not investment advice.
    </p>
  )
}

export function emptyText(c: DividendsController): { title: string; body: string } {
  if (c.weekRows.length && c.filtersActive) return { title: 'No rows match these filters.', body: 'Clear the search or frequency filter.' }
  if (c.day) return { title: `No ex-dividend dates on ${dayLabel(c.day, 'long')}.`, body: 'Pick another day or the whole week.' }
  return c.scope === 'all'
    ? { title: 'No stocks go ex-dividend this week.', body: 'Try the next week.' }
    : { title: `None of your ${c.scope === 'watchlist' ? 'watchlist' : 'portfolio'} stocks go ex-dividend this week.`, body: 'Try the next week or switch to All stocks.' }
}

export function ErrorOrEmpty({ c }: { c: DividendsController }) {
  if (c.calError) {
    return <StateBox tone="warn" title="Could not load the dividend calendar" body={c.calError.message}
      actions={<button type="button" className={ghostBtn} onClick={() => c.cal.refetch()}>Retry</button>} />
  }
  if (c.cal.data && !c.cal.data.source_ok) {
    return <StateBox tone="warn" title="Dividend calendar data is unavailable right now" body="The Nasdaq dividend calendar did not answer. Try again shortly."
      actions={<button type="button" className={ghostBtn} onClick={() => c.cal.refetch()}>Retry</button>} />
  }
  const t = emptyText(c)
  return (
    <StateBox title={t.title} body={t.body} actions={
      <>
        {c.filtersActive && <button type="button" className={ghostBtn} onClick={c.clearFilters}>Clear filters</button>}
        {c.day && <button type="button" className={ghostBtn} onClick={() => c.setDay(null)}>Whole week</button>}
        <button type="button" className={ghostBtn} onClick={() => c.shiftWeek(1)}>Next week</button>
        {c.scope !== 'all' && <button type="button" className={ghostBtn} onClick={() => c.setScope('all')}>All stocks</button>}
      </>
    } />
  )
}

/** True when the table area should show ErrorOrEmpty instead of rows. */
export function showState(c: DividendsController): boolean {
  return !c.calLoading && (!!c.calError || !!(c.cal.data && !c.cal.data.source_ok) || c.visible.length === 0)
}
