import { describe, expect, it } from 'vitest'
import {
  barFractions,
  fmtMoney,
  fmtPerShare,
  fmtShortDate,
  fmtYield,
  groupByExDate,
  monthLabel,
  daysUntil,
  relDays,
  sortByYield,
  sortDividendRows,
  summarize,
  sumMonths,
  type DividendRow,
} from './dividends'
import { addDays, dayLabel, todayNY, weekDays, weekRangeLabel, weekStart } from './calendarDates'

const row = (o: Partial<DividendRow>): DividendRow => ({
  symbol: 'X', name: null, sector: null, ex_date: '2026-11-30', pay_date: null, record_date: null,
  declared_date: null, amount: null, annual_dividend: null, frequency: null, frequency_label: null,
  price: null, yield_pct: null, in_watchlist: false, in_portfolio: false, ...o,
})

describe('dividend formatting: missing is "—", never $0 or NaN', () => {
  it('formats money, per-share, yield and dates', () => {
    expect(fmtMoney(434.66)).toBe('$434.66')
    expect(fmtMoney(1234.5, 0)).toBe('$1,235')
    expect(fmtPerShare(0.0675374)).toBe('$0.0675')
    expect(fmtPerShare(0.53)).toBe('$0.53')
    expect(fmtYield(3.0286)).toBe('3.03%')
    expect(fmtShortDate('2026-12-14')).toBe('Dec 14')
    for (const v of [null, undefined, NaN, Infinity]) {
      expect(fmtMoney(v as number)).toBe('—')
      expect(fmtPerShare(v as number)).toBe('—')
      expect(fmtYield(v as number)).toBe('—')
    }
    expect(fmtShortDate(null)).toBe('—')
    expect(fmtShortDate('garbage')).toBe('—')
    expect(monthLabel('2027-01')).toBe('Jan')
    expect(monthLabel('2027-01', 'long')).toBe('January 2027')
  })
})

describe('income chart math', () => {
  it('scales bars to the largest month and sums months to cents', () => {
    expect(barFractions([53.7, 0, 26.85])).toEqual([1, 0, 0.5])
    expect(barFractions([0, 0])).toEqual([0, 0])
    expect(barFractions([NaN, 10])).toEqual([0, 1])
    expect(sumMonths([{ total: 53.7 }, { total: 32.54 }, { total: 29.9 }])).toBe(116.14)
    expect(sumMonths([{ total: 0.1 }, { total: 0.2 }])).toBe(0.3)
  })
})

describe('dividend calendar grouping', () => {
  it('groups by ex-date with empty days present and sorts highest yield first', () => {
    const rows = [
      row({ symbol: 'A', yield_pct: 2 }),
      row({ symbol: 'B', yield_pct: 6 }),
      row({ symbol: 'C' }),
      row({ symbol: 'D', ex_date: '2026-12-02', yield_pct: 1 }),
    ]
    const g = groupByExDate(rows, weekDays('2026-11-30'))
    expect(g['2026-12-01']).toEqual([])
    expect(sortByYield(g['2026-11-30']).map((r) => r.symbol)).toEqual(['B', 'A', 'C'])
    expect(g['2026-12-02'].map((r) => r.symbol)).toEqual(['D'])
  })
})

describe('calendar dates', () => {
  it('handles week math, labels and the New York date', () => {
    expect(weekStart('2026-11-29')).toBe('2026-11-23')
    expect(weekStart('2027-01-01')).toBe('2026-12-28')
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(dayLabel('2026-11-30')).toBe('Mon, Nov 30')
    expect(weekRangeLabel('2026-11-30')).toBe('Nov 30 – Dec 4, 2026')
    expect(todayNY(new Date('2026-11-27T03:00:00Z'))).toBe('2026-11-26')
  })
})

describe('dividend sorting and summary', () => {
  const rows = [
    row({ symbol: 'B', yield_pct: 2, amount: 0.5, pay_date: '2026-12-10', price: 50 }),
    row({ symbol: 'A', yield_pct: null, amount: 1, pay_date: null }),
    row({ symbol: 'C', yield_pct: 5, amount: 0.1, pay_date: '2026-12-01', price: 8, in_portfolio: true }),
  ]
  it('sorts by any key with unknown values last in both directions', () => {
    expect(sortDividendRows(rows, 'yield', 'desc').map((r) => r.symbol)).toEqual(['C', 'B', 'A'])
    expect(sortDividendRows(rows, 'yield', 'asc').map((r) => r.symbol)).toEqual(['B', 'C', 'A'])
    expect(sortDividendRows(rows, 'pay_date', 'asc').map((r) => r.symbol)).toEqual(['C', 'B', 'A'])
    expect(sortDividendRows(rows, 'amount', 'desc').map((r) => r.symbol)).toEqual(['A', 'B', 'C'])
    expect(sortDividendRows(rows, 'symbol', 'asc').map((r) => r.symbol)).toEqual(['A', 'B', 'C'])
  })
  it('summarizes counts and the top known yield', () => {
    const s = summarize(rows)
    expect(s).toMatchObject({ total: 3, withYield: 2, held: 1, watched: 0 })
    expect(s.top?.symbol).toBe('C')
    expect(summarize([]).top).toBeNull()
  })
  it('counts days to a date', () => {
    expect(daysUntil('2026-12-04', '2026-11-27')).toBe(7)
    expect(daysUntil(null, '2026-11-27')).toBeNull()
    expect(relDays(0)).toBe('today')
    expect(relDays(3)).toBe('in 3d')
    expect(relDays(-2)).toBe('2d ago')
    expect(relDays(null)).toBe('')
  })
})
