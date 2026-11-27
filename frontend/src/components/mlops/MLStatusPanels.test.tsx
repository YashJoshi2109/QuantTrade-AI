import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test'
})

import MLStatusPanels from './MLStatusPanels'
import { fetchFailureMessage, gateHeadline, type MlopsStatus } from '@/lib/mlopsStatus'
import { basketCoverageNote } from '@/lib/basketCoverage'

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const EMPTY_STATUS: MlopsStatus = {
  generated_at: '2026-11-27T00:00:00Z',
  gate: {
    status: 'ok', verdict: 'NOT_READY', promoted: false, gates_passed: null, gates_total: 10, gates_required: 8,
    note: 'Our ML price model is experimental.',
    benchmark_test: {
      benchmark: 'ARIMA(0,1,0)', edge_any: false, finding: 'LSTM shows no predictive edge over a random walk.',
      horizons: [{ horizon: 1, tickers: ['AAPL', 'SPY'], rel_mae_range: [1.13, 3.16], min_dm_p_one_sided: 0.99,
        significantly_worse_tickers: ['AAPL'], edge: false }],
    },
  },
  registry: { status: 'empty', versions: [], runs_total: 0, empty_reason: 'No model versions in Postgres yet.' },
  data_freshness: {
    status: 'ok', symbols: 387,
    price_bars: { status: 'fresh', rows: 4504, symbols_covered: 20, newest_age_days: 1.2, stale_after_days: 4 },
    fundamentals: { status: 'stale', rows: 22, newest_age_days: 9, stale_after_days: 7, empty_reason: 'Newest fundamentals row is 9.0 days old.' },
    coverage_note: 'Only 20 of 387 symbols have price history.',
  },
  forecast_benchmarks: { status: 'empty', tickers: [], empty_reason: 'No forecast evaluations are cached yet.' },
  file_stores: { status: 'ephemeral', stores: [], empty_reason: 'reset on every deploy' },
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MLStatusPanels', () => {
  it.each([false, true])('explains every empty section instead of rendering blank (compact=%s)', async (compact) => {
    fetchMock.mockResolvedValue(jsonResponse(EMPTY_STATUS))
    render(<MLStatusPanels compact={compact} />)

    expect(await screen.findByText(/NOT READY/)).toBeTruthy()
    expect(screen.getByText('No model versions in Postgres yet.')).toBeTruthy()
    expect(screen.getByText('No forecast evaluations are cached yet.')).toBeTruthy()
    expect(screen.getByText('Newest fundamentals row is 9.0 days old.')).toBeTruthy()
    expect(screen.getByText(/LSTM shows no predictive edge/)).toBeTruthy()
    expect(screen.getByText('NO EDGE')).toBeTruthy()
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://api.test/api/v1/mlops/status')
  })

  it('tells the user to sign in again on 401 instead of a blank page', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Not authenticated' }, 401))
    render(<MLStatusPanels />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/session has expired/i)
  })

  it('lists registry versions and benchmark edges when data exists', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      ...EMPTY_STATUS,
      registry: { status: 'ok', runs_total: 2, runs_completed: 2, versions: [
        { model_version: 'v20261126_1303', promotion_status: 'production', avg_da: 0.5388, avg_ic: 0.1515 }] },
      forecast_benchmarks: { status: 'ok', cached: 1, edges: 1, tests: 2, benchmark: 'ARIMA(0,1,0)', tickers: [
        { ticker: 'AAPL', horizons: [{ horizon: 1, rel_mae: 1.01, edge: false }, { horizon: 5, rel_mae: 0.97, edge: true }] }] },
    }))
    render(<MLStatusPanels />)
    expect(await screen.findByText('v20261126_1303')).toBeTruthy()
    expect(screen.getByText(/DA 53\.9%/)).toBeTruthy()
    expect(screen.getByText('1/2 edges')).toBeTruthy()
    expect(screen.getByText('5d 0.97x')).toBeTruthy()
  })
})

describe('helpers', () => {
  it('gateHeadline says NOT READY and never-tested', () => {
    expect(gateHeadline(EMPTY_STATUS.gate)).toBe('NOT READY · never gate-tested (8/10 required)')
    expect(gateHeadline({ ...EMPTY_STATUS.gate, gates_passed: 7 })).toBe('NOT READY · 7/10 gates passed (8 required)')
  })

  it('fetchFailureMessage distinguishes auth from network failures', () => {
    expect(fetchFailureMessage({ ok: false, reason: 'unauthorized', status: 401 })).toMatch(/sign in/i)
    expect(fetchFailureMessage({ ok: false, reason: 'network' })).toMatch(/reach the backend/)
    expect(fetchFailureMessage({ ok: true, data: 1 })).toBeNull()
  })

  it('basketCoverageNote describes partial baskets only', () => {
    expect(basketCoverageNote({ universe_size: 166, scoreable: 40, scored: 40, partial: true,
      top_reasons: [{ reason: 'no fundamentals, no price_bars', count: 120 }] }))
      .toBe('Partial basket: built from 40 of 166 stocks with enough data; 126 skipped. Most common gap: no fundamentals, no price_bars (120).')
    expect(basketCoverageNote({ universe_size: 10, scoreable: 10, scored: 10, partial: false, top_reasons: [] })).toBeNull()
    expect(basketCoverageNote(undefined)).toBeNull()
  })
})
