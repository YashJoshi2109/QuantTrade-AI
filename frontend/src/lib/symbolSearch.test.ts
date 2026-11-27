import { describe, expect, it } from 'vitest'
import {
  classifyKind,
  flattenGroups,
  groupSearchResults,
  highlightParts,
  matchRank,
  mergeSearchResults,
  parseRecent,
  pushRecent,
  quoteSymbolsFor,
  typedTicker,
  type DbSearchRow,
  type GlobalSearchRow,
  type SearchHit,
} from './symbolSearch'

const db = (symbol: string, name: string, asset_type = 'Equity', extra: Partial<DbSearchRow> = {}): DbSearchRow => ({
  symbol,
  name,
  exchange: 'NASDAQ',
  asset_type,
  country: 'US',
  market_cap: null,
  ...extra,
})
const yf = (symbol: string, name: string, quote_type = 'EQUITY', extra: Partial<GlobalSearchRow> = {}): GlobalSearchRow => ({
  symbol,
  name,
  exchange_display: 'NYSE',
  type: 'Equity',
  quote_type,
  country: 'US',
  ...extra,
})
const hit = (symbol: string, kind: SearchHit['kind'], extra: Partial<SearchHit> = {}): SearchHit => ({
  symbol,
  name: symbol,
  exchange: 'NASDAQ',
  kind,
  country: 'US',
  market_cap: null,
  source: 'db',
  ...extra,
})

describe('classifyKind', () => {
  it('maps asset type labels and symbol shapes', () => {
    expect(classifyKind('Equity', 'AAPL')).toBe('stock')
    expect(classifyKind('ETF', 'SPY')).toBe('etf')
    expect(classifyKind('INDEX', '^GSPC')).toBe('index')
    expect(classifyKind('', '^DJI')).toBe('index')
    expect(classifyKind('CRYPTOCURRENCY', 'BTC-USD')).toBe('crypto')
    expect(classifyKind(null, 'ETH-USD')).toBe('crypto')
    expect(classifyKind('MUTUALFUND', 'VFIAX')).toBe('fund')
    expect(classifyKind(null, 'MSFT')).toBe('stock')
    expect(classifyKind('FUTURE', 'ES=F')).toBe('other')
  })
})

describe('mergeSearchResults', () => {
  it('dedupes by ticker, DB row wins and keeps its market cap', () => {
    const out = mergeSearchResults(
      [db('META', 'Meta Platforms Inc.', 'Equity', { market_cap: 1.6e12 })],
      [yf('META', 'Meta Platforms, Inc.'), yf('TMC', 'TMC the metals company')],
      'meta',
    )
    expect(out.map((h) => h.symbol)).toEqual(['META', 'TMC'])
    expect(out[0]).toMatchObject({ source: 'db', market_cap: 1.6e12, name: 'Meta Platforms Inc.' })
  })

  it('fills a missing DB exchange from Yahoo', () => {
    const out = mergeSearchResults([db('XYZ', 'Block', 'Equity', { exchange: null })], [yf('xyz', 'Block Inc')], 'xyz')
    expect(out).toHaveLength(1)
    expect(out[0].exchange).toBe('NYSE')
  })

  it('ranks exact ticker, then ticker prefix, then name matches; caps at limit', () => {
    const out = mergeSearchResults(
      [db('NTAP', 'NetApp Inc.'), db('AAPL', 'Apple Inc.'), db('APP', 'AppLovin')],
      [yf('APPS', 'Digital Turbine')],
      'app',
      3,
    )
    expect(out.map((h) => h.symbol)).toEqual(['APP', 'APPS', 'AAPL'])
  })

  it('ignores rows without a symbol and drops non-positive market caps', () => {
    const out = mergeSearchResults(
      [{ ...db('', 'x') }, db('ZERO', 'Zero Co', 'Equity', { market_cap: 0 })],
      [],
      'zero',
    )
    expect(out).toHaveLength(1)
    expect(out[0].market_cap).toBeNull()
  })
})

describe('matchRank', () => {
  it('orders match quality', () => {
    expect(matchRank({ symbol: 'APP', name: 'AppLovin' }, 'app')).toBe(0)
    expect(matchRank({ symbol: 'APPS', name: 'Digital Turbine' }, 'app')).toBe(1)
    expect(matchRank({ symbol: 'AAPL', name: 'Apple Inc.' }, 'app')).toBe(2)
    expect(matchRank({ symbol: 'NTAP', name: 'NetApp' }, 'app')).toBe(3)
  })
})

describe('groupSearchResults', () => {
  it('groups in Stocks, ETFs, Indices, Crypto order and skips empty groups', () => {
    const groups = groupSearchResults([
      hit('BTC-USD', 'crypto'),
      hit('SPY', 'etf'),
      hit('AAPL', 'stock'),
      hit('MSFT', 'stock'),
      hit('^GSPC', 'index'),
    ])
    expect(groups.map((g) => g.label)).toEqual(['Stocks', 'ETFs', 'Indices', 'Crypto'])
    expect(groups[0].hits.map((h) => h.symbol)).toEqual(['AAPL', 'MSFT'])
    expect(flattenGroups(groups).map((h) => h.symbol)).toEqual(['AAPL', 'MSFT', 'SPY', '^GSPC', 'BTC-USD'])
  })
})

describe('highlightParts', () => {
  it('splits around the first case-insensitive match', () => {
    expect(highlightParts('Apple Inc.', 'app')).toEqual([
      { text: 'App', match: true },
      { text: 'le Inc.', match: false },
    ])
    expect(highlightParts('NetApp', 'APP')).toEqual([
      { text: 'Net', match: false },
      { text: 'App', match: true },
    ])
  })
  it('returns the whole text unmatched when there is no hit or no query', () => {
    expect(highlightParts('Tesla', 'xyz')).toEqual([{ text: 'Tesla', match: false }])
    expect(highlightParts('Tesla', '  ')).toEqual([{ text: 'Tesla', match: false }])
    expect(highlightParts('', 'a')).toEqual([])
  })
})

describe('quoteSymbolsFor', () => {
  it('keeps US stocks/ETFs only, max N, sorted for a stable cache key', () => {
    const syms = quoteSymbolsFor(
      [
        hit('MSFT', 'stock'),
        hit('BTC-USD', 'crypto'),
        hit('VOD.L', 'stock', { country: 'GB' }),
        hit('SHOP', 'stock', { country: 'CA' }),
        hit('SPY', 'etf'),
        hit('AAPL', 'stock'),
      ],
      2,
    )
    expect(syms).toEqual(['MSFT', 'SPY'])
  })
})

describe('recent searches', () => {
  it('pushRecent moves a repeat to the front, uppercases and caps', () => {
    let list = [] as ReturnType<typeof pushRecent>
    list = pushRecent(list, { symbol: 'aapl', name: 'Apple', kind: 'stock' })
    list = pushRecent(list, { symbol: 'MSFT', name: 'Microsoft', kind: 'stock' })
    list = pushRecent(list, { symbol: 'AAPL', name: 'Apple Inc.', kind: 'stock' })
    expect(list.map((r) => r.symbol)).toEqual(['AAPL', 'MSFT'])
    expect(list[0].name).toBe('Apple Inc.')
    for (let i = 0; i < 20; i++) list = pushRecent(list, { symbol: `T${i}`, name: '', kind: 'stock' }, 5)
    expect(list).toHaveLength(5)
  })

  it('parseRecent drops corrupt entries and rejects non-arrays', () => {
    expect(parseRecent('nope')).toBeUndefined()
    expect(
      parseRecent([{ symbol: 'nvda', name: 'NVIDIA', kind: 'stock' }, { symbol: 42 }, null, { symbol: '<script>' }, { symbol: 'SPY', kind: 'bogus' }]),
    ).toEqual([
      { symbol: 'NVDA', name: 'NVIDIA', kind: 'stock' },
      { symbol: 'SPY', name: 'SPY', kind: 'stock' },
    ])
  })
})

describe('typedTicker', () => {
  it('accepts ticker-shaped input only', () => {
    expect(typedTicker(' brk.b ')).toBe('BRK.B')
    expect(typedTicker('BTC-USD')).toBe('BTC-USD')
    expect(typedTicker('apple inc')).toBeNull()
    expect(typedTicker('')).toBeNull()
  })
})
