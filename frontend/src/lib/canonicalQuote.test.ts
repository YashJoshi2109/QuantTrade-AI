import { describe, expect, it } from 'vitest'
import { applyCanonicalQuote, canonicalQuoteInfo, extendedBadge } from './canonicalQuote'
import { resolvePriceInfo } from './researchQuote'

// /api/v1/enhanced/quote/AMD body for the 2026-11-26 21:48 ET fixture, as
// produced by backend/tests/test_canonical_quote.py (Public.com overnight
// print 424.00, Nov 25 regular close 406.03, Nov 24 close 413.27).
const ENHANCED_AMD = {
  symbol: 'AMD',
  last_price: 406.03,
  change: -7.24,
  change_percent: -1.7519,
  previous_close: 413.27,
  volume: 78535,
  data_source: 'public.com',
  source: 'public.com',
  stale: false,
  as_of: '2026-11-25T21:00:00+00:00',
  session: 'regular',
  regular: {
    price: 406.03,
    previous_close: 413.27,
    change: -7.24,
    change_percent: -1.7519,
    session_date: '2026-11-25',
    previous_session_date: '2026-11-24',
    close_time: '2026-11-25T21:00:00+00:00',
    live: false,
  },
  extended: {
    price: 424.0,
    change: 17.97,
    change_percent: 4.4258,
    time: '2026-11-27T02:47:50+00:00',
    session: 'overnight',
  },
}

// What FMP's profile quote said (it is not the source of the headline any more).
const FMP_PROFILE = { price: 423.01, change: 9.74, change_percent: 2.36, prev_close: 413.27 }

describe('canonical quote: every surface shows one price', () => {
  it('the /api/quotes/ticker overlay replaces the profile price with the regular session', () => {
    const info = applyCanonicalQuote(FMP_PROFILE, canonicalQuoteInfo(ENHANCED_AMD))
    expect(info.price).toBe(406.03)
    expect(info.change_percent).toBeCloseTo(-1.7519, 3)
    expect(info.prev_close).toBe(413.27)
    expect(info.quote?.extended?.price).toBe(424)
  })

  it('research header (realtime) and profile route resolve to the same numbers', () => {
    const viaRealtime = resolvePriceInfo(
      { price: ENHANCED_AMD.last_price, change: ENHANCED_AMD.change, change_percent: ENHANCED_AMD.change_percent,
        extended: ENHANCED_AMD.extended },
      null,
      null,
    )
    const viaProfile = resolvePriceInfo(null, applyCanonicalQuote(FMP_PROFILE, canonicalQuoteInfo(ENHANCED_AMD)), null)
    expect(viaRealtime.price).toBe(viaProfile.price)
    expect(viaRealtime.percent).toBeCloseTo(viaProfile.percent, 6)
    expect(viaRealtime.extended?.text).toBe('Overnight 424.00 +4.43%')
    expect(viaProfile.extended?.text).toBe('Overnight 424.00 +4.43%')
  })

  it('without a canonical quote the profile numbers stay and no badge is shown', () => {
    const info = applyCanonicalQuote(FMP_PROFILE, null)
    expect(info.price).toBe(423.01)
    expect(info.quote).toBeNull()
    expect(resolvePriceInfo(null, info, null).extended).toBeNull()
  })

  it('labels each extended session', () => {
    expect(extendedBadge({ price: 423.01, change: 16.98, change_percent: 4.18, time: null, session: 'after-hours' })?.text)
      .toBe('After hours 423.01 +4.18%')
    expect(extendedBadge({ price: 400, change: -6.03, change_percent: -1.485, time: null, session: 'pre-market' })?.text)
      .toBe('Pre-market 400.00 -1.49%')
    expect(extendedBadge(null)).toBeNull()
  })
})
