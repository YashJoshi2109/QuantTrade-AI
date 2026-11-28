import { describe, expect, it } from 'vitest'
import { parseStockSlug, researchHref, stockPath, stockUrl, symbolToSlug } from './symbol'

describe('symbolToSlug', () => {
  it.each([
    ['NVDA', 'NVDA'],
    ['nvda', 'NVDA'],
    ['BRK.B', 'BRK-B'],
    ['BF.B', 'BF-B'],
    ['GOOGL', 'GOOGL'],
  ])('%s -> %s', (sym, slug) => expect(symbolToSlug(sym)).toBe(slug))

  it.each(['^GSPC', 'BTC-USD', 'ES=F', 'EURUSD=X', '0700.HK', 'SHOP.TO', 'TOOLONGX', '', 'BRK.BB'])(
    'has no page for %s',
    (sym) => expect(symbolToSlug(sym)).toBeNull(),
  )
})

describe('parseStockSlug', () => {
  it('maps the dash form back to the dotted ticker', () => {
    expect(parseStockSlug('BRK-B')).toEqual({ symbol: 'BRK.B', slug: 'BRK-B', needsRedirect: false })
  })

  it('asks for a redirect to the canonical slug', () => {
    expect(parseStockSlug('nvda')).toEqual({ symbol: 'NVDA', slug: 'NVDA', needsRedirect: true })
    expect(parseStockSlug('BRK.B')).toEqual({ symbol: 'BRK.B', slug: 'BRK-B', needsRedirect: true })
    expect(parseStockSlug('brk-b')).toEqual({ symbol: 'BRK.B', slug: 'BRK-B', needsRedirect: true })
    expect(parseStockSlug('BRK%2EB')).toEqual({ symbol: 'BRK.B', slug: 'BRK-B', needsRedirect: true })
  })

  it.each(['sitemap.xml', 'BTC-USD', '%E0%A4%A', 'A-BC', '..', 'NVDA ', 'N V'])('rejects %s', (raw) => {
    const r = parseStockSlug(raw)
    // 'NVDA ' trims to a valid ticker but must redirect to the clean slug
    if (raw === 'NVDA ') expect(r?.needsRedirect).toBe(true)
    else expect(r).toBeNull()
  })
})

describe('links', () => {
  it('builds canonical www URLs and research links', () => {
    expect(stockPath('BRK.B')).toBe('/stocks/BRK-B')
    expect(stockUrl('nvda')).toBe('https://www.quanttrade.us/stocks/NVDA')
    expect(stockPath('^GSPC')).toBeNull()
    expect(researchHref('brk.b')).toBe('/research?symbol=BRK.B')
  })
})
