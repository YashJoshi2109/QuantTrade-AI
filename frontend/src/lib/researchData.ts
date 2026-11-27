/**
 * Research page data layer shared by desktop (app/research/page.tsx) and
 * mobile (components/layout/MobileResearch.tsx).
 *
 * Every core source is a React Query with one shared key, so both views (and
 * any panel) read one cache entry instead of fetching twice. Fetchers here
 * throw `HttpError` instead of swallowing failures into `[]` / `{}`, so the
 * aggregated status (`useResearchStatus`) can tell "unknown ticker" (404) from
 * "temporarily unavailable" (5xx / 429 / network) and retry with backoff.
 */
import { useCallback, useMemo } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { TickerInfo } from '@/app/api/quotes/ticker/route'
import { apiUrl, type FundamentalsData, type Indicators, type PriceBar } from './api'
import { HttpError, httpErrorFrom } from './httpError'
import { retryWhileFailing } from './queryPolicy'
import { resolvePriceInfo, type ResolvedPriceInfo } from './researchQuote'
import {
  summarizeResearchStatus,
  type ResearchSourceId,
  type ResearchStatus,
  type SourceState,
} from './researchStatus'

export const researchKeys = {
  tickerInfo: (symbol: string) => ['tickerInfo', symbol] as const,
  fundamentals: (symbol: string) => ['research.fundamentals', symbol] as const,
  indicators: (symbol: string) => ['research.indicators', symbol] as const,
  prices: (symbol: string, rangeKey: string) => ['research.prices', symbol, rangeKey] as const,
}

/** Failed one-shot sources retry after 30s, 60s, 120s... (never for a 404). */
const FAILING_RETRY_BASE = 30_000

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw httpErrorFrom(res, url)
  return (await res.json()) as T
}

export function fetchTickerInfo(symbol: string, signal?: AbortSignal): Promise<TickerInfo> {
  return getJson<TickerInfo>(`/api/quotes/ticker?symbol=${encodeURIComponent(symbol)}`, signal)
}

export function fetchResearchIndicators(symbol: string, signal?: AbortSignal): Promise<Indicators> {
  return getJson<Indicators>(apiUrl(`/api/v1/indicators/${encodeURIComponent(symbol)}`).toString(), signal)
}

export function fetchResearchFundamentals(symbol: string, signal?: AbortSignal): Promise<FundamentalsData> {
  return getJson<FundamentalsData>(apiUrl(`/api/v1/enhanced/fundamentals/${encodeURIComponent(symbol)}`).toString(), signal)
}

export async function fetchDailyBars(
  symbol: string,
  start: Date,
  end: Date,
  limit: number,
  signal?: AbortSignal,
): Promise<PriceBar[]> {
  const url = apiUrl(`/api/v1/prices/${encodeURIComponent(symbol)}`)
  url.searchParams.set('start', start.toISOString())
  url.searchParams.set('end', end.toISOString())
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('auto_sync', 'true')
  const data = await getJson<unknown>(url.toString(), signal)
  return Array.isArray(data) ? (data as PriceBar[]) : []
}

export async function fetchIntradayBars(
  symbol: string,
  interval: '1m' | '5m',
  days: number,
  extendedHours: boolean,
  signal?: AbortSignal,
): Promise<PriceBar[]> {
  const url = apiUrl(`/api/v1/prices/${encodeURIComponent(symbol.toUpperCase())}/intraday`)
  url.searchParams.set('interval', interval)
  url.searchParams.set('days', String(days))
  if (extendedHours) url.searchParams.set('extended_hours', 'true')
  const data = await getJson<unknown>(url.toString(), signal)
  return (Array.isArray(data) ? data : []).map((bar: PriceBar) => ({
    timestamp: bar.timestamp,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  }))
}

/** Ask the backend to backfill daily bars for a symbol (best effort). */
export async function requestPriceSync(symbol: string, start: Date, end: Date): Promise<void> {
  const url = apiUrl(`/api/v1/prices/${encodeURIComponent(symbol)}/sync`)
  url.searchParams.set('start', start.toISOString())
  url.searchParams.set('end', end.toISOString())
  try {
    await fetch(url.toString(), { method: 'POST' })
  } catch {
    /* best effort */
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })
}

export type PriceRange =
  | { kind: 'intraday'; interval: '1m' | '5m'; days: number; extendedHours: boolean }
  | { kind: 'daily'; days: number; limit: number }

export function priceRangeKey(r: PriceRange): string {
  return r.kind === 'intraday' ? `i:${r.interval}:${r.days}:${r.extendedHours ? 'x' : 'r'}` : `d:${r.days}:${r.limit}`
}

/**
 * Load bars for a range. An empty daily result on a cold symbol triggers one
 * backend sync and a single re-read (the old page-level behaviour).
 */
export async function loadBars(symbol: string, range: PriceRange, signal?: AbortSignal): Promise<PriceBar[]> {
  if (range.kind === 'intraday') {
    let bars = await fetchIntradayBars(symbol, range.interval, range.days, range.extendedHours, signal)
    if (bars.length === 0) {
      await sleep(2500, signal)
      bars = await fetchIntradayBars(symbol, range.interval, range.days, range.extendedHours, signal)
    }
    return bars
  }
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - range.days)
  let bars = await fetchDailyBars(symbol, start, end, range.limit, signal)
  if (bars.length === 0) {
    await requestPriceSync(symbol, start, end)
    await sleep(2000, signal)
    bars = await fetchDailyBars(symbol, start, end, range.limit, signal)
  }
  return bars
}

export function useTickerInfo(symbol: string) {
  return useQuery<TickerInfo>({
    queryKey: researchKeys.tickerInfo(symbol),
    queryFn: ({ signal }) => fetchTickerInfo(symbol, signal),
    enabled: !!symbol,
    staleTime: 300_000,
    refetchInterval: retryWhileFailing(FAILING_RETRY_BASE),
  })
}

export function useResearchFundamentals(symbol: string) {
  return useQuery<FundamentalsData>({
    queryKey: researchKeys.fundamentals(symbol),
    queryFn: ({ signal }) => fetchResearchFundamentals(symbol, signal),
    enabled: !!symbol,
    staleTime: 5 * 60_000,
    refetchInterval: retryWhileFailing(FAILING_RETRY_BASE),
  })
}

export function useResearchIndicators(symbol: string) {
  return useQuery<Indicators>({
    queryKey: researchKeys.indicators(symbol),
    queryFn: ({ signal }) => fetchResearchIndicators(symbol, signal),
    enabled: !!symbol,
    staleTime: 60_000,
    refetchInterval: retryWhileFailing(FAILING_RETRY_BASE),
  })
}

export function useResearchPrices(symbol: string, range: PriceRange) {
  const intraday = range.kind === 'intraday'
  return useQuery<PriceBar[]>({
    queryKey: researchKeys.prices(symbol, priceRangeKey(range)),
    queryFn: ({ signal }) => loadBars(symbol, range, signal),
    enabled: !!symbol,
    staleTime: intraday ? 30_000 : 60_000,
    refetchInterval: retryWhileFailing(FAILING_RETRY_BASE),
  })
}

/** True when the indicators payload has no computed value at all. */
export function indicatorsEmpty(ind: Indicators | null | undefined): boolean {
  const i = ind?.indicators
  if (!i) return true
  const vals = [i.current_price, i.sma_20, i.sma_50, i.sma_200, i.rsi, i.macd?.macd, i.bollinger_bands?.middle]
  return vals.every((v) => v == null || !Number.isFinite(v))
}

export function isNotFoundError(err: unknown): boolean {
  return err instanceof HttpError ? err.status === 404 : (err as { status?: number } | null)?.status === 404
}

type AnyQuery<T> = Pick<UseQueryResult<T>, 'status' | 'error' | 'isFetching' | 'data'> & {
  refetch?: () => unknown
  dataUpdatedAt?: number
}

function sourceState<T>(q: AnyQuery<T>, empty?: (d: T) => boolean): SourceState {
  // A failed refresh keeps the previous result on screen (React Query keeps
  // `data` on error); report it as a labelled cached snapshot.
  const hasData = q.data !== undefined && !(empty && empty(q.data as T))
  return {
    status: q.status,
    error: q.error,
    empty: q.status === 'success' && empty ? empty(q.data as T) : false,
    isFetching: q.isFetching,
    cachedAt: q.status === 'error' && hasData && q.dataUpdatedAt ? q.dataUpdatedAt : null,
  }
}

interface QuoteLike {
  price?: number | null
  timestamp?: string | null
}

export interface ResearchStatusResult extends ResearchStatus {
  /** price the header shows (best real source) */
  priceInfo: ResolvedPriceInfo
  retry: () => void
  retrying: boolean
}

/**
 * Aggregate the Research page's core queries into one banner status plus the
 * best real price to show. Used by desktop and mobile alike.
 */
export function useResearchStatus(args: {
  symbol: string
  quote: AnyQuery<QuoteLike>
  tickerInfo: AnyQuery<TickerInfo>
  prices: AnyQuery<PriceBar[]>
  indicators: AnyQuery<Indicators>
  fundamentals: AnyQuery<FundamentalsData>
}): ResearchStatusResult {
  const { symbol, quote, tickerInfo, prices, indicators, fundamentals } = args
  const priceInfo = resolvePriceInfo(
    quote.data as Parameters<typeof resolvePriceInfo>[0],
    tickerInfo.data,
    prices.data,
  )

  const quoteHasPrice = !!quote.data && typeof quote.data.price === 'number' && quote.data.price > 0
  const usingProfile = !quoteHasPrice && priceInfo.hasPrice && priceInfo.dataSource !== 'daily close'
  const lastBar = prices.data && prices.data.length ? prices.data[prices.data.length - 1] : null
  const priceAsOf = quoteHasPrice
    ? quote.data?.timestamp ?? null
    : usingProfile
      ? tickerInfo.data?.quote?.as_of ?? null
      : lastBar?.timestamp ?? null

  const status = summarizeResearchStatus({
    symbol,
    sources: {
      quote: sourceState(quote, (d) => !(d && typeof d.price === 'number' && d.price > 0)),
      profile: sourceState(tickerInfo),
      prices: sourceState(prices, (d) => !d || d.length === 0),
      indicators: sourceState(indicators, indicatorsEmpty),
      fundamentals: sourceState(fundamentals),
    } satisfies Record<ResearchSourceId, SourceState>,
    price: priceInfo,
    priceAsOf,
    fallbackSource: quoteHasPrice ? null : usingProfile ? 'profile' : priceInfo.hasPrice ? 'bars' : null,
  })

  const failedKey = status.failed.join(',')
  const retry = useCallback(() => {
    const refetchers: Record<ResearchSourceId, (() => unknown) | undefined> = {
      quote: quote.refetch,
      profile: tickerInfo.refetch,
      prices: prices.refetch,
      indicators: indicators.refetch,
      fundamentals: fundamentals.refetch,
    }
    const ids = failedKey ? (failedKey.split(',') as ResearchSourceId[]) : []
    for (const id of ids) void refetchers[id]?.()
  }, [failedKey, quote.refetch, tickerInfo.refetch, prices.refetch, indicators.refetch, fundamentals.refetch])

  const retrying = useMemo(
    () => [quote, tickerInfo, prices, indicators, fundamentals].some((q) => q.isFetching && q.status === 'error'),
    [quote, tickerInfo, prices, indicators, fundamentals],
  )
  return { ...status, priceInfo, retry, retrying }
}
