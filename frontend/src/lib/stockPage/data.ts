/**
 * Server-side data loader for /stocks/{SYMBOL}.
 *
 * Reads the same backend endpoints the Research page uses (canonical quote,
 * fundamentals, indicators, earnings, dividends, SEC Form 4 / 13F data sets,
 * news feed, cached statistical forecast). Every source is optional: a failed
 * source drops its section, it never becomes a made-up number.
 *
 * Existence is decided first with two cheap DB-backed calls (ticker identity +
 * symbol row) so a crawler hitting /stocks/RANDOM never triggers provider
 * lookups. Retired tickers (renamed / acquired / delisted / reused) 404.
 */
import { RETIRED_SYMBOLS } from './universe'
import type {
  CompanyOverviewPayload,
  DividendsPayload,
  EarningsHistoryPayload,
  EarningsNextPayload,
  ForecastSummary,
  FundamentalsPayload,
  IdentityPayload,
  IndicatorsPayload,
  InsidersPayload,
  InstitutionalPayload,
  NewsItem,
  PriceBar,
  QuotePayload,
  StockPageData,
  SymbolPayload,
} from './types'

/** ISR window for the page and every backend fetch it makes (seconds). */
export const STOCK_PAGE_REVALIDATE = 900

const TIMEOUT_MS = 6_000
const RETRY_DELAY_MS = 400
const RETIRED = new Set(RETIRED_SYMBOLS)

export function backendBase(): string {
  return (
    process.env.BACKEND_INTERNAL_URL ||
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    ''
  ).replace(/\/$/, '')
}

export interface Fetched<T> {
  /** HTTP status; 0 for a network error / timeout */
  status: number
  body: T | null
}

export type JsonFetcher = <T>(path: string) => Promise<Fetched<T>>

export function makeFetcher(base = backendBase(), revalidate = STOCK_PAGE_REVALIDATE): JsonFetcher {
  return async function fetchJson<T>(path: string): Promise<Fetched<T>> {
    if (!base) return { status: 0, body: null }
    let last: Fetched<T> = { status: 0, body: null }
    // One quick retry for a transient failure (connection error, 5xx, 429).
    // 4xx answers and timeouts are final, so a slow source costs one timeout.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
      try {
        const res = await fetch(`${base}${path}`, {
          headers: { Accept: 'application/json' },
          next: { revalidate },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (res.ok) return { status: res.status, body: (await res.json()) as T }
        last = { status: res.status, body: null }
        if (res.status < 500 && res.status !== 429) return last
      } catch (e) {
        last = { status: 0, body: null }
        if ((e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError') return last
      }
    }
    return last
  }
}

export class StockPageUnavailableError extends Error {
  constructor(symbol: string) {
    super(`Stock page data temporarily unavailable for ${symbol}`)
    this.name = 'StockPageUnavailableError'
  }
}

export type Existence = 'exists' | 'unknown' | 'retired' | 'unavailable'

/**
 * Decide whether a ticker gets a page from the identity + symbol lookups.
 * `unavailable` means the backend did not answer either call (5xx / timeout):
 * the caller must not cache a 404 for a ticker that may well exist.
 */
export function resolveExistence(
  symbol: string,
  identity: Fetched<IdentityPayload>,
  symbolRow: Fetched<SymbolPayload>,
): Existence {
  if (RETIRED.has(symbol)) return 'retired'
  const id = identity.body
  if (id) {
    if (id.is_active === false || id.lifecycle_status === 'inactive' || id.lifecycle_status === 'reused') {
      return 'retired'
    }
  }
  if (id?.known_symbol || symbolRow.status === 200) return 'exists'
  const identityAnswered = identity.status === 200 || identity.status === 404
  const symbolAnswered = symbolRow.status === 200 || symbolRow.status === 404
  if (identityAnswered && symbolAnswered) return 'unknown'
  return 'unavailable'
}

export type LoadResult =
  | { kind: 'ok'; data: StockPageData }
  | { kind: 'not_found'; reason: 'unknown' | 'retired' | 'no_data' }

interface FeedResponse {
  items?: Array<{ title?: string; url?: string; source?: string; published_at?: string }>
}

interface ForecastSummaryResponse {
  items?: Array<{ ticker: string; status: string; summary: ForecastSummary | null }>
}

export function hasPrice(q: QuotePayload | null): boolean {
  const p = q?.regular?.price ?? q?.price
  return typeof p === 'number' && Number.isFinite(p) && p > 0
}

/** Load everything the page renders. Throws StockPageUnavailableError on a backend outage. */
export async function loadStockPage(symbol: string, fetchJson: JsonFetcher = makeFetcher()): Promise<LoadResult> {
  if (RETIRED.has(symbol)) return { kind: 'not_found', reason: 'retired' }
  const enc = encodeURIComponent(symbol)

  const [identity, symbolRow] = await Promise.all([
    fetchJson<IdentityPayload>(`/api/v1/research/${enc}/identity`),
    fetchJson<SymbolPayload>(`/api/v1/symbols/${enc}`),
  ])
  const existence = resolveExistence(symbol, identity, symbolRow)
  if (existence === 'unavailable') throw new StockPageUnavailableError(symbol)
  if (existence !== 'exists') return { kind: 'not_found', reason: existence }

  const [
    quote, fundamentals, indicators, earningsNext, earningsHistory, dividends,
    insiders, institutional, feed, forecast, overview, bars,
  ] = await Promise.all([
    fetchJson<QuotePayload>(`/api/v1/quotes/${enc}`),
    fetchJson<FundamentalsPayload>(`/api/v1/enhanced/fundamentals/${enc}`),
    fetchJson<IndicatorsPayload>(`/api/v1/indicators/${enc}`),
    fetchJson<EarningsNextPayload>(`/api/v1/earnings/next/${enc}`),
    fetchJson<EarningsHistoryPayload>(`/api/v1/earnings/history/${enc}`),
    fetchJson<DividendsPayload>(`/api/v1/dividends/history/${enc}`),
    fetchJson<InsidersPayload>(`/api/v1/datasets/insiders/${enc}`),
    fetchJson<InstitutionalPayload>(`/api/v1/datasets/institutional/${enc}`),
    fetchJson<FeedResponse>(`/api/v1/news/feed?ticker=${enc}&sort=latest&limit=6`),
    // Cache-only summary: never triggers a model fit inside page rendering.
    fetchJson<ForecastSummaryResponse>(`/api/v1/forecasts/summary?tickers=${enc}`),
    fetchJson<CompanyOverviewPayload>(`/api/v1/research/${enc}/company-overview`),
    fetchJson<PriceBar[]>(`/api/v1/prices/${enc}?limit=260&auto_sync=false`),
  ])

  const quoteBody = quote.body && quote.body.unavailable !== true ? quote.body : null
  const barList = Array.isArray(bars.body)
    ? bars.body.filter((b) => typeof b?.close === 'number' && Number.isFinite(b.close) && b.close > 0)
    : []

  if (!hasPrice(quoteBody) && barList.length === 0) {
    // Quote and price history both failed. If the backend is answering at all
    // this ticker simply has no market data; on an outage keep the old page.
    if (quote.status === 0 || quote.status >= 500) throw new StockPageUnavailableError(symbol)
    return { kind: 'not_found', reason: 'no_data' }
  }

  const news: NewsItem[] = (feed.body?.items ?? [])
    .filter((n): n is { title: string; url: string; source?: string; published_at?: string } =>
      typeof n?.title === 'string' && n.title.trim() !== '' && typeof n?.url === 'string' && /^https?:\/\//.test(n.url))
    .slice(0, 6)
    .map((n) => ({ title: n.title.trim(), url: n.url, source: n.source ?? null, published_at: n.published_at ?? null }))

  const fc = forecast.body?.items?.find((i) => i.ticker === symbol && i.status === 'ready')?.summary ?? null

  return {
    kind: 'ok',
    data: {
      symbol,
      identity: identity.body,
      symbolRow: symbolRow.body,
      quote: quoteBody,
      fundamentals: fundamentals.body,
      indicators: indicators.body,
      earningsNext: earningsNext.body,
      earningsHistory: earningsHistory.body,
      dividends: dividends.body,
      insiders: insiders.body?.status === 'ok' ? insiders.body : null,
      institutional: institutional.body?.status === 'ok' ? institutional.body : null,
      news,
      forecast: fc,
      overview: overview.body,
      bars: barList,
      fetchedAt: new Date().toISOString(),
    },
  }
}
