/**
 * Canonical quote contract shared by every quote surface (backend
 * app/services/canonical_quote.py).
 *
 * `price` / `change` / `change_percent` / `previous_close` are ALWAYS the
 * regular session. A pre-market / after-hours / overnight trade is only in
 * `extended` and is shown next to the price as a labelled badge
 * ("After hours 423.01 +4.18%"), never as the headline.
 *
 * Incident 2026-11-26 (Thanksgiving): the copilot showed AMD 423.01 (an
 * overnight print) while the research header showed 406.03 (the Nov 25
 * close). Both now read one backend quote.
 */

import { isNumber } from './format'

export type ExtendedSession = 'pre-market' | 'after-hours' | 'overnight'

export interface CanonicalRegular {
  price: number
  previous_close: number | null
  change: number | null
  change_percent: number | null
  /** ET trading date the price is from (YYYY-MM-DD). */
  session_date: string
  /** Trading date of the close the change is measured against. */
  previous_session_date: string
  /** UTC ISO close time once the session is over; null while it is live. */
  close_time: string | null
  live: boolean
}

export interface CanonicalExtended {
  price: number
  /** vs regular.price */
  change: number | null
  change_percent: number | null
  /** trade time of the print (UTC ISO); null when the provider gave none */
  time: string | null
  session: ExtendedSession | string
}

export interface CanonicalQuoteInfo {
  regular: CanonicalRegular | null
  extended: CanonicalExtended | null
  /** trade time of the regular price, never the fetch time */
  as_of: string | null
  source: string | null
  stale: boolean
  /** regular-session volume / open / high / low; null when unknown */
  volume?: number | null
  open?: number | null
  high?: number | null
  low?: number | null
}

const SESSION_LABEL: Record<string, string> = {
  'pre-market': 'Pre-market',
  'after-hours': 'After hours',
  overnight: 'Overnight',
}

export interface ExtendedBadge {
  label: string
  price: number
  changePercent: number | null
  /** e.g. "After hours 423.01 +4.18%" */
  text: string
  up: boolean
  time: string | null
}

/** Badge for an extended-hours print, or null when there is none. */
export function extendedBadge(ext: CanonicalExtended | null | undefined): ExtendedBadge | null {
  if (!ext || !isNumber(ext.price) || ext.price <= 0) return null
  const label = SESSION_LABEL[ext.session] ?? 'Extended hours'
  const pct = isNumber(ext.change_percent) ? ext.change_percent : null
  const pctText = pct === null ? '' : ` ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
  return {
    label,
    price: ext.price,
    changePercent: pct,
    text: `${label} ${ext.price.toFixed(2)}${pctText}`,
    up: (pct ?? 0) >= 0,
    time: ext.time ?? null,
  }
}

/** Pick the canonical fields out of any backend quote body (null if absent). */
export function canonicalQuoteInfo(body: unknown): CanonicalQuoteInfo | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const regular = (b.regular ?? null) as CanonicalRegular | null
  if (!regular || !isNumber(regular.price)) return null
  return {
    regular,
    extended: (b.extended ?? null) as CanonicalExtended | null,
    as_of: typeof b.as_of === 'string' ? b.as_of : null,
    source: typeof b.source === 'string' ? b.source : typeof b.data_source === 'string' ? b.data_source : null,
    stale: b.stale === true,
    // Regular-session bar figures (never the overnight venue's volume).
    volume: positive(b.volume),
    open: positive(b.open),
    high: positive(b.high),
    low: positive(b.low),
  }
}

function positive(v: unknown): number | null {
  return isNumber(v) && v > 0 ? v : null
}

interface PriceFields {
  price: number
  change: number
  change_percent: number
  prev_close: number
  volume?: number
  open?: number
  day_high?: number
  day_low?: number
  quote?: CanonicalQuoteInfo | null
}

/**
 * Overlay the canonical backend quote on a profile payload (FMP / Yahoo) so
 * the research header / tape show the same price, change and change % as the
 * copilot, watchlist and portfolio. Without a canonical quote the profile's
 * own numbers stay and `quote` is null.
 */
export function applyCanonicalQuote<T extends PriceFields>(
  info: T,
  q: CanonicalQuoteInfo | null,
): T & { quote: CanonicalQuoteInfo | null } {
  if (!q?.regular) return { ...info, quote: null }
  const r = q.regular
  return {
    ...info,
    price: r.price,
    change: isNumber(r.change) ? r.change : 0,
    change_percent: isNumber(r.change_percent) ? r.change_percent : 0,
    prev_close: isNumber(r.previous_close) ? r.previous_close : info.prev_close,
    ...(q.volume != null ? { volume: q.volume } : {}),
    ...(q.open != null ? { open: q.open } : {}),
    ...(q.high != null ? { day_high: q.high } : {}),
    ...(q.low != null ? { day_low: q.low } : {}),
    quote: q,
  }
}
