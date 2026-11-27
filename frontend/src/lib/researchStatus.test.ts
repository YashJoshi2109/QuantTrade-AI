import { describe, expect, it } from 'vitest'
import { HttpError } from './httpError'
import { summarizeResearchStatus, type ResearchStatusInput, type SourceState } from './researchStatus'
import { indicatorsEmpty } from './researchData'

const ok: SourceState = { status: 'success' }
const pending: SourceState = { status: 'pending' }
const err = (status: number): SourceState => ({ status: 'error', error: new HttpError(status, '/x') })

type Over = Partial<Omit<ResearchStatusInput, 'sources'>> & { sources?: Partial<ResearchStatusInput['sources']> }

function input(over: Over): ResearchStatusInput {
  return {
    symbol: 'meta',
    price: { hasPrice: true, dataSource: 'finnhub' },
    priceAsOf: '2026-11-26T21:00:00Z',
    fallbackSource: null,
    ...over,
    sources: { quote: ok, profile: ok, prices: ok, indicators: ok, fundamentals: ok, ...(over.sources ?? {}) },
  }
}

describe('summarizeResearchStatus', () => {
  it('is ok when every source succeeded', () => {
    const s = summarizeResearchStatus(input({}))
    expect(s.kind).toBe('ok')
    expect(s.failed).toEqual([])
  })

  it('degrades with a labelled fallback when the live quote fails', () => {
    const s = summarizeResearchStatus(
      input({
        sources: { quote: err(503) },
        price: { hasPrice: true, dataSource: 'daily close' },
        fallbackSource: 'bars',
      }),
    )
    expect(s.kind).toBe('degraded')
    expect(s.headline).toBe("We're working on it")
    expect(s.detail).toContain('Live quote for META is temporarily unavailable')
    expect(s.fallbackLabel).toBe('last price from daily price history as of Nov 26, 4:00 PM ET')
  })

  it('names other failed panels and flags rate limiting', () => {
    const s = summarizeResearchStatus(input({ sources: { indicators: err(429), fundamentals: err(500) } }))
    expect(s.kind).toBe('degraded')
    expect(s.rateLimited).toBe(true)
    expect(s.detail).toContain('Technical indicators and fundamentals are temporarily unavailable.')
    expect(s.detail).toContain('High traffic')
  })

  it('labels a cached snapshot when a refresh fails but data is still shown', () => {
    const s = summarizeResearchStatus(
      input({ sources: { fundamentals: { status: 'error', error: new HttpError(502, '/f'), cachedAt: Date.parse('2026-11-27T15:42:00Z') } } }),
    )
    expect(s.detail).toContain("Fundamentals couldn't refresh; showing the snapshot from Nov 27, 10:42 AM ET.")
  })

  it('is unavailable (never fake numbers) when no source has a price', () => {
    const s = summarizeResearchStatus(
      input({ sources: { quote: err(503), profile: err(502), prices: err(500) }, price: { hasPrice: false } }),
    )
    expect(s.kind).toBe('unavailable')
    expect(s.detail).toContain('Prices for META are temporarily unavailable')
  })

  it('stays loading while price sources are still pending', () => {
    const s = summarizeResearchStatus(
      input({ sources: { quote: pending, profile: pending, prices: pending, indicators: err(500) }, price: { hasPrice: false } }),
    )
    expect(s.kind).toBe('loading')
  })

  it('detects an unknown ticker only from 404s, never from an outage', () => {
    const unknown = summarizeResearchStatus(
      input({
        symbol: 'zzzzz',
        sources: { profile: err(404), quote: { status: 'success', empty: true }, prices: { status: 'success', empty: true } },
        price: { hasPrice: false },
      }),
    )
    expect(unknown.kind).toBe('not_found')
    expect(unknown.headline).toBe("We couldn't find ZZZZZ")

    const outage = summarizeResearchStatus(
      input({
        sources: { profile: err(503), quote: err(503), prices: { status: 'success', empty: true } },
        price: { hasPrice: false },
      }),
    )
    expect(outage.kind).toBe('unavailable')
  })

  it('a 404 profile with real bars is degraded, not unknown', () => {
    const s = summarizeResearchStatus(
      input({ sources: { profile: err(404), quote: err(404) }, price: { hasPrice: true, dataSource: 'daily close' }, fallbackSource: 'bars' }),
    )
    expect(s.kind).toBe('degraded')
  })
})

describe('indicatorsEmpty', () => {
  it('treats an all-null payload as empty', () => {
    expect(
      indicatorsEmpty({
        symbol: 'Z',
        indicators: { macd: { macd: null, signal: null, histogram: null }, bollinger_bands: { upper: null, middle: null, lower: null } },
      }),
    ).toBe(true)
    expect(indicatorsEmpty({ symbol: 'A', indicators: { rsi: 55 } })).toBe(false)
    expect(indicatorsEmpty(null)).toBe(true)
  })
})
