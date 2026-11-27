import { describe, expect, it } from 'vitest'
import {
  bollingerBandwidth,
  bollingerPosition,
  exchangeLabel,
  fmtChange,
  fmtSigned,
  macdHistory,
  macdSignal,
  momentumFromRsi,
  rangePosition,
  rsiZone,
  rulesReport,
  smaRows,
  trendSignal,
  volatilityFromBollinger,
} from './researchTechnicals'

// TSM on 2026-11-27 from /api/v1/indicators/TSM
const TSM = {
  price: 342.34,
  sma_20: 379.5,
  sma_50: 418.26,
  sma_200: 402.23,
  rsi: 47.63,
  macd: { macd: -20.68, signal: -17.57, histogram: -3.11 },
  bollinger_bands: { upper: 437.0, middle: 379.5, lower: 322.0 },
}

describe('trendSignal', () => {
  it('is Bearish when price is below all three SMAs and MACD is negative', () => {
    const t = trendSignal(TSM)!
    expect(t.label).toBe('Bearish')
    expect(t.score).toBe(-1)
    expect(t.available).toBe(4)
    expect(t.reason).toBe('Price below all three SMAs · MACD negative')
  })

  it('is Bullish when every vote is up', () => {
    const t = trendSignal({ price: 500, sma_20: 480, sma_50: 450, sma_200: 400, macd: { macd: 3, signal: 1 } })!
    expect(t.label).toBe('Bullish')
    expect(t.score).toBe(1)
    expect(t.reason).toBe('Price above all three SMAs · MACD positive')
  })

  it('is Neutral on a split vote and names both sides', () => {
    const t = trendSignal({ price: 400, sma_20: 410, sma_50: 390, sma_200: 380, macd: { macd: -1, signal: 0 } })!
    expect(t.score).toBe(0)
    expect(t.label).toBe('Neutral')
    expect(t.reason).toBe('Price above SMA 50/200, below SMA 20 · MACD negative')
  })

  it('crosses to Bullish at +0.5 (3 up, 1 down)', () => {
    expect(trendSignal({ price: 400, sma_20: 410, sma_50: 390, sma_200: 380, macd: { macd: 1, signal: 0 } })!.label).toBe('Bullish')
  })

  it('needs a price and at least two votes', () => {
    expect(trendSignal({ sma_20: 1, sma_50: 2 })).toBeNull()
    expect(trendSignal({ price: 10, sma_20: 9 })).toBeNull()
    expect(trendSignal(null)).toBeNull()
    expect(trendSignal({ price: 10, sma_20: 9, macd: { macd: null, signal: null } })).toBeNull()
  })
})

describe('momentum and RSI zones', () => {
  it('maps RSI to momentum bands', () => {
    expect(momentumFromRsi(25)!.label).toBe('Oversold')
    expect(momentumFromRsi(30)!.label).toBe('Weak')
    expect(momentumFromRsi(47.63)!.label).toBe('Neutral')
    expect(momentumFromRsi(55)!.label).toBe('Neutral')
    expect(momentumFromRsi(60)!.label).toBe('Strong')
    expect(momentumFromRsi(70)!.label).toBe('Overbought')
    expect(momentumFromRsi(null)).toBeNull()
    expect(momentumFromRsi(140)).toBeNull()
  })

  it('uses the classic 30/70 zones on the RSI card', () => {
    expect(rsiZone(29.9)).toBe('Oversold')
    expect(rsiZone(30)).toBe('Neutral')
    expect(rsiZone(69.9)).toBe('Neutral')
    expect(rsiZone(70)).toBe('Overbought')
    expect(rsiZone(undefined)).toBeNull()
  })
})

describe('volatility and Bollinger position', () => {
  it('computes bandwidth from the bands', () => {
    expect(bollingerBandwidth(TSM.bollinger_bands)).toBeCloseTo(30.3, 1)
    expect(volatilityFromBollinger(TSM.bollinger_bands)!.label).toBe('High')
    expect(volatilityFromBollinger({ upper: 104, middle: 100, lower: 96 })!.label).toBe('Low')
    expect(volatilityFromBollinger({ upper: 107, middle: 100, lower: 93 })!.label).toBe('Moderate')
    expect(volatilityFromBollinger({ upper: null, middle: 100, lower: 96 })).toBeNull()
  })

  it('labels where price sits between the bands', () => {
    expect(bollingerPosition(342.34, TSM.bollinger_bands)!.label).toBe('Near lower band')
    expect(bollingerPosition(380, TSM.bollinger_bands)!.label).toBe('Mid band')
    expect(bollingerPosition(430, TSM.bollinger_bands)!.label).toBe('Near upper band')
    expect(bollingerPosition(300, TSM.bollinger_bands)!.label).toBe('Below lower band')
    expect(bollingerPosition(450, TSM.bollinger_bands)!.label).toBe('Above upper band')
    expect(bollingerPosition(0, TSM.bollinger_bands)).toBeNull()
  })
})

describe('macdSignal', () => {
  it('compares MACD with its signal line', () => {
    const m = macdSignal(TSM.macd)!
    expect(m.label).toBe('Bearish')
    expect(m.signal).toBe(-17.57)
    expect(macdSignal({ macd: 2, signal: 1, histogram: null })!.histogram).toBe(1)
    expect(macdSignal({ macd: null, signal: 1 })).toBeNull()
  })
})

describe('smaRows', () => {
  it('flags price above/below each SMA and dashes missing ones', () => {
    const rows = smaRows({ ...TSM, sma_200: null })
    expect(rows.map((r) => r.above)).toEqual([false, false, null])
    expect(rows[2].value).toBeNull()
  })
})

describe('rangePosition', () => {
  it('clamps to the range and rejects bad input', () => {
    expect(rangePosition(5, 0.0001, 10)).toBeCloseTo(0.5, 2)
    expect(rangePosition(15, 1, 10)).toBe(1)
    expect(rangePosition(0.5, 1, 10)).toBe(0)
    expect(rangePosition(5, 5, 5)).toBe(0.5)
    expect(rangePosition(5, 10, 1)).toBeNull()
    expect(rangePosition(null, 1, 10)).toBeNull()
  })
})

describe('formatting', () => {
  it('uses a true minus sign', () => {
    expect(fmtSigned(-17.571)).toBe('−17.57')
    expect(fmtSigned(3.1)).toBe('+3.10')
    expect(fmtSigned(null)).toBe('—')
    expect(fmtChange(-6.86, -1.96)).toBe('−6.86 (−1.96%)')
    expect(fmtChange(0, 0)).toBe('0.00%')
    expect(fmtChange(1, null)).toBe('—')
  })
})

describe('rulesReport', () => {
  it('summarises the same inputs the trend rule uses', () => {
    const r = rulesReport(TSM, { percent: -1.96, volume: 12_340_000 })
    expect(r.sentiment).toBe('Bearish')
    expect(r.rsiSignal).toBe('Neutral')
    expect(r.trendSignal).toBe('Below SMA 50')
    expect(r.maSummary).toContain('SMA alignment is mixed')
    expect(r.bullets).toEqual(['RSI(14) is 47.6 — in a neutral band.', 'Change vs prior close: −1.96%.', 'Volume: about 12.34M shares on this print.'])
  })

  it('degrades without indicator data', () => {
    const r = rulesReport(null)
    expect(r.sentiment).toBe('Neutral')
    expect(r.rsiSignal).toBe('N/A')
    expect(r.bullets).toEqual([])
  })
})

describe('macdHistory', () => {
  const bars = Array.from({ length: 120 }, (_, i) => ({
    timestamp: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    close: 100 + i * 0.5,
  }))

  it('returns the last N MACD points from daily closes', () => {
    const h = macdHistory(bars, 60)
    expect(h).toHaveLength(60)
    // steady uptrend: MACD positive
    expect(h[h.length - 1].macd).toBeGreaterThan(0)
  })

  it('needs enough bars', () => {
    expect(macdHistory(bars.slice(0, 20))).toEqual([])
    expect(macdHistory(null)).toEqual([])
  })
})

describe('exchangeLabel', () => {
  it('maps provider codes to venue names', () => {
    expect(exchangeLabel('NYQ')).toBe('NYSE')
    expect(exchangeLabel('NMS')).toBe('NASDAQ')
    expect(exchangeLabel('NasdaqGS')).toBe('NASDAQ')
    expect(exchangeLabel('PCX')).toBe('NYSE Arca')
    expect(exchangeLabel('LSE')).toBe('LSE')
    expect(exchangeLabel(null)).toBe('')
  })
})
