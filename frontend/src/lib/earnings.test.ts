import { describe, expect, it } from 'vitest'
import {
  addDays,
  calendarQuery,
  dayLabel,
  earningsBadgeText,
  fmtEps,
  fmtRevenue,
  fmtSurprise,
  groupByDay,
  hourShort,
  surpriseTone,
  todayNY,
  weekDays,
  weekRangeLabel,
  weekStart,
  sortEarningsRows,
  type EarningsRow,
} from './earnings'
import { CONDITION_META, earningsCountdown, formatThreshold, validateThreshold } from './alerts'

const row = (o: Partial<EarningsRow>): EarningsRow => ({
  symbol: 'X', name: null, date: '2026-12-02', hour: null, hour_label: null,
  eps_estimate: null, eps_actual: null, eps_surprise_pct: null,
  revenue_estimate: null, revenue_actual: null, revenue_surprise_pct: null,
  market_cap: null, cap_tier: null, sector: null, fiscal_period: null, num_estimates: null,
  status: 'upcoming', in_watchlist: false, in_portfolio: false, sources: [], ...o,
})

describe('earnings dates', () => {
  it('finds the Monday of a week, across month and year boundaries', () => {
    expect(weekStart('2026-11-26')).toBe('2026-11-23') // Thu
    expect(weekStart('2026-11-23')).toBe('2026-11-23') // Mon
    expect(weekStart('2026-11-29')).toBe('2026-11-23') // Sun belongs to the week before
    expect(weekStart('2027-01-01')).toBe('2026-12-28')
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(weekDays('2026-11-30')).toEqual(['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'])
  })

  it('labels days and weeks without time-zone drift', () => {
    expect(dayLabel('2026-12-02')).toBe('Wed, Dec 2')
    expect(weekRangeLabel('2026-11-23')).toBe('Nov 23 – 27, 2026')
    expect(weekRangeLabel('2026-11-30')).toBe('Nov 30 – Dec 4, 2026')
  })

  it('uses the New York calendar date', () => {
    // 2026-11-27 03:00 UTC is still Nov 26 in New York
    expect(todayNY(new Date('2026-11-27T03:00:00Z'))).toBe('2026-11-26')
    expect(todayNY(new Date('2026-11-27T15:00:00Z'))).toBe('2026-11-27')
  })
})

describe('earnings formatting: missing data is "—", never 0 or NaN', () => {
  it('formats EPS, revenue and surprise', () => {
    expect(fmtEps(2.41)).toBe('$2.41')
    expect(fmtEps(-0.84)).toBe('-$0.84')
    expect(fmtEps(0)).toBe('$0.00')
    for (const v of [null, undefined, NaN, Infinity]) {
      expect(fmtEps(v as number)).toBe('—')
      expect(fmtRevenue(v as number)).toBe('—')
      expect(fmtSurprise(v as number)).toBe('—')
    }
    expect(fmtRevenue(10_120_000_000)).toBe('$10.12B')
    expect(fmtRevenue(1_532_000_000_000)).toBe('$1.53T')
    expect(fmtRevenue(450_500_000)).toBe('$450.5M')
    expect(fmtSurprise(39.85)).toBe('+39.9%')
    expect(fmtSurprise(-4.2)).toBe('-4.2%')
    expect(surpriseTone(5)).toBe('beat')
    expect(surpriseTone(-5)).toBe('miss')
    expect(surpriseTone(0.2)).toBe('inline')
    expect(surpriseTone(null)).toBe('none')
    expect(hourShort('bmo')).toBe('BMO')
    expect(hourShort('amc')).toBe('AMC')
    expect(hourShort(null)).toBe('—')
  })

  it('builds the research badge text', () => {
    expect(earningsBadgeText(0)).toBe('Earnings today')
    expect(earningsBadgeText(1)).toBe('Earnings tomorrow')
    expect(earningsBadgeText(6)).toBe('Earnings in 6 days')
    expect(earningsBadgeText(31)).toBeNull()
    expect(earningsBadgeText(-1)).toBeNull()
    expect(earningsBadgeText(null)).toBeNull()
    expect(earningsBadgeText(NaN)).toBeNull()
  })
})

describe('earnings grouping + query', () => {
  it('groups by day with empty days present, and sorts biggest first', () => {
    const rows = [
      row({ symbol: 'A', date: '2026-12-01', market_cap: 1e9 }),
      row({ symbol: 'B', date: '2026-12-01', market_cap: 5e11 }),
      row({ symbol: 'C', date: '2026-12-01' }),
      row({ symbol: 'D', date: '2026-12-03', market_cap: 2e9 }),
    ]
    const g = groupByDay(rows, weekDays('2026-11-30'))
    expect(Object.keys(g)).toHaveLength(5)
    expect(g['2026-11-30']).toEqual([])
    expect(sortEarningsRows(g['2026-12-01'], 'market_cap', 'desc').map((r) => r.symbol)).toEqual(['B', 'A', 'C'])
    expect(g['2026-12-03'].map((r) => r.symbol)).toEqual(['D'])
  })

  it('only sends active filters', () => {
    expect(calendarQuery({ start: '2026-11-30', end: '2026-12-06', scope: 'all', cap: '', sector: '' }))
      .toBe('start=2026-11-30&end=2026-12-06')
    expect(calendarQuery({ start: '2026-11-30', end: '2026-12-06', scope: 'watchlist', cap: 'mega', sector: 'Technology' }))
      .toBe('start=2026-11-30&end=2026-12-06&scope=watchlist&cap=mega&sector=Technology')
  })
})

describe('earnings pre-alert UI helpers', () => {
  it('validates whole days 1-30 and formats the threshold', () => {
    expect(CONDITION_META.earnings_within_days.unit).toBe('days')
    expect(validateThreshold('earnings_within_days', '3')).toBeNull()
    expect(validateThreshold('earnings_within_days', '0')).not.toBeNull()
    expect(validateThreshold('earnings_within_days', '31')).not.toBeNull()
    expect(validateThreshold('earnings_within_days', '2.5')).toBe('Use a whole number of days')
    expect(formatThreshold('earnings_within_days', 1)).toBe('1 day')
    expect(formatThreshold('earnings_within_days', 5)).toBe('5 days')
  })

  it('shows the countdown for earnings alerts only', () => {
    expect(earningsCountdown({ condition: 'earnings_within_days', last_value: 3 })).toBe('Reports in 3 days')
    expect(earningsCountdown({ condition: 'earnings_within_days', last_value: 0 })).toBe('Reports today')
    expect(earningsCountdown({ condition: 'earnings_within_days', last_value: null })).toBe('Next report not scheduled yet')
    expect(earningsCountdown({ condition: 'price_above', last_value: 3 })).toBeNull()
  })
})
