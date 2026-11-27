import { describe, expect, it } from 'vitest'
import { fmtCompact, fmtPe, fmtPrice, keyStatsColumns, keyStatsSource } from './researchKeyStats'

describe('researchKeyStats', () => {
  it('formats NVDA session figures from the canonical quote', () => {
    const cols = keyStatsColumns({
      open: 144.06, day_high: 150.37, day_low: 141.17, volume: 366_570_000,
      pe_ratio: 16.04, market_cap: 3.61e12, week_52_high: 243.37, week_52_low: 124.5, avg_volume: 210_400_000,
    })
    expect(cols.map((c) => c.map((s) => `${s.label}=${s.value}`))).toEqual([
      ['Open=144.06', 'High=150.37', 'Low=141.17'],
      ['Vol=366.57M', 'P/E=16.04', 'Mkt Cap=3.61T'],
      ['52W H=243.37', '52W L=124.50', 'Avg Vol=210.40M'],
    ])
  })

  it('never fabricates: missing, zero or negative figures are dashes', () => {
    expect(fmtPrice(0)).toBe('—')
    expect(fmtPrice(null)).toBe('—')
    expect(fmtCompact(undefined)).toBe('—')
    expect(fmtPe(-12.3)).toBe('—')
    expect(keyStatsColumns(null).flat().every((s) => s.value === '—')).toBe(true)
  })

  it('merges live quote, ticker quote and fundamentals with one rule', () => {
    const src = keyStatsSource(
      { open: 144.06, day_high: 149.0, day_low: 0, volume: 1, pe_ratio: 0, market_cap: 3.61e12, week_52_high: 0, avg_volume: 2e8 },
      { high: 150.37, low: 141.17, volume: 366_570_000 },
      { pe_ratio: 16.04, week_52_high: 243.37, week_52_low: 124.5 },
    )
    expect(src).toEqual({
      open: 144.06, day_high: 150.37, day_low: 141.17, volume: 366_570_000, pe_ratio: 16.04,
      market_cap: 3.61e12, week_52_high: 243.37, week_52_low: 124.5, avg_volume: 2e8,
    })
    expect(keyStatsSource(null)).toEqual({
      open: undefined, day_high: undefined, day_low: undefined, volume: undefined, pe_ratio: undefined,
      market_cap: undefined, week_52_high: undefined, week_52_low: undefined, avg_volume: undefined,
    })
  })

  it('prefers the live quote open and falls back to the ticker open', () => {
    expect(keyStatsSource({ open: 100 }, { open: 101.5 }).open).toBe(101.5)
    expect(keyStatsSource({ open: 100 }, { open: null }).open).toBe(100)
  })
})
