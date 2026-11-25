import { describe, expect, it } from 'vitest'
import { pickQuote, toIndexQuote, type RawQuote } from '@/lib/indexQuotes'
import { displaySymbol, formatLevelOrPrice, isIndexLevel } from '@/lib/quoteDisplay'
import { normalizeMoverRows } from '@/lib/movers'
import { computeBreadth } from '@/lib/marketBreadth'

const spxInfo = {
  name: 'S&P 500',
  shortName: 'SPX',
  exchangeId: 'nyse',
  exchangeName: 'NYSE',
  country: 'United States',
  countryCode: 'US',
  continent: 'americas',
  currency: 'USD',
  color: '#007AFF',
}

const raw = (price: number, extra: Partial<RawQuote> = {}): RawQuote => ({
  price,
  change: 0,
  change_percent: 0.5,
  prev_close: price,
  day_high: price,
  day_low: price,
  volume: 0,
  market_state: 'REGULAR',
  ...extra,
})

describe('index quotes never present an ETF proxy as the index level', () => {
  it('real index level keeps the index label and is a level', () => {
    const q = toIndexQuote('^GSPC', spxInfo, raw(7201.3))
    expect(q.name).toBe('S&P 500')
    expect(q.is_proxy).toBeUndefined()
    expect(isIndexLevel(q)).toBe(true)
    expect(formatLevelOrPrice(q.price, isIndexLevel(q))).toBe('7,201.30')
  })

  it('Finnhub SPY proxy is relabelled as the ETF and priced in dollars', () => {
    const q = toIndexQuote('^GSPC', spxInfo, raw(718.78, { proxy: { symbol: 'SPY', name: 'S&P 500 ETF' } }))
    expect(q.name).toBe('SPY (S&P 500 ETF)')
    expect(q.shortName).toBe('SPY')
    expect(q.is_proxy).toBe(true)
    expect(displaySymbol(q)).toBe('SPY')
    expect(isIndexLevel(q)).toBe(false)
    expect(formatLevelOrPrice(q.price, isIndexLevel(q))).toBe('$718.78')
    expect(q).not.toHaveProperty('proxy')
  })

  it('a zero-price primary row does not mask the fallback', () => {
    expect(pickQuote(raw(0), undefined, raw(7200))?.price).toBe(7200)
    expect(pickQuote(null, raw(0))).toBeUndefined()
  })

  it('missing values render as a dash', () => {
    expect(formatLevelOrPrice(0, true)).toBe('—')
    expect(formatLevelOrPrice(undefined, false)).toBe('—')
  })
})

describe('normalizeMoverRows', () => {
  it('keeps backend StockPerformance rows intact', () => {
    const rows = normalizeMoverRows([
      { symbol: 'MSGS', name: 'Madison Square Garden Sports', price: 384.39, change: 71.77, change_percent: 22.96, volume: 1 },
    ])
    expect(rows).toEqual([
      { symbol: 'MSGS', name: 'Madison Square Garden Sports', price: 384.39, change_percent: 22.96 },
    ])
  })

  it('maps provider field names and drops rows that would render empty', () => {
    const rows = normalizeMoverRows([
      { ticker: 'AAA', companyName: 'Alpha', price: '12.5', changesPercentage: '3.2%' },
      { symbol: '', price: 1, change_percent: 1 },
      { symbol: 'NOPCT', price: 5 },
      null,
      { symbol: 'AAA', price: 1, change_percent: 9 },
    ])
    expect(rows).toEqual([{ symbol: 'AAA', name: 'Alpha', price: 12.5, change_percent: 3.2 }])
  })

  it('returns [] for non-arrays', () => {
    expect(normalizeMoverRows(undefined)).toEqual([])
    expect(normalizeMoverRows({ gainers: [] })).toEqual([])
  })
})

describe('home header breadth uses the shared classifier', () => {
  it('counts flats within ±0.1% instead of splitting them into up/down', () => {
    const sectors = [{ stocks: [{ change_percent: 0.05 }, { change_percent: -0.05 }, { change_percent: 1 }, { change_percent: -1 }] }]
    expect(computeBreadth(sectors)).toEqual({ total: 4, gainers: 1, losers: 1, flat: 2 })
  })
})
