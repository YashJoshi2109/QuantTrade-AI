import { describe, expect, it } from 'vitest'
import {
  bandCalibration, BENCHMARK_NAME, EDGE_TEXT, EXPERIMENTAL_LABEL, fmtP, horizonLabel, horizonReliability, mlStatusSentence,
  noEdgeReason,
} from './forecastHonesty'

describe('horizonReliability', () => {
  it('prefers the backend field', () => {
    expect(horizonReliability({ horizons: [{ h: 5, reliability: 'edge_in_backtest' }], beats_naive: { '5': false } }, 5))
      .toBe('edge_in_backtest')
  })
  it('falls back to beats_naive and defaults to no edge', () => {
    expect(horizonReliability({ beats_naive: { '1': true } }, 1)).toBe('edge_in_backtest')
    expect(horizonReliability({ beats_naive: {} }, 20)).toBe('no_edge')
    expect(horizonReliability({}, 20)).toBe('no_edge')
  })
})

describe('bandCalibration', () => {
  const bt = (c80: number, c95: number, origins = 40) => ({ backtest: { origins, band_coverage: { '20': { '80': c80, '95': c95 } } } })
  it('classifies coverage like the backend', () => {
    expect(bandCalibration(bt(0.81, 0.94), 20)).toBe('calibrated')
    expect(bandCalibration(bt(0.6, 0.85), 20)).toBe('under_covered')
    expect(bandCalibration(bt(0.97, 1.0), 20)).toBe('over_covered')
  })
  it('refuses to judge with too few origins or missing data', () => {
    expect(bandCalibration(bt(0.8, 0.95, 5), 20)).toBe('insufficient_data')
    expect(bandCalibration({}, 20)).toBe('insufficient_data')
  })
  it('uses the backend status when present', () => {
    expect(bandCalibration({ horizons: [{ h: 1, calibration: { status: 'under_covered' } }] }, 1)).toBe('under_covered')
  })
})

describe('labels', () => {
  it('always says experimental and not advice', () => {
    expect(EXPERIMENTAL_LABEL).toMatch(/Experimental/)
    expect(EXPERIMENTAL_LABEL).toMatch(/Not investment advice/)
    expect(mlStatusSentence(undefined)).toMatch(/experimental/i)
    expect(mlStatusSentence({ note: 'custom' })).toBe('custom')
  })
})

describe('benchmark helpers', () => {
  it('names ARIMA(0,1,0) as the benchmark everywhere', () => {
    expect(BENCHMARK_NAME).toBe('ARIMA(0,1,0)')
    expect(EDGE_TEXT.no_edge).toBe('No edge vs ARIMA(0,1,0)')
    expect(horizonLabel(60)).toBe('3 months')
    expect(horizonLabel(7)).toBe('7 days')
  })
  it('formats p-values and explains missing edges', () => {
    expect(fmtP(0.004)).toBe('<0.01')
    expect(fmtP(0.456)).toBe('0.46')
    expect(fmtP(null)).toBe('—')
    expect(noEdgeReason({ edge: true })).toBeNull()
    expect(noEdgeReason({ edge: false, effective_tests: 3.7 })).toBe('too few independent tests')
    expect(noEdgeReason({ edge: false, effective_tests: 50, rel_mae: 1.04 })).toBe('error not below ARIMA(0,1,0)')
    expect(noEdgeReason({ edge: false, effective_tests: 50, rel_mae: 0.98, dm_pvalue_holm: 0.4 }))
      .toBe('improvement not statistically significant')
  })
})
