import { afterEach, describe, expect, it } from 'vitest'
import {
  SHOW_BOTS_KEY,
  botProfileHref,
  botSlugOf,
  cellTone,
  chartBars,
  formatChartValue,
  readShowBotsLocal,
  safeExternalUrl,
  writeShowBotsLocal,
} from './communityBots'

describe('chartBars', () => {
  it('scales diverging bars to the largest absolute value', () => {
    const bars = chartBars({
      type: 'bar', title: 't', unit: '%',
      series: [{ label: 'A', value: 2 }, { label: 'B', value: -4 }, { label: 'C', value: Number.NaN }],
    })
    expect(bars).toEqual([
      { label: 'A', value: 2, pct: 50, positive: true },
      { label: 'B', value: -4, pct: 100, positive: false },
    ])
  })
  it('handles empty / null charts', () => {
    expect(chartBars(null)).toEqual([])
    expect(chartBars({ type: 'bar', title: '', unit: '', series: [{ label: 'z', value: 0 }] })[0].pct).toBe(0)
  })
})

describe('formatting', () => {
  it('formats chart values by unit with a real minus sign', () => {
    expect(formatChartValue(1.234, '%')).toBe('+1.23%')
    expect(formatChartValue(-3.06, 'pp')).toBe('−3.1 pp')
    expect(formatChartValue(0.5, '')).toBe('+0.50')
  })
  it('colours signed numeric cells only', () => {
    expect(cellTone('+1.20%')).toBe('up')
    expect(cellTone('−0.40%')).toBe('down')
    expect(cellTone('-2')).toBe('down')
    expect(cellTone('+0.00')).toBeNull()
    expect(cellTone('$NVDA')).toBeNull()
    expect(cellTone('Before open')).toBeNull()
  })
})

describe('links', () => {
  it('only allows http(s) URLs', () => {
    expect(safeExternalUrl('https://news.example.com/a')).toBe('https://news.example.com/a')
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(safeExternalUrl('not a url')).toBeNull()
    expect(safeExternalUrl(undefined)).toBeNull()
  })
  it('builds bot profile links', () => {
    expect(botProfileHref('market_weather')).toBe('/community/bots/market_weather')
    expect(botSlugOf({ bot: { bot: { slug: 'x' } } as never })).toBe('x')
    expect(botSlugOf({})).toBeNull()
  })
})

describe('show-bot-posts local preference', () => {
  afterEach(() => window.localStorage.clear())
  it('defaults to showing bot posts', () => {
    expect(readShowBotsLocal()).toBe(true)
  })
  it('persists the toggle', () => {
    writeShowBotsLocal(false)
    expect(window.localStorage.getItem(SHOW_BOTS_KEY)).toBe('0')
    expect(readShowBotsLocal()).toBe(false)
    writeShowBotsLocal(true)
    expect(readShowBotsLocal()).toBe(true)
  })
})
