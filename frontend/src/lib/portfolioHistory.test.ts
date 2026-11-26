import { describe, expect, it } from 'vitest'
import {
  checkImportFile,
  describeImportRow,
  excessReturn,
  historySeries,
  startsAfterFirstTrade,
  type ImportRow,
  type PortfolioHistory,
} from './portfolioHistory'

const base: PortfolioHistory = {
  portfolio_id: 1,
  kind: 'tracked',
  simulated: false,
  range: '1Y',
  benchmark: 'SPY',
  benchmark_available: true,
  points: [
    { date: '2026-01-02', value: 1000, cost_basis: 1000, cash: null, net_flow: 1000, return_percent: 0, benchmark_percent: 0, source: 'backfill' },
    { date: '2026-01-05', value: 1100, cost_basis: 1000, cash: null, net_flow: 0, return_percent: 10, benchmark_percent: null, source: 'backfill' },
  ],
  stats: { twr_percent: 10, max_drawdown_percent: 0, benchmark_return_percent: 2.5, start_value: 1000, end_value: 1100, start: '2026-01-02', end: '2026-01-05', days: 2 },
  missing_symbols: [],
  rebuilt: false,
  history_start: '2026-01-02',
  coverage_start: '2026-01-02',
}

describe('portfolio history helpers', () => {
  it('builds portfolio + SPY series, keeping gaps', () => {
    const { dates, series } = historySeries(base)
    expect(dates).toEqual(['2026-01-02', '2026-01-05'])
    expect(series.map((s) => s.key)).toEqual(['portfolio', 'benchmark'])
    expect(series[1].values).toEqual([0, null])
    expect(series[1].dashed).toBe(true)
  })

  it('labels a paper curve as simulated and hides a missing benchmark', () => {
    const { series } = historySeries({ ...base, simulated: true, kind: 'paper', benchmark_available: false })
    expect(series).toHaveLength(1)
    expect(series[0].label).toMatch(/simulated/i)
    expect(historySeries(undefined)).toEqual({ dates: [], series: [] })
  })

  it('excess return needs both numbers', () => {
    expect(excessReturn(base.stats)).toBeCloseTo(7.5)
    expect(excessReturn({ ...base.stats, benchmark_return_percent: null })).toBeNull()
    expect(excessReturn(undefined)).toBeNull()
  })

  it('flags a curve that starts after the first trade', () => {
    expect(startsAfterFirstTrade(base)).toBe(false)
    expect(startsAfterFirstTrade({ ...base, history_start: '2025-03-10' })).toBe(true)
    expect(startsAfterFirstTrade(undefined)).toBe(false)
  })

  it('checks the file before upload', () => {
    expect(checkImportFile({ name: 'trades.csv', size: 1000 })).toBeNull()
    expect(checkImportFile({ name: 'trades.xlsx', size: 1000 })).toMatch(/csv/)
    expect(checkImportFile({ name: 'big.csv', size: 10 * 1024 * 1024 })).toMatch(/larger/)
  })

  it('describes preview rows, with — when incomplete', () => {
    const row: ImportRow = {
      row: 2, date: '2026-01-05', symbol: 'AAPL', type: 'BUY', quantity: 10, price: 185.2, fees: 0,
      amount: null, notes: null, errors: [], warnings: [], status: 'ok',
    }
    expect(describeImportRow(row)).toBe('Buy 10 @ $185.2')
    expect(describeImportRow({ ...row, type: 'DIVIDEND', amount: 2.4 })).toBe('Dividend $2.40')
    expect(describeImportRow({ ...row, type: null })).toBe('—')
  })
})
