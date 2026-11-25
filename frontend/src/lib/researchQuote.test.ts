import { describe, expect, it } from 'vitest'
import { formatPercent } from './format'
import { pickMetric, resolvePriceInfo } from './researchQuote'

describe('resolvePriceInfo', () => {
  it('prefers a real realtime quote', () => {
    const r = resolvePriceInfo(
      { price: 317.1, change: 0.44, change_percent: 0.14, volume: 100, data_source: 'finnhub', latency_ms: 50 },
      { price: 310, change: 1, change_percent: 0.3 },
      [],
    )
    expect(r).toMatchObject({ price: 317.1, percent: 0.14, dataSource: 'finnhub', hasPrice: true })
  })

  it('ignores the zero placeholder fetchQuote returns on failure and uses the ticker profile', () => {
    const r = resolvePriceInfo(
      { price: 0, change: 0, change_percent: 0, volume: 0 },
      { price: 25.5, change: -0.5, change_percent: -1.92, volume: 1e6 },
      [],
    )
    expect(r).toMatchObject({ price: 25.5, change: -0.5, percent: -1.92, dataSource: 'profile', hasPrice: true })
  })

  it('falls back to the last two daily bars', () => {
    const r = resolvePriceInfo(undefined, undefined, [{ close: 100 }, { close: 110, volume: 5 }])
    expect(r.price).toBe(110)
    expect(r.change).toBe(10)
    expect(r.percent).toBeCloseTo(10)
    expect(r.hasPrice).toBe(true)
  })

  it('reports hasPrice=false instead of a $0.00 quote when nothing is loaded', () => {
    const r = resolvePriceInfo({ price: 0 }, { price: 0 }, [])
    expect(r.hasPrice).toBe(false)
    expect(r.price).toBe(0)
  })
})

describe('pickMetric', () => {
  it('uses the ticker value first, then fundamentals', () => {
    expect(pickMetric(842e9, 800e9)).toBe(842e9)
    expect(pickMetric(0, 800e9)).toBe(800e9)
    expect(pickMetric(undefined, null)).toBeUndefined()
  })
})

describe('dividend yield formatting', () => {
  it('/api/quotes/ticker returns percent units, so 0.33 renders as 0.33%, not 33%', () => {
    expect(formatPercent(0.33466)).toBe('0.33%')
    expect(formatPercent(undefined)).toBe('N/A')
  })
})
