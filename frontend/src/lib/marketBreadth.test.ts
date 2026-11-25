import { describe, expect, it } from 'vitest'
import { classifyChange, computeBreadth, isStaleTradeTime, FLAT_THRESHOLD_PCT } from './marketBreadth'

describe('marketBreadth', () => {
  it('uses one ±0.1% flat band', () => {
    expect(FLAT_THRESHOLD_PCT).toBe(0.1)
    expect(classifyChange(0)).toBe('flat')
    expect(classifyChange(0.1)).toBe('flat')
    expect(classifyChange(-0.1)).toBe('flat')
    expect(classifyChange(0.11)).toBe('up')
    expect(classifyChange(-0.11)).toBe('down')
    expect(classifyChange(undefined)).toBe('flat')
    expect(classifyChange(NaN)).toBe('flat')
  })

  it('cards, heatmap and mobile get identical counts (regression: 503/251/12 vs 487/238/41)', () => {
    const sectors = [
      { stocks: [{ change_percent: 0.01 }, { change_percent: -0.01 }, { change_percent: 0.05 }, { change_percent: 0.5 }] },
      { stocks: [{ change_percent: -0.5 }, { change_percent: 0 }, null] },
      { stocks: null },
      null,
    ]
    expect(computeBreadth(sectors)).toEqual({ total: 6, gainers: 1, losers: 1, flat: 4 })
    expect(computeBreadth(undefined)).toEqual({ total: 0, gainers: 0, losers: 0, flat: 0 })
  })

  it('flags delisted tickers by last trade time', () => {
    const now = Date.UTC(2026, 10, 25, 5)
    const eaLastTrade = Date.UTC(2026, 7, 4, 20) / 1000 // EA regularMarketTime
    expect(isStaleTradeTime(eaLastTrade, now)).toBe(true)
    expect(isStaleTradeTime(now / 1000 - 4 * 86400, now)).toBe(false) // long weekend
    expect(isStaleTradeTime(undefined, now)).toBe(false)
    expect(isStaleTradeTime('x', now)).toBe(false)
  })
})
