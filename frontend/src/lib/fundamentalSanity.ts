/**
 * Plausibility rules for fundamentals shown on Research (stats card, Company
 * Folio, Fundamentals tab). Mirrors backend app/services/fundamental_sanity.py
 * so values reaching the page from other routes (/api/quotes/ticker, FMP,
 * Yahoo) get the same treatment.
 *
 * PARA on 2026-11-27 (a $2.74 microcap after an unadjusted reverse split)
 * showed a 52-week high of $39,200, EPS of $25,891 on a $1.86M market cap and
 * ROE of -250% as facts. An implausible value renders "—" with a tooltip that
 * says why; derived values (backend `field_notes` status "derived") carry
 * their source in the tooltip.
 */

export const HIGH_52W_MAX_MULT = 50
export const LOW_52W_MIN_DIV = 50
export const RANGE_TOLERANCE = 0.03
export const EPS_EARNINGS_MAX_MULT = 20
export const RATIO_ABS_MAX = 200
export const TARGET_MAX_MULT = 20
export const MIN_POSITIVE_PE = 0.5
export const BETA_ABS_MAX = 10
export const DIVIDEND_YIELD_MAX = 30

export interface FieldNote {
  status: 'implausible' | 'derived' | 'n/m' | 'n/a'
  reason?: string
  source?: string
}
export type FieldNotes = Record<string, FieldNote>

export interface SanityInput {
  week_52_high?: number | null
  week_52_low?: number | null
  eps?: number | null
  pe_ratio?: number | null
  forward_pe?: number | null
  roe?: number | null
  roa?: number | null
  target_price?: number | null
  beta?: number | null
  dividend_yield?: number | null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

const money = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** {field: reason} for values that contradict the price (or each other). */
export function implausibleReasons(f: SanityInput | null | undefined, price: number | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!f) return out
  const p = num(price) !== null && (price as number) > 0 ? (price as number) : null
  const hi = num(f.week_52_high)
  const lo = num(f.week_52_low)
  if (p) {
    if (hi !== null && hi > p * HIGH_52W_MAX_MULT) out.week_52_high = `52-week high ${money(hi)} is over ${HIGH_52W_MAX_MULT}x the price (${money(p)}): likely an unadjusted split.`
    else if (hi !== null && hi < p * (1 - RANGE_TOLERANCE)) out.week_52_high = `52-week high ${money(hi)} is below the current price (${money(p)}).`
    if (lo !== null && lo < p / LOW_52W_MIN_DIV) out.week_52_low = `52-week low ${money(lo)} is under 1/${LOW_52W_MIN_DIV} of the price: likely an unadjusted split.`
    else if (lo !== null && lo > p * (1 + RANGE_TOLERANCE)) out.week_52_low = `52-week low ${money(lo)} is above the current price (${money(p)}).`
    const eps = num(f.eps)
    if (eps !== null && Math.abs(eps) > p * EPS_EARNINGS_MAX_MULT) out.eps = `EPS ${money(eps)} implies earnings over ${EPS_EARNINGS_MAX_MULT}x the market cap at ${money(p)} a share: likely not split-adjusted.`
    const tgt = num(f.target_price)
    if (tgt !== null && tgt > 0 && (tgt > p * TARGET_MAX_MULT || tgt < p / TARGET_MAX_MULT)) out.target_price = `Analyst target ${money(tgt)} is more than ${TARGET_MAX_MULT}x away from the price.`
  }
  if (hi !== null && lo !== null && lo > hi) out.week_52_low = out.week_52_high = '52-week low is above the 52-week high.'
  for (const k of ['pe_ratio', 'forward_pe'] as const) {
    const v = num(f[k])
    if (v !== null && v > 0 && v < MIN_POSITIVE_PE) out[k] = `P/E of ${v.toFixed(4)} implies EPS over ${1 / MIN_POSITIVE_PE}x the share price.`
  }
  for (const [k, label] of [['roe', 'ROE'], ['roa', 'ROA']] as const) {
    const v = num(f[k])
    if (v !== null && Math.abs(v) > RATIO_ABS_MAX) out[k] = `${label} of ${v.toFixed(0)}% is outside ±${RATIO_ABS_MAX}% (tiny or negative equity base).`
  }
  const b = num(f.beta)
  if (b !== null && Math.abs(b) > BETA_ABS_MAX) out.beta = `Beta of ${b.toFixed(1)} is not meaningful (short or broken price history).`
  const dy = num(f.dividend_yield)
  if (dy !== null && dy > DIVIDEND_YIELD_MAX) out.dividend_yield = `Dividend yield of ${dy.toFixed(1)}% is implausible for common stock.`
  return out
}

/** Copy with implausible fields nulled, plus merged notes (backend notes kept). */
export function sanitizeFundamentals<T extends SanityInput>(
  f: T | null | undefined,
  price: number | null | undefined,
  backendNotes?: FieldNotes | null,
): { values: T | null; notes: FieldNotes } {
  const notes: FieldNotes = { ...(backendNotes ?? {}) }
  if (!f) return { values: null, notes }
  const values = { ...f }
  for (const [k, reason] of Object.entries(implausibleReasons(f, price))) {
    ;(values as Record<string, unknown>)[k] = null
    notes[k] = { status: 'implausible', reason }
  }
  return { values, notes }
}

const TICKER_FIELDS: Array<[string, keyof SanityInput, string]> = [
  ['week_52_high', 'week_52_high', '52W High'],
  ['week_52_low', 'week_52_low', '52W Low'],
  ['eps', 'eps', 'EPS'],
  ['pe_ratio', 'pe_ratio', 'P/E Ratio'],
  ['forward_pe', 'forward_pe', 'Fwd P/E'],
  ['return_on_equity', 'roe', 'Return on Equity'],
  ['return_on_assets', 'roa', 'Return on Assets'],
  ['target_price', 'target_price', 'Target'],
  ['target_high', 'target_price', 'Target High'],
  ['target_low', 'target_price', 'Target Low'],
  ['beta', 'beta', 'Beta'],
  ['dividend_yield', 'dividend_yield', 'Div Yield'],
]

/**
 * Same rules for a ticker profile (/api/quotes/ticker shape, used by Company
 * Folio): implausible fields are zeroed (the folio renders 0 as "—") and
 * listed in `hidden` with the reason for a tooltip.
 */
export function sanitizeTickerInfo<T extends object & { price?: number | null }>(
  info: T,
): { info: T; hidden: Array<{ label: string; reason: string }> } {
  const src = info as unknown as Record<string, unknown>
  const hidden: Array<{ label: string; reason: string }> = []
  const out = { ...src }
  const price = num(src.price)
  for (const [field, rule, label] of TICKER_FIELDS) {
    const v = num(src[field])
    if (v === null) continue
    const reason = implausibleReasons({ [rule]: v } as SanityInput, price)[rule]
    if (reason) {
      out[field] = 0
      hidden.push({ label, reason })
    }
  }
  return { info: out as unknown as T, hidden }
}

/** Tooltip text for a field: why it is hidden, or where a derived value came from. */
export function fieldTooltip(notes: FieldNotes | null | undefined, field: string): string | undefined {
  const n = notes?.[field]
  if (!n) return undefined
  if (n.status === 'implausible') return `Hidden: ${n.reason ?? 'value is implausible'}`
  if (n.status === 'derived') return `Derived: ${n.source ?? 'computed from other data'}`
  return n.reason
}

/** "n/m" for a loss-maker's P/E, "n/a" for funds; otherwise undefined. */
export function notMeaningfulLabel(notes: FieldNotes | null | undefined, field: string): string | undefined {
  const s = notes?.[field]?.status
  return s === 'n/m' ? 'n/m' : s === 'n/a' ? 'n/a' : undefined
}
