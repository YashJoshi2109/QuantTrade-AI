import { describe, expect, it } from 'vitest'
import fixture from '../__fixtures__/stockPageNVDA.json'
import { loadStockPage, resolveExistence, StockPageUnavailableError, type Fetched, type JsonFetcher } from './data'

type Routes = Record<string, Fetched<unknown>>

/** Fake backend: first route whose key is a prefix of the path answers; others 404. */
function fakeBackend(routes: Routes, calls: string[] = []): JsonFetcher {
  return async <T,>(path: string) => {
    calls.push(path)
    const key = Object.keys(routes).find((k) => path.startsWith(k))
    return (key ? routes[key] : { status: 404, body: null }) as Fetched<T>
  }
}

const ok = <T,>(body: T): Fetched<T> => ({ status: 200, body })
const fx = fixture as Record<string, unknown>

const nvdaRoutes: Routes = {
  '/api/v1/research/NVDA/identity': ok(fx.identity),
  '/api/v1/symbols/NVDA': ok(fx.symbolRow),
  '/api/v1/quotes/NVDA': ok(fx.quote),
  '/api/v1/enhanced/fundamentals/NVDA': ok(fx.fundamentals),
  '/api/v1/indicators/NVDA': ok(fx.indicators),
  '/api/v1/earnings/next/NVDA': ok(fx.earningsNext),
  '/api/v1/earnings/history/NVDA': ok(fx.earningsHistory),
  '/api/v1/dividends/history/NVDA': ok(fx.dividends),
  '/api/v1/datasets/insiders/NVDA': ok(fx.insiders),
  '/api/v1/datasets/institutional/NVDA': ok(fx.institutional),
  '/api/v1/news/feed': ok({ items: [...(fx.news as object[]), { title: 'bad', url: 'javascript:alert(1)' }] }),
  '/api/v1/forecasts/summary': ok({ items: [{ ticker: 'NVDA', status: 'ready', summary: fx.forecast }] }),
  '/api/v1/research/NVDA/company-overview': ok(fx.overview),
  '/api/v1/prices/NVDA': ok([{ timestamp: '2026-11-27T05:00:00Z', close: 150.49 }]),
}

describe('resolveExistence', () => {
  const id = (body: object | null, status = 200): Fetched<object> => ({ status, body })
  it('treats retired and reused tickers as gone', () => {
    expect(resolveExistence('WBA', id({ is_active: false, lifecycle_status: 'inactive' }), id(null, 404))).toBe('retired')
    expect(resolveExistence('XYZQ', id({ is_active: true, lifecycle_status: 'reused', known_symbol: true }), id({}))).toBe('retired')
    // static lifecycle list wins even when the backend is down
    expect(resolveExistence('SQ', id(null, 0), id(null, 0))).toBe('retired')
  })
  it('needs the identity map or a symbol row', () => {
    expect(resolveExistence('NVDA', id({ known_symbol: true, is_active: true }), id(null, 404))).toBe('exists')
    expect(resolveExistence('ABC', id({ known_symbol: false, is_active: true }), id({}))).toBe('exists')
    expect(resolveExistence('ZZZZQ', id({ known_symbol: false, is_active: true }), id(null, 404))).toBe('unknown')
  })
  it('does not 404 during an outage', () => {
    expect(resolveExistence('NVDA', id(null, 502), id(null, 0))).toBe('unavailable')
  })
})

describe('loadStockPage', () => {
  it('assembles every source for a known ticker', async () => {
    const r = await loadStockPage('NVDA', fakeBackend(nvdaRoutes))
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.data.quote?.price).toBe(150.49)
    expect(r.data.forecast?.horizons?.length).toBeGreaterThan(0)
    expect(r.data.news.every((n) => n.url.startsWith('http'))).toBe(true)
    expect(r.data.news).toHaveLength((fx.news as object[]).length)
    expect(r.data.bars).toHaveLength(1)
  })

  it('404s an unknown ticker without calling the quote providers', async () => {
    const calls: string[] = []
    const r = await loadStockPage('ZZZZQ', fakeBackend({
      '/api/v1/research/ZZZZQ/identity': ok({ known_symbol: false, is_active: true, lifecycle_status: 'active' }),
    }, calls))
    expect(r).toEqual({ kind: 'not_found', reason: 'unknown' })
    expect(calls.some((c) => c.includes('/quotes/'))).toBe(false)
  })

  it('404s a retired ticker before any request', async () => {
    const calls: string[] = []
    const r = await loadStockPage('WBA', fakeBackend({}, calls))
    expect(r).toEqual({ kind: 'not_found', reason: 'retired' })
    expect(calls).toHaveLength(0)
  })

  it('404s a backend-retired ticker', async () => {
    const r = await loadStockPage('OLDX', fakeBackend({
      '/api/v1/research/OLDX/identity': ok({ is_active: false, lifecycle_status: 'inactive', known_symbol: false }),
    }))
    expect(r).toEqual({ kind: 'not_found', reason: 'retired' })
  })

  it('throws (keeps the cached page) when the backend is down', async () => {
    const down: JsonFetcher = async () => ({ status: 503, body: null })
    await expect(loadStockPage('NVDA', down)).rejects.toBeInstanceOf(StockPageUnavailableError)
  })

  it('404s a known symbol with no market data at all', async () => {
    const r = await loadStockPage('EMPTY', fakeBackend({
      '/api/v1/research/EMPTY/identity': ok({ known_symbol: true, is_active: true }),
      '/api/v1/quotes/EMPTY': ok({ unavailable: true, price: null }),
      '/api/v1/prices/EMPTY': ok([]),
    }))
    expect(r).toEqual({ kind: 'not_found', reason: 'no_data' })
  })

  it('drops sources that failed instead of failing the page', async () => {
    const routes = { ...nvdaRoutes }
    delete routes['/api/v1/datasets/insiders/NVDA']
    routes['/api/v1/enhanced/fundamentals/NVDA'] = { status: 502, body: null }
    const r = await loadStockPage('NVDA', fakeBackend(routes))
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.data.insiders).toBeNull()
    expect(r.data.fundamentals).toBeNull()
  })
})
