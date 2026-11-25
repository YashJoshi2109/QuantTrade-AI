import { describe, expect, it } from 'vitest'
import { atmStrike } from './OptionChainPanel'
import { fcfDisplay, fyEndLabel, isFinancialSic, periodLabel } from './SecEdgarPanel'
import { MOBILE_RESEARCH_TABS } from '@/components/layout/MobileResearch'
import type { OptionContract } from '@/lib/api'

const contract = (strike: number, mid: number | null): OptionContract =>
  ({ symbol: `X${strike}`, strike, mid } as unknown as OptionContract)

describe('atmStrike', () => {
  it('picks the strike closest to spot', () => {
    const calls = [contract(340, 15), contract(350, 6), contract(355, 3)]
    expect(atmStrike(calls, [], 352.1)).toBe(350)
  })

  it('falls back to the call/put mid crossover without spot', () => {
    const calls = [contract(340, 15), contract(350, 6), contract(360, 2)]
    const puts = [contract(340, 2), contract(350, 5.5), contract(360, 11)]
    expect(atmStrike(calls, puts, null)).toBe(350)
  })

  it('returns null for an empty chain', () => {
    expect(atmStrike([], [], 100)).toBeNull()
  })
})

describe('SEC EDGAR labels', () => {
  it('labels periods with SEC fiscal year / quarter', () => {
    expect(periodLabel({ fiscal_year: 2026, fiscal_quarter: 3 })).toBe('Q3 FY26')
    expect(periodLabel({ fiscal_year: 2025, fiscal_quarter: null })).toBe('FY25')
  })

  it('treats fiscalYearEnd as MMDD, not a year', () => {
    // AAPL "0925" used to render "FY Sep 25", which read as fiscal 2025.
    expect(fyEndLabel('0925')).toBe('FY ends Sep')
    expect(fyEndLabel('1231')).toBe('FY ends Dec')
  })
})

describe('free cash flow display', () => {
  it('shows OCF - capex when capex exists', () => {
    expect(fcfDisplay({ free_cash_flow: 31.9e9, capital_expenditures: 2.4e9, operating_cash_flow: 34.3e9 }, false)).toBe('$31.90B')
  })

  it('explains the blank for banks without capex', () => {
    expect(isFinancialSic('6021')).toBe(true)
    expect(isFinancialSic('3571')).toBe(false)
    expect(fcfDisplay({ free_cash_flow: null, capital_expenditures: null, operating_cash_flow: 33e9 }, true)).toBe('n/a for banks')
  })
})

describe('mobile research tabs', () => {
  it('give every desktop panel group a tab', () => {
    expect(MOBILE_RESEARCH_TABS.map((t) => t.key)).toEqual(['overview', 'financials', 'options', 'technicals', 'company'])
  })
})
