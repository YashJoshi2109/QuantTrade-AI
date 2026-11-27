/**
 * Earnings calendar client + shared helpers. EarningsDesktop, EarningsMobile and the
 * Research header badge (desktop + mobile) all use these, so both views stay in sync.
 * Backend: /api/v1/earnings (backend/app/api/earnings.py), Finnhub + Nasdaq, Redis-cached.
 * Missing values render as "—", never 0.
 */
import { useQuery } from '@tanstack/react-query'

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

export type EarningsHour = 'bmo' | 'amc' | 'dmh'
export type EarningsScope = 'all' | 'watchlist' | 'portfolio'
export type CapTier = 'mega' | 'large' | 'mid' | 'small' | 'micro'

export interface EarningsRow {
  symbol: string
  name: string | null
  date: string
  hour: EarningsHour | null
  hour_label: string | null
  eps_estimate: number | null
  eps_actual: number | null
  eps_surprise_pct: number | null
  revenue_estimate: number | null
  revenue_actual: number | null
  revenue_surprise_pct: number | null
  market_cap: number | null
  cap_tier: CapTier | null
  sector: string | null
  fiscal_period: string | null
  num_estimates: number | null
  status: 'reported' | 'upcoming'
  in_watchlist: boolean
  in_portfolio: boolean
  sources: string[]
}

export interface EarningsCalendarResponse {
  start: string
  end: string
  today: string
  scope: EarningsScope
  rows: EarningsRow[]
  total: number
  truncated: boolean
  sectors: string[]
  cap_tiers: { id: CapTier; label: string }[]
  sources: { finnhub: boolean; nasdaq: boolean }
  watchlist_count: number | null
  portfolio_count: number | null
}

export interface NextEarnings {
  symbol: string
  today: string
  date: string | null
  hour: EarningsHour | null
  hour_label: string | null
  days_until: number | null
  eps_estimate: number | null
  revenue_estimate: number | null
  fiscal_period: string | null
}

export const CAP_TIER_OPTIONS: { id: CapTier; label: string; short: string }[] = [
  { id: 'mega', label: 'Mega cap ($200B+)', short: 'Mega' },
  { id: 'large', label: 'Large cap ($10B–200B)', short: 'Large' },
  { id: 'mid', label: 'Mid cap ($2B–10B)', short: 'Mid' },
  { id: 'small', label: 'Small cap ($300M–2B)', short: 'Small' },
  { id: 'micro', label: 'Micro cap (<$300M)', short: 'Micro' },
]

export const SCOPE_OPTIONS: { id: EarningsScope; label: string; needsAuth: boolean }[] = [
  { id: 'all', label: 'All companies', needsAuth: false },
  { id: 'watchlist', label: 'My watchlist', needsAuth: true },
  { id: 'portfolio', label: 'My portfolio', needsAuth: true },
]

export const DASH = '—'

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

// ── dates: shared with the dividend calendar (lib/calendarDates.ts) ──
export { addDays, busiestDay, dayFractions, dayLabel, parseDay, toDay, todayNY, weekDays, weekRangeLabel, weekStart } from './calendarDates'
import { busiestDay } from './calendarDates'

export function groupByDay(rows: EarningsRow[], days: string[]): Record<string, EarningsRow[]> {
  const out: Record<string, EarningsRow[]> = Object.fromEntries(days.map((d) => [d, [] as EarningsRow[]]))
  for (const r of rows) (out[r.date] ||= []).push(r)
  return out
}

// ── formatting ──

export function hourShort(h: EarningsHour | null): string {
  if (h === 'bmo') return 'BMO'
  if (h === 'amc') return 'AMC'
  if (h === 'dmh') return 'DMH'
  return DASH
}

export function hourTitle(h: EarningsHour | null): string {
  if (h === 'bmo') return 'Before market open'
  if (h === 'amc') return 'After market close'
  if (h === 'dmh') return 'During market hours'
  return 'Time not announced'
}

export function fmtEps(v: number | null | undefined): string {
  if (!finite(v)) return DASH
  const s = `$${Math.abs(v).toFixed(2)}`
  return v < 0 ? `-${s}` : s
}

export function fmtRevenue(v: number | null | undefined): string {
  if (!finite(v)) return DASH
  const a = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}K`
  return `${sign}$${a.toFixed(0)}`
}

export function fmtSurprise(v: number | null | undefined): string {
  if (!finite(v)) return DASH
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
}

export function surpriseTone(v: number | null | undefined): 'beat' | 'miss' | 'inline' | 'none' {
  if (!finite(v)) return 'none'
  if (v > 0.5) return 'beat'
  if (v < -0.5) return 'miss'
  return 'inline'
}

export const SURPRISE_CLASS: Record<ReturnType<typeof surpriseTone>, string> = {
  beat: 'text-emerald-600 dark:text-emerald-400',
  miss: 'text-red-600 dark:text-red-400',
  inline: 'text-fg-secondary',
  none: 'text-fg-muted',
}

/** Badge text for the Research header; null when there is nothing to show. */
export function earningsBadgeText(days: number | null | undefined, maxDays = 30): string | null {
  if (!finite(days) || days < 0 || days > maxDays) return null
  if (days === 0) return 'Earnings today'
  if (days === 1) return 'Earnings tomorrow'
  return `Earnings in ${days} days`
}

// ── filters, stats, sort, CSV (client-side over the week's rows) ──

export type SessionFilter = 'all' | 'bmo' | 'amc' | 'dmh' | 'tbd'
export type StatusFilter = 'all' | 'reported' | 'upcoming'

export const SESSION_OPTIONS: { id: SessionFilter; label: string }[] = [
  { id: 'all', label: 'All sessions' },
  { id: 'bmo', label: 'BMO · before open' },
  { id: 'amc', label: 'AMC · after close' },
  { id: 'dmh', label: 'During market' },
  { id: 'tbd', label: 'TBD · not announced' },
]
export const STATUS_OPTIONS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All reports' },
  { id: 'reported', label: 'Reported' },
  { id: 'upcoming', label: 'Upcoming' },
]
export const SESSION_IDS = SESSION_OPTIONS.map((o) => o.id)
export const STATUS_IDS = STATUS_OPTIONS.map((o) => o.id)
export const CAP_IDS: (CapTier | '')[] = ['', ...CAP_TIER_OPTIONS.map((o) => o.id)]

export interface EarningsFilters {
  session: SessionFilter
  status: StatusFilter
  cap: CapTier | ''
  q: string
}

export function filterEarningsRows(rows: EarningsRow[], f: EarningsFilters): EarningsRow[] {
  const q = f.q.trim().toLowerCase()
  return rows.filter((r) => {
    if (f.session === 'tbd' ? r.hour !== null : f.session !== 'all' && r.hour !== f.session) return false
    if (f.status !== 'all' && r.status !== f.status) return false
    if (f.cap && r.cap_tier !== f.cap) return false
    if (!q) return true
    return r.symbol.toLowerCase().startsWith(q) || (r.name || '').toLowerCase().includes(q)
  })
}

export interface EarningsStats {
  total: number
  today: number
  reported: number
  withEstimate: number
  busiest: { day: string; count: number } | null
}

/** Stat cards: reports in the week, today, busiest weekday, and EPS-estimate coverage. */
export function earningsStats(rows: EarningsRow[], days: string[], today: string): EarningsStats {
  const perDay: Record<string, number> = {}
  let todayN = 0
  let reported = 0
  let withEstimate = 0
  for (const r of rows) {
    perDay[r.date] = (perDay[r.date] ?? 0) + 1
    if (r.date === today) todayN++
    if (r.status === 'reported') reported++
    if (finite(r.eps_estimate)) withEstimate++
  }
  return { total: rows.length, today: todayN, reported, withEstimate, busiest: busiestDay(perDay, days) }
}

export type EarningsSortKey =
  | 'symbol' | 'date' | 'hour' | 'eps_estimate' | 'eps_actual' | 'eps_surprise_pct'
  | 'revenue_estimate' | 'revenue_actual' | 'revenue_surprise_pct' | 'market_cap'
export type SortDir = 'asc' | 'desc'

export const EARNINGS_SORT_OPTIONS: { key: EarningsSortKey; label: string; defaultDir: SortDir }[] = [
  { key: 'market_cap', label: 'Market cap', defaultDir: 'desc' },
  { key: 'symbol', label: 'Company', defaultDir: 'asc' },
  { key: 'date', label: 'Date', defaultDir: 'asc' },
  { key: 'hour', label: 'Session', defaultDir: 'asc' },
  { key: 'eps_estimate', label: 'EPS estimate', defaultDir: 'desc' },
  { key: 'eps_actual', label: 'EPS actual', defaultDir: 'desc' },
  { key: 'eps_surprise_pct', label: 'EPS surprise', defaultDir: 'desc' },
  { key: 'revenue_estimate', label: 'Revenue estimate', defaultDir: 'desc' },
  { key: 'revenue_actual', label: 'Revenue actual', defaultDir: 'desc' },
  { key: 'revenue_surprise_pct', label: 'Revenue surprise', defaultDir: 'desc' },
]
export const EARNINGS_SORT_KEYS = EARNINGS_SORT_OPTIONS.map((o) => o.key)

const HOUR_ORDER: Record<string, number> = { bmo: 0, dmh: 1, amc: 2 }

function earningsSortValue(r: EarningsRow, k: EarningsSortKey): number | string | null {
  switch (k) {
    case 'symbol': return r.symbol
    case 'date': return r.date
    case 'hour': return r.hour ? HOUR_ORDER[r.hour] : null
    default: {
      const v = r[k]
      return finite(v) ? v : null
    }
  }
}

/** Unknown values sink to the bottom in either direction; ties by market cap, then symbol. */
export function sortEarningsRows(rows: EarningsRow[], key: EarningsSortKey, dir: SortDir): EarningsRow[] {
  const sign = dir === 'asc' ? 1 : -1
  const tie = (a: EarningsRow, b: EarningsRow) => (b.market_cap ?? -1) - (a.market_cap ?? -1) || a.symbol.localeCompare(b.symbol)
  return [...rows].sort((a, b) => {
    const va = earningsSortValue(a, key)
    const vb = earningsSortValue(b, key)
    if (va === null && vb === null) return tie(a, b)
    if (va === null) return 1
    if (vb === null) return -1
    const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
    return c !== 0 ? c * sign : tie(a, b)
  })
}

export function earningsRowKey(r: Pick<EarningsRow, 'symbol' | 'date'>): string {
  return `${r.symbol}|${r.date}`
}

export const EARNINGS_CSV_HEADERS = [
  'Symbol', 'Company', 'Date', 'Session', 'Fiscal period', 'Status', 'EPS estimate', 'EPS actual', 'EPS surprise %',
  'Revenue estimate', 'Revenue actual', 'Revenue surprise %', 'Market cap', 'Sector', 'Sources',
]

export function earningsCsv(rows: EarningsRow[]): unknown[][] {
  const n = (v: number | null) => (finite(v) ? v : null)
  return rows.map((r) => [
    r.symbol, r.name, r.date, r.hour ? hourShort(r.hour) : 'TBD', r.fiscal_period, r.status,
    n(r.eps_estimate), n(r.eps_actual), n(r.eps_surprise_pct), n(r.revenue_estimate), n(r.revenue_actual),
    n(r.revenue_surprise_pct), n(r.market_cap), r.sector, r.sources.join('+'),
  ])
}

/** Two comparison bars (actual vs estimate) as fractions of the larger magnitude. */
export function compareBars(actual: number | null, estimate: number | null): { actual: number; estimate: number } | null {
  if (!finite(actual) && !finite(estimate)) return null
  const max = Math.max(finite(actual) ? Math.abs(actual) : 0, finite(estimate) ? Math.abs(estimate) : 0)
  if (max === 0) return { actual: 0, estimate: 0 }
  return { actual: finite(actual) ? Math.abs(actual) / max : 0, estimate: finite(estimate) ? Math.abs(estimate) / max : 0 }
}

// ── per-symbol EPS history (snapshot mini chart) ──

export interface EpsQuarter {
  /** Fiscal period end (Finnhub) or report date (yfinance). */
  period: string
  label: string
  eps_actual: number | null
  eps_estimate: number | null
  surprise_pct: number | null
}

export interface EpsHistory {
  symbol: string
  available: boolean
  quarters: EpsQuarter[]
  source: 'finnhub' | 'yfinance' | null
}

// ── API ──

export interface CalendarParams {
  start: string
  end: string
  scope: EarningsScope
  cap: CapTier | ''
  sector: string
}

export function calendarQuery(p: CalendarParams): string {
  const q = new URLSearchParams({ start: p.start, end: p.end })
  if (p.scope !== 'all') q.set('scope', p.scope)
  if (p.cap) q.set('cap', p.cap)
  if (p.sector) q.set('sector', p.sector)
  return q.toString()
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1/earnings${path}`, { credentials: 'include' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const d = (data as { detail?: unknown })?.detail
    throw new Error(typeof d === 'string' ? d : `Request failed (${res.status})`)
  }
  return data as T
}

export const earningsApi = {
  calendar: (p: CalendarParams) => getJson<EarningsCalendarResponse>(`/calendar?${calendarQuery(p)}`),
  next: (symbol: string) => getJson<NextEarnings>(`/next/${encodeURIComponent(symbol.toUpperCase())}`),
  history: (symbol: string) => getJson<EpsHistory>(`/history/${encodeURIComponent(symbol.toUpperCase())}`),
}

export function useEpsHistory(symbol: string | null | undefined) {
  const sym = (symbol || '').trim().toUpperCase()
  return useQuery({
    queryKey: ['earnings-history', sym],
    queryFn: () => earningsApi.history(sym),
    enabled: /^[A-Z0-9.\-]{1,10}$/.test(sym),
    staleTime: 6 * 3600_000,
    retry: 1,
  })
}

export function useEarningsCalendar(p: CalendarParams, enabled = true) {
  return useQuery({
    queryKey: ['earnings-calendar', p],
    queryFn: () => earningsApi.calendar(p),
    enabled,
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  })
}

export function useNextEarnings(symbol: string | null | undefined) {
  const sym = (symbol || '').trim().toUpperCase()
  return useQuery({
    queryKey: ['earnings-next', sym],
    queryFn: () => earningsApi.next(sym),
    enabled: /^[A-Z0-9.\-]{1,10}$/.test(sym),
    staleTime: 30 * 60_000,
    retry: 1,
  })
}
