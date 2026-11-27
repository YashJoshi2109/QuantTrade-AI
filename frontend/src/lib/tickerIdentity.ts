/**
 * Ticker identity (stale / reassigned tickers) for the Research views.
 *
 * Tickers get reassigned after mergers and delistings: PARA was Paramount
 * Global, merged into Paramount Skydance (PSKY), now Skydance Corp (SKYD), and
 * SEC now gives PARA to an unrelated filer. Backend
 * `/api/v1/research/{ticker}/identity` says when our listing is stale; desktop
 * and mobile both render the warning from these helpers.
 */

export type TickerIdentityStatus = 'ok' | 'changed' | 'mismatch'

export interface TickerIdentity {
  ticker: string
  status: TickerIdentityStatus
  note: string | null
  listed_name: string | null
  filer_name: string | null
  former_name: string | null
  successor_symbol: string | null
  successor_listed?: boolean
  known_symbol?: boolean
  // Lifecycle (backend app.services.ticker_lifecycle). Absent on old backends.
  lifecycle_status?: 'active' | 'inactive' | 'reused'
  is_active?: boolean
  delisted_at?: string | null
  status_note?: string | null
  data_quality?: 'ok' | 'limited' | 'none'
  current_name?: string | null
  retirement_kind?: 'renamed' | 'acquired' | 'delisted' | 'reused' | null
}

export interface TickerBannerState {
  kind: 'inactive' | 'reused' | 'identity'
  title: string
  body: string
  successorSymbol: string | null
  successorHref: string | null
  /** Quote, chart, stats and technicals are hidden (nothing trades any more). */
  hidePricePanels: boolean
  /** Prominent (red/amber, full width) vs. the plain identity warning. */
  prominent: boolean
  dataQuality: 'ok' | 'limited' | 'none'
}

function fmtDay(iso: string | null | undefined): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/**
 * One banner decision for the Research views (desktop and mobile):
 *  - inactive (renamed / acquired / delisted): "SQ stopped trading on Jan 17,
 *    2025 — now XYZ", price panels hidden instead of showing nulls;
 *  - reused (ticker now belongs to another company, e.g. PARA): prominent
 *    warning, data quality "limited", panels stay (the new holder trades);
 *  - otherwise the existing identity warning (changed / mismatch), or null.
 */
export function tickerBannerState(identity: TickerIdentity | null | undefined): TickerBannerState | null {
  if (!identity) return null
  const t = identity.ticker
  const succ = identity.successor_symbol && identity.successor_symbol !== t ? identity.successor_symbol : null
  const successorHref = succ ? `/research?symbol=${encodeURIComponent(succ)}` : null
  const life = identity.lifecycle_status
  if (life === 'inactive') {
    const day = fmtDay(identity.delisted_at)
    const title = `${t} stopped trading${day ? ` on ${day}` : ''}${succ ? ` — now ${succ}` : ''}`
    return {
      kind: 'inactive',
      title,
      body:
        (identity.status_note || identity.note || `${identity.former_name || t} no longer trades under ${t}.`) +
        ' Prices and technicals are hidden because no current market data exists for this ticker.',
      successorSymbol: succ,
      successorHref,
      hidePricePanels: true,
      prominent: true,
      dataQuality: 'none',
    }
  }
  if (life === 'reused') {
    const now = identity.current_name || identity.filer_name
    return {
      kind: 'reused',
      title: `${t} now refers to ${now || 'a different company'}${identity.former_name ? `, not ${identity.former_name}` : ''}`,
      body: `${identity.status_note || identity.note || ''} Data quality is limited: the new holder has a short history and providers may mix in the former company or unadjusted splits.`.trim(),
      successorSymbol: succ,
      successorHref,
      hidePricePanels: false,
      prominent: true,
      dataQuality: 'limited',
    }
  }
  const w = identityWarning(identity)
  if (!w) return null
  return {
    kind: 'identity',
    title: w.title,
    body: w.body,
    successorSymbol: w.successorSymbol,
    successorHref: w.successorHref,
    hidePricePanels: false,
    prominent: false,
    dataQuality: identity.data_quality ?? 'ok',
  }
}

export interface TickerIdentityWarning {
  title: string
  body: string
  successorSymbol: string | null
  /** Research URL for the successor ticker, when there is one. */
  successorHref: string | null
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || ''

export const tickerIdentityQueryKey = (symbol: string) => ['tickerIdentity', symbol.toUpperCase()] as const

export async function fetchTickerIdentity(symbol: string): Promise<TickerIdentity | null> {
  const s = symbol.trim().toUpperCase()
  if (!s) return null
  const res = await fetch(`${API_BASE}/api/v1/research/${encodeURIComponent(s)}/identity`)
  if (!res.ok) return null // a failed check must never block the page
  return (await res.json()) as TickerIdentity
}

/** Warning copy for a stale/mismatched identity, or null when the ticker is fine. */
export function identityWarning(identity: TickerIdentity | null | undefined): TickerIdentityWarning | null {
  if (!identity || identity.status === 'ok') return null
  const t = identity.ticker
  const succ = identity.successor_symbol && identity.successor_symbol !== t ? identity.successor_symbol : null
  const title =
    identity.status === 'changed'
      ? `${t} no longer refers to ${identity.former_name || 'the company we list'}`
      : `${t} may refer to a different company`
  const body =
    identity.note ||
    (identity.filer_name
      ? `SEC now lists ${t} as ${identity.filer_name}; our listing says ${identity.listed_name || 'something else'}.`
      : `The ticker was likely reassigned after a delisting or merger.`)
  return {
    title,
    body: `${body} Prices, news and filings shown for ${t} may belong to another company.`,
    successorSymbol: succ,
    successorHref: succ ? `/research?symbol=${encodeURIComponent(succ)}` : null,
  }
}

/** Company name safe to show next to the ticker: never present a stale name as current. */
export function displayCompanyName(
  name: string | null | undefined,
  identity: TickerIdentity | null | undefined,
): string | null {
  if (!name) return null
  if (identity && identity.status !== 'ok' && identity.former_name && name === identity.listed_name) {
    return `${name} (former)`
  }
  return name
}
