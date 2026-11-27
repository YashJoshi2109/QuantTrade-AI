import { describe, expect, it } from 'vitest'
import {
  axisFor,
  defaultTarget,
  fmtIv,
  fmtMoney,
  fmtPct,
  fmtProb,
  fmtRange,
  normalizeSymbol,
  parseSymbols,
  pctIn,
  pricingVerdict,
  rangePct,
  rangeWidthPct,
} from './outlook'
import { parseHoldings } from '@/components/outlook/ScenarioPanel'
import { headlineExpiry } from '@/components/outlook/ImpliedPanels'
import type { ExpiryOutlook } from './outlook'

describe('outlook formatting', () => {
  it('formats probabilities, vols and percents from the right units', () => {
    expect(fmtProb(0.1313)).toBe('13.1%')
    expect(fmtProb(0.0004)).toBe('<0.1%')
    expect(fmtProb(0.9996)).toBe('>99.9%')
    expect(fmtProb(null)).toBe('—')
    expect(fmtIv(0.2356)).toBe('23.6%')
    expect(fmtPct(4.8)).toBe('4.80%')
    expect(fmtPct(-3.14159, 1, true)).toBe('−3.1%')
    expect(fmtPct(2, 1, true)).toBe('+2.0%')
    expect(fmtMoney(-2478)).toBe('−$2,478')
    expect(fmtMoney(90, true)).toBe('+$90')
    expect(fmtMoney(undefined)).toBe('—')
    expect(fmtRange([334.24, 376.77])).toBe('$334.24 – $376.77')
    expect(fmtRange([null, 3])).toBe('—')
  })

  it('never shows 0 for a missing number', () => {
    expect(fmtPct(Number.NaN)).toBe('—')
    expect(fmtIv(undefined)).toBe('—')
  })
})

describe('outlook geometry', () => {
  it('maps ranges onto a shared axis', () => {
    const ax = axisFor([[90, 110], [95, 120], null], [100])!
    expect(ax[0]).toBeLessThan(90)
    expect(ax[1]).toBeGreaterThan(120)
    expect(pctIn(ax[0], ax[0], ax[1])).toBe(0)
    expect(pctIn(1e9, ax[0], ax[1])).toBe(100)
    expect(axisFor([null])).toBeNull()
  })

  it('converts a price range to percent moves from spot', () => {
    const p = rangePct([90, 110], 100)!
    expect(p[0]).toBeCloseTo(-10)
    expect(p[1]).toBeCloseTo(10)
    expect(rangeWidthPct([95, 110], 100)).toBeCloseTo(15)
    expect(rangePct([90, 110], 0)).toBeNull()
  })

  it('picks the expiry nearest 30 days as the headline', () => {
    const rows = [3, 21, 35, 84].map((days) => ({ days, expiration: `d${days}` }) as unknown as ExpiryOutlook)
    expect(headlineExpiry(rows)?.days).toBe(35)
    expect(headlineExpiry([])).toBeNull()
  })
})

describe('outlook inputs', () => {
  it('validates and dedupes symbols', () => {
    expect(normalizeSymbol(' brk.b ')).toBe('BRK.B')
    expect(normalizeSymbol('$$$')).toBeNull()
    expect(parseSymbols('aapl, msft msft;nvda ???', 12)).toEqual(['AAPL', 'MSFT', 'NVDA'])
    expect(parseSymbols('A B C D', 2)).toEqual(['A', 'B'])
  })

  it('parses holdings lines and sums duplicates', () => {
    expect(parseHoldings('AAPL 10\nmsft, 5\nAAPL 2.5\nbad line\nTSLA 0')).toEqual([
      { symbol: 'AAPL', shares: 12.5 },
      { symbol: 'MSFT', shares: 5 },
    ])
  })

  it('rounds the default probability target to a sensible tick', () => {
    expect(defaultTarget(355.58)).toBe(373)
    expect(defaultTarget(42)).toBe(44)
    expect(defaultTarget(null)).toBeNull()
  })

  it('words the implied vs realized ratio', () => {
    expect(pricingVerdict(1.5)).toMatch(/bigger/)
    expect(pricingVerdict(0.5)).toMatch(/smaller/)
    expect(pricingVerdict(1)).toMatch(/in line/)
    expect(pricingVerdict(null)).toBeNull()
  })
})
