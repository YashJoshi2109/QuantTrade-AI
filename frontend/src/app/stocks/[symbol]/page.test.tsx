import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import fixture from '@/lib/__fixtures__/stockPageNVDA.json'
import type { LoadResult } from '@/lib/stockPage/data'

const loadStockPage = vi.fn<(symbol: string) => Promise<LoadResult>>()

vi.mock('@/lib/stockPage/data', async (orig) => ({
  ...(await orig<typeof import('@/lib/stockPage/data')>()),
  loadStockPage: (s: string) => loadStockPage(s),
}))
vi.mock('@/components/AppLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  permanentRedirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`)
  },
}))

import StockPage, { generateMetadata, generateStaticParams } from './page'

const params = (symbol: string) => ({ params: Promise.resolve({ symbol }) })
const okNvda: LoadResult = { kind: 'ok', data: fixture as never }

beforeEach(() => {
  loadStockPage.mockReset()
})

describe('generateMetadata', () => {
  it('sets a self-canonical www URL, a <=60 char title and OG tags', async () => {
    loadStockPage.mockResolvedValue(okNvda)
    const m = await generateMetadata(params('NVDA'))
    expect(m.alternates?.canonical).toBe('https://www.quanttrade.us/stocks/NVDA')
    const title = (m.title as { absolute: string }).absolute
    expect(title).toBe('NVIDIA (NVDA) Stock Price & Forecast | QuantTrade AI')
    expect(title.length).toBeLessThanOrEqual(60)
    expect(m.description).toContain('$150.49')
    expect(m.openGraph?.url).toBe('https://www.quanttrade.us/stocks/NVDA')
    expect(m.robots).toEqual({ index: true, follow: true })
  })

  it('noindexes unknown tickers', async () => {
    loadStockPage.mockResolvedValue({ kind: 'not_found', reason: 'unknown' })
    const m = await generateMetadata(params('ZZZZQ'))
    expect(m.robots).toEqual({ index: false, follow: true })
  })
})

describe('StockPage', () => {
  it('404s unknown and retired tickers', async () => {
    loadStockPage.mockResolvedValue({ kind: 'not_found', reason: 'unknown' })
    await expect(StockPage(params('ZZZZQ'))).rejects.toThrow('NEXT_NOT_FOUND')
    loadStockPage.mockResolvedValue({ kind: 'not_found', reason: 'retired' })
    await expect(StockPage(params('WBA'))).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('404s slugs that are not tickers without loading data', async () => {
    await expect(StockPage(params('BTC-USD'))).rejects.toThrow('NEXT_NOT_FOUND')
    expect(loadStockPage).not.toHaveBeenCalled()
  })

  it('redirects lowercase and dotted forms to the canonical slug', async () => {
    await expect(StockPage(params('nvda'))).rejects.toThrow('REDIRECT:/stocks/NVDA')
    await expect(StockPage(params('BRK.B'))).rejects.toThrow('REDIRECT:/stocks/BRK-B')
  })

  it('server-renders the copy, FAQ and JSON-LD', async () => {
    loadStockPage.mockResolvedValue(okNvda)
    const html = renderToStaticMarkup(await StockPage(params('NVDA')))
    expect(html).toContain('<h1')
    expect(html).toContain('NVIDIA Corporation (NVDA) Stock')
    expect(html).toContain('When is NVDA&#x27;s next earnings date?')
    expect(html).toContain('href="/research?symbol=NVDA"')
    expect(html).toContain('href="/screener"')
    expect(html).toContain('Not financial advice')
    const ld = /<script type="application\/ld\+json">([^<]+)<\/script>/.exec(html)
    expect(ld).not.toBeNull()
    const graph = JSON.parse(ld![1])['@graph']
    expect(graph.map((g: { '@type': string }) => g['@type'])).toEqual(['BreadcrumbList', 'WebPage', 'FAQPage'])
  })
})

describe('generateStaticParams', () => {
  it('pre-renders only when opted in and a backend URL is set', async () => {
    const saved = { ...process.env }
    delete process.env.BACKEND_INTERNAL_URL
    delete process.env.BACKEND_URL
    delete process.env.NEXT_PUBLIC_API_URL
    process.env.STOCK_PAGES_PRERENDER = '1'
    expect(await generateStaticParams()).toEqual([])
    process.env.BACKEND_URL = 'https://api.example'
    delete process.env.STOCK_PAGES_PRERENDER
    expect(await generateStaticParams()).toEqual([])
    process.env.STOCK_PAGES_PRERENDER = '1'
    const list = await generateStaticParams()
    expect(list).toContainEqual({ symbol: 'NVDA' })
    expect(list).toContainEqual({ symbol: 'BRK-B' })
    process.env = saved
  })
})
