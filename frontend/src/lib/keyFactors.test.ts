import { describe, expect, it } from 'vitest'
import { generateKeyFactors, netBias } from './keyFactors'
import type { FundamentalsData, Indicators } from './api'

// NVDA readings from the research page screenshot + yfinance fundamentals
const ind: Indicators = {
  symbol: 'NVDA',
  indicators: {
    current_price: 155.38, sma_20: 175.78, sma_50: 204.95, sma_200: 202.81, rsi: 34.41,
    macd: { macd: -17.26, signal: -16.07, histogram: -1.19 },
    bollinger_bands: { upper: 225.84, middle: 175.78, lower: 125.72 },
  },
}
const fund: FundamentalsData = {
  symbol: 'NVDA', pe_ratio: 17.7, forward_pe: 9.36, peg_ratio: 0.15, profit_margin: 62.5, gross_margin: 74.9,
  roe: 117.4, debt_to_equity: 0.14, current_ratio: 4.08, beta: 2.25, week_52_high: 243.37, week_52_low: 124.5,
  target_price: 244.71, recommendation: '1.7',
}

describe('generateKeyFactors', () => {
  const factors = generateKeyFactors(ind, fund, 155.38)
  const byId = Object.fromEntries(factors.map((f) => [f.id, f]))

  it('covers technical + fundamental families (not just 3 extremes)', () => {
    expect(factors.length).toBeGreaterThanOrEqual(9)
    for (const id of ['trend', 'rsi', 'macd', 'vol', 'range', 'val', 'quality', 'balance', 'analyst', 'beta']) {
      expect(byId[id], id).toBeDefined()
    }
  })

  it('reads NVDA correctly', () => {
    // price 155.38 below SMA50 204.95 AND SMA200 202.81 (SMA50 > SMA200) → the
    // uptrend has broken; "pullback" is only for prices still above SMA200
    expect(byId.trend.title).toBe('Trend Breakdown')
    expect(byId.trend.bias).toBe('Bearish')
    expect(byId.rsi.title).toBe('Weak Momentum')          // 34.4: below 45, not ≤30
    expect(byId.macd.bias).toBe('Bearish')
    expect(byId.vol.title).toBe('High Volatility')         // bands span 57% of the mean
    expect(byId.val.title).toBe('Attractive Valuation')    // PEG 0.15
    expect(byId.quality.bias).toBe('Bullish')
    expect(byId.balance.title).toBe('Strong Balance Sheet')
    expect(byId.analyst.title).toBe('Analysts Bullish')    // +57% to target, consensus 1.7
    expect(byId.analyst.description).toContain('+57.5%')
  })

  it('calls a dip that holds SMA200 a pullback', () => {
    const t = Object.fromEntries(generateKeyFactors(ind, fund, 203.5).map((f) => [f.id, f]))
    expect(t.trend.title).toBe('Pullback in Uptrend')
  })

  it('never claims invented hit-rates', () => {
    for (const f of factors) expect(f.description).not.toMatch(/probability|historically|% of the time|~1\.7x/i)
  })

  it('sorts High impact first and keeps strength in 5..95', () => {
    const rank = { High: 0, Medium: 1, Low: 2 }
    for (let i = 1; i < factors.length; i++) expect(rank[factors[i - 1].impact]).toBeLessThanOrEqual(rank[factors[i].impact])
    for (const f of factors) expect(f.strength).toBeGreaterThanOrEqual(5), expect(f.strength).toBeLessThanOrEqual(95)
  })

  it('handles missing data', () => {
    expect(generateKeyFactors(null, null, undefined)).toEqual([])
    expect(generateKeyFactors(null, { symbol: 'X', pe_ratio: 30 }, 10).map((f) => f.id)).toEqual(['val'])
  })
})

describe('netBias', () => {
  it('weights by impact and spans -100..100', () => {
    expect(netBias([])).toBe(0)
    const mk = (bias: 'Bullish' | 'Bearish' | 'Neutral', impact: 'High' | 'Low') =>
      ({ id: bias + impact, title: '', category: 'Technical', impact, bias, strength: 50, description: '', icon: 'trend' } as const)
    expect(netBias([mk('Bullish', 'High')])).toBe(100)
    expect(netBias([mk('Bearish', 'High'), mk('Bullish', 'Low')])).toBe(-50)
  })
})
