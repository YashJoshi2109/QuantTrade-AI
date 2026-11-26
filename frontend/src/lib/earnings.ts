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
export { addDays, dayLabel, parseDay, toDay, todayNY, weekDays, weekRangeLabel, weekStart } from './calendarDates'

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
