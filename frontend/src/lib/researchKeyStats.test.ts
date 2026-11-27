import { describe, expect, it } from 'vitest'
import { fmtCompact, fmtPe, fmtPrice, keyStatsColumns } from './researchKeyStats'

describe('researchKeyStats', () => {
  it('formats NVDA session figures from the canonical quote', () => {
    const cols = keyStatsColumns({
      open: 144.02, day_high: 150.37, day_low: 141.17, volume: 366_570_000,
      pe_ratio: 16.04, market_cap: 3.61e12, week_52_high: 243.37, week_52_low: 124.5, avg_volume: 210_400_000,
    })
    expect(cols.map((c) => c.map((s) => `${s.label}=${s.value}`))).toEqual([
      ['Open=144.02', 'High=150.37', 'Low=141.17'],
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
})
