import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test'
})

import SecEdgarPanel, { fmtEPS } from './SecEdgarPanel'
import {
  EdgarFetchError, edgarErrorFrom, filingFormsFor, secPanelView,
} from '@/lib/secEdgarState'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const domesticOverview = (ticker: string, name: string) => ({
  ticker, asset_type: 'equity', filer_type: 'domestic', edgar_status: 'ok', cik: '0000927003',
  company_name: name, sic: '3679', sic_description: 'Electronic Components, NEC',
  state_of_incorporation: 'DE', fiscal_year_end: '1231', category: 'Large accelerated filer',
  identity_status: 'ok', updated_at: null,
})

const period = {
  period: '2026-Q3', fiscal_year: 2026, fiscal_quarter: 3, form: '10-Q',
  period_end_date: '2026-09-30', filed_date: '2026-11-02',
  income_statement: { revenue: 463_000_000, gross_profit: null, operating_income: null, net_income: 40_000_000,
    ebitda: null, eps_basic: null, eps_diluted: 1.05, rd_expense: null, sga_expense: null },
  balance_sheet: { total_assets: null, current_assets: null, cash_and_equivalents: null, total_liabilities: null,
    current_liabilities: null, long_term_debt: null, stockholders_equity: null, retained_earnings: null, goodwill: null },
  cash_flow: { operating_cash_flow: null, investing_cash_flow: null, financing_cash_flow: null,
    capital_expenditures: null, free_cash_flow: null, dividends_paid: null, share_repurchases: null },
}

const fetchMock = vi.fn()

function renderPanel(symbol: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SecEdgarPanel symbol={symbol} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('secPanelView', () => {
  it('never says "not applicable" for a US operating company', () => {
    expect(secPanelView(domesticOverview('AEIS', 'Advanced Energy'), null, false)).toBe('ok')
    expect(secPanelView({ asset_type: 'equity', filer_type: 'unknown' }, null, false)).toBe('ok')
    // Legacy payload without filer_type
    expect(secPanelView({ asset_type: 'equity' }, null, false)).toBe('ok')
  })

  it('maps foreign filers, funds and errors', () => {
    expect(secPanelView({ asset_type: 'equity', filer_type: 'foreign' }, null, false)).toBe('foreign')
    expect(secPanelView({ asset_type: 'etf', edgar_status: 'not_applicable' }, null, false)).toBe('fund')
    expect(secPanelView({ asset_type: 'fund', filer_type: 'fund' }, null, false)).toBe('fund')
    expect(secPanelView(null, new EdgarFetchError('no_sec_filer', 404), false)).toBe('no_filer')
    expect(secPanelView(null, new EdgarFetchError('sec_unavailable', 503), false)).toBe('unavailable')
    expect(secPanelView(null, new Error('boom'), false)).toBe('unavailable')
    expect(secPanelView(null, null, true)).toBe('loading')
  })

  it('reads typed and legacy error bodies', () => {
    expect(edgarErrorFrom(404, { detail: { code: 'no_sec_filer', message: 'x' } }).code).toBe('no_sec_filer')
    expect(edgarErrorFrom(503, { detail: { code: 'sync_pending' } }).retryable).toBe(true)
    // Legacy: "Symbol X not found" / sync failure 404s were NOT a no-filer verdict.
    expect(edgarErrorFrom(404, { detail: 'Symbol INSM not found' }).code).toBe('sec_unavailable')
    expect(edgarErrorFrom(404, { detail: 'Could not fetch EDGAR data for AEIS' }).code).toBe('sec_unavailable')
    expect(edgarErrorFrom(404, { detail: 'CIK not found for ZZZZ' }).code).toBe('no_sec_filer')
    expect(edgarErrorFrom(404, { detail: 'CIK not found for ZZZZ' }).retryable).toBe(false)
  })

  it('asks for 20-F / 6-K filings for foreign filers', () => {
    expect(filingFormsFor('foreign')).toEqual(['20-F', '40-F', '6-K'])
    expect(filingFormsFor('ok')).toEqual(['10-K', '10-Q', '8-K'])
  })
})

describe('fmtEPS', () => {
  it('puts the sign before the dollar', () => {
    expect(fmtEPS(-0.4)).toBe('-$0.40')
    expect(fmtEPS(2.79)).toBe('$2.79')
    expect(fmtEPS(null)).toBe('—')
  })
})

describe('SecEdgarPanel', () => {
  it('AEIS renders statements, not the ETF / foreign "not applicable" card', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/company-overview')) return json(domesticOverview('AEIS', 'ADVANCED ENERGY INDUSTRIES, INC.'))
      if (url.includes('/financials')) return json({ ticker: 'AEIS', count: 1, periods: [period], stale: false, syncing: false })
      return json({}, 404)
    })
    renderPanel('AEIS')
    expect(await screen.findByText('ADVANCED ENERGY INDUSTRIES, INC.')).toBeTruthy()
    expect(await screen.findByTestId('edgar-latest-period')).toBeTruthy()
    expect(screen.queryByTestId('edgar-not-applicable')).toBeNull()
    expect(screen.queryByText(/foreign issuers/i)).toBeNull()
  })

  it('shows a skeleton while the overview loads', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}))
    renderPanel('INSM')
    expect(await screen.findByTestId('edgar-loading')).toBeTruthy()
    expect(screen.queryByTestId('edgar-not-applicable')).toBeNull()
  })

  it('ETF gets the fund card', async () => {
    fetchMock.mockResolvedValue(json({ ticker: 'SPY', asset_type: 'etf', filer_type: 'fund', edgar_status: 'not_applicable' }))
    renderPanel('SPY')
    expect(await screen.findByTestId('edgar-not-applicable')).toBeTruthy()
    expect(screen.getByText(/SPY is a fund/)).toBeTruthy()
  })

  it('foreign filer gets the 20-F / 6-K view with filings', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/company-overview')) {
        return json({ ...domesticOverview('TSM', 'Taiwan Semiconductor Manufacturing Company Limited'), filer_type: 'foreign', state_of_incorporation: '' })
      }
      if (url.includes('/financials')) return json({ ticker: 'TSM', count: 0, periods: [], stale: false, syncing: false })
      if (url.includes('/filings')) {
        expect(url).toContain('form_types=20-F,40-F,6-K')
        return json({ ticker: 'TSM', filings: [{ form_type: '20-F', filing_date: '2026-04-16', period_end_date: '2025-12-31', accession_number: 'a1', url: 'https://www.sec.gov/x', description: '' }] })
      }
      return json({}, 404)
    })
    renderPanel('TSM')
    expect(await screen.findByTestId('edgar-foreign-note')).toBeTruthy()
    expect(await screen.findByText('Filed: 2026-04-16')).toBeTruthy()
    // Blank incorporation state is not rendered as a dangling "Inc." chip.
    expect(screen.queryByText(/^Inc\.\s*$/)).toBeNull()
  })

  it('ticker without an SEC filer gets an honest no-filer card', async () => {
    fetchMock.mockResolvedValue(json({ detail: { code: 'no_sec_filer', message: 'not in registry' } }, 404))
    renderPanel('ZZZZ')
    expect(await screen.findByTestId('edgar-no-filer')).toBeTruthy()
    expect(screen.queryByTestId('edgar-not-applicable')).toBeNull()
  })
})
