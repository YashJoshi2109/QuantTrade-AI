'use client'

/**
 * Shared by DividendsDesktop and DividendsMobile: page controller (calendar week/day/
 * scope + income portfolio) and the pieces both layouts render (income chart, notes).
 */
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { addDays, parseDay, todayNY, weekDays, weekStart } from '@/lib/calendarDates'
import {
  barFractions,
  fmtMoney,
  groupByExDate,
  monthLabel,
  sortDividendRows,
  SORT_OPTIONS,
  summarize,
  useDividendCalendar,
  useDividendIncome,
  type DividendScope,
  type DividendSortKey,
  type IncomeResponse,
  type SortDir,
} from '@/lib/dividends'

export const PER_DAY_PREVIEW = 25

export const SCOPES: { id: DividendScope; label: string; needsAuth: boolean }[] = [
  { id: 'all', label: 'All stocks', needsAuth: false },
  { id: 'watchlist', label: 'My watchlist', needsAuth: true },
  { id: 'portfolio', label: 'My portfolio', needsAuth: true },
]

export function useDividendsController() {
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const [monday, setMonday] = useState(() => weekStart(todayNY()))
  const [day, setDay] = useState<string | null>(null)
  const [scope, setScope] = useState<DividendScope>('all')
  const [portfolioId, setPortfolioId] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [sort, setSortState] = useState<{ key: DividendSortKey; dir: SortDir }>({ key: 'yield', dir: 'desc' })
  /** Same key again flips direction; a new key starts at its natural direction. */
  const setSort = (key: DividendSortKey) =>
    setSortState((cur) =>
      cur.key === key
        ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: SORT_OPTIONS.find((o) => o.key === key)?.defaultDir ?? 'desc' })

  useEffect(() => {
    if (!authLoading && !isAuthenticated && scope !== 'all') setScope('all')
  }, [authLoading, isAuthenticated, scope])

  const days = useMemo(() => weekDays(monday), [monday])
  const cal = useDividendCalendar(monday, addDays(monday, 6), scope, !authLoading)
  const income = useDividendIncome(portfolioId, isAuthenticated && !authLoading)
  const today = cal.data?.today || todayNY()

  const grouped = useMemo(() => {
    const g = groupByExDate(cal.data?.rows ?? [], days)
    for (const k of Object.keys(g)) g[k] = sortDividendRows(g[k], sort.key, sort.dir)
    return g
  }, [cal.data, days, sort])

  const summary = useMemo(() => {
    const inView = day ? (grouped[day] ?? []) : days.flatMap((d) => grouped[d] ?? [])
    return summarize(inView)
  }, [grouped, day, days])

  return {
    isAuthenticated, authLoading,
    cal, calLoading: cal.isLoading || authLoading, calError: cal.error as Error | null,
    income, incomeData: income.data as IncomeResponse | undefined,
    today, monday, days, day, setDay, visibleDays: day ? [day] : days, grouped,
    sort, setSort, summary,
    scope, setScope, portfolioId, setPortfolioId, expanded, setExpanded,
    isThisWeek: monday === weekStart(today),
    shiftWeek: (n: number) => { setMonday((m) => addDays(m, 7 * n)); setDay(null); setExpanded({}) },
    goToday: () => {
      setMonday(weekStart(today))
      const dow = parseDay(today).getUTCDay()
      setDay(dow >= 1 && dow <= 5 ? today : null)
      setExpanded({})
    },
  }
}

export type DividendsController = ReturnType<typeof useDividendsController>

/** 12 monthly bars. Values are labelled; an empty month shows "—" (nothing projected), not $0. */
export function IncomeChart({ data, compact = false }: { data: IncomeResponse; compact?: boolean }) {
  const fr = barFractions(data.months.map((m) => m.total))
  const h = compact ? 120 : 160
  return (
    <figure aria-label="Projected dividend income by month">
      <div className="grid grid-cols-[repeat(12,minmax(0,1fr))] items-end gap-1.5" style={{ height: h + 36 }}>
        {data.months.map((m, i) => {
          const syms = Array.from(new Set(m.payments.map((p) => p.symbol)))
          const title = `${monthLabel(m.month, 'long')}: ${m.total > 0 ? fmtMoney(m.total) : 'nothing projected'}${syms.length ? ` (${syms.join(', ')})` : ''}`
          return (
            <div key={m.month} className="flex h-full flex-col items-center justify-end" title={title}>
              <span className={`mb-1 tabular-nums text-fg-secondary ${compact ? 'text-[8px]' : 'text-[10px]'}`}>
                {m.total > 0 ? (compact ? `$${Math.round(m.total)}` : fmtMoney(m.total, 0)) : '—'}
              </span>
              <div
                className="w-full rounded-t-md bg-sky-500/70 dark:bg-sky-400/70"
                style={{ height: Math.max(fr[i] * h, m.total > 0 ? 3 : 0) }}
                data-testid="income-bar"
              />
              <span className={`mt-1 text-fg-muted ${compact ? 'text-[9px]' : 'text-[11px]'}`}>{monthLabel(m.month)}</span>
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

export function IncomeNote({ lag }: { lag?: number }) {
  return (
    <p className="text-[11px] leading-relaxed text-fg-muted">
      Projection, not a promise: current shares in your tracked portfolio(s) times the latest regular
      dividend per share, repeated at the company’s historical frequency, with no dividend growth or cuts
      assumed. Announced ex/pay dates are used when known; other pay dates are estimated (ex-date + the
      announced lag, else {lag ?? 21} days). Special one-off dividends are not projected. Sources: yfinance
      dividend history, Nasdaq dividend calendar.
    </p>
  )
}

export function CalendarNote() {
  return (
    <p className="text-[11px] leading-relaxed text-fg-muted">
      <strong className="font-semibold text-fg-secondary">Ex-date</strong>: you must own the shares before
      this day (buy by the prior trading day’s close) to receive the payment.{' '}
      <strong className="font-semibold text-fg-secondary">Record</strong>: the company’s shareholder-of-record date.{' '}
      <strong className="font-semibold text-fg-secondary">Pay</strong>: when cash is paid.{' '}
      <strong className="font-semibold text-fg-secondary">Fwd yield</strong> = indicated (forward) annual
      dividend ÷ last price (our stored price, else the latest daily close); not trailing-12-month (TTM).
      “—” when either input is unknown. Frequency is inferred from annual ÷ per-payment amount. Sources:
      Nasdaq dividend calendar, yfinance. Not investment advice.
    </p>
  )
}

