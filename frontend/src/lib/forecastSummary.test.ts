import { describe, expect, it } from 'vitest'
import {
  describeHorizon, fmtRange, fmtRangePct, fmtSignedPct, hitRateText, hitRateTone, normalizeTickers, pickHorizon,
  portfolioForecastBand, positionInRange, summarizeFullForecast, type ForecastHorizonSummary, type ForecastSummary,
} from './forecastSummary'

/** A /api/v1/forecast payload in the current shape (two horizons). */
function fullPayload(edge20 = false) {
  const row = (h: number, b80: [number, number], b95: [number, number], point: number, edge: boolean, cov80: number, tests: number) => ({
    h, date: '2026-12-23', point, exp_return_pct: 0.69, prob_up: 0.56, sigma_log: 0.05,
    bands: { '50': [b80[0] + 1, b80[1] - 1] as [number, number], '80': b80, '95': b95 },
    reliability: edge ? ('edge_in_backtest' as const) : ('no_edge' as const),
    calibration: { status: 'calibrated' as const },
    eval: { holdout_origins: tests, coverage: { '80': cov80, '95': 0.93 } },
  })
  return {
    ticker: 'AAPL', as_of: '2026-11-25', last_close: 236.48, benchmark: { name: 'ARIMA(0,1,0)' },
    horizons: [row(1, [232.9, 240.3], [230.1, 243.0], 236.6, false, 0.9, 50), row(20, [219.5, 257.3], [209.0, 268.4], 238.1, edge20, 0.78, 40)],
    beats_naive: { '1': false, '20': edge20 },
    ml_model: { promoted: false, gates_passed: 6, gates_total: 10, gates_required: 8, note: 'passed 6 of 10' },
  }
}

describe('summarizeFullForecast (mirror of backend summarize_forecast)', () => {
  it('keeps ranges and hit rates, hides direction without a tested edge', () => {
    const s = summarizeFullForecast(fullPayload(false))!
    const h = pickHorizon(s, 20)!
    expect(h.range_80).toEqual([219.5, 257.3])
    expect(h.range_95).toEqual([209.0, 268.4])
    expect(h.range_80_pct).toEqual([Math.round((219.5 / 236.48 - 1) * 10000) / 100, Math.round((257.3 / 236.48 - 1) * 10000) / 100])
    expect(h.midpoint).toBeNull()
    expect(h.prob_up_pct).toBeNull()
    expect(h.exp_return_pct).toBeNull()
    expect(h.edge_text).toBe('No edge vs ARIMA(0,1,0)')
    expect([h.hit_rate_80, h.hit_rate_tests]).toEqual([0.78, 40])
    expect(s.signal).toBe(false)
    expect(s.investment_advice).toBe(false)
    expect(s.label).toBe('Experimental · Not investment advice')
    expect(s.ml_gate?.gates_passed).toBe(6)
  })

  it('shows midpoint and P(up) only on horizons that beat the benchmark', () => {
    const s = summarizeFullForecast(fullPayload(true))!
    expect(pickHorizon(s, 20)!.midpoint).toBe(238.1)
    expect(pickHorizon(s, 20)!.prob_up_pct).toBe(56)
    expect(pickHorizon(s, 1)!.midpoint).toBeNull()
    expect(s.any_edge).toBe(true)
    expect(s.signal).toBe(false)
  })

  it('returns null for empty payloads', () => {
    expect(summarizeFullForecast(null)).toBeNull()
    expect(summarizeFullForecast({ horizons: [] })).toBeNull()
  })
})

describe('formatting', () => {
  it('formats ranges, signed percents and hit rates', () => {
    expect(fmtRange([219.5, 257.3])).toBe('$219.50 – $257.30')
    expect(fmtRange([1219.5, 1257.3])).toBe('$1,220 – $1,257')
    expect(fmtRange(null)).toBe('—')
    expect(fmtSignedPct(-7.18)).toBe('−7.2%')
    expect(fmtSignedPct(8.81)).toBe('+8.8%')
    expect(fmtSignedPct(0)).toBe('0.0%')
    expect(fmtRangePct([-7.18, 8.81])).toBe('−7.2% / +8.8%')
    expect(hitRateText({ hit_rate_80: 0.78, hit_rate_tests: 40 })).toBe('Held 78% of 40 tests')
    expect(hitRateText({ hit_rate_80: null, hit_rate_tests: 40 })).toBeNull()
    expect(hitRateText({ hit_rate_80: 0.8, hit_rate_tests: 0 })).toBeNull()
    expect(hitRateTone({ calibration: 'under_covered' })).toBe('warn')
    expect(hitRateTone({ calibration: 'calibrated' })).toBe('ok')
    expect(hitRateTone({ calibration: 'insufficient_data' })).toBe('muted')
  })

  it('describes a horizon with the honesty label and no midpoint when there is no edge', () => {
    const h = pickHorizon(summarizeFullForecast(fullPayload(false)), 20)!
    const d = describeHorizon('AAPL', h)
    expect(d).toContain('80% range $219.50 – $257.30')
    expect(d).toContain('held 78% of 40 tests')
    expect(d).toContain('No edge vs ARIMA(0,1,0)')
    expect(d).toContain('Not investment advice')
    expect(d).not.toContain('midpoint')
  })

  it('positions a price inside a range, clamped', () => {
    expect(positionInRange(150, [100, 200])).toBe(50)
    expect(positionInRange(250, [100, 200])).toBe(100)
    expect(positionInRange(null, [100, 200])).toBeNull()
    expect(positionInRange(150, [200, 200])).toBeNull()
  })

  it('normalizes tickers', () => {
    expect(normalizeTickers([' aapl', 'MSFT', 'AAPL', '', null, 'brk.b'])).toEqual(['AAPL', 'MSFT', 'BRK.B'])
    expect(normalizeTickers(Array.from({ length: 80 }, (_, i) => `T${i}`))).toHaveLength(50)
  })
})

describe('portfolioForecastBand', () => {
  const hz = (lo: number, hi: number, lo95: number, hi95: number, hit: number | null, tests: number | null, edge = false): ForecastHorizonSummary => ({
    h: 20, label: '1 month', range_80: [100 * (1 + lo / 100), 100 * (1 + hi / 100)], range_95: [0, 0],
    range_80_pct: [lo, hi], range_95_pct: [lo95, hi95], reliability: edge ? 'edge_in_backtest' : 'no_edge', edge,
    edge_text: '', midpoint: null, exp_return_pct: null, prob_up_pct: null, hit_rate_80: hit, hit_rate_95: null,
    hit_rate_tests: tests, calibration: 'calibrated',
  })
  const sm = (h: ForecastHorizonSummary): ForecastSummary => ({
    ticker: null, as_of: null, last_close: 100, benchmark: 'ARIMA(0,1,0)', horizons: [h], any_edge: h.edge,
    status: 'experimental', label: '', investment_advice: false, signal: false,
  })

  it('sums each holding’s range applied to its value (comonotonic, widest case)', () => {
    const band = portfolioForecastBand(
      [{ symbol: 'AAPL', market_value: 6000 }, { symbol: 'msft', market_value: 4000 }, { symbol: 'NEW', market_value: 1000 }, { symbol: 'Z', market_value: null }],
      { AAPL: sm(hz(-10, 10, -20, 20, 0.8, 40)), MSFT: sm(hz(-5, 15, -12, 25, 0.7, 30)), NEW: null },
      20,
    )
    // 80%: 6000*0.9 + 4000*0.95 = 9200 ; 6000*1.1 + 4000*1.15 = 11200
    expect(band.range_80).toEqual([9200, 11200])
    // 95% low: 6000*0.8 + 4000*0.88 = 8320 → downside 1680 (16.8% of 10000)
    expect(band.range_95).toEqual([8320, 12200])
    expect(band.downside_95).toBe(1680)
    expect(band.downside_95_pct).toBe(16.8)
    expect(band.range_80_pct).toEqual([-8, 12])
    expect(band.covered_value).toBe(10000)
    expect(band.total_value).toBe(11000)
    expect([band.covered_count, band.total_count]).toEqual([2, 3])
    expect(band.missing).toEqual(['NEW'])
    // value-weighted hit rate (0.6*0.8 + 0.4*0.7) and the smallest test count
    expect(band.avg_hit_rate_80).toBe(0.76)
    expect(band.min_tests).toBe(30)
    expect(band.any_edge).toBe(false)
  })

  it('is empty, not invented, when nothing has a forecast', () => {
    const band = portfolioForecastBand([{ symbol: 'A', market_value: 100 }], {}, 20)
    expect(band.range_80).toBeNull()
    expect(band.downside_95).toBeNull()
    expect(band.avg_hit_rate_80).toBeNull()
    expect(band.missing).toEqual(['A'])
  })

  it('uses only the requested horizon', () => {
    const band = portfolioForecastBand([{ symbol: 'A', market_value: 100 }], { A: sm(hz(-1, 1, -2, 2, null, null)) }, 5)
    expect(band.range_80).toBeNull()
    expect(band.missing).toEqual(['A'])
  })
})
