import { describe, expect, it } from 'vitest'
import {
  alignNormalised,
  buildRows,
  compareHref,
  forecastCell,
  parseFinvizNumber,
  parseSymbols,
  rangeStartDate,
  rankRow,
  recommendationLabel,
  type CompareSnapshot,
} from './compare'

const snap = (symbol: string, f: Record<string, unknown>, extra: Partial<CompareSnapshot> = {}): CompareSnapshot => ({
  symbol,
  name: symbol,
  sector: null,
  quote: null,
  fundamentals: { symbol, ...f },
  finviz: null,
  indicators: null,
  ...extra,
})

describe('compare helpers', () => {
  it('parses, dedupes, validates and caps symbols for the shareable URL', () => {
    expect(parseSymbols('aapl, msft,,AAPL,bad$,nvda amd,tsla')).toEqual(['AAPL', 'MSFT', 'NVDA', 'AMD'])
    expect(parseSymbols(null)).toEqual([])
    expect(parseSymbols('BRK.B')).toEqual(['BRK.B'])
    expect(compareHref(['aapl', 'msft'])).toBe('/compare?symbols=AAPL,MSFT')
    expect(compareHref([])).toBe('/compare')
  })

  it('ranks best/worst by direction, ignoring missing values and ties', () => {
    expect(rankRow([10, 20, null, 5], 'higher')).toEqual({ best: 1, worst: 3 })
    expect(rankRow([10, 20, null, 5], 'lower')).toEqual({ best: 3, worst: 1 })
    expect(rankRow([10, null], 'higher')).toEqual({ best: null, worst: null })
    expect(rankRow([3, 3], 'higher')).toEqual({ best: null, worst: null })
    expect(rankRow([3, 3, 1], 'higher')).toEqual({ best: null, worst: 2 })
    expect(rankRow([1, 2], null)).toEqual({ best: null, worst: null })
  })

  it('builds rows: negative P/E is not ranked, missing shows —', () => {
    const rows = buildRows([
      snap('A', { pe_ratio: 20, debt_to_equity: 0.5, dividend_yield: 1.2 }),
      snap('B', { pe_ratio: -5, debt_to_equity: 2.0 }),
      snap('C', { pe_ratio: 30, debt_to_equity: 1.0, dividend_yield: 0.4 }),
    ])
    const pe = rows.find((r) => r.def.key === 'pe')!
    expect(pe.display).toEqual(['20.00x', '—', '30.00x'])
    expect([pe.best, pe.worst]).toEqual([0, 2])
    const de = rows.find((r) => r.def.key === 'de')!
    expect([de.best, de.worst]).toEqual([0, 1])
    const dy = rows.find((r) => r.def.key === 'dy')!
    expect(dy.display[1]).toBe('—')
    const rowsBank = buildRows([snap('JPM', { gross_margin: 0 }), snap('X', { gross_margin: 40 })])
    expect(rowsBank.find((r) => r.def.key === 'gm')!.display).toEqual(['—', '40.00%'])
    const mcap = rows.find((r) => r.def.key === 'mcap')!
    expect(mcap.best).toBeNull()
    expect(mcap.display).toEqual(['—', '—', '—'])
  })

  it('computes technicals and analyst upside from price', () => {
    const rows = buildRows([
      snap('A', { target_price: 110 }, { indicators: { rsi: 55, sma50: 90, sma200: 80, price: 100 } }),
      snap('B', {}, { finviz: { Recom: '1.80', 'Target Price': '50', 'Sales Y/Y TTM': '12.5%' }, indicators: { rsi: 40, sma50: 55, sma200: 60, price: 50 } }),
    ])
    const v = (k: string) => rows.find((r) => r.def.key === k)!
    expect(v('sma50').values[0]).toBeCloseTo(11.111, 2)
    expect(v('sma200').values[1]).toBeCloseTo(-16.667, 2)
    expect(v('upside').values).toEqual([expect.closeTo(10, 5), 0])
    expect(v('rec').display[1]).toBe('Buy (1.8)')
    expect(v('rev_g').display).toEqual(['—', '+12.50%'])
    expect(v('rsi').best).toBeNull()
  })

  it('parses finviz strings', () => {
    expect(parseFinvizNumber('15.06%')).toBe(15.06)
    expect(parseFinvizNumber('-3.2%')).toBe(-3.2)
    expect(parseFinvizNumber('1,234.5')).toBe(1234.5)
    expect(parseFinvizNumber('-')).toBeNull()
    expect(parseFinvizNumber(undefined)).toBeNull()
    expect(recommendationLabel(null)).toBe('—')
    expect(recommendationLabel(3.9)).toBe('Sell (3.9)')
  })

  it('aligns closes on one axis, forward-fills after the first close, normalises', () => {
    const { dates, values, commonStart } = alignNormalised(
      {
        A: [{ timestamp: '2026-01-02T05:00:00Z', close: 100 }, { timestamp: '2026-01-05T05:00:00Z', close: 110 }, { timestamp: '2026-01-06T05:00:00Z', close: 121 }],
        B: [{ timestamp: '2026-01-05T00:00:00Z', close: 50 }, { timestamp: '2026-01-06T00:00:00Z', close: 45 }],
      },
      ['A', 'B']
    )
    expect(commonStart).toBe('2026-01-05')
    // both lines start on the first day every ticker has a close
    expect(dates).toEqual(['2026-01-05', '2026-01-06'])
    expect(values.A[0]).toBe(0)
    expect(values.A[1]).toBeCloseTo(10)
    expect(values.B).toEqual([0, expect.closeTo(-10, 5)])
  })

  it('range start dates', () => {
    const now = new Date('2026-11-26T12:00:00Z')
    expect(rangeStartDate('YTD', now).toISOString().slice(0, 10)).toBe('2026-01-01')
    expect(rangeStartDate('3M', now).toISOString().slice(0, 10)).toBe('2026-08-26')
  })

  it('forecast cell follows the honesty rules', () => {
    expect(forecastCell(null)).toEqual({ main: '—', sub: '' })
    expect(forecastCell({ h: 20, exp_return_pct: 1.18, prob_up: 0.557, reliability: 'edge_in_backtest' })).toEqual({ main: '+1.18%', sub: 'P(up) 56%' })
    expect(forecastCell({ h: 20, exp_return_pct: 1.18, prob_up: 0.557, reliability: 'no_edge' }).main).toBe('No edge')
  })
})
