import { describe, expect, it } from 'vitest'
import {
  debtToEquityRatio,
  earningsTiming,
  formatMarketCap,
  meaningfulPeg,
  parseEarningsDate,
  reconcileTickerFundamentals,
  type OverlappingTickerFields,
} from '@/lib/valuation'
import { generateKeyFactors } from '@/lib/keyFactors'

const NOW = new Date(Date.UTC(2026, 10, 25)) // 2026-11-25

describe('formatMarketCap (QT-09: one T/B/M formatter for search + Research)', () => {
  it('formats trillions as T, not "2200.0B"', () => {
    expect(formatMarketCap(3.4296e12)).toBe('$3.43T')
    expect(formatMarketCap(2.2e12)).toBe('$2.20T')
  })
  it('formats billions and millions', () => {
    expect(formatMarketCap(16_047_796_224)).toBe('$16.05B')
    expect(formatMarketCap(15_200_000)).toBe('$15.20M')
  })
  it('missing / non-positive renders the fallback', () => {
    expect(formatMarketCap(null)).toBe('—')
    expect(formatMarketCap(0, 'N/A')).toBe('N/A')
  })
})

describe('meaningfulPeg / debtToEquityRatio (D10)', () => {
  it('negative or zero PEG is not meaningful', () => {
    expect(meaningfulPeg(-12.62)).toBeNull()
    expect(meaningfulPeg(0)).toBeNull()
    expect(meaningfulPeg(1.89)).toBe(1.89)
  })
  it('percent D/E becomes a ratio', () => {
    expect(debtToEquityRatio(71.47, 'percent')).toBeCloseTo(0.7147)
    expect(debtToEquityRatio(0.84)).toBe(0.84)
  })
})

describe('earnings dates (D10: never call a past date "next")', () => {
  it('year-less "Nov 02" seen on Nov 25 is in the past', () => {
    expect(parseEarningsDate('Nov 02', NOW)?.toISOString().slice(0, 10)).toBe('2026-11-02')
    expect(earningsTiming('Nov 02 AMC', NOW)?.kind).toBe('reported')
  })
  it('year-less "Jan 28" seen in November is next year', () => {
    expect(parseEarningsDate('Jan 28', NOW)?.toISOString().slice(0, 10)).toBe('2027-01-28')
    expect(earningsTiming('Jan 28', NOW)?.kind).toBe('upcoming')
  })
  it('ISO dates parse exactly', () => {
    const t = earningsTiming('2026-12-03', NOW)
    expect(t?.kind).toBe('upcoming')
    expect(t?.days).toBe(8)
  })

  it('Key Factors shows "Last reported" for a past date, never "Next earnings"', () => {
    const past = generateKeyFactors(null, { symbol: 'AAPL', earnings_date: 'Nov 02' }, 350, NOW)
    const e = past.find((f) => f.id === 'earnings')
    expect(e?.description).toMatch(/^Last reported: Nov 2, 2026/)
    expect(e?.description).not.toMatch(/Next earnings/)

    const future = generateKeyFactors(null, { symbol: 'AAPL', earnings_date: '2027-01-29' }, 350, NOW)
    expect(future.find((f) => f.id === 'earnings')?.description).toMatch(/^Next earnings: Jan 29, 2027/)
  })
})

const tickerAapl = (): OverlappingTickerFields & { symbol: string } => ({
  symbol: 'AAPL',
  market_cap: 5_110_393_452_000,
  pe_ratio: 39.03,
  forward_pe: 35.76,
  peg_ratio: 1.908,
  price_to_book: 50,
  price_to_sales: 11,
  debt_to_equity: 71.47, // percent (FMP ×100)
  return_on_equity: 127.61,
  return_on_assets: 25,
  profit_margins: 27,
  operating_margins: 32,
  gross_margins: 47,
  beta: 1.1,
  eps: 9.0,
  dividend_yield: 0.3,
  earnings_date: '2026-10-30',
})

describe('reconcileTickerFundamentals (D10: one source of truth per page)', () => {
  it('backend fundamentals win for every overlapping metric', () => {
    const out = reconcileTickerFundamentals(
      tickerAapl(),
      { forward_pe: 32.93, peg_ratio: 2.8397, debt_to_equity: 0.843, roe: 142.26, market_cap: 5.0596e12 },
      NOW,
    )
    expect(out.forward_pe).toBe(32.93)
    expect(out.peg_ratio).toBe(2.8397)
    expect(out.debt_to_equity).toBe(0.843)
    expect(out.return_on_equity).toBe(142.26)
    expect(out.market_cap).toBe(5.0596e12)
    expect(out.symbol).toBe('AAPL')
  })

  it('without backend data the profile is kept but D/E is a ratio', () => {
    const out = reconcileTickerFundamentals(tickerAapl(), null, NOW)
    expect(out.debt_to_equity).toBeCloseTo(0.7147)
    expect(out.forward_pe).toBe(35.76)
  })

  it('negative PEG is dropped and past earnings dates are removed', () => {
    const t = { ...tickerAapl(), peg_ratio: -12.62 }
    const out = reconcileTickerFundamentals(t, { earnings_date: '2026-11-02' }, NOW)
    expect(out.peg_ratio).toBe(0)
    expect(out.earnings_date).toBe('')
    const fut = reconcileTickerFundamentals(t, { earnings_date: '2027-01-29' }, NOW)
    expect(fut.earnings_date).toBe('2027-01-29')
  })
})
