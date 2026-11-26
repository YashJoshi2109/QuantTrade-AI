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
