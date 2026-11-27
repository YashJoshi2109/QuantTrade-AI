import { afterEach, describe, expect, it } from 'vitest'
import { HttpError, parseRetryAfter, isRateLimited, httpErrorFrom } from './httpError'
import {
  backoffInterval,
  cooldownRemainingMs,
  nextPollDelay,
  noteRateLimited,
  resetRateLimitCooldown,
  retryDelayMs,
  retryWhileFailing,
  shouldRetryQuery,
} from './queryPolicy'
import { clockMarketPhase, marketPhaseFrom } from './marketPhase'

afterEach(() => resetRateLimitCooldown())

describe('shouldRetryQuery', () => {
  it('never retries 429 or other 4xx', () => {
    expect(shouldRetryQuery(0, new HttpError(429, '/q', 30_000))).toBe(false)
    expect(shouldRetryQuery(0, new HttpError(404, '/q'))).toBe(false)
    expect(shouldRetryQuery(0, new HttpError(400, '/q'))).toBe(false)
  })
  it('retries 5xx / network errors at most twice', () => {
    expect(shouldRetryQuery(0, new HttpError(503, '/q'))).toBe(true)
    expect(shouldRetryQuery(1, new TypeError('Failed to fetch'))).toBe(true)
    expect(shouldRetryQuery(2, new HttpError(502, '/q'))).toBe(false)
  })
  it('does not retry aborts', () => {
    expect(shouldRetryQuery(0, new DOMException('x', 'AbortError'))).toBe(false)
  })
})

describe('retryDelayMs', () => {
  it('honours Retry-After, else exponential capped at 15s', () => {
    expect(retryDelayMs(0, new HttpError(503, '/q', 7_000))).toBe(7_000)
    expect(retryDelayMs(0, new Error('x'))).toBe(1000)
    expect(retryDelayMs(2, new Error('x'))).toBe(4000)
    expect(retryDelayMs(10, new Error('x'))).toBe(15_000)
  })
})

describe('parseRetryAfter / httpErrorFrom', () => {
  it('parses seconds and HTTP dates', () => {
    expect(parseRetryAfter('60')).toBe(60_000)
    expect(parseRetryAfter(null)).toBeNull()
    expect(parseRetryAfter('soon')).toBeNull()
    const now = Date.parse('2026-11-27T12:00:00Z')
    expect(parseRetryAfter('Fri, 27 Nov 2026 12:00:30 GMT', now)).toBe(30_000)
    expect(parseRetryAfter('999999')).toBe(600_000) // capped
  })
  it('builds a typed error from a 429 response', () => {
    const err = httpErrorFrom(new Response('{}', { status: 429, headers: { 'Retry-After': '12' } }), '/x')
    expect(isRateLimited(err)).toBe(true)
    expect(err.retryAfterMs).toBe(12_000)
  })
})

const ok = { status: 'success', error: null, errorUpdatedAt: 0, dataUpdatedAt: 10 }
const rl = (at: number, ra: number | null = null) => ({
  status: 'error',
  error: new HttpError(429, '/q', ra),
  errorUpdatedAt: at,
  dataUpdatedAt: 0,
})

describe('nextPollDelay / backoffInterval', () => {
  it('uses the base interval when healthy', () => {
    expect(nextPollDelay(20_000, ok, {})).toBe(20_000)
  })
  it('backs off exponentially on consecutive 429s and honours Retry-After', () => {
    const key = {}
    expect(nextPollDelay(20_000, rl(1), key)).toBe(40_000)
    expect(nextPollDelay(20_000, rl(1), key)).toBe(40_000) // same error re-evaluated
    expect(nextPollDelay(20_000, rl(2), key)).toBe(80_000)
    expect(nextPollDelay(20_000, rl(3, 500_000), key)).toBe(500_000)
    expect(nextPollDelay(20_000, ok, key)).toBe(20_000) // reset on success
    expect(nextPollDelay(20_000, rl(4), key)).toBe(40_000)
  })
  it('caps at 10 minutes', () => {
    const key = {}
    for (let i = 1; i < 10; i++) nextPollDelay(200_000, rl(i), key)
    expect(nextPollDelay(200_000, rl(11), key)).toBe(600_000)
  })
  it('a 429 anywhere delays every poll until the cooldown passes', () => {
    noteRateLimited(new HttpError(429, '/other', 90_000), Date.now())
    expect(cooldownRemainingMs()).toBeGreaterThan(80_000)
    expect(nextPollDelay(20_000, ok, {})).toBeGreaterThan(80_000)
    noteRateLimited(new HttpError(500, '/x')) // non-429 ignored
  })
  it('backoffInterval(false) disables polling', () => {
    expect(backoffInterval(false)({ state: ok })).toBe(false)
  })
})

describe('retryWhileFailing', () => {
  it('does not poll healthy queries or 404s; backs off failures', () => {
    const fn = retryWhileFailing(30_000)
    const q = { state: ok }
    expect(fn(q)).toBe(false)
    expect(fn({ state: { ...ok, status: 'error', error: new HttpError(404, '/t'), errorUpdatedAt: 5 } })).toBe(false)
    const failing = { state: { status: 'error', error: new HttpError(503, '/t'), errorUpdatedAt: 1, dataUpdatedAt: 0 } }
    expect(fn(failing)).toBe(30_000)
    failing.state = { ...failing.state, errorUpdatedAt: 2 }
    expect(fn(failing)).toBe(60_000)
  })
})

describe('market phase', () => {
  it('uses the New York clock', () => {
    expect(clockMarketPhase(new Date('2026-11-27T15:00:00Z'))).toBe('open') // 10:00 EST Fri
    expect(clockMarketPhase(new Date('2026-11-27T22:00:00Z'))).toBe('extended') // 17:00 EST
    expect(clockMarketPhase(new Date('2026-11-28T15:00:00Z'))).toBe('closed') // Saturday
    expect(clockMarketPhase(new Date('2026-07-01T13:45:00Z'))).toBe('open') // 9:45 EDT
  })
  it('prefers backend status for open/closed', () => {
    const open = new Date('2026-11-27T15:00:00Z')
    expect(marketPhaseFrom({ is_open: false, is_weekday: true }, open)).toBe('extended') // holiday/early close
    expect(marketPhaseFrom({ is_open: true }, new Date('2026-11-28T15:00:00Z'))).toBe('open')
    expect(marketPhaseFrom({ is_open: false, is_weekday: false }, open)).toBe('closed')
    expect(marketPhaseFrom(undefined, open)).toBe('open')
  })
})
