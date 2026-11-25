import { afterEach, describe, expect, it } from 'vitest'
import { isCompanyAsset, toYahooSymbol } from '@/lib/assetType'
import {
  BENCHMARK_INDEX_LABELS,
  FINNHUB_PROXY_ETFS,
  clearLastKnownIndexLevels,
  isIndexLevelSymbol,
  lastKnownIndexLevel,
  plausibleIndexFallback,
  rememberIndexLevel,
  type RawQuote,
} from '@/lib/indexQuotes'
import { formatLevelOrPrice, isIndexLevel } from '@/lib/quoteDisplay'

const raw = (price: number): RawQuote => ({
  price, change: 0, change_percent: 0, prev_close: price, day_high: price, day_low: price, volume: 0, market_state: 'REGULAR',
})

describe('isCompanyAsset (QT-11)', () => {
  it('indices and non-equity assets are not companies', () => {
    expect(isCompanyAsset('^GSPC')).toBe(false)
    expect(isCompanyAsset('^GSPC', 'equity')).toBe(false)
    expect(isCompanyAsset('000001.SS')).toBe(false)
    expect(isCompanyAsset('SPY', 'etf')).toBe(false)
    expect(isCompanyAsset('SPY', 'ETF')).toBe(false)
    expect(isCompanyAsset('CL=F')).toBe(false)
    expect(isCompanyAsset('BTC-USD')).toBe(false)
  })
  it('equities and unknown types keep company panels', () => {
    expect(isCompanyAsset('AAPL', 'equity')).toBe(true)
    expect(isCompanyAsset('AAPL', 'EQUITY')).toBe(true)
    expect(isCompanyAsset('BRK.B')).toBe(true)
  })
})

describe('toYahooSymbol (D9 share classes)', () => {
  it('maps dot share classes to dash', () => {
    expect(toYahooSymbol('BRK.B')).toBe('BRK-B')
    expect(toYahooSymbol('bf.b')).toBe('BF-B')
  })
  it('keeps exchange suffixes', () => {
    expect(toYahooSymbol('0700.HK')).toBe('0700.HK')
    expect(toYahooSymbol('SHOP.TO')).toBe('SHOP.TO')
    expect(toYahooSymbol('VOD.L')).toBe('VOD.L')
    expect(toYahooSymbol('AAPL')).toBe('AAPL')
  })
})

describe('index tiles (D3)', () => {
  afterEach(() => clearLastKnownIndexLevels())

  it('SSE Composite / CSI 300 are index levels: no $ and no FX conversion', () => {
    expect(isIndexLevelSymbol('000001.SS')).toBe(true)
    expect(isIndexLevelSymbol('000300.SS')).toBe(true)
    expect(isIndexLevelSymbol('600519.SS')).toBe(false) // Moutai is a stock
    // Even a stale cached row with is_index_level:false renders as points.
    const q = { symbol: '000001.SS', is_index_level: false }
    expect(isIndexLevel(q)).toBe(true)
    expect(formatLevelOrPrice(3476.12, isIndexLevel(q), '$', 0)).toBe('3,476')
  })

  it('^RUT and ^VIX carry proper names', () => {
    expect(BENCHMARK_INDEX_LABELS['^RUT'].name).toBe('Russell 2000')
    expect(BENCHMARK_INDEX_LABELS['^VIX'].shortName).toBe('VIX')
  })

  it('no ETF proxy is configured for any index symbol', () => {
    for (const sym of Object.keys(FINNHUB_PROXY_ETFS)) expect(sym.startsWith('^')).toBe(false)
  })

  it('falls back to the last known index level, never an ETF price', () => {
    rememberIndexLevel('^IXIC', raw(23140.95), 1_000)
    expect(lastKnownIndexLevel('^IXIC', 2_000)?.quote.price).toBe(23140.95)
    // QQQ-sized "level" from a loose fallback provider is rejected.
    expect(plausibleIndexFallback(raw(610.55), raw(23140.95))).toBe(false)
    expect(plausibleIndexFallback(raw(23500), raw(23140.95))).toBe(true)
    // Expired entries are not served.
    expect(lastKnownIndexLevel('^IXIC', 10 * 86_400_000)).toBeUndefined()
  })
})
