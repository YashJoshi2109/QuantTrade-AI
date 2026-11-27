/**
 * Marketwatch (Kite-style multiple watchlists) client, React Query hooks and pure
 * helpers. Desktop (components/marketwatch/*) and mobile (MobileWatchlist) both use
 * this module so they always show the same lists, prices and P&L.
 *
 * Backend: /api/v1/marketwatch (backend/app/api/marketwatch.py).
 *  - Lists store symbols and order only. Prices come from the canonical batch quote
 *    (/api/v1/quotes, QuoteCacheService), the same cache the Portfolio page and
 *    price alerts read, so an LTP or P&L figure agrees across surfaces.
 *  - The "Holdings" list is computed server-side from the user's portfolios with the
 *    Portfolio page's own valuation code. P&L is never recomputed here.
 *
 * Read-only: nothing in this module places, routes or simulates an order.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { isNumber } from './format'

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

// ── types ────────────────────────────────────────────────────────────────────

export interface WatchItem {
  symbol: string
  name: string | null
  exchange: string | null
  position: number
}

export interface WatchList {
  id: number
  name: string
  position: number
  is_default: boolean
  items: WatchItem[]
}

export interface MarketwatchData {
  lists: WatchList[]
  limits: { lists: number; items_per_list: number }
}

/** Regular-session quote (canonical contract: price/change are never an extended print). */
export interface WatchQuote {
  symbol: string
  price: number | null
  change: number | null
  change_percent: number | null
  previous_close: number | null
  open: number | null
  high: number | null
  low: number | null
  volume: number | null
  as_of: string | null
  source: string | null
  stale: boolean
  unavailable: boolean
  extended: { price: number; change_percent: number | null; session: string } | null
}

export interface HoldingRow {
  symbol: string
  name: string | null
  quantity: number
  avg_cost: number | null
  cost_basis: number | null
  price: number | null
  change_percent: number | null
  market_value: number | null
  unrealized_pnl: number | null
  unrealized_pnl_percent: number | null
  day_change: number | null
  portfolio_id: number
  portfolio_name: string
  simulated: boolean
}

export interface HoldingsPortfolio {
  id: number
  name: string
  kind: 'tracked' | 'paper'
  simulated: boolean
  market_value: number | null
  cost_basis: number | null
  unrealized_pnl: number | null
  day_change: number | null
  holding_count: number
}

export interface HoldingsData {
  holdings: HoldingRow[]
  portfolios: HoldingsPortfolio[]
  stale_quotes: string[]
}

export class MarketwatchError extends Error {
  status: number
  constructor(m: string, s: number) {
    super(m)
    this.status = s
  }
}

function errText(data: unknown, status: number): string {
  const d = (data as { detail?: unknown })?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d) && d.length) return String((d[0] as { msg?: string })?.msg || '').replace(/^Value error, /, '') || 'Invalid input'
  if (status === 401) return 'Please sign in to use watchlists'
  return `Request failed (${status})`
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1/marketwatch${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    credentials: 'include',
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new MarketwatchError(errText(data, res.status), res.status)
  return data as T
}

export const SYMBOL_RE = /^[A-Z0-9.\-]{1,10}$/

export const marketwatchApi = {
  get: () => req<MarketwatchData>(''),
  createList: (name: string) => req<WatchList>('/lists', { method: 'POST', body: JSON.stringify({ name }) }),
  renameList: (id: number, name: string) => req<{ id: number; name: string }>(`/lists/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteList: (id: number) => req<void>(`/lists/${id}`, { method: 'DELETE' }),
  orderLists: (ids: number[]) => req<MarketwatchData>('/lists/order', { method: 'PUT', body: JSON.stringify({ ids }) }),
  async addItem(listId: number, rawSymbol: string): Promise<WatchItem> {
    const symbol = rawSymbol.trim().toUpperCase()
    const send = () => req<WatchItem>(`/lists/${listId}/items`, { method: 'POST', body: JSON.stringify({ symbol }) })
    try {
      return await send()
    } catch (e) {
      // Unknown ticker: ask the backend to sync it once, then retry (same flow as alerts/portfolio).
      if (!(e instanceof MarketwatchError) || e.status !== 404 || !/symbol/i.test(e.message)) throw e
      const s = await fetch(`${API_URL}/api/v1/symbols/${encodeURIComponent(symbol)}/sync`, { method: 'POST' })
      if (!s.ok) throw new MarketwatchError(`Unknown symbol ${symbol}`, 404)
      return send()
    }
  },
  removeItem: (listId: number, symbol: string) => req<void>(`/lists/${listId}/items/${encodeURIComponent(symbol)}`, { method: 'DELETE' }),
  orderItems: (listId: number, symbols: string[]) =>
    req<{ id: number; symbols: string[] }>(`/lists/${listId}/items/order`, { method: 'PUT', body: JSON.stringify({ symbols }) }),
  holdings: () => req<HoldingsData>('/holdings'),
}

// ── canonical batch quotes (/api/v1/quotes) ──────────────────────────────────

const BATCH = 50 // backend cap per request

function num(v: unknown): number | null {
  return isNumber(v) ? v : null
}

/** Map one /api/v1/quotes entry to a WatchQuote. Never invents a value. */
export function toWatchQuote(symbol: string, raw: Record<string, unknown> | null | undefined): WatchQuote {
  const r = raw || {}
  const regular = (r.regular || null) as Record<string, unknown> | null
  const ext = (r.extended || null) as Record<string, unknown> | null
  const price = num(regular?.price) ?? num(r.price)
  const unavailable = r.unavailable === true || price == null || price <= 0
  return {
    symbol,
    price: unavailable ? null : price,
    change: unavailable ? null : num(regular?.change) ?? num(r.change),
    change_percent: unavailable ? null : num(regular?.change_percent) ?? num(r.change_percent),
    previous_close: num(regular?.previous_close) ?? num(r.previous_close),
    open: num(r.open),
    high: num(r.high),
    low: num(r.low),
    volume: num(r.volume),
    as_of: typeof r.as_of === 'string' ? r.as_of : typeof r.market_time === 'string' ? r.market_time : null,
    source: typeof r.data_source === 'string' ? r.data_source : null,
    stale: r.stale === true,
    unavailable,
    extended:
      ext && isNumber(ext.price) && (ext.price as number) > 0
        ? { price: ext.price as number, change_percent: num(ext.change_percent), session: String(ext.session || '') }
        : null,
  }
}

export async function fetchWatchQuotes(symbols: string[]): Promise<Record<string, WatchQuote>> {
  const uniq = Array.from(new Set(symbols.map((s) => s.toUpperCase()))).filter(Boolean)
  const out: Record<string, WatchQuote> = {}
  for (let i = 0; i < uniq.length; i += BATCH) {
    const chunk = uniq.slice(i, i + BATCH)
    const res = await fetch(`${API_URL}/api/v1/quotes?symbols=${encodeURIComponent(chunk.join(','))}`, { credentials: 'include' })
    if (!res.ok) throw new MarketwatchError(`Quotes unavailable (${res.status})`, res.status)
    const body = (await res.json().catch(() => ({}))) as { quotes?: Record<string, Record<string, unknown>> }
    for (const s of chunk) out[s] = toWatchQuote(s, body.quotes?.[s])
  }
  return out
}

// ── pure helpers (unit-tested in marketwatch.test.ts) ─────────────────────────

/**
 * Minimal quote from a Holdings row (the server's LTP + day %), for a dialog opened
 * from the Holdings tab before the full canonical quote has loaded. No other field is guessed.
 */
export function quoteFromHolding(symbol: string, rows: readonly HoldingRow[]): WatchQuote | undefined {
  const h = rows.find((r) => r.symbol === symbol && r.price != null)
  if (!h) return undefined
  return {
    symbol, price: h.price, change: null, change_percent: h.change_percent, previous_close: null, open: null, high: null,
    low: null, volume: null, as_of: null, source: null, stale: false, unavailable: false, extended: null,
  }
}

/** Move one element; returns a new array. Out-of-range indexes return a copy. */
export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  const next = arr.slice()
  if (from < 0 || from >= arr.length || to < 0 || to >= arr.length || from === to) return next
  const [x] = next.splice(from, 1)
  next.splice(to, 0, x)
  return next
}

export function clampIndex(i: number, n: number): number {
  if (n <= 0) return -1
  return Math.max(0, Math.min(n - 1, i))
}

export type SortMode = 'manual' | 'symbol' | 'change' | 'ltp'
export const SORT_LABEL: Record<SortMode, string> = {
  manual: 'My order',
  symbol: 'A–Z',
  change: '% change',
  ltp: 'Price',
}

/** View-only sort (stored order is untouched). Symbols without a quote go last. */
export function sortItems<T extends { symbol: string }>(items: readonly T[], quotes: Record<string, WatchQuote | undefined>, mode: SortMode): T[] {
  if (mode === 'manual') return items.slice()
  if (mode === 'symbol') return items.slice().sort((a, b) => a.symbol.localeCompare(b.symbol))
  const key = (s: string) => {
    const q = quotes[s]
    const v = mode === 'change' ? q?.change_percent : q?.price
    return v == null ? null : v
  }
  return items.slice().sort((a, b) => {
    const ka = key(a.symbol)
    const kb = key(b.symbol)
    if (ka == null && kb == null) return a.symbol.localeCompare(b.symbol)
    if (ka == null) return 1
    if (kb == null) return -1
    return kb - ka
  })
}

/**
 * GTT-style single trigger: the alert direction follows from where the trigger sits
 * relative to the last price. A trigger at the LTP would fire immediately: null.
 */
export function gttCondition(trigger: number, ltp: number | null | undefined): 'price_above' | 'price_below' | null {
  if (!Number.isFinite(trigger) || trigger <= 0) return null
  if (ltp == null || !Number.isFinite(ltp) || ltp <= 0) return null
  if (Math.abs(trigger - ltp) < 1e-9) return null
  return trigger > ltp ? 'price_above' : 'price_below'
}

/** Signed % distance of `target` from `ltp`. */
export function pctFrom(ltp: number | null | undefined, target: number | null | undefined): number | null {
  if (ltp == null || target == null || !Number.isFinite(ltp) || !Number.isFinite(target) || ltp <= 0) return null
  return ((target - ltp) / ltp) * 100
}

/** Where the LTP sits inside the day's range, 0..1 (null when the range is unknown). */
export function rangePosition(price: number | null, low: number | null, high: number | null): number | null {
  if (price == null || low == null || high == null || !(high > low)) return null
  return Math.max(0, Math.min(1, (price - low) / (high - low)))
}

export interface HeldSummary {
  quantity: number
  simulatedQuantity: number
  portfolios: string[]
}

/** Quantity held per symbol across portfolios; real (tracked) and simulated kept apart. */
export function holdingsBySymbol(rows: readonly HoldingRow[]): Record<string, HeldSummary> {
  const out: Record<string, HeldSummary> = {}
  for (const r of rows) {
    const h = (out[r.symbol] ||= { quantity: 0, simulatedQuantity: 0, portfolios: [] })
    if (r.simulated) h.simulatedQuantity += r.quantity
    else h.quantity += r.quantity
    if (!h.portfolios.includes(r.portfolio_name)) h.portfolios.push(r.portfolio_name)
  }
  return out
}

export interface HoldingsTotals {
  marketValue: number
  costBasis: number
  unrealizedPnl: number
  unrealizedPct: number | null
  dayChange: number
  priced: number
  unpriced: number
}

/**
 * Totals from the backend's own per-row values (never recomputed from price).
 * Rows without a quote are excluded from value and cost alike, so the % is honest.
 */
export function holdingsTotals(rows: readonly HoldingRow[]): HoldingsTotals {
  let mv = 0, cost = 0, pnl = 0, day = 0, priced = 0, unpriced = 0
  for (const r of rows) {
    if (r.market_value == null) {
      unpriced++
      continue
    }
    priced++
    mv += r.market_value
    cost += r.cost_basis ?? 0
    pnl += r.unrealized_pnl ?? 0
    day += r.day_change ?? 0
  }
  return { marketValue: mv, costBasis: cost, unrealizedPnl: pnl, unrealizedPct: cost > 0 ? (pnl / cost) * 100 : null, dayChange: day, priced, unpriced }
}

/** Default name for a new list: "Watchlist N" with the first free N. */
export function nextListName(lists: readonly { name: string }[]): string {
  const taken = new Set(lists.map((l) => l.name.toLowerCase()))
  for (let n = lists.length + 1; n < 100; n++) {
    const name = `Watchlist ${n}`
    if (!taken.has(name.toLowerCase())) return name
  }
  return `Watchlist ${Date.now() % 1000}`
}

const priceFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const smallFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

/** LTP without a currency sign (dense rows); 4 decimals under $1. */
export function fmtLtp(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return (Math.abs(v) < 1 ? smallFmt : priceFmt).format(v)
}

export function fmtSigned(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const s = Math.abs(v).toFixed(digits)
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s
}

/** Tailwind class for direction (green up / red down / neutral). */
export function dirClass(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || Math.abs(v) < 1e-9) return 'text-fg-secondary'
  return v > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
}

// ── price history ranges ─────────────────────────────────────────────────────

/**
 * 1D / 1W come from the intraday route (/api/v1/prices/{s}/intraday); the rest
 * from stored daily bars (/api/v1/prices/{s}). Each range is backed by a real series.
 */
export const RANGES = ['1D', '1W', '1M', '3M', '6M', '1Y', '2Y'] as const
export type RangeKey = (typeof RANGES)[number]
export const INTRADAY_RANGES: Record<'1D' | '1W', { interval: '5m' | '15m'; days: number }> = {
  '1D': { interval: '5m', days: 1 },
  '1W': { interval: '15m', days: 5 },
}
const RANGE_MONTHS: Record<Exclude<RangeKey, '1D' | '1W'>, number> = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '2Y': 24 }

export function isIntradayRange(r: RangeKey): r is '1D' | '1W' {
  return r === '1D' || r === '1W'
}

/** ISO start/end for a daily range ending at `now`, plus a bar limit that covers it. */
export function rangeWindow(range: Exclude<RangeKey, '1D' | '1W'>, now = new Date()): { start: string; end: string; limit: number } {
  const start = new Date(now)
  start.setMonth(start.getMonth() - RANGE_MONTHS[range])
  return { start: start.toISOString(), end: now.toISOString(), limit: Math.max(30, RANGE_MONTHS[range] * 23 + 5) }
}

/** Mean of positive volumes (null when there are none). Used for "Avg Vol" from stored bars. */
export function avgVolume(volumes: readonly (number | null | undefined)[]): number | null {
  let sum = 0
  let n = 0
  for (const v of volumes) {
    if (v != null && Number.isFinite(v) && v > 0) {
      sum += v
      n++
    }
  }
  return n ? sum / n : null
}

/**
 * Min–max y domain for a PRICE chart, padded 6%. lib/lineChart's valueDomain pins 0
 * into the domain (right for returns), which flattens a price line into a strip.
 */
export function priceDomain(values: readonly (number | null | undefined)[]): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (!Number.isFinite(lo)) return [0, 1]
  if (hi - lo < 1e-9) {
    const d = Math.abs(lo) * 0.01 || 1
    return [lo - d, hi + d]
  }
  const pad = (hi - lo) * 0.06
  return [lo - pad, hi + pad]
}

/**
 * SVG polyline points for a sparkline in a w x h box (oldest first).
 * Returns '' with fewer than two finite values so the row draws nothing rather than a fake line.
 */
export function sparkPoints(values: readonly number[], w: number, h: number, pad = 1): string {
  const v = values.filter((x) => Number.isFinite(x))
  if (v.length < 2) return ''
  const lo = Math.min(...v)
  const hi = Math.max(...v)
  const span = hi - lo || 1
  return v
    .map((x, i) => {
      const px = pad + (i / (v.length - 1)) * (w - 2 * pad)
      const py = hi === lo ? h / 2 : pad + (1 - (x - lo) / span) * (h - 2 * pad)
      return `${px.toFixed(1)},${py.toFixed(1)}`
    })
    .join(' ')
}

export async function fetchSparklines(symbols: string[]): Promise<Record<string, number[]>> {
  const uniq = Array.from(new Set(symbols.map((s) => s.toUpperCase()))).filter(Boolean)
  const out: Record<string, number[]> = {}
  for (let i = 0; i < uniq.length; i += BATCH) {
    const chunk = uniq.slice(i, i + BATCH)
    const r = await req<{ sparklines: Record<string, number[]> }>(`/sparklines?symbols=${encodeURIComponent(chunk.join(','))}`)
    Object.assign(out, r.sparklines || {})
  }
  return out
}

// ── React Query hooks ────────────────────────────────────────────────────────

export const marketwatchKeys = {
  lists: ['marketwatch'] as const,
  holdings: ['marketwatch', 'holdings'] as const,
  quotes: (symbols: string[]) => ['marketwatch', 'quotes', symbols.slice().sort().join(',')] as const,
  sparks: (symbols: string[]) => ['marketwatch', 'sparks', symbols.slice().sort().join(',')] as const,
}

/** Row sparklines from stored daily closes (refreshed rarely: daily data). */
export function useSparklines(symbols: string[], enabled = true) {
  return useQuery({
    queryKey: marketwatchKeys.sparks(symbols),
    queryFn: () => fetchSparklines(symbols),
    enabled: enabled && symbols.length > 0,
    staleTime: 15 * 60_000,
    placeholderData: (prev) => prev,
  })
}

export function useMarketwatch(enabled: boolean) {
  return useQuery({ queryKey: marketwatchKeys.lists, queryFn: marketwatchApi.get, enabled, staleTime: 30_000 })
}

export function useHoldingsWatch(enabled: boolean, refetchMs = 60_000) {
  return useQuery({ queryKey: marketwatchKeys.holdings, queryFn: marketwatchApi.holdings, enabled, refetchInterval: refetchMs, staleTime: 20_000 })
}

export function useWatchQuotes(symbols: string[], refetchMs: number | false) {
  return useQuery({
    queryKey: marketwatchKeys.quotes(symbols),
    queryFn: () => fetchWatchQuotes(symbols),
    enabled: symbols.length > 0,
    refetchInterval: refetchMs,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  })
}

function setLists(qc: QueryClient, fn: (lists: WatchList[]) => WatchList[]) {
  qc.setQueryData<MarketwatchData>(marketwatchKeys.lists, (old) => (old ? { ...old, lists: fn(old.lists) } : old))
}

export function useMarketwatchMutations() {
  const qc = useQueryClient()
  const refresh = () => {
    qc.invalidateQueries({ queryKey: marketwatchKeys.lists, exact: true })
    // the default list mirrors the classic watchlist other pages read
    qc.invalidateQueries({ queryKey: ['watchlist'] })
  }
  const snapshot = () => qc.getQueryData<MarketwatchData>(marketwatchKeys.lists)
  const restore = (prev?: MarketwatchData) => prev && qc.setQueryData(marketwatchKeys.lists, prev)

  return {
    createList: useMutation({ mutationFn: (name: string) => marketwatchApi.createList(name), onSettled: refresh }),
    renameList: useMutation({
      mutationFn: ({ id, name }: { id: number; name: string }) => marketwatchApi.renameList(id, name),
      onMutate: ({ id, name }) => {
        const prev = snapshot()
        setLists(qc, (ls) => ls.map((l) => (l.id === id ? { ...l, name } : l)))
        return { prev }
      },
      onError: (_e, _v, ctx) => restore(ctx?.prev),
      onSettled: refresh,
    }),
    deleteList: useMutation({ mutationFn: (id: number) => marketwatchApi.deleteList(id), onSettled: refresh }),
    orderLists: useMutation({
      mutationFn: (ids: number[]) => marketwatchApi.orderLists(ids),
      onMutate: (ids) => {
        const prev = snapshot()
        setLists(qc, (ls) => ids.map((id) => ls.find((l) => l.id === id)).filter((l): l is WatchList => !!l))
        return { prev }
      },
      onError: (_e, _v, ctx) => restore(ctx?.prev),
      onSettled: refresh,
    }),
    addItem: useMutation({
      mutationFn: ({ listId, symbol }: { listId: number; symbol: string }) => marketwatchApi.addItem(listId, symbol),
      onMutate: ({ listId, symbol }) => {
        const prev = snapshot()
        const sym = symbol.trim().toUpperCase()
        setLists(qc, (ls) =>
          ls.map((l) =>
            l.id === listId && !l.items.some((i) => i.symbol === sym)
              ? { ...l, items: [...l.items, { symbol: sym, name: null, exchange: null, position: l.items.length }] }
              : l
          )
        )
        return { prev }
      },
      onError: (_e, _v, ctx) => restore(ctx?.prev),
      onSettled: refresh,
    }),
    removeItem: useMutation({
      mutationFn: ({ listId, symbol }: { listId: number; symbol: string }) => marketwatchApi.removeItem(listId, symbol),
      onMutate: ({ listId, symbol }) => {
        const prev = snapshot()
        setLists(qc, (ls) => ls.map((l) => (l.id === listId ? { ...l, items: l.items.filter((i) => i.symbol !== symbol) } : l)))
        return { prev }
      },
      onError: (_e, _v, ctx) => restore(ctx?.prev),
      onSettled: refresh,
    }),
    orderItems: useMutation({
      mutationFn: ({ listId, symbols }: { listId: number; symbols: string[] }) => marketwatchApi.orderItems(listId, symbols),
      onMutate: ({ listId, symbols }) => {
        const prev = snapshot()
        setLists(qc, (ls) =>
          ls.map((l) =>
            l.id === listId
              ? { ...l, items: symbols.map((s, i) => ({ ...(l.items.find((x) => x.symbol === s) as WatchItem), position: i })) }
              : l
          )
        )
        return { prev }
      },
      onError: (_e, _v, ctx) => restore(ctx?.prev),
      onSettled: refresh,
    }),
  }
}
