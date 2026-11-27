import { describe, expect, it } from 'vitest'
import {
  avgVolume, clampIndex, gttCondition, holdingsBySymbol, holdingsTotals, moveItem, nextListName, pctFrom,
  quoteFromHolding, rangePosition, sortItems, sparkPoints, toWatchQuote, fmtLtp, fmtSigned,
  type HoldingRow, type WatchQuote,
} from './marketwatch'

const row = (o: Partial<HoldingRow>): HoldingRow => ({
  symbol: 'AAPL', name: null, quantity: 1, avg_cost: 100, cost_basis: 100, price: 110, change_percent: 1,
  market_value: 110, unrealized_pnl: 10, unrealized_pnl_percent: 10, day_change: 1, portfolio_id: 1,
  portfolio_name: 'Main', simulated: false, ...o,
})

describe('toWatchQuote (canonical contract)', () => {
  it('uses the regular session, never the extended print, as the headline', () => {
    const q = toWatchQuote('AMD', {
      price: 423.01, change: 16.98, change_percent: 4.18,
      regular: { price: 406.03, change: -1.2, change_percent: -0.29, previous_close: 407.23 },
      extended: { price: 423.01, change_percent: 4.18, session: 'overnight' },
      data_source: 'finnhub', as_of: '2026-11-26T21:00:00Z',
    })
    expect(q.price).toBe(406.03)
    expect(q.change_percent).toBe(-0.29)
    expect(q.previous_close).toBe(407.23)
    expect(q.extended).toEqual({ price: 423.01, change_percent: 4.18, session: 'overnight' })
    expect(q.unavailable).toBe(false)
  })

  it('marks missing or non-positive prices unavailable without inventing values', () => {
    for (const raw of [undefined, { unavailable: true, price: 10 }, { price: 0 }, { price: null }]) {
      const q = toWatchQuote('X', raw as Record<string, unknown> | undefined)
      expect(q.unavailable).toBe(true)
      expect(q.price).toBeNull()
      expect(q.change).toBeNull()
      expect(q.change_percent).toBeNull()
    }
  })
})

describe('ordering helpers', () => {
  it('moveItem moves one element and ignores out-of-range moves', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b'], -1, 0)).toEqual(['a', 'b'])
  })

  it('clampIndex', () => {
    expect(clampIndex(5, 3)).toBe(2)
    expect(clampIndex(-2, 3)).toBe(0)
    expect(clampIndex(0, 0)).toBe(-1)
  })

  it('sortItems keeps stored order for manual and puts unquoted symbols last', () => {
    const items = [{ symbol: 'C' }, { symbol: 'A' }, { symbol: 'B' }, { symbol: 'D' }]
    const quotes: Record<string, WatchQuote | undefined> = {
      A: toWatchQuote('A', { price: 10, change_percent: -1 }),
      B: toWatchQuote('B', { price: 30, change_percent: 3 }),
      C: toWatchQuote('C', { price: 20, change_percent: 2 }),
    }
    expect(sortItems(items, quotes, 'manual').map((i) => i.symbol)).toEqual(['C', 'A', 'B', 'D'])
    expect(sortItems(items, quotes, 'symbol').map((i) => i.symbol)).toEqual(['A', 'B', 'C', 'D'])
    expect(sortItems(items, quotes, 'change').map((i) => i.symbol)).toEqual(['B', 'C', 'A', 'D'])
    expect(sortItems(items, quotes, 'ltp').map((i) => i.symbol)).toEqual(['B', 'C', 'A', 'D'])
  })

  it('nextListName picks the first free number', () => {
    expect(nextListName([{ name: 'Watchlist 1' }])).toBe('Watchlist 2')
    expect(nextListName([{ name: 'Watchlist 1' }, { name: 'watchlist 2' }])).toBe('Watchlist 3')
  })
})

describe('GTT-style trigger', () => {
  it('direction follows the trigger vs the last price', () => {
    expect(gttCondition(110, 100)).toBe('price_above')
    expect(gttCondition(90, 100)).toBe('price_below')
  })
  it('refuses triggers that cannot be placed honestly', () => {
    expect(gttCondition(100, 100)).toBeNull() // would fire at once
    expect(gttCondition(0, 100)).toBeNull()
    expect(gttCondition(NaN, 100)).toBeNull()
    expect(gttCondition(110, null)).toBeNull() // no live price
  })
  it('pctFrom and rangePosition', () => {
    expect(pctFrom(100, 105)).toBeCloseTo(5)
    expect(pctFrom(0, 105)).toBeNull()
    expect(rangePosition(15, 10, 20)).toBeCloseTo(0.5)
    expect(rangePosition(25, 10, 20)).toBe(1)
    expect(rangePosition(15, 20, 20)).toBeNull()
  })
})

describe('holdings', () => {
  it('holdingsBySymbol keeps real and simulated quantities apart', () => {
    const m = holdingsBySymbol([
      row({ quantity: 5 }),
      row({ quantity: 3, simulated: true, portfolio_id: 2, portfolio_name: 'Paper' }),
      row({ symbol: 'MSFT', quantity: 2 }),
    ])
    expect(m.AAPL).toEqual({ quantity: 5, simulatedQuantity: 3, portfolios: ['Main', 'Paper'] })
    expect(m.MSFT.quantity).toBe(2)
  })

  it('holdingsTotals sums server values and excludes unpriced rows from value and cost', () => {
    const t = holdingsTotals([
      row({ market_value: 110, cost_basis: 100, unrealized_pnl: 10, day_change: 1 }),
      row({ symbol: 'X', market_value: null, cost_basis: 500, unrealized_pnl: null, price: null }),
      row({ symbol: 'Y', market_value: 90, cost_basis: 100, unrealized_pnl: -10, day_change: -2 }),
    ])
    expect(t.marketValue).toBe(200)
    expect(t.costBasis).toBe(200)
    expect(t.unrealizedPnl).toBe(0)
    expect(t.unrealizedPct).toBe(0)
    expect(t.dayChange).toBe(-1)
    expect(t.priced).toBe(2)
    expect(t.unpriced).toBe(1)
  })

  it('holdingsTotals has no % without a cost basis', () => {
    expect(holdingsTotals([]).unrealizedPct).toBeNull()
  })

  it('quoteFromHolding carries only the server LTP and day %', () => {
    const q = quoteFromHolding('AAPL', [row({ price: 123.45, change_percent: 0.5 })])!
    expect(q.price).toBe(123.45)
    expect(q.change_percent).toBe(0.5)
    expect(q.change).toBeNull()
    expect(q.previous_close).toBeNull()
    expect(quoteFromHolding('AAPL', [row({ price: null })])).toBeUndefined()
  })
})

describe('format + charts', () => {
  it('fmtLtp / fmtSigned', () => {
    expect(fmtLtp(1234.5)).toBe('1,234.50')
    expect(fmtLtp(0.12345)).toBe('0.1235')
    expect(fmtLtp(null)).toBe('—')
    expect(fmtSigned(1.234)).toBe('+1.23')
    expect(fmtSigned(-1.234)).toBe('−1.23')
    expect(fmtSigned(0)).toBe('0.00')
  })

  it('sparkPoints draws nothing for fewer than two values', () => {
    expect(sparkPoints([], 50, 20)).toBe('')
    expect(sparkPoints([1], 50, 20)).toBe('')
    const pts = sparkPoints([1, 2, 3], 52, 22).split(' ')
    expect(pts).toHaveLength(3)
    expect(pts[0]).toBe('1.0,21.0') // lowest value at the bottom-left
    expect(pts[2]).toBe('51.0,1.0') // highest at the top-right
  })

  it('avgVolume ignores missing and zero volumes', () => {
    expect(avgVolume([100, 0, null, 300])).toBe(200)
    expect(avgVolume([])).toBeNull()
  })
})
