import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ForecastBadge from './ForecastBadge'
import type { SummaryItem } from '@/lib/forecastSummary'

const item = (edge: boolean): SummaryItem => ({
  ticker: 'AAPL',
  status: 'ready',
  summary: {
    ticker: 'AAPL', as_of: '2026-11-25', last_close: 236.48, benchmark: 'ARIMA(0,1,0)', any_edge: edge,
    status: 'experimental', label: 'Experimental · Not investment advice', investment_advice: false, signal: false,
    horizons: [{
      h: 20, label: '1 month', range_80: [219.5, 257.3], range_95: [209, 268.4], range_80_pct: [-7.18, 8.8],
      range_95_pct: [-11.62, 13.5], reliability: edge ? 'edge_in_backtest' : 'no_edge', edge,
      edge_text: edge ? 'Beat ARIMA(0,1,0) in tests' : 'No edge vs ARIMA(0,1,0)',
      midpoint: edge ? 238.1 : null, exp_return_pct: null, prob_up_pct: null,
      hit_rate_80: 0.78, hit_rate_95: 0.93, hit_rate_tests: 40, calibration: 'calibrated',
    }],
  },
})

describe('ForecastBadge', () => {
  afterEach(cleanup)

  it('shows a skeleton while loading', () => {
    render(<ForecastBadge symbol="AAPL" loading />)
    expect(screen.getByTestId('forecast-badge-skeleton')).toBeTruthy()
  })

  it('shows range, hit rate and no-edge label, no midpoint', () => {
    render(<ForecastBadge symbol="AAPL" item={item(false)} price={236.48} />)
    const el = screen.getByTestId('forecast-badge-AAPL')
    expect(el.textContent).toContain('$219.50 – $257.30')
    expect(el.textContent).toContain('Held 78% of 40')
    expect(el.textContent).toContain('no edge')
    expect(el.textContent).not.toContain('mid')
    expect(el.getAttribute('title')).toContain('Not investment advice')
  })

  it('shows the midpoint only with a tested edge', () => {
    render(<ForecastBadge symbol="AAPL" item={item(true)} />)
    expect(screen.getByTestId('forecast-badge-AAPL').textContent).toContain('mid $238.10')
  })

  it('is honest when nothing is computed', () => {
    const { rerender } = render(<ForecastBadge symbol="X" item={{ ticker: 'X', status: 'pending', summary: null }} />)
    expect(screen.getByText('Computing…')).toBeTruthy()
    rerender(<ForecastBadge symbol="X" item={{ ticker: 'X', status: 'invalid', summary: null }} />)
    expect(screen.getByText('—')).toBeTruthy()
  })
})
