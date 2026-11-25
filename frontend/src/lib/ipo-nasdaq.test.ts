import { describe, expect, it } from 'vitest'
import { ipoMonthKeys, mergeIpoPipeline, nasdaqDateToIso, parseNasdaqIpoCalendar } from './ipo-nasdaq'
import { filterNotificationsByCategory } from './notification-feed'
import type { Notification } from './api'

const payload = {
  data: {
    priced: {
      rows: [
        {
          proposedTickerSymbol: 'ANT',
          companyName: 'Anthropic, PBC',
          proposedExchange: 'NASDAQ Global Select',
          proposedSharePrice: '83.00',
          sharesOffered: '980,000,000',
          pricedDate: '11/19/2026',
        },
      ],
    },
    upcoming: {
      upcomingTable: {
        rows: [
          {
            proposedTickerSymbol: 'NEWC',
            companyName: 'NewCo Inc',
            proposedExchange: 'NYSE',
            proposedSharePrice: '10.00-12.00',
            sharesOffered: '5,000,000',
            expectedPriceDate: '12/03/2026',
          },
        ],
      },
    },
    filed: { rows: [{ proposedTickerSymbol: 'EARS', companyName: 'EarLens Corp', filedDate: '11/24/2026' }] },
    withdrawn: { rows: null },
  },
}

describe('Nasdaq IPO calendar parsing', () => {
  it('converts MM/DD/YYYY dates', () => {
    expect(nasdaqDateToIso('11/19/2026')).toBe('2026-11-19')
    expect(nasdaqDateToIso('1/2/2027')).toBe('2027-01-02')
    expect(nasdaqDateToIso('2026-11-19')).toBe('2026-11-19')
    expect(nasdaqDateToIso('n/a')).toBe('')
  })

  it('parses priced, upcoming and filed rows', () => {
    const rows = parseNasdaqIpoCalendar(payload)
    expect(rows).toHaveLength(3)
    expect(rows.find((r) => r.symbol === 'ANT')).toEqual({
      date: '2026-11-19',
      symbol: 'ANT',
      name: 'Anthropic, PBC',
      exchange: 'NASDAQ Global Select',
      status: 'priced',
      price: '83.00',
      shares: 980000000,
    })
    expect(rows.find((r) => r.symbol === 'NEWC')?.status).toBe('expected')
    expect(rows.find((r) => r.symbol === 'EARS')?.exchange).toBeNull()
  })

  it('tolerates null sections and garbage', () => {
    expect(parseNasdaqIpoCalendar({ data: { priced: { rows: null }, upcoming: { upcomingTable: { rows: null } } } })).toEqual([])
    expect(parseNasdaqIpoCalendar(null)).toEqual([])
    expect(parseNasdaqIpoCalendar('oops')).toEqual([])
  })

  it('merges upcoming first, then priced, then filed, de-duplicated', () => {
    const rows = parseNasdaqIpoCalendar(payload)
    const merged = mergeIpoPipeline([...rows, ...rows], '2026-11-25')
    expect(merged.map((r) => r.symbol)).toEqual(['NEWC', 'ANT', 'EARS'])
    expect(mergeIpoPipeline(rows, '2026-12-10').map((r) => r.symbol)).toEqual(['ANT', 'EARS'])
  })

  it('builds previous/current/next month keys across year boundaries', () => {
    expect(ipoMonthKeys(new Date(Date.UTC(2027, 0, 15)))).toEqual(['2026-12', '2027-01', '2027-02'])
  })
})

describe('notification feed categories (bell and /notifications share these)', () => {
  const n = (id: number, type: string, is_read = false) => ({ id, type, is_read }) as unknown as Notification
  const feed = [n(1, 'reply'), n(2, 'price_alert', true), n(3, 'system_notice')]
  it('splits by category', () => {
    expect(filterNotificationsByCategory(feed, 'social').map((x) => x.id)).toEqual([1])
    expect(filterNotificationsByCategory(feed, 'trading').map((x) => x.id)).toEqual([2])
    expect(filterNotificationsByCategory(feed, 'system').map((x) => x.id)).toEqual([3])
    expect(filterNotificationsByCategory(feed, 'unread').map((x) => x.id)).toEqual([1, 3])
    expect(filterNotificationsByCategory(feed, 'all')).toHaveLength(3)
  })
})
