import { describe, expect, it } from 'vitest'
import { tickerBannerState, type TickerIdentity } from './tickerIdentity'

const base: TickerIdentity = {
  ticker: 'AAPL',
  status: 'ok',
  note: null,
  listed_name: 'Apple Inc',
  filer_name: 'Apple Inc.',
  former_name: null,
  successor_symbol: null,
  lifecycle_status: 'active',
  data_quality: 'ok',
}

describe('tickerBannerState', () => {
  it('is null for an active ticker with a clean identity', () => {
    expect(tickerBannerState(base)).toBeNull()
    expect(tickerBannerState(null)).toBeNull()
  })

  it('retired ticker: stopped-trading title with date + successor, price panels hidden', () => {
    const s = tickerBannerState({
      ...base,
      ticker: 'SQ',
      status: 'changed',
      lifecycle_status: 'inactive',
      is_active: false,
      delisted_at: '2025-01-17',
      successor_symbol: 'XYZ',
      former_name: 'Block Inc',
      status_note: 'Block, Inc. changed its ticker from SQ to XYZ in Jan 2025.',
      data_quality: 'none',
    })
    expect(s?.kind).toBe('inactive')
    expect(s?.title).toBe('SQ stopped trading on Jan 17, 2025 — now XYZ')
    expect(s?.successorHref).toBe('/research?symbol=XYZ')
    expect(s?.hidePricePanels).toBe(true)
    expect(s?.body).toContain('changed its ticker')
  })

  it('retired ticker without date or successor still reads cleanly', () => {
    const s = tickerBannerState({ ...base, ticker: 'K', lifecycle_status: 'inactive', former_name: 'Kellanova' })
    expect(s?.title).toBe('K stopped trading')
    expect(s?.successorHref).toBeNull()
    expect(s?.hidePricePanels).toBe(true)
  })

  it('reused ticker: prominent, limited data quality, panels stay', () => {
    const s = tickerBannerState({
      ...base,
      ticker: 'PARA',
      status: 'changed',
      lifecycle_status: 'reused',
      former_name: 'Paramount Global',
      current_name: 'Parabolic Technologies, Inc.',
      successor_symbol: 'SKYD',
      data_quality: 'limited',
      status_note: 'Paramount Global merged with Skydance; trades as SKYD.',
    })
    expect(s?.kind).toBe('reused')
    expect(s?.title).toBe('PARA now refers to Parabolic Technologies, Inc., not Paramount Global')
    expect(s?.prominent).toBe(true)
    expect(s?.hidePricePanels).toBe(false)
    expect(s?.dataQuality).toBe('limited')
    expect(s?.successorHref).toBe('/research?symbol=SKYD')
  })

  it('falls back to the identity warning for a name mismatch', () => {
    const s = tickerBannerState({ ...base, status: 'mismatch', filer_name: 'Other Co' })
    expect(s?.kind).toBe('identity')
    expect(s?.hidePricePanels).toBe(false)
    expect(s?.prominent).toBe(false)
  })
})
