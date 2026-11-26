/**
 * Portfolios client + shared view helpers (desktop and mobile both import from here).
 *
 * Backend: /api/v1/portfolios (backend/app/api/portfolios.py). Auth is the httpOnly
 * session cookie, so every call sends credentials.
 *
 * Two kinds:
 *  - tracked: the user records trades made elsewhere (their own price/date).
 *  - paper:   SIMULATED trading with virtual cash. Orders fill at the server's last
 *             price and are never sent to a broker.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

export type PortfolioKind = 'tracked' | 'paper'
export type TxnType = 'BUY' | 'SELL' | 'DIVIDEND'

export interface Holding {
  symbol: string
  name: string | null
  sector: string
  quantity: number
  avg_cost: number | null
  cost_basis: number | null
  price: number | null
  change_percent: number | null
  market_value: number | null
  unrealized_pnl: number | null
  unrealized_pnl_percent: number | null
  day_change: number | null
  realized_pnl: number | null
  dividends: number | null
  weight: number | null
}

export interface AllocationSlice {
  label: string
  value: number
  weight: number
}

export interface PortfolioSummary {
  id: number
  name: string
  kind: PortfolioKind
  simulated: boolean
  currency: string
  starting_cash: number | null
  cash: number | null
  market_value: number
  total_value: number
  cost_basis: number
  unrealized_pnl: number
  realized_pnl: number
  dividends: number
  fees: number
  total_pnl: number
  total_return_percent: number | null
  day_change: number
  day_change_percent: number
  transaction_count: number
  stale_quotes: string[]
  holdings: Holding[]
  allocation: AllocationSlice[]
  created_at: string | null
  updated_at: string | null
}

export type PortfolioListItem = Omit<PortfolioSummary, 'holdings' | 'allocation'> & {
  holding_count: number
}

export interface PortfolioTxn {
  id: number
  symbol: string
  type: TxnType
  quantity: number
  price: number
  fees: number
  amount: number
  realized_pnl: number | null
  notes: string | null
  date: string
}

export interface PaperOrderResult {
  simulated: true
  notice: string
  order: PortfolioTxn & { status: 'filled'; fill_price: number; quote_source?: string | null; quote_time?: string | null }
  cash: number
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1/portfolios${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    credentials: 'include',
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiError(errorText(data, res.status), res.status)
  }
  return data as T
}

/** FastAPI errors are either {detail: string} or {detail: [{msg}]} (422). */
export function errorText(data: unknown, status: number): string {
  const detail = (data as { detail?: unknown })?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail.length) {
    const msg = (detail[0] as { msg?: string })?.msg
    if (msg) return msg.replace(/^Value error, /, '')
  }
  if (status === 401) return 'Please sign in to use portfolios'
  return `Request failed (${status})`
}

/**
 * Symbols must exist in the backend symbols table. On a 404 for an unknown ticker,
 * ask the backend to sync it from market data once, then retry (same flow as Watchlist).
 */
async function withSymbolSync<T>(symbol: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 404 || !/symbol/i.test(e.message)) throw e
    const sync = await fetch(`${API_URL}/api/v1/symbols/${encodeURIComponent(symbol)}/sync`, { method: 'POST' })
    if (!sync.ok) throw new ApiError(`Unknown symbol ${symbol}`, 404)
    return call()
  }
}

export const portfolioApi = {
  list: () => req<{ portfolios: PortfolioListItem[]; limit: number }>(''),
  get: (id: number) => req<PortfolioSummary>(`/${id}`),
  create: (body: { name: string; kind: PortfolioKind; starting_cash?: number }) =>
    req<PortfolioSummary>('', { method: 'POST', body: JSON.stringify(body) }),
  rename: (id: number, name: string) =>
    req<{ id: number; name: string }>(`/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  remove: (id: number) => req<void>(`/${id}`, { method: 'DELETE' }),
  transactions: (id: number) => req<{ transactions: PortfolioTxn[]; simulated: boolean }>(`/${id}/transactions`),
  addTransaction: (
    id: number,
    body: { symbol: string; type: TxnType; quantity?: number; price?: number; amount?: number; fees?: number; trade_date: string; notes?: string }
  ) => {
    const symbol = body.symbol.trim().toUpperCase()
    return withSymbolSync(symbol, () =>
      req<PortfolioTxn>(`/${id}/transactions`, { method: 'POST', body: JSON.stringify({ ...body, symbol }) })
    )
  },
  deleteTransaction: (id: number, txnId: number) => req<void>(`/${id}/transactions/${txnId}`, { method: 'DELETE' }),
  /** SIMULATED paper order. Server fills at its last price; no broker is involved. */
  paperOrder: (id: number, body: { symbol: string; side: 'BUY' | 'SELL'; quantity: number }) => {
    const symbol = body.symbol.trim().toUpperCase()
    return withSymbolSync(symbol, () =>
      req<PaperOrderResult>(`/${id}/orders`, { method: 'POST', body: JSON.stringify({ ...body, symbol }) })
    )
  },
  reset: (id: number) => req<PortfolioSummary>(`/${id}/reset`, { method: 'POST' }),
  /** Download holdings or transactions as CSV via the authenticated endpoint. */
  async exportCsv(id: number, type: 'holdings' | 'transactions'): Promise<void> {
    const res = await fetch(`${API_URL}/api/v1/portfolios/${id}/export?type=${type}`, { credentials: 'include' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new ApiError(errorText(data, res.status), res.status)
    }
    const blob = await res.blob()
    const cd = res.headers.get('content-disposition') || ''
    const name = /filename="([^"]+)"/.exec(cd)?.[1] || `portfolio_${type}.csv`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
}

export const portfolioKeys = {
  list: ['portfolios'] as const,
  detail: (id: number) => ['portfolios', id] as const,
  txns: (id: number) => ['portfolios', id, 'txns'] as const,
}

// ── formatting helpers ──────────────────────────────────────────────────────

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const usdCompact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 })

export function fmtMoney(v: number | null | undefined, opts: { compact?: boolean; signed?: boolean } = {}): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const s = (opts.compact && Math.abs(v) >= 100_000 ? usdCompact : usd).format(Math.abs(v))
  if (opts.signed) return `${v > 0 ? '+' : v < 0 ? '−' : ''}${s}`
  return v < 0 ? `−${s}` : s
}

export function fmtPct(v: number | null | undefined, signed = true): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const sign = signed ? (v > 0 ? '+' : v < 0 ? '−' : '') : v < 0 ? '−' : ''
  return `${sign}${Math.abs(v).toFixed(2)}%`
}

export function fmtQty(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

/** Tailwind text color for a gain/loss number (neutral for 0/null). */
export function pnlClass(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || Math.abs(v) < 0.005) return 'text-fg-secondary'
  return v > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
}

/** Stable colors for allocation slices (Cash is always neutral). */
const SLICE_COLORS = ['#6366f1', '#06b6d4', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#f97316', '#14b8a6', '#eab308', '#3b82f6']
export function sliceColor(label: string, index: number): string {
  if (label === 'Cash') return '#94a3b8'
  return SLICE_COLORS[index % SLICE_COLORS.length]
}

export function todayIso(): string {
  const d = new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10)
}

export function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Client-side preflight for a paper order so the form can show cost / buying power. */
export function estimateOrder(
  side: 'BUY' | 'SELL',
  qty: number,
  price: number | null | undefined,
  cash: number | null | undefined,
  held: number
): { notional: number | null; error: string | null } {
  if (!Number.isFinite(qty) || qty <= 0) return { notional: null, error: 'Enter a quantity above 0' }
  if (price == null || !(price > 0)) return { notional: null, error: null }
  const notional = qty * price
  if (side === 'BUY' && cash != null && notional > cash + 1e-6) {
    return { notional, error: `Not enough simulated cash (${fmtMoney(cash)} available)` }
  }
  if (side === 'SELL' && qty > held + 1e-9) {
    return { notional, error: `You hold ${fmtQty(held)} shares` }
  }
  return { notional, error: null }
}
