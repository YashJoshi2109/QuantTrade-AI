import { describe, expect, it } from 'vitest'
import { bandCalibration, EXPERIMENTAL_LABEL, horizonReliability, mlStatusSentence } from './forecastHonesty'

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
