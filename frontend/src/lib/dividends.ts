/**
 * Dividend calendar + projected income client and shared helpers. DividendsDesktop and
 * DividendsMobile both use these. Backend: /api/v1/dividends (backend/app/api/dividends.py).
 * Missing values render as "—", never 0.
 */
import { useQuery } from '@tanstack/react-query'

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

export type DividendScope = 'all' | 'watchlist' | 'portfolio'

export interface DividendRow {
  symbol: string
  name: string | null
  sector: string | null
  ex_date: string
  pay_date: string | null
  record_date: string | null
  declared_date: string | null
  amount: number | null
  annual_dividend: number | null
  frequency: number | null
  frequency_label: string | null
  price: number | null
  yield_pct: number | null
  in_watchlist: boolean
  in_portfolio: boolean
}

export interface DividendCalendarResponse {
  start: string
  end: string
  today: string
  scope: DividendScope
  rows: DividendRow[]
  total: number
  truncated: boolean
  source_ok: boolean
}

export interface IncomePayment {
  symbol: string
  ex_date: string
  pay_date: string
  amount_per_share: number
  shares: number
  income: number
  estimated: boolean
  announced: boolean
}

export type HoldingStatus = 'projected' | 'no_dividend' | 'irregular' | 'suspended' | 'unavailable'

export interface IncomeHolding {
  symbol: string
  name: string | null
  shares: number
  frequency: number | null
  frequency_label: string | null
  amount_per_share: number | null
  annual_per_share: number | null
  last_ex_date: string | null
  next_ex_date: string | null
  next_pay_date: string | null
  projected_income: number | null
  price: number | null
  yield_pct: number | null
  status: HoldingStatus
  note: string | null
}

export interface IncomeResponse {
  today: string
  months: { month: string; total: number; payments: IncomePayment[] }[]
  total_12m: number | null
  holdings: IncomeHolding[]
  portfolios: { id: number; name: string; kind: 'tracked' | 'paper' }[]
  portfolio_id: number | null
  has_tracked_portfolio: boolean
  holding_count: number
  portfolio_yield_pct: number | null
  assumptions: { pay_lag_days_default: number }
}

export const DASH = '—'

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function fmtMoney(v: number | null | undefined, digits = 2): string {
  if (!finite(v)) return DASH
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

/** Per-share dividend amounts can be tiny (0.0675): show up to 4 decimals. */
export function fmtPerShare(v: number | null | undefined): string {
  if (!finite(v)) return DASH
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
}

export function fmtYield(v: number | null | undefined): string {
  if (!finite(v)) return DASH
  return `${v.toFixed(2)}%`
}

export function fmtShortDate(iso: string | null | undefined): string {
  if (!iso) return DASH
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return DASH
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function monthLabel(ym: string, style: 'short' | 'long' = 'short'): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1, 1))
  return style === 'long'
    ? d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
}

export const STATUS_TEXT: Record<HoldingStatus, string> = {
  projected: 'Projected',
  no_dividend: 'No dividend',
  irregular: 'Irregular',
  suspended: 'Suspended?',
  unavailable: 'Data unavailable',
}

/** Bar heights as a fraction of the largest month (0..1); all zero when nothing is projected. */
export function barFractions(totals: number[]): number[] {
  const max = Math.max(0, ...totals.filter(finite))
  return totals.map((t) => (max > 0 && finite(t) ? t / max : 0))
}

/** Sum of the projected monthly totals, rounded to cents (must equal total_12m). */
export function sumMonths(months: { total: number }[]): number {
  return Math.round(months.reduce((s, m) => s + (finite(m.total) ? m.total : 0), 0) * 100) / 100
}

export function groupByExDate(rows: DividendRow[], days: string[]): Record<string, DividendRow[]> {
  const out: Record<string, DividendRow[]> = Object.fromEntries(days.map((d) => [d, [] as DividendRow[]]))
  for (const r of rows) (out[r.ex_date] ||= []).push(r)
  return out
}

/** Highest yield first; unknown yield last, then by symbol. */
export function sortByYield(rows: DividendRow[]): DividendRow[] {
  return [...rows].sort((a, b) => (b.yield_pct ?? -1) - (a.yield_pct ?? -1) || a.symbol.localeCompare(b.symbol))
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1/dividends${path}`, { credentials: 'include' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const d = (data as { detail?: unknown })?.detail
    throw new Error(typeof d === 'string' ? d : `Request failed (${res.status})`)
  }
  return data as T
}

export const dividendsApi = {
  calendar: (start: string, end: string, scope: DividendScope) => {
    const q = new URLSearchParams({ start, end })
    if (scope !== 'all') q.set('scope', scope)
    return getJson<DividendCalendarResponse>(`/calendar?${q}`)
  },
  income: (portfolioId: number | null) =>
    getJson<IncomeResponse>(`/income${portfolioId ? `?portfolio_id=${portfolioId}` : ''}`),
}

export function useDividendCalendar(start: string, end: string, scope: DividendScope, enabled = true) {
  return useQuery({
    queryKey: ['dividend-calendar', start, end, scope],
    queryFn: () => dividendsApi.calendar(start, end, scope),
    enabled,
    staleTime: 10 * 60_000,
    placeholderData: (prev) => prev,
  })
}

export function useDividendIncome(portfolioId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ['dividend-income', portfolioId],
    queryFn: () => dividendsApi.income(portfolioId),
    enabled,
    staleTime: 10 * 60_000,
  })
}
