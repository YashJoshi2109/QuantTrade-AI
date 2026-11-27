import { describe, expect, it } from 'vitest'
import { blendEquityCurves, fmtDrawdown, fmtPctUnits, pctToFraction } from './legacyBacktest'
import { dsrTitle, metricLabel, METRIC_DEFS } from './backtestLab'

// Values from the prod classic API, 2026-11-26: AAPL ma_crossover 50/200,
// 2016-11-25 .. 2026-11-25, no costs (independently re-computed: +286.04%).
const PROD = { total_return: 286.04, win_rate: 60.0, max_drawdown: 31.43, var_95: -2.22, annualized_volatility: 23.4 }

describe('classic backtest units', () => {
  it('formats API percents without multiplying by 100 again', () => {
    expect(fmtPctUnits(PROD.total_return)).toBe('286.04%') // was 28604.00%
    expect(fmtPctUnits(PROD.win_rate)).toBe('60.00%') // was 6000.00%
    expect(fmtPctUnits(PROD.total_return, 2, true)).toBe('+286.04%')
    expect(fmtDrawdown(PROD.max_drawdown)).toBe('-31.43%')
    expect(fmtDrawdown(0)).toBe('0.00%')
  })

  it('converts percent units to fractions for Kelly and risk scores', () => {
    expect(pctToFraction(PROD.win_rate)).toBeCloseTo(0.6, 10)
    expect(pctToFraction(PROD.var_95)).toBeCloseTo(-0.0222, 10)
    expect(pctToFraction(undefined)).toBe(0)
  })
})

describe('blended (combined) portfolio', () => {
  // A: +10% then -10%; B: flat then +5%. 50/50, rebalanced daily:
  // r_p = [0.05, -0.025] -> equity 1.05, 1.02375.
  const A = [100, 110, 99]
  const B = [100, 100, 105]

  it('compounds the weighted daily returns', () => {
    const m = blendEquityCurves([A, B], [50, 50])!
    expect(m.total_return).toBeCloseTo(2.375, 9)
    // drawdown of the mix (1.02375 / 1.05 - 1), not the 5% average of 10% and 0%
    expect(m.max_drawdown).toBeCloseTo(2.5, 9)
    const mean = (0.05 - 0.025) / 2
    const sd = Math.sqrt(((0.05 - mean) ** 2 + (-0.025 - mean) ** 2) / 1)
    expect(m.sharpe_ratio).toBeCloseTo((mean / sd) * Math.sqrt(252), 9)
    expect(m.bars).toBe(3)
  })

  it('normalises weights and ignores zero-weight legs', () => {
    expect(blendEquityCurves([A, B], [3, 0])!.total_return).toBeCloseTo(-1, 9) // A alone: 99/100 - 1
    expect(blendEquityCurves([A, B], [0, 0])).toBeNull()
  })
})

describe('strategy lab labels', () => {
  const sharpe = METRIC_DEFS.find((d) => d.key === 'sharpe')!
  it('puts the risk-free rate in rf-dependent labels', () => {
    expect(metricLabel(sharpe, { risk_free_rate_pct: 4 })).toBe('Sharpe · rf 4%')
    expect(metricLabel(sharpe, {})).toBe('Sharpe · rf 0%')
    expect(metricLabel(METRIC_DEFS.find((d) => d.key === 'cagr_pct')!, { risk_free_rate_pct: 4 })).toBe('CAGR')
  })

  it('calls a one-trial deflated Sharpe what it is', () => {
    expect(dsrTitle({ trials: 1 })).toBe('Probabilistic Sharpe')
    expect(dsrTitle({ trials: 9 })).toBe('Deflated Sharpe (9 trials)')
    expect(dsrTitle(null)).toBe('Probabilistic Sharpe')
  })

  it('shows the pro metrics the backend returns', () => {
    const keys = METRIC_DEFS.map((d) => d.key)
    for (const k of ['information_ratio', 'tracking_error_pct', 'correlation', 'exposure_adjusted_cagr_pct',
      'var_95_daily_pct', 'cvar_95_daily_pct', 'best_month_pct', 'worst_month_pct', 'positive_months_pct']) {
      expect(keys).toContain(k)
    }
  })
})
