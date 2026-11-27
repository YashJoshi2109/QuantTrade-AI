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
  /** "db" = our fundamentals / latest stored bar; "last_close" = latest daily close (yfinance). */
  price_source?: 'db' | 'last_close' | null
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

export type DividendSortKey =
  | 'yield' | 'symbol' | 'amount' | 'annual' | 'price' | 'pay_date' | 'record_date' | 'ex_date' | 'frequency'
export type SortDir = 'asc' | 'desc'

export const SORT_OPTIONS: { key: DividendSortKey; label: string; defaultDir: SortDir }[] = [
  { key: 'yield', label: 'Fwd yield', defaultDir: 'desc' },
  { key: 'amount', label: 'Dividend / share', defaultDir: 'desc' },
  { key: 'annual', label: 'Indicated annual', defaultDir: 'desc' },
  { key: 'price', label: 'Price', defaultDir: 'desc' },
  { key: 'ex_date', label: 'Ex-date', defaultDir: 'asc' },
  { key: 'record_date', label: 'Record date', defaultDir: 'asc' },
  { key: 'pay_date', label: 'Pay date', defaultDir: 'asc' },
  { key: 'frequency', label: 'Frequency', defaultDir: 'desc' },
  { key: 'symbol', label: 'Symbol', defaultDir: 'asc' },
]
export const SORT_KEYS = SORT_OPTIONS.map((o) => o.key)

function sortValue(r: DividendRow, key: DividendSortKey): number | string | null {
  switch (key) {
    case 'yield': return finite(r.yield_pct) ? r.yield_pct : null
    case 'amount': return finite(r.amount) ? r.amount : null
    case 'annual': return finite(r.annual_dividend) ? r.annual_dividend : null
    case 'price': return finite(r.price) ? r.price : null
    case 'pay_date': return r.pay_date || null
    case 'record_date': return r.record_date || null
    case 'ex_date': return r.ex_date || null
    case 'frequency': return finite(r.frequency) ? r.frequency : null
    case 'symbol': return r.symbol
  }
}

/** Sort by any column; unknown values always sink to the bottom (either direction), ties by symbol. */
export function sortDividendRows(rows: DividendRow[], key: DividendSortKey, dir: SortDir): DividendRow[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const va = sortValue(a, key)
    const vb = sortValue(b, key)
    if (va === null && vb === null) return a.symbol.localeCompare(b.symbol)
    if (va === null) return 1
    if (vb === null) return -1
    const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
    return c !== 0 ? c * sign : a.symbol.localeCompare(b.symbol)
  })
}

/** Whole calendar days from `today` to `iso` (negative = past); null when unknown. */
export function daysUntil(iso: string | null | undefined, today: string): number | null {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  if (!y || !m || !d || !ty || !tm || !td) return null
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000)
}

/** "today", "in 3d", "5d ago"; "" when unknown. */
export function relDays(n: number | null): string {
  if (n === null) return ''
  if (n === 0) return 'today'
  return n > 0 ? `in ${n}d` : `${-n}d ago`
}

export interface WeekSummary {
  total: number
  withYield: number
  held: number
  watched: number
  top: DividendRow | null
}

/** Header strip for the calendar: counts and the highest known yield in view. */
export function summarize(rows: DividendRow[]): WeekSummary {
  let top: DividendRow | null = null
  let withYield = 0
  let held = 0
  let watched = 0
  for (const r of rows) {
    if (finite(r.yield_pct)) {
      withYield++
      if (!top || (r.yield_pct as number) > (top.yield_pct as number)) top = r
    }
    if (r.in_portfolio) held++
    if (r.in_watchlist) watched++
  }
  return { total: rows.length, withYield, held, watched, top }
}

// ── filters, row identity, CSV ──

export type FreqFilter = 'all' | 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'unknown'

export const FREQ_OPTIONS: { id: FreqFilter; label: string }[] = [
  { id: 'all', label: 'All frequencies' },
  { id: 'weekly', label: 'Weekly / biweekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'semiannual', label: 'Semi-annual' },
  { id: 'annual', label: 'Annual' },
  { id: 'unknown', label: 'Irregular / unknown' },
]
export const FREQ_IDS = FREQ_OPTIONS.map((o) => o.id)

export function freqBucket(freq: number | null | undefined): Exclude<FreqFilter, 'all'> {
  switch (freq) {
    case 52: case 26: return 'weekly'
    case 12: return 'monthly'
    case 4: return 'quarterly'
    case 2: return 'semiannual'
    case 1: return 'annual'
    default: return 'unknown'
  }
}

export interface DividendFilters {
  freq: FreqFilter
  q: string
}

/** Frequency bucket + company search (ticker prefix or name substring, case-insensitive). */
export function filterDividendRows(rows: DividendRow[], f: DividendFilters): DividendRow[] {
  const q = f.q.trim().toLowerCase()
  return rows.filter((r) => {
    if (f.freq !== 'all' && freqBucket(r.frequency) !== f.freq) return false
    if (!q) return true
    return r.symbol.toLowerCase().startsWith(q) || (r.name || '').toLowerCase().includes(q)
  })
}

/** Stable identity for a calendar row (a symbol can have two distributions in one week). */
export function dividendRowKey(r: Pick<DividendRow, 'symbol' | 'ex_date' | 'amount'>): string {
  return `${r.symbol}|${r.ex_date}|${r.amount ?? ''}`
}

export const DIVIDEND_CSV_HEADERS = [
  'Symbol', 'Company', 'Ex-date', 'Record date', 'Pay date', 'Declared', 'Frequency',
  'Dividend per share', 'Indicated annual', 'Price', 'Price source', 'Forward yield %', 'In watchlist', 'In portfolio',
]

export function dividendsCsv(rows: DividendRow[]): unknown[][] {
  return rows.map((r) => [
    r.symbol, r.name, r.ex_date, r.record_date, r.pay_date, r.declared_date, r.frequency_label,
    finite(r.amount) ? r.amount : null, finite(r.annual_dividend) ? r.annual_dividend : null,
    finite(r.price) ? r.price : null, r.price ? (r.price_source === 'last_close' ? 'latest close' : 'stored') : null,
    finite(r.yield_pct) ? r.yield_pct : null, r.in_watchlist ? 'yes' : 'no', r.in_portfolio ? 'yes' : 'no',
  ])
}

// ── per-symbol dividend history (snapshot mini chart) ──

export interface DividendHistory {
  symbol: string
  /** false = lookup failed (unknown); true with no payments = pays no dividend. */
  available: boolean
  payments: { ex_date: string; amount: number }[]
  ttm_total: number | null
  ttm_count: number
  frequency: number | null
  frequency_label: string | null
  next_ex_date: string | null
  next_pay_date: string | null
  source: string
}

/** Last `n` payments as bar fractions of the largest one (for the mini chart). */
export function historyBars(h: DividendHistory | undefined, n = 12): { ex_date: string; amount: number; frac: number }[] {
  const pts = (h?.payments ?? []).filter((p) => finite(p.amount) && p.amount > 0).slice(-n)
  const max = Math.max(0, ...pts.map((p) => p.amount))
  return pts.map((p) => ({ ...p, frac: max > 0 ? p.amount / max : 0 }))
}

export type TimelineStep = { id: 'declared' | 'ex' | 'record' | 'pay'; label: string; date: string | null; state: 'past' | 'today' | 'future' | 'unknown' }

/** Declared → Ex-dividend → Record → Payment, each marked past / today / future relative to `today`. */
export function paymentTimeline(r: DividendRow, today: string): TimelineStep[] {
  const st = (d: string | null): TimelineStep['state'] => {
    const n = daysUntil(d, today)
    if (n === null) return 'unknown'
    return n < 0 ? 'past' : n === 0 ? 'today' : 'future'
  }
  const steps: TimelineStep[] = [
    { id: 'ex', label: 'Ex-dividend', date: r.ex_date, state: st(r.ex_date) },
    { id: 'record', label: 'Record', date: r.record_date, state: st(r.record_date) },
    { id: 'pay', label: 'Payment', date: r.pay_date, state: st(r.pay_date) },
  ]
  return r.declared_date ? [{ id: 'declared', label: 'Declared', date: r.declared_date, state: st(r.declared_date) }, ...steps] : steps
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
  history: (symbol: string) => getJson<DividendHistory>(`/history/${encodeURIComponent(symbol.toUpperCase())}`),
}

export function useDividendHistory(symbol: string | null | undefined) {
  const sym = (symbol || '').trim().toUpperCase()
  return useQuery({
    queryKey: ['dividend-history', sym],
    queryFn: () => dividendsApi.history(sym),
    enabled: /^[A-Z0-9.\-]{1,10}$/.test(sym),
    staleTime: 6 * 3600_000,
    retry: 1,
  })
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
