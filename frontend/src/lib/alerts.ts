/**
 * Price / indicator alerts client + shared helpers (desktop and mobile views both use these).
 * Backend: /api/v1/alerts (backend/app/api/alerts.py). Triggered alerts show up as
 * "Price Alert" items in /notifications; Pro users can also opt into email.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

export type AlertCondition =
  | 'price_above'
  | 'price_below'
  | 'change_up_pct'
  | 'change_down_pct'
  | 'rsi_above'
  | 'rsi_below'
  | 'earnings_within_days'

export type AlertStatus = 'active' | 'triggered' | 'paused'

export interface PriceAlert {
  id: number
  symbol: string
  name: string | null
  condition: AlertCondition
  condition_label: string
  /** price | change | rsi | earnings */
  metric?: string
  threshold: number
  status: AlertStatus
  repeat: boolean
  armed: boolean
  notify_email: boolean
  note: string | null
  trigger_count: number
  last_triggered_at: string | null
  last_triggered_value: number | null
  last_checked_at: string | null
  last_value: number | null
  /** Earnings alerts: report date (YYYY-MM-DD) that last fired. */
  last_event_key?: string | null
  current_price: number | null
  change_percent: number | null
  created_at: string | null
}

export interface AlertInput {
  symbol: string
  condition: AlertCondition
  threshold: number
  repeat?: boolean
  notify_email?: boolean
  note?: string
}

/** UI metadata. Bounds mirror backend CONDITIONS (server re-validates). */
export const CONDITION_META: Record<
  AlertCondition,
  { short: string; label: string; unit: '$' | '%' | '' | 'days'; min: number; max: number; step: string; hint: string }
> = {
  price_above: { short: 'Price ≥', label: 'Price rises above', unit: '$', min: 0.0001, max: 10_000_000, step: '0.01', hint: 'Fires when the last price is at or above this level.' },
  price_below: { short: 'Price ≤', label: 'Price falls below', unit: '$', min: 0.0001, max: 10_000_000, step: '0.01', hint: 'Fires when the last price is at or below this level.' },
  change_up_pct: { short: 'Day ▲', label: 'Up on the day by', unit: '%', min: 0.1, max: 100, step: '0.1', hint: 'Percent change vs. the previous close.' },
  change_down_pct: { short: 'Day ▼', label: 'Down on the day by', unit: '%', min: 0.1, max: 100, step: '0.1', hint: 'Size of the drop vs. the previous close, e.g. 3 = down 3% or more.' },
  rsi_above: { short: 'RSI ≥', label: 'RSI(14) above', unit: '', min: 1, max: 99, step: '1', hint: 'Daily RSI(14) including today’s price. 70+ is often read as overbought.' },
  rsi_below: { short: 'RSI ≤', label: 'RSI(14) below', unit: '', min: 1, max: 99, step: '1', hint: 'Daily RSI(14) including today’s price. 30 or lower is often read as oversold.' },
  earnings_within_days: { short: 'Earnings', label: 'Earnings report within', unit: 'days', min: 1, max: 30, step: '1', hint: 'Fires once per earnings report, N days (or fewer) before the scheduled date.' },
}

export const CONDITION_ORDER: AlertCondition[] = [
  'price_above', 'price_below', 'change_up_pct', 'change_down_pct', 'rsi_above', 'rsi_below',
  'earnings_within_days',
]

export const isEarningsCondition = (c: AlertCondition) => c === 'earnings_within_days'

export function formatThreshold(c: AlertCondition, v: number): string {
  const u = CONDITION_META[c].unit
  if (u === '$') return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
  if (u === '%') return `${v}%`
  if (u === 'days') return `${v} day${v === 1 ? '' : 's'}`
  return String(v)
}

export function describeAlert(a: Pick<PriceAlert, 'condition' | 'threshold'>): string {
  return `${CONDITION_META[a.condition].label} ${formatThreshold(a.condition, a.threshold)}`
}

/** How far the current price is from a price alert's level (null for non-price alerts). */
export function distanceToLevel(a: Pick<PriceAlert, 'condition' | 'threshold' | 'current_price'>): number | null {
  if (a.current_price == null || a.current_price <= 0) return null
  if (a.condition !== 'price_above' && a.condition !== 'price_below') return null
  return ((a.threshold - a.current_price) / a.current_price) * 100
}

/** Earnings alerts: "Reports in 3 days" from the last evaluation, or null for other alerts. */
export function earningsCountdown(a: Pick<PriceAlert, 'condition' | 'last_value'>): string | null {
  if (!isEarningsCondition(a.condition)) return null
  const d = a.last_value
  if (d == null || !Number.isFinite(d) || d < 0) return 'Next report not scheduled yet'
  if (d === 0) return 'Reports today'
  if (d === 1) return 'Reports tomorrow'
  return `Reports in ${d} days`
}

export function validateThreshold(c: AlertCondition, raw: string): string | null {
  const v = Number(raw)
  const m = CONDITION_META[c]
  if (raw.trim() === '' || !Number.isFinite(v)) return 'Enter a number'
  if (v < m.min || v > m.max) return `Must be between ${m.min} and ${m.max.toLocaleString('en-US')}`
  if (m.unit === 'days' && !Number.isInteger(v)) return 'Use a whole number of days'
  return null
}

export const STATUS_STYLE: Record<AlertStatus, string> = {
  active: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25',
  triggered: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25',
  paused: 'bg-surface-raised text-fg-secondary border-line-default',
}

class AlertApiError extends Error {
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
  if (status === 401) return 'Please sign in to manage alerts'
  return `Request failed (${status})`
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1/alerts${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    credentials: 'include',
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new AlertApiError(errText(data, res.status), res.status)
  return data as T
}

export const alertsApi = {
  list: () => req<{ alerts: PriceAlert[]; limit: number }>(''),
  async create(body: AlertInput): Promise<PriceAlert> {
    const symbol = body.symbol.trim().toUpperCase()
    const send = () => req<PriceAlert>('', { method: 'POST', body: JSON.stringify({ ...body, symbol }) })
    try {
      return await send()
    } catch (e) {
      // Unknown ticker: ask the backend to sync it once, then retry (same as Watchlist).
      if (!(e instanceof AlertApiError) || e.status !== 404) throw e
      const s = await fetch(`${API_URL}/api/v1/symbols/${encodeURIComponent(symbol)}/sync`, { method: 'POST' })
      if (!s.ok) throw new AlertApiError(`Unknown symbol ${symbol}`, 404)
      return send()
    }
  },
  update: (id: number, body: Partial<Pick<PriceAlert, 'threshold' | 'repeat' | 'notify_email' | 'note'>> & { status?: 'active' | 'paused' }) =>
    req<PriceAlert>(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: number) => req<void>(`/${id}`, { method: 'DELETE' }),
  suggestions: (limit = 12) => req<SuggestionsResponse>(`/suggestions?limit=${limit}`),
}

// ── Suggested alerts (GET /api/v1/alerts/suggestions) ─────────────────────────

export type SuggestionSource =
  | 'portfolio'
  | 'watchlist'
  | 'near_52w_high'
  | 'near_52w_low'
  | 'top_mover'
  | 'upcoming_earnings'

export interface AlertSuggestion {
  /** Stable "SYMBOL:condition:threshold"; used for dismissal. */
  id: string
  symbol: string
  name: string | null
  condition: AlertCondition
  condition_label: string
  threshold: number
  /** Human reason, e.g. "AAPL is 1.2% below its 52-week high of $X". */
  reason: string
  source: SuggestionSource
  /** Short headline, e.g. "Stop-loss", "Breakout". */
  label: string
  current_price: number | null
  change_percent: number | null
  repeat: boolean
  note: string | null
  score: number
}

export interface SuggestionsResponse {
  suggestions: AlertSuggestion[]
  signed_in: boolean
  personalized: boolean
  as_of: string
}

export const SOURCE_META: Record<SuggestionSource, { label: string; cls: string }> = {
  portfolio: { label: 'Your portfolio', cls: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/25' },
  watchlist: { label: 'Watchlist', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25' },
  near_52w_high: { label: 'Near 52w high', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25' },
  near_52w_low: { label: 'Near 52w low', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25' },
  top_mover: { label: 'Top mover', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25' },
  upcoming_earnings: { label: 'Earnings soon', cls: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/25' },
}

export function suggestionToInput(s: AlertSuggestion): AlertInput {
  return {
    symbol: s.symbol,
    condition: s.condition,
    threshold: s.threshold,
    repeat: s.repeat,
    notify_email: false,
    note: s.note || undefined,
  }
}

/** Dismissed suggestion ids -> dismissed-at (ms). Per browser; a dismissal lasts a week. */
export const DISMISS_KEY = 'qt:alert-suggestions:dismissed'
export const DISMISS_TTL_MS = 7 * 24 * 3600 * 1000

export function pruneDismissed(map: Record<string, number>, now: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, t] of Object.entries(map || {})) {
    if (typeof t === 'number' && now - t < DISMISS_TTL_MS) out[k] = t
  }
  return out
}

export function readDismissed(now = Date.now()): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY)
    return pruneDismissed(raw ? (JSON.parse(raw) as Record<string, number>) : {}, now)
  } catch {
    return {}
  }
}

export function writeDismissed(map: Record<string, number>): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify(map))
  } catch {
    /* private mode / blocked storage: dismissal lasts for this page view only */
  }
}

/** Suggestions still worth showing: not dismissed, not just added, not already an alert. */
export function visibleSuggestions(
  list: AlertSuggestion[],
  hidden: Record<string, unknown>,
  alerts: Pick<PriceAlert, 'symbol' | 'condition' | 'status'>[] = [],
): AlertSuggestion[] {
  const have = new Set(alerts.filter((a) => a.status !== 'triggered').map((a) => `${a.symbol}:${a.condition}`))
  return list.filter((s) => !(s.id in hidden) && !have.has(`${s.symbol}:${s.condition}`))
}

const KEY = ['price-alerts'] as const
const SUGGEST_KEY = ['price-alert-suggestions'] as const

export function useAlertSuggestions(signedIn: boolean, enabled = true) {
  return useQuery({
    queryKey: [...SUGGEST_KEY, signedIn],
    queryFn: () => alertsApi.suggestions(12),
    enabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  })
}

/** One-click add with an optimistic row in the alerts list (rolled back on error). */
export function useAddSuggestion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (s: AlertSuggestion) => alertsApi.create(suggestionToInput(s)),
    onMutate: async (s) => {
      await qc.cancelQueries({ queryKey: KEY })
      const prev = qc.getQueryData<{ alerts: PriceAlert[]; limit: number }>(KEY)
      if (prev) {
        const temp: PriceAlert = {
          id: -Date.now(), symbol: s.symbol, name: s.name, condition: s.condition, condition_label: s.condition_label,
          threshold: s.threshold, status: 'active', repeat: s.repeat, armed: true, notify_email: false, note: s.note,
          trigger_count: 0, last_triggered_at: null, last_triggered_value: null, last_checked_at: null, last_value: null,
          last_event_key: null, current_price: s.current_price, change_percent: s.change_percent, created_at: new Date().toISOString(),
        }
        qc.setQueryData(KEY, { ...prev, alerts: [temp, ...prev.alerts] })
      }
      return { prev }
    },
    onError: (_e, _s, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: KEY })
      qc.invalidateQueries({ queryKey: SUGGEST_KEY })
    },
  })
}

export function useAlerts(enabled: boolean) {
  return useQuery({ queryKey: KEY, queryFn: alertsApi.list, enabled, refetchInterval: 60_000, staleTime: 20_000 })
}

export function useAlertMutations() {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: KEY })
  return {
    create: useMutation({ mutationFn: alertsApi.create, onSuccess: done }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: number } & Parameters<typeof alertsApi.update>[1]) => alertsApi.update(id, body),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: alertsApi.remove, onSuccess: done }),
  }
}
