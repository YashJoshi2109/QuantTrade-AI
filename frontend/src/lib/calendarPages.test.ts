import { describe, expect, it } from 'vitest'
import { busiestDay, dayFractions } from './calendarDates'
import { csvCell, toCsv } from './csv'
import { countUpValue } from './useCountUp'
import {
  compareBars,
  earningsCsv,
  earningsStats,
  filterEarningsRows,
  sortEarningsRows,
  type EarningsRow,
} from './earnings'
import {
  dividendRowKey,
  dividendsCsv,
  filterDividendRows,
  freqBucket,
  historyBars,
  paymentTimeline,
  sortDividendRows,
  type DividendRow,
} from './dividends'

const er = (o: Partial<EarningsRow>): EarningsRow => ({
  symbol: 'X', name: null, date: '2026-12-02', hour: null, hour_label: null,
  eps_estimate: null, eps_actual: null, eps_surprise_pct: null,
  revenue_estimate: null, revenue_actual: null, revenue_surprise_pct: null,
  market_cap: null, cap_tier: null, sector: null, fiscal_period: null, num_estimates: null,
  status: 'upcoming', in_watchlist: false, in_portfolio: false, sources: ['nasdaq'], ...o,
})

const dr = (o: Partial<DividendRow>): DividendRow => ({
  symbol: 'X', name: null, sector: null, ex_date: '2026-12-01', pay_date: null, record_date: null, declared_date: null,
  amount: null, annual_dividend: null, frequency: null, frequency_label: null, price: null, yield_pct: null,
  in_watchlist: false, in_portfolio: false, ...o,
})

describe('calendar day cards', () => {
  it('scales bars to the busiest day and finds it', () => {
    expect(dayFractions([2, 4, 0, 1, 4])).toEqual([0.5, 1, 0, 0.25, 1])
    expect(dayFractions([0, 0])).toEqual([0, 0])
    const days = ['2026-11-30', '2026-12-01', '2026-12-02']
    expect(busiestDay({ '2026-12-01': 5, '2026-12-02': 5, '2026-11-30': 1 }, days)).toEqual({ day: '2026-12-01', count: 5 })
    expect(busiestDay({}, days)).toBeNull()
  })
})

describe('earnings page helpers', () => {
  const rows = [
    er({ symbol: 'AAPL', name: 'Apple Inc.', date: '2026-11-30', hour: 'amc', status: 'reported', eps_estimate: 1, eps_actual: 1.1, eps_surprise_pct: 10, market_cap: 3e12, cap_tier: 'mega' }),
    er({ symbol: 'TINY', date: '2026-11-30', hour: null, market_cap: 5e7, cap_tier: 'micro' }),
    er({ symbol: 'MSFT', name: 'Microsoft', date: '2026-12-01', hour: 'bmo', eps_estimate: 3, market_cap: 2.9e12, cap_tier: 'mega' }),
    er({ symbol: 'ZZ', date: '2026-12-01', hour: 'bmo', eps_surprise_pct: -4 }),
  ]

  it('filters by session (TBD = no time), status, size and search', () => {
    const f = { session: 'all' as const, status: 'all' as const, cap: '' as const, q: '' }
    expect(filterEarningsRows(rows, { ...f, session: 'tbd' }).map((r) => r.symbol)).toEqual(['TINY'])
    expect(filterEarningsRows(rows, { ...f, session: 'bmo' }).map((r) => r.symbol)).toEqual(['MSFT', 'ZZ'])
    expect(filterEarningsRows(rows, { ...f, status: 'reported' }).map((r) => r.symbol)).toEqual(['AAPL'])
    expect(filterEarningsRows(rows, { ...f, cap: 'mega' })).toHaveLength(2)
    expect(filterEarningsRows(rows, { ...f, q: 'micro' }).map((r) => r.symbol)).toEqual(['MSFT'])
    expect(filterEarningsRows(rows, { ...f, q: 'aa' }).map((r) => r.symbol)).toEqual(['AAPL'])
  })

  it('computes stat cards from the real rows', () => {
    const s = earningsStats(rows, ['2026-11-30', '2026-12-01', '2026-12-02'], '2026-12-01')
    expect(s).toEqual({ total: 4, today: 2, reported: 1, withEstimate: 2, busiest: { day: '2026-11-30', count: 2 } })
    expect(earningsStats([], ['2026-11-30'], '2026-11-30').busiest).toBeNull()
  })

  it('sorts with unknowns last in both directions', () => {
    expect(sortEarningsRows(rows, 'eps_surprise_pct', 'desc').map((r) => r.symbol)).toEqual(['AAPL', 'ZZ', 'MSFT', 'TINY'])
    expect(sortEarningsRows(rows, 'eps_surprise_pct', 'asc').map((r) => r.symbol)).toEqual(['ZZ', 'AAPL', 'MSFT', 'TINY'])
    expect(sortEarningsRows(rows, 'hour', 'asc').map((r) => r.symbol)).toEqual(['MSFT', 'ZZ', 'AAPL', 'TINY'])
  })

  it('compares actual vs estimate bars and exports blanks for unknowns', () => {
    expect(compareBars(1.1, 1)).toEqual({ actual: 1, estimate: 1 / 1.1 })
    expect(compareBars(null, 2)).toEqual({ actual: 0, estimate: 1 })
    expect(compareBars(null, null)).toBeNull()
    const csv = earningsCsv([rows[1]])[0]
    expect(csv[3]).toBe('TBD')
    expect(csv[6]).toBeNull() // EPS estimate unknown -> empty cell, not 0
  })
})

describe('dividend page helpers', () => {
  const rows = [
    dr({ symbol: 'KO', name: 'Coca-Cola', frequency: 4, yield_pct: 3 }),
    dr({ symbol: 'O', name: 'Realty Income', frequency: 12, yield_pct: 5.5 }),
    dr({ symbol: 'CCAP', frequency: 52 }),
    dr({ symbol: 'SPC', frequency: null, yield_pct: 1 }),
  ]

  it('buckets frequency and filters', () => {
    expect(freqBucket(26)).toBe('weekly')
    expect(freqBucket(null)).toBe('unknown')
    expect(filterDividendRows(rows, { freq: 'monthly', q: '' }).map((r) => r.symbol)).toEqual(['O'])
    expect(filterDividendRows(rows, { freq: 'unknown', q: '' }).map((r) => r.symbol)).toEqual(['SPC'])
    expect(filterDividendRows(rows, { freq: 'all', q: 'cola' }).map((r) => r.symbol)).toEqual(['KO'])
    expect(sortDividendRows(rows, 'frequency', 'desc').map((r) => r.symbol)).toEqual(['CCAP', 'O', 'KO', 'SPC'])
  })

  it('builds the payment timeline relative to today', () => {
    const t = paymentTimeline(dr({ ex_date: '2026-11-30', record_date: '2026-11-30', pay_date: '2026-12-15', declared_date: '2026-11-01' }), '2026-11-30')
    expect(t.map((s) => `${s.id}:${s.state}`)).toEqual(['declared:past', 'ex:today', 'record:today', 'pay:future'])
    const u = paymentTimeline(dr({ ex_date: '2026-12-02' }), '2026-11-30')
    expect(u.map((s) => s.state)).toEqual(['future', 'unknown', 'unknown'])
  })

  it('scales history bars and keys rows', () => {
    const h = { symbol: 'KO', available: true, ttm_total: 2, ttm_count: 4, frequency: 4, frequency_label: 'Quarterly',
      next_ex_date: null, next_pay_date: null, source: 'yfinance',
      payments: [{ ex_date: '2026-03-01', amount: 0.5 }, { ex_date: '2026-06-01', amount: 1 }] }
    expect(historyBars(h).map((b) => b.frac)).toEqual([0.5, 1])
    expect(historyBars(undefined)).toEqual([])
    expect(dividendRowKey(rows[0])).toBe('KO|2026-12-01|')
    expect(dividendsCsv([rows[2]])[0][11]).toBeNull()
  })
})

describe('csv + count-up', () => {
  it('escapes cells and neutralises formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell(-1.5)).toBe('-1.5')
    expect(csvCell(null)).toBe('')
    expect(csvCell(Number.NaN)).toBe('')
    expect(toCsv(['A', 'B'], [[1, null]])).toBe('A,B\r\n1,')
  })

  it('eases from start to target', () => {
    expect(countUpValue(0, 100, 0)).toBe(0)
    expect(countUpValue(0, 100, 1)).toBe(100)
    expect(countUpValue(0, 100, 0.5)).toBeGreaterThan(50)
    expect(countUpValue(10, 0, 2)).toBe(0)
  })
})
