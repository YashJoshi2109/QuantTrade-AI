'use client'

/**
 * Shared by EarningsDesktop and EarningsMobile: the page controller (week, day, scope,
 * filters, sort and selected row, persisted per user) and the pieces both layouts
 * render: stat cards, session chip, snapshot, EPS history chart, alert control, notes.
 * All numbers come from /api/v1/earnings; unknown values render "—" with a reason.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { BellPlus, BellRing, CalendarCheck2, CalendarDays, ExternalLink, Flame, Gauge, Loader2, LogIn, Timer } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/Toast'
import TickerLogo from '@/components/TickerLogo'
import { Skeleton } from '@/components/Skeleton'
import { downloadCsv, toCsv } from '@/lib/csv'
import { useAlertMutations, useAlerts } from '@/lib/alerts'
import { isStr, objectOf, oneOf, usePersistentState } from '@/lib/persistentState'
import { formatMarketCap } from '@/lib/valuation'
import {
  CAP_IDS,
  CAP_TIER_OPTIONS,
  EARNINGS_CSV_HEADERS,
  EARNINGS_SORT_KEYS,
  EARNINGS_SORT_OPTIONS,
  SCOPE_OPTIONS,
  SESSION_IDS,
  STATUS_IDS,
  SURPRISE_CLASS,
  addDays,
  compareBars,
  dayFractions,
  dayLabel,
  earningsCsv,
  earningsRowKey,
  earningsStats,
  filterEarningsRows,
  fmtEps,
  fmtRevenue,
  fmtSurprise,
  groupByDay,
  hourShort,
  hourTitle,
  parseDay,
  sortEarningsRows,
  surpriseTone,
  todayNY,
  useEarningsCalendar,
  useEpsHistory,
  weekDays,
  weekRangeLabel,
  weekStart,
  type CapTier,
  type EarningsHour,
  type EarningsRow,
  type EarningsScope,
  type EarningsSortKey,
  type EpsQuarter,
  type SessionFilter,
  type SortDir,
  type StatusFilter,
} from '@/lib/earnings'
import { Dash, GlassCard, MemberTags, MeterBar, StatCard, StateBox, ghostBtn, primaryBtn, selectCls, type DayCardItem } from '@/components/calendar/CalendarKit'

export const PAGE = 100
export const SUBTITLE = 'Scheduled and reported earnings: timing, EPS and revenue vs. consensus, and surprise'
export const scopeOptions = SCOPE_OPTIONS
export const capOptions = CAP_TIER_OPTIONS

export const REASON = {
  epsEst: 'No consensus EPS estimate from Finnhub or Nasdaq',
  revEst: 'No revenue estimate (Finnhub only; Nasdaq does not publish one)',
  surprise: 'Needs both an actual and an estimate',
  mcap: 'Market cap unknown',
  epsAct: (r: EarningsRow) => (r.status === 'upcoming' ? 'Not reported yet' : 'Actual not published by the sources yet'),
  revAct: (r: EarningsRow) => (r.status === 'upcoming' ? 'Not reported yet' : 'Revenue actual not published yet'),
}

// ── persisted view state ─────────────────────────────────────────────────────

interface Prefs { scope: EarningsScope; session: SessionFilter; status: StatusFilter; cap: CapTier | ''; sort: { key: EarningsSortKey; dir: SortDir } }
interface Cursor { monday: string; day: string | null; selected: string; q: string }

const PREFS_DEFAULT: Prefs = { scope: 'all', session: 'all', status: 'all', cap: '', sort: { key: 'market_cap', dir: 'desc' } }
const CURSOR_DEFAULT: Cursor = { monday: '', day: null, selected: '', q: '' }
const isDay = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(parseDay(v).getTime()) ? v : undefined)

const validatePrefs = objectOf<Prefs>(PREFS_DEFAULT, {
  scope: oneOf(['all', 'watchlist', 'portfolio'] as const),
  session: oneOf(SESSION_IDS),
  status: oneOf(STATUS_IDS),
  cap: (v) => (typeof v === 'string' && (CAP_IDS as string[]).includes(v) ? (v as CapTier | '') : undefined),
  sort: (v) => {
    const s = v as { key?: unknown; dir?: unknown } | null
    const key = oneOf(EARNINGS_SORT_KEYS)(s?.key)
    const dir = oneOf(['asc', 'desc'] as const)(s?.dir)
    return key && dir ? { key, dir } : undefined
  },
})
const validateCursor = objectOf<Cursor>(CURSOR_DEFAULT, {
  monday: (v) => (v === '' ? '' : isDay(v)),
  day: (v) => (v === null ? null : isDay(v)),
  selected: isStr,
  q: (v) => (typeof v === 'string' ? v.slice(0, 60) : undefined),
})

export function useEarningsController() {
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const [prefs, setPrefs] = usePersistentState<Prefs>('earnings.prefs', PREFS_DEFAULT, { version: 1, validate: validatePrefs })
  const [cursor, setCursor, { restored }] = usePersistentState<Cursor>('earnings.cursor', CURSOR_DEFAULT, {
    version: 1, validate: validateCursor, maxAgeMs: 24 * 3600_000,
  })
  const [limit, setLimit] = useState(PAGE)
  const patch = (p: Partial<Cursor>) => setCursor((c) => ({ ...c, ...p }))

  // /earnings?date=YYYY-MM-DD (Research badge link) opens that week with the day selected.
  useEffect(() => {
    if (!restored) return
    try {
      const d = new URLSearchParams(window.location.search).get('date')
      if (d && isDay(d)) patch({ monday: weekStart(d), day: d })
    } catch {
      /* no-op */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored])

  const scope: EarningsScope = !authLoading && !isAuthenticated ? 'all' : prefs.scope
  const monday = cursor.monday || weekStart(todayNY())
  const days = useMemo(() => weekDays(monday), [monday])
  const q = useEarningsCalendar({ start: monday, end: addDays(monday, 6), scope, cap: '', sector: '' }, !authLoading)
  const data = q.data
  const today = data?.today || todayNY()

  const weekRows = useMemo(() => data?.rows ?? [], [data])
  const filtered = useMemo(
    () => filterEarningsRows(weekRows, { session: prefs.session, status: prefs.status, cap: prefs.cap, q: cursor.q }),
    [weekRows, prefs.session, prefs.status, prefs.cap, cursor.q],
  )
  const grouped = useMemo(() => groupByDay(filtered, days), [filtered, days])
  const day = cursor.day && days.includes(cursor.day) ? cursor.day : null
  const visible = useMemo(
    () => sortEarningsRows(day ? grouped[day] ?? [] : filtered, prefs.sort.key, prefs.sort.dir),
    [day, grouped, filtered, prefs.sort],
  )
  const selected = useMemo(() => visible.find((r) => earningsRowKey(r) === cursor.selected) ?? null, [visible, cursor.selected])
  const stats = useMemo(() => earningsStats(weekRows, days, today), [weekRows, days, today])

  const counts = days.map((d) => grouped[d]?.length ?? 0)
  const fr = dayFractions(counts)
  const dayItems: DayCardItem[] = [
    { id: null, title: 'Whole week', subtitle: weekRangeLabel(monday), count: filtered.length, frac: filtered.length ? 1 : 0 },
    ...days.map((d, i) => {
      const [wd, ...rest] = dayLabel(d).split(' ')
      return { id: d, title: wd.replace(',', ''), subtitle: rest.join(' '), count: counts[i], frac: fr[i], isToday: d === today }
    }),
  ]

  useEffect(() => setLimit(PAGE), [monday, day, scope, prefs.session, prefs.status, prefs.cap, cursor.q, prefs.sort])

  const setSort = (key: EarningsSortKey) =>
    setPrefs((p) => ({
      ...p,
      sort: p.sort.key === key
        ? { key, dir: p.sort.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: EARNINGS_SORT_OPTIONS.find((o) => o.key === key)?.defaultDir ?? 'desc' },
    }))
  const filtersActive = prefs.session !== 'all' || prefs.status !== 'all' || !!prefs.cap || !!cursor.q.trim()

  return {
    isAuthenticated, authLoading,
    q, loading: q.isLoading || authLoading, fetching: q.isFetching, error: q.error as Error | null,
    data, today, monday, days, day, dayItems, stats,
    weekRows, filtered, visible, shown: visible.slice(0, limit), more: Math.max(0, visible.length - limit),
    showMore: () => setLimit((l) => l + PAGE),
    selected,
    scope, session: prefs.session, status: prefs.status, cap: prefs.cap, sort: prefs.sort, search: cursor.q,
    setScope: (s: EarningsScope) => setPrefs((p) => ({ ...p, scope: s })),
    setSession: (s: SessionFilter) => setPrefs((p) => ({ ...p, session: s })),
    setStatus: (s: StatusFilter) => setPrefs((p) => ({ ...p, status: s })),
    setCap: (cap: CapTier | '') => setPrefs((p) => ({ ...p, cap })),
    setSearch: (v: string) => patch({ q: v }),
    setSort,
    setDay: (d: string | null) => patch({ day: d }),
    select: (r: EarningsRow | null) => patch({ selected: r ? earningsRowKey(r) : '' }),
    isThisWeek: monday === weekStart(today),
    shiftWeek: (n: number) => patch({ monday: addDays(monday, 7 * n), day: null }),
    goToday: () => {
      const dow = parseDay(today).getUTCDay()
      patch({ monday: '', day: dow >= 1 && dow <= 5 ? today : null })
    },
    filtersActive,
    activeFilterCount: (prefs.session !== 'all' ? 1 : 0) + (prefs.status !== 'all' ? 1 : 0) + (prefs.cap ? 1 : 0),
    clearFilters: () => { setPrefs((p) => ({ ...p, session: 'all', status: 'all', cap: '' })); patch({ q: '' }) },
    exportCsv: () => downloadCsv(`earnings_${day ?? monday}.csv`, toCsv(EARNINGS_CSV_HEADERS, earningsCsv(visible))),
  }
}

export type EarningsController = ReturnType<typeof useEarningsController>

// ── small pieces ─────────────────────────────────────────────────────────────

export function HourPill({ hour, className = '' }: { hour: EarningsHour | null; className?: string }) {
  const tone =
    hour === 'bmo'
      ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
      : hour === 'amc'
        ? 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300'
        : hour === 'dmh'
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : 'border-line-default bg-slate-500/5 text-fg-muted'
  return (
    <span title={hourTitle(hour)} className={`inline-flex rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-bold ${tone} ${className}`}>
      {hour ? hourShort(hour) : 'TBD'}
    </span>
  )
}

export function Surprise({ v }: { v: number | null }) {
  if (v == null) return <Dash reason={REASON.surprise} />
  return <span className={`font-semibold ${SURPRISE_CLASS[surpriseTone(v)]}`}>{fmtSurprise(v)}</span>
}

export const ecell = {
  epsEst: (r: EarningsRow) => (r.eps_estimate != null ? fmtEps(r.eps_estimate) : <Dash reason={REASON.epsEst} />),
  epsAct: (r: EarningsRow) => (r.eps_actual != null ? fmtEps(r.eps_actual) : <Dash reason={REASON.epsAct(r)} />),
  revEst: (r: EarningsRow) => (r.revenue_estimate != null ? fmtRevenue(r.revenue_estimate) : <Dash reason={REASON.revEst} />),
  revAct: (r: EarningsRow) => (r.revenue_actual != null ? fmtRevenue(r.revenue_actual) : <Dash reason={REASON.revAct(r)} />),
  mcap: (r: EarningsRow) => (r.market_cap != null && r.market_cap > 0 ? formatMarketCap(r.market_cap) : <Dash reason={REASON.mcap} />),
}

export function CompanyCell({ r, size = 32, prefix }: { r: EarningsRow; size?: number; prefix?: string }) {
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

// ── stat cards ───────────────────────────────────────────────────────────────

export function EarningsStatCards({ c, compact = false }: { c: EarningsController; compact?: boolean }) {
  const s = c.stats
  const loading = c.loading
  const err = !!c.error
  const icon = (n: ReactNode) => <span className={compact ? '[&>svg]:h-3.5 [&>svg]:w-3.5' : '[&>svg]:h-4 [&>svg]:w-4'}>{n}</span>
  const todayRows = c.weekRows.filter((r) => r.date === c.today)
  const bmo = todayRows.filter((r) => r.hour === 'bmo').length
  const amc = todayRows.filter((r) => r.hour === 'amc').length
  const todayInWeek = c.days.includes(c.today)
  return (
    <>
      <StatCard compact={compact} tone="amber" label="This week" icon={icon(<CalendarDays />)} loading={loading}
        value={err ? null : s.total} reason="Earnings calendar unavailable"
        sub={err ? 'Calendar unavailable' : `scheduled reports · ${s.reported.toLocaleString('en-US')} reported`} />
      <StatCard compact={compact} tone="sky" label="Today" icon={icon(<Timer />)} loading={loading}
        value={err ? null : todayInWeek ? s.today : null} reason={todayInWeek ? 'Earnings calendar unavailable' : 'Today is not in the week shown'}
        sub={err ? 'Calendar unavailable' : todayInWeek ? (s.today ? `${bmo} BMO · ${amc} AMC` : 'No reports today') : `Week of ${dayLabel(c.monday)}`} />
      <StatCard compact={compact} tone="violet" label="Busiest day" icon={icon(<Flame />)} loading={loading}
        value={err ? null : s.busiest?.count ?? null} reason={err ? 'Earnings calendar unavailable' : 'No reports this week'}
        sub={err ? 'Calendar unavailable' : s.busiest ? dayLabel(s.busiest.day, 'long') : 'No reports this week'} />
      <StatCard compact={compact} tone="emerald" label="Earnings coverage" icon={icon(<Gauge />)} loading={loading}
        value={err || !s.total ? null : (s.withEstimate / s.total) * 100} format={(n) => `${Math.round(n)}%`}
        reason={err ? 'Earnings calendar unavailable' : 'No reports this week'}
        bar={s.total ? s.withEstimate / s.total : 0}
        sub={err ? 'Calendar unavailable' : s.total ? `${s.withEstimate.toLocaleString('en-US')} / ${s.total.toLocaleString('en-US')} with an EPS estimate` : ''} />
    </>
  )
}

// ── alert control (real POST /api/v1/alerts) ─────────────────────────────────

const ALERT_DAYS = [1, 3, 7, 14]

export function SetEarningsAlert({ symbol }: { symbol: string }) {
  const { isAuthenticated } = useAuth()
  const toast = useToast()
  const alerts = useAlerts(isAuthenticated)
  const { create } = useAlertMutations()
  const [days, setDays] = useState(3)
  if (!isAuthenticated) {
    return <Link href="/auth" className={`${ghostBtn} w-full justify-center`}><LogIn className="h-4 w-4" /> Sign in to set an earnings alert</Link>
  }
  const existing = alerts.data?.alerts.find((a) => a.symbol === symbol && a.condition === 'earnings_within_days' && a.status !== 'triggered')
  if (alerts.isLoading) return <Skeleton className="h-9 w-full rounded-xl" />
  if (existing) {
    return (
      <div className="cal-inset flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm">
        <span className="flex items-center gap-1.5 text-fg-primary"><BellRing className="h-4 w-4 text-amber-500" /> Alert {existing.status === 'paused' ? 'paused' : 'set'} · {existing.threshold}d before</span>
        <Link href="/alerts" className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400">Manage</Link>
      </div>
    )
  }
  const submit = () =>
    create.mutate(
      { symbol, condition: 'earnings_within_days', threshold: days },
      {
        onSuccess: () => toast.success(`Alert set: ${symbol} earnings within ${days} day${days === 1 ? '' : 's'}`),
        onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not create the alert'),
      },
    )
  return (
    <div className="flex gap-2">
      <select aria-label="Days before the report" className={`${selectCls} min-w-0 flex-1`} value={days} onChange={(e) => setDays(Number(e.target.value))}>
        {ALERT_DAYS.map((d) => <option key={d} value={d}>{d} day{d === 1 ? '' : 's'} before</option>)}
      </select>
      <button type="button" className={primaryBtn} onClick={submit} disabled={create.isPending}>
        {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellPlus className="h-4 w-4" />} Set alert
      </button>
    </div>
  )
}

// ── EPS history mini chart ───────────────────────────────────────────────────

/** Estimate vs actual per quarter with a zero baseline (negative EPS draws below it). */
export function EpsHistoryChart({ symbol }: { symbol: string }) {
  const h = useEpsHistory(symbol)
  const qs: EpsQuarter[] = (h.data?.quarters ?? []).slice(-8)
  const header = (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <p className="text-xs font-semibold text-fg-secondary">EPS history · actual vs estimate</p>
      {h.data?.source && <p className="text-[10px] text-fg-muted">{h.data.source === 'finnhub' ? 'Finnhub' : 'yfinance'}</p>}
    </div>
  )
  if (h.isLoading) return <div>{header}<Skeleton className="h-24 w-full rounded-xl" /></div>
  if (h.error || !h.data?.available) return <div>{header}<p className="cal-inset rounded-xl px-3 py-4 text-center text-xs text-fg-muted">EPS history is unavailable right now.</p></div>
  if (!qs.length) return <div>{header}<p className="cal-inset rounded-xl px-3 py-4 text-center text-xs text-fg-muted">No reported quarters on record.</p></div>
  const vals = qs.flatMap((x) => [x.eps_actual, x.eps_estimate]).filter((v): v is number => v != null)
  const pos = Math.max(0, ...vals)
  const neg = Math.max(0, ...vals.map((v) => -v))
  const H = 84
  const span = pos + neg || 1
  const base = (pos / span) * H
  const bw = 9
  const gw = 30
  const W = qs.length * gw
  const y = (v: number) => (v >= 0 ? base - (v / span) * H : base)
  const hgt = (v: number) => Math.max(1, (Math.abs(v) / span) * H)
  return (
    <div>
      {header}
      <figure aria-label={`${symbol} EPS actual vs estimate, last ${qs.length} quarters`}>
        <svg viewBox={`0 0 ${W} ${H + 16}`} className="h-28 w-full" preserveAspectRatio="none" role="img">
          <line x1={0} x2={W} y1={base} y2={base} className="stroke-slate-300 dark:stroke-white/15" strokeWidth={0.6} />
          {qs.map((x, i) => {
            const cx = i * gw + gw / 2
            const tone = surpriseTone(x.surprise_pct)
            const actCls = tone === 'beat' ? 'fill-emerald-500' : tone === 'miss' ? 'fill-red-500' : 'fill-slate-500 dark:fill-slate-300'
            return (
              <g key={x.period} className="cal-grow-y" style={{ ['--i' as string]: i, transformBox: 'fill-box' }}>
                <title>{`${x.label}: actual ${fmtEps(x.eps_actual)} vs estimate ${fmtEps(x.eps_estimate)} (${fmtSurprise(x.surprise_pct)})`}</title>
                {x.eps_estimate != null && <rect x={cx - bw - 1} y={y(x.eps_estimate)} width={bw} height={hgt(x.eps_estimate)} rx={1.5} className="fill-slate-300 dark:fill-white/20" />}
                {x.eps_actual != null && <rect x={cx + 1} y={y(x.eps_actual)} width={bw} height={hgt(x.eps_actual)} rx={1.5} className={actCls} />}
                <text x={cx} y={H + 12} textAnchor="middle" className="fill-slate-500 text-[7px] dark:fill-slate-400">{x.label.replace(/^Q(\d) (\d{2})(\d{2})$/, "Q$1 '$3")}</text>
              </g>
            )
          })}
        </svg>
        <figcaption className="mt-1 flex items-center gap-3 text-[10px] text-fg-muted">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-300 dark:bg-white/20" /> Estimate</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500" /> Beat</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-red-500" /> Miss</span>
        </figcaption>
      </figure>
    </div>
  )
}

// ── snapshot ─────────────────────────────────────────────────────────────────

export function ReadingLegend() {
  const item = (dot: ReactNode, t: string, d: string) => (
    <li className="flex items-start gap-2"><span className="mt-0.5 shrink-0">{dot}</span><span><span className="font-semibold text-fg-secondary">{t}</span> {d}</span></li>
  )
  return (
    <div className="cal-inset rounded-xl p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-muted">Reading earnings</p>
      <ul className="space-y-1.5 text-[11px] text-fg-muted">
        {item(<span className="block h-2.5 w-2.5 rounded-full bg-emerald-500" />, 'Positive surprise', 'actual above the consensus estimate')}
        {item(<span className="block h-2.5 w-2.5 rounded-full bg-red-500" />, 'Negative surprise', 'actual below the estimate')}
        {item(<HourPill hour="bmo" />, 'Before market open', 'reported before 9:30 ET')}
        {item(<HourPill hour="amc" />, 'After market close', 'reported after 4:00 ET')}
        {item(<HourPill hour={null} />, 'Time not announced', 'session not confirmed yet')}
      </ul>
    </div>
  )
}

function CompareBlock({ title, actual, estimate, surprise, fmt, actReason, estReason }: {
  title: string; actual: number | null; estimate: number | null; surprise: number | null
  fmt: (v: number | null) => string; actReason: string; estReason: string
}) {
  const b = compareBars(actual, estimate)
  const tone = surpriseTone(surprise)
  const actBar = tone === 'beat' ? 'bg-emerald-500' : tone === 'miss' ? 'bg-red-500' : 'bg-indigo-500'
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold text-fg-secondary">{title}</p>
        <p className="text-sm tabular-nums">{surprise != null ? <Surprise v={surprise} /> : <Dash reason={REASON.surprise} />}<span className="ml-1 text-[10px] text-fg-muted">surprise</span></p>
      </div>
      {[['Actual', actual, actReason, actBar, b?.actual ?? 0] as const, ['Estimate', estimate, estReason, 'bg-slate-400 dark:bg-white/30', b?.estimate ?? 0] as const].map(([label, v, reason, cls, frac]) => (
        <div key={label} className="grid grid-cols-[64px_minmax(0,1fr)_72px] items-center gap-2 text-xs">
          <span className="text-fg-muted">{label}</span>
          <MeterBar frac={frac} className={cls} />
          <span className="text-right font-semibold tabular-nums text-fg-primary">{v != null ? fmt(v) : <Dash reason={reason} />}</span>
        </div>
      ))}
    </div>
  )
}

export function EarningsSnapshot({ r, today }: { r: EarningsRow | null; today: string }) {
  if (!r) return <StateBox icon={<CalendarCheck2 className="h-7 w-7" />} title="Select a company" body="Pick a row to see its report session, EPS and revenue vs. estimates." />
  const rel = (() => {
    const n = Math.round((parseDay(r.date).getTime() - parseDay(today).getTime()) / 86_400_000)
    return n === 0 ? 'today' : n > 0 ? `in ${n}d` : `${-n}d ago`
  })()
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <CompanyCell r={r} size={40} />
        <Link prefetch={false} href={`/research?symbol=${encodeURIComponent(r.symbol)}`} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
          Research <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
      <div className="cal-inset flex items-center justify-between gap-2 rounded-xl px-3 py-2.5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Report session</p>
          <p className="mt-0.5 text-sm font-semibold text-fg-primary">{dayLabel(r.date, 'long')} <span className="whitespace-nowrap font-normal text-fg-muted">· {rel}</span></p>
          <p className="text-[11px] text-fg-muted">{hourTitle(r.hour)}{r.fiscal_period ? ` · ${r.fiscal_period}` : ''}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <HourPill hour={r.hour} className="text-xs" />
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.status === 'reported' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}>
            {r.status === 'reported' ? 'Reported' : 'Upcoming'}
          </span>
        </div>
      </div>
      <CompareBlock title="EPS" actual={r.eps_actual} estimate={r.eps_estimate} surprise={r.eps_surprise_pct} fmt={fmtEps}
        actReason={REASON.epsAct(r)} estReason={REASON.epsEst} />
      <CompareBlock title="Revenue" actual={r.revenue_actual} estimate={r.revenue_estimate} surprise={r.revenue_surprise_pct} fmt={fmtRevenue}
        actReason={REASON.revAct(r)} estReason={REASON.revEst} />
      <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-2 text-xs">
        <div className="cal-inset rounded-xl px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-fg-muted">Market cap</p><p className="mt-0.5 font-semibold tabular-nums text-fg-primary">{ecell.mcap(r)}</p></div>
        <div className="cal-inset rounded-xl px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-fg-muted"># estimates</p><p className="mt-0.5 font-semibold tabular-nums text-fg-primary">{r.num_estimates ?? <Dash reason="Analyst count not published by the source" />}</p></div>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold text-fg-secondary">Alert me before {r.symbol} reports</p>
        <SetEarningsAlert symbol={r.symbol} />
      </div>
      <EpsHistoryChart symbol={r.symbol} />
      <ReadingLegend />
    </div>
  )
}

export function SourceNote({ sources }: { sources?: { finnhub: boolean; nasdaq: boolean } }) {
  const names = [sources?.finnhub && 'Finnhub', sources?.nasdaq && 'Nasdaq'].filter(Boolean).join(' + ')
  return (
    <p className="text-[11px] leading-relaxed text-fg-muted">
      {names ? `Data: ${names}.` : 'Data: Finnhub and Nasdaq calendars.'} BMO = before market open, AMC = after
      market close, TBD = time not announced. Estimates are analyst consensus and can change; companies sometimes move
      report dates. Surprise = (actual − estimate) ÷ |estimate|. Coverage = reports with a consensus EPS estimate.
      “—” = unknown (hover for why). Not investment advice.
    </p>
  )
}

export function ErrorOrEmpty({ c }: { c: EarningsController }) {
  if (c.error) {
    return <StateBox tone="warn" title="Could not load the earnings calendar" body={c.error.message}
      actions={<button type="button" className={ghostBtn} onClick={() => c.q.refetch()}>Retry</button>} />
  }
  const title = c.weekRows.length && c.filtersActive
    ? 'No reports match these filters.'
    : c.day ? `No reports on ${dayLabel(c.day, 'long')}.`
      : c.scope === 'all' ? 'No earnings reports scheduled this week.'
        : `None of your ${c.scope === 'watchlist' ? 'watchlist' : 'portfolio'} companies report this week.`
  return (
    <StateBox title={title} actions={
      <>
        {c.filtersActive && <button type="button" className={ghostBtn} onClick={c.clearFilters}>Clear filters</button>}
        {c.day && <button type="button" className={ghostBtn} onClick={() => c.setDay(null)}>Whole week</button>}
        <button type="button" className={ghostBtn} onClick={() => c.shiftWeek(1)}>Next week</button>
        {c.scope !== 'all' && <button type="button" className={ghostBtn} onClick={() => c.setScope('all')}>All companies</button>}
      </>
    } />
  )
}

export function showState(c: EarningsController): boolean {
  return !c.loading && (!!c.error || c.visible.length === 0)
}

export function SnapshotCard({ c, current }: { c: EarningsController; current: EarningsRow | null }) {
  return (
    <GlassCard as="aside" tone="amber" accent className="sticky top-4 p-5" aria-label="Earnings snapshot">
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-muted">Earnings snapshot</p>
      {c.loading ? <Skeleton className="h-64 w-full rounded-xl" /> : <EarningsSnapshot key={current ? earningsRowKey(current) : ''} r={current} today={c.today} />}
    </GlassCard>
  )
}
