import { describe, expect, it } from 'vitest'
import { curvePath, fmtCompact, fmtSignedPct, netActivityLabel, shortVolumeTone, type InsiderSummary } from './publicData'

const summary = (net: number, buys = 1, sells = 1): InsiderSummary => ({
  days: 90, buy_transactions: buys, sell_transactions: sells, buy_value: Math.max(net, 0), sell_value: Math.max(-net, 0),
  net_value: net, net_shares: 0, distinct_buyers: buys, distinct_sellers: sells, sells_under_10b5_1_plan: 0,
})

describe('public data formatting', () => {
  it('formats compact values with sign and prefix', () => {
    expect(fmtCompact(812_345_678, '$')).toBe('$812.35M')
    expect(fmtCompact(-1_500_000, '$')).toBe('-$1.50M')
    expect(fmtCompact(16_160_000_000)).toBe('16.16B')
    expect(fmtCompact(null)).toBe('—')
    expect(fmtSignedPct(8.243)).toBe('+8.2%')
    expect(fmtSignedPct(-2)).toBe('-2.0%')
  })

  it('labels net insider activity honestly', () => {
    expect(netActivityLabel(summary(-812_345_678, 0, 41))).toEqual({ label: 'Net selling $812.35M', tone: 'sell' })
    expect(netActivityLabel(summary(150_000, 1, 0))).toEqual({ label: 'Net buying $150.0K', tone: 'buy' })
    expect(netActivityLabel(summary(0, 0, 0)).tone).toBe('none')
    expect(netActivityLabel(undefined).label).toBe('No open-market trades')
  })

  it('flags high short-sale volume only above 55%', () => {
    expect(shortVolumeTone(38.1)).toBe('normal')
    expect(shortVolumeTone(61)).toBe('high')
    expect(shortVolumeTone(null)).toBe('unknown')
  })
})

describe('yield curve path', () => {
  it('places curves by tenor so older curves line up', () => {
    const tenors = ['3M', '2Y', '10Y']
    const now = [{ tenor: '3M', years: 0.25, yield_pct: 4 }, { tenor: '2Y', years: 2, yield_pct: 4.5 }, { tenor: '10Y', years: 10, yield_pct: 5 }]
    expect(curvePath(now, tenors, 100, 10, 4, 5)).toBe('0.0,10.0 50.0,5.0 100.0,0.0')
    const old = [{ tenor: '3M', years: 0.25, yield_pct: 5 }, { tenor: '10Y', years: 10, yield_pct: 4 }, { tenor: '1.5M', years: 0.125, yield_pct: 4 }]
    expect(curvePath(old, tenors, 100, 10, 4, 5)).toBe('0.0,0.0 100.0,10.0')
    expect(curvePath(now, ['3M'], 100, 10, 4, 5)).toBe('')
  })
})
