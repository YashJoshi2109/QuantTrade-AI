import { describe, expect, it } from 'vitest'
import { fieldTooltip, implausibleReasons, notMeaningfulLabel, sanitizeFundamentals, sanitizeTickerInfo } from './fundamentalSanity'

describe('fundamental sanity', () => {
  it('rejects PARA-style unadjusted values', () => {
    const r = implausibleReasons(
      { week_52_high: 39200, week_52_low: 2.06, eps: 25891, roe: -250.06, pe_ratio: 0.0001, target_price: 24000 },
      2.74,
    )
    expect(Object.keys(r).sort()).toEqual(['eps', 'pe_ratio', 'roe', 'target_price', 'week_52_high'])
    expect(r.week_52_high).toContain('50x')
  })

  it('keeps plausible values', () => {
    expect(implausibleReasons({ week_52_high: 260, week_52_low: 160, eps: 6.5, roe: 150, pe_ratio: 35 }, 230)).toEqual({})
  })

  it('nulls fields and builds tooltips, keeping backend derived notes', () => {
    const { values, notes } = sanitizeFundamentals(
      { week_52_high: 39200, pe_ratio: null, market_cap: 5e6 } as { week_52_high: number; pe_ratio: null; market_cap: number },
      2.74,
      { market_cap: { status: 'derived', source: 'SEC XBRL diluted shares x price $2.74' }, pe_ratio: { status: 'n/m', reason: 'Not meaningful' } },
    )
    expect(values?.week_52_high).toBeNull()
    expect(fieldTooltip(notes, 'week_52_high')).toMatch(/^Hidden: /)
    expect(fieldTooltip(notes, 'market_cap')).toMatch(/^Derived: SEC XBRL/)
    expect(notMeaningfulLabel(notes, 'pe_ratio')).toBe('n/m')
  })

  it('sanitizes a ticker profile for Company Folio', () => {
    const { info, hidden } = sanitizeTickerInfo({ price: 2.74, week_52_high: 39200, eps: 25891, return_on_equity: -250, beta: 1.1 })
    expect(info.week_52_high).toBe(0)
    expect(info.eps).toBe(0)
    expect(info.return_on_equity).toBe(0)
    expect(info.beta).toBe(1.1)
    expect(hidden.map((h) => h.label)).toEqual(['52W High', 'EPS', 'Return on Equity'])
  })
})
