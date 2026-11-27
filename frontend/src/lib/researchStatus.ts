/**
 * Pure aggregation of the Research page's core data sources into one calm
 * status for the header banner (desktop + mobile share it via
 * lib/researchData `useResearchStatus`).
 *
 * Never invents numbers: the fallback it describes is whatever real price
 * `resolvePriceInfo` already picked (live quote -> profile quote -> last bar),
 * labelled with its source and as-of time.
 */
import { isHttpError, isRateLimited } from './httpError'

export type ResearchSourceId = 'quote' | 'profile' | 'prices' | 'indicators' | 'fundamentals'

export const SOURCE_LABEL: Record<ResearchSourceId, string> = {
  quote: 'live quote',
  profile: 'company profile',
  prices: 'price history',
  indicators: 'technical indicators',
  fundamentals: 'fundamentals',
}

export interface SourceState {
  status: 'pending' | 'success' | 'error'
  error?: unknown
  /** succeeded but returned nothing usable (no bars, all-null indicators) */
  empty?: boolean
  isFetching?: boolean
  /** refresh failed but an earlier successful result (this time, epoch ms) is still shown */
  cachedAt?: number | null
}

export interface PriceFallbackLike {
  hasPrice: boolean
  /** resolvePriceInfo().dataSource: provider name, 'profile', 'daily close'... */
  dataSource?: string
  stale?: boolean
}

export interface ResearchStatusInput {
  symbol: string
  sources: Record<ResearchSourceId, SourceState>
  price: PriceFallbackLike
  /** trade/bar time of the price being shown (ISO), when known */
  priceAsOf?: string | null
  /** where the shown price came from when the live quote failed */
  fallbackSource?: 'profile' | 'bars' | null
}

export type ResearchStatusKind = 'ok' | 'loading' | 'degraded' | 'unavailable' | 'not_found'

export interface ResearchStatus {
  kind: ResearchStatusKind
  /** sources that errored or came back empty */
  failed: ResearchSourceId[]
  rateLimited: boolean
  headline: string
  detail: string
  /** "last close from daily bars as of Nov 26, 4:00 PM ET" when a fallback price is shown */
  fallbackLabel: string | null
}

const is404 = (e: unknown) => isHttpError(e) && e.status === 404

export function formatAsOf(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return (
    d.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }) + ' ET'
  )
}

function fallbackSourceName(input: ResearchStatusInput): string {
  if (input.fallbackSource === 'bars') return 'daily price history'
  const ds = input.price.dataSource
  if (!ds || ds === 'profile') return 'the company profile feed'
  if (ds === 'daily close') return 'daily price history'
  return ds
}

const PLURAL: ReadonlySet<ResearchSourceId> = new Set<ResearchSourceId>(['indicators', 'fundamentals'])
const verb = (ids: ResearchSourceId[]) => (ids.length > 1 || PLURAL.has(ids[0]) ? 'are' : 'is')

function joinLabels(ids: ResearchSourceId[]): string {
  const labels = ids.map((id) => SOURCE_LABEL[id])
  if (labels.length <= 1) return labels[0] ?? ''
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

export function summarizeResearchStatus(input: ResearchStatusInput): ResearchStatus {
  const sym = input.symbol.toUpperCase()
  const entries = Object.entries(input.sources) as Array<[ResearchSourceId, SourceState]>
  const failed = entries
    .filter(([, s]) => s.status === 'error' || (s.status === 'success' && s.empty))
    .map(([id]) => id)
  const rateLimited = entries.some(([, s]) => s.status === 'error' && isRateLimited(s.error))
  const { quote, profile, prices } = input.sources

  // Unknown ticker: the profile says 404 and neither the quote nor price
  // history has anything. An outage (5xx/429/network) is never "not found".
  const quoteMissing = (quote.status === 'error' && is404(quote.error)) || (quote.status === 'success' && quote.empty)
  const pricesMissing = (prices.status === 'success' && prices.empty) || (prices.status === 'error' && is404(prices.error))
  if (profile.status === 'error' && is404(profile.error) && quoteMissing && pricesMissing && !input.price.hasPrice) {
    return {
      kind: 'not_found',
      failed,
      rateLimited: false,
      headline: `We couldn't find ${sym}`,
      detail: `${sym} may be misspelled, delisted, or not covered yet.`,
      fallbackLabel: null,
    }
  }

  const corePending = quote.status === 'pending' && profile.status === 'pending'
  if (failed.length === 0) {
    return {
      kind: corePending ? 'loading' : 'ok',
      failed,
      rateLimited,
      headline: '',
      detail: '',
      fallbackLabel: null,
    }
  }

  const retryNote = rateLimited
    ? 'High traffic right now: retrying automatically with backoff.'
    : 'Retrying automatically.'

  if (!input.price.hasPrice) {
    // Still waiting on a source that might supply a price: not a banner yet.
    const anyPricePending = [quote, profile, prices].some((s) => s.status === 'pending')
    if (anyPricePending && !failed.includes('quote')) {
      return { kind: 'loading', failed, rateLimited, headline: '', detail: '', fallbackLabel: null }
    }
    return {
      kind: 'unavailable',
      failed,
      rateLimited,
      headline: "We're working on it",
      detail: `Prices for ${sym} are temporarily unavailable. ${retryNote}`,
      fallbackLabel: null,
    }
  }

  const asOf = formatAsOf(input.priceAsOf)
  const quoteFailed = failed.includes('quote')
  const fallbackLabel = quoteFailed
    ? `last price from ${fallbackSourceName(input)}${asOf ? ` as of ${asOf}` : ''}`
    : null
  const others = failed.filter((id) => id !== 'quote')
  const cached = others.filter((id) => input.sources[id].cachedAt)
  const missing = others.filter((id) => !input.sources[id].cachedAt)
  const cap = (t: string) => t.replace(/^./, (c) => c.toUpperCase())
  const parts: string[] = []
  if (quoteFailed) parts.push(`Live quote for ${sym} is temporarily unavailable; showing ${fallbackLabel}.`)
  if (missing.length) {
    parts.push(`${cap(joinLabels(missing))} ${verb(missing)} temporarily unavailable.`)
  }
  if (cached.length) {
    const oldest = Math.min(...cached.map((id) => input.sources[id].cachedAt as number))
    const at = formatAsOf(new Date(oldest).toISOString())
    parts.push(`${cap(joinLabels(cached))} couldn't refresh; showing the snapshot from ${at ?? 'earlier'}.`)
  }
  parts.push(retryNote)
  return {
    kind: 'degraded',
    failed,
    rateLimited,
    headline: "We're working on it",
    detail: parts.join(' '),
    fallbackLabel,
  }
}
