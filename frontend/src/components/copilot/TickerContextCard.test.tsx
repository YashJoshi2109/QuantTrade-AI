import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CitationData, TickerContext } from '@/lib/copilot-engine'
import TickerContextCard from './TickerContextCard'
import CitationSourcePanel from './CitationSourcePanel'

const ctx: TickerContext = {
  ticker: 'AAPL',
  name: 'Apple Inc',
  asset_type: 'equity',
  identity: { status: 'ok' },
  quote: { id: 'quote:AAPL', price: 236.48, change: 2.11, change_percent: 0.9, as_of: '2026-11-25T21:00:00+00:00', source: 'quote cache', market_session: 'CLOSED' },
  key_stats: { market_cap: 3.51e12, pe_ratio: 35.6, eps_ttm: 6.64, target_price: 255 },
  forecast: { id: 'fc:AAPL', horizon_days: 20, p10: 219.5, p50: 238.1, p90: 257.3, prob_up_pct: 56 },
  latest_statement: { id: 'fs:AAPL:2026-Q4', period_label: 'Q4 FY2026', form: '10-K', revenue: 114.477e9, gross_margin_pct: 47.89, revenue_yoy_pct: 8.1 },
  news: [{ id: 'news:1', title: 'Apple immune to sell-off', publisher: 'Fool', sentiment: 'bullish' }],
  filings: [],
  errors: {},
}

describe('TickerContextCard', () => {
  it('shows price, key stats, forecast band, statement and news', () => {
    render(<TickerContextCard symbol="AAPL" ctx={ctx} />)
    expect(screen.getByText('$236.48')).toBeTruthy()
    expect(screen.getByText('+0.90%')).toBeTruthy()
    expect(screen.getByText('$3.51T')).toBeTruthy()
    expect(screen.getByText('$219.50')).toBeTruthy()
    expect(screen.getByText('$257.30')).toBeTruthy()
    expect(screen.getByText(/Q4 FY2026/)).toBeTruthy()
    expect(screen.getByText('Apple immune to sell-off')).toBeTruthy()
  })

  it('hides the forecast midpoint without a tested edge and shows the hit rate', () => {
    cleanup()
    render(
      <TickerContextCard
        symbol="AAPL"
        ctx={{ ...ctx, forecast: { ...ctx.forecast!, p50: null, prob_up_pct: null, reliability: 'no_edge',
          edge_vs_benchmark: 'No edge vs ARIMA(0,1,0)', hit_rate_80: 0.78, hit_rate_tests: 40 } }}
      />,
    )
    expect(screen.queryByText(/mid \$/)).toBeNull()
    const note = screen.getByTestId('copilot-forecast-honesty').textContent ?? ''
    expect(note).toContain('Held 78% of 40 tests')
    expect(note).toContain('No edge vs ARIMA(0,1,0)')
    expect(note).toContain('not which way')
  })

  it('warns on a reassigned ticker and fires suggestions', () => {
    const onAsk = vi.fn()
    render(
      <TickerContextCard
        symbol="PARA"
        ctx={{ ...ctx, ticker: 'PARA', quote: null, identity: { status: 'changed', note: 'Now trades as PSKY.' } }}
        suggestions={['What happened to PARA?']}
        onAsk={onAsk}
      />,
    )
    expect(screen.getByText('Now trades as PSKY.')).toBeTruthy()
    fireEvent.click(screen.getByText('What happened to PARA?'))
    expect(onAsk).toHaveBeenCalledWith('What happened to PARA?')
  })
})

describe('CitationSourcePanel', () => {
  it('reveals filing section, filed date and excerpt', () => {
    const c: CitationData = {
      id: 'filing:abc', n: 2, kind: 'filing', source: 'SEC 10-K (EDGAR)', label: 'TSLA 10-K 2025 · Risk Factors',
      ticker: 'TSLA', filing_type: '10-K', section: 'Risk Factors', filed_date: '2026-01-29',
      snippet: 'We are highly dependent on the services of Elon Musk.',
    }
    render(<CitationSourcePanel citation={c} onClose={() => {}} />)
    expect(screen.getByText('Risk Factors excerpt')).toBeTruthy()
    expect(screen.getByText('2026-01-29')).toBeTruthy()
    expect(screen.getByText(/highly dependent/)).toBeTruthy()
  })
})
