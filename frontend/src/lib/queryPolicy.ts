/**
 * Shared React Query policy: retry predicate, backoff and polling intervals.
 *
 * Rules (see the 429 storm on /research):
 *  - Never retry a 4xx. A 429 means "slow down"; retrying it immediately is the
 *    storm. A 404 will not fix itself either.
 *  - Network / 5xx errors retry at most twice, with exponential backoff.
 *  - Polling intervals depend on the market phase (live quotes matter only in
 *    session) and back off exponentially after consecutive 429s, honouring
 *    Retry-After. A 429 on any endpoint pauses every poll until the cooldown
 *    passes: the backend limiter is one bucket per client, not per endpoint.
 */
import { isHttpError, isRateLimited } from './httpError'

export type MarketPhase = 'open' | 'extended' | 'closed'

export interface PhaseIntervals {
  open: number
  extended: number
  closed: number
}

/** Live quote polling: 20s in session, 60s extended hours, 2 min when closed. */
export const QUOTE_POLL: PhaseIntervals = { open: 20_000, extended: 60_000, closed: 120_000 }
/** Market-wide widgets (indices, movers): backend caches these for 30-60s. */
export const MARKET_WIDGET_POLL: PhaseIntervals = { open: 60_000, extended: 120_000, closed: 300_000 }
/** Sector performance: backend caches 60s; it barely moves minute to minute. */
export const SECTOR_POLL: PhaseIntervals = { open: 120_000, extended: 300_000, closed: 600_000 }

const MAX_RETRIES = 2
const MAX_RETRY_DELAY_MS = 15_000
const MAX_POLL_MS = 10 * 60_000
const DEFAULT_429_COOLDOWN_MS = 30_000

/** React Query `retry` predicate: no retries for 4xx (incl. 429) or aborts. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (isHttpError(error) && error.status >= 400 && error.status < 500) return false
  if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) return false
  return failureCount < MAX_RETRIES
}

/** React Query `retryDelay`: Retry-After when given, else 1s, 2s, 4s... capped at 15s. */
export function retryDelayMs(attemptIndex: number, error: unknown): number {
  if (isHttpError(error) && error.retryAfterMs != null) return Math.min(error.retryAfterMs, MAX_POLL_MS)
  return Math.min(1000 * 2 ** attemptIndex, MAX_RETRY_DELAY_MS)
}

export function intervalForPhase(phase: MarketPhase, intervals: PhaseIntervals): number {
  return intervals[phase]
}

// ── Global 429 cooldown ─────────────────────────────────────────────────────

let cooldownUntil = 0

/** Record a 429 seen anywhere; every poll waits at least until it passes. */
export function noteRateLimited(error: unknown, now: number = Date.now()): void {
  if (!isRateLimited(error)) return
  const wait = isHttpError(error) && error.retryAfterMs != null ? error.retryAfterMs : DEFAULT_429_COOLDOWN_MS
  cooldownUntil = Math.max(cooldownUntil, now + Math.min(wait, MAX_POLL_MS))
}

export function cooldownRemainingMs(now: number = Date.now()): number {
  return Math.max(0, cooldownUntil - now)
}

/** Test helper. */
export function resetRateLimitCooldown(): void {
  cooldownUntil = 0
}

// ── Interval with backoff ───────────────────────────────────────────────────

interface QueryStateLike {
  status: string
  error: unknown
  errorUpdatedAt: number
  dataUpdatedAt: number
}

const streaks = new WeakMap<object, { errorAt: number; count: number }>()

/**
 * Next poll delay for a query given its base interval: base on success,
 * base * 2^n (n = consecutive 429s, max 2^4) after 429s and at least the
 * Retry-After / global cooldown; 2x base after other errors.
 */
export function nextPollDelay(
  base: number,
  state: QueryStateLike,
  streakKey: object,
  now: number = Date.now(),
): number {
  let delay = base
  if (state.status === 'error' && state.errorUpdatedAt >= state.dataUpdatedAt) {
    if (isRateLimited(state.error)) {
      const prev = streaks.get(streakKey)
      const count = prev && prev.errorAt === state.errorUpdatedAt ? prev.count : (prev?.count ?? 0) + 1
      streaks.set(streakKey, { errorAt: state.errorUpdatedAt, count })
      delay = base * 2 ** Math.min(count, 4)
      const ra = isHttpError(state.error) ? state.error.retryAfterMs : null
      if (ra != null) delay = Math.max(delay, ra)
    } else {
      streaks.delete(streakKey)
      delay = base * 2
    }
  } else {
    streaks.delete(streakKey)
  }
  return Math.min(Math.max(delay, cooldownRemainingMs(now)), MAX_POLL_MS)
}

/**
 * `refetchInterval` for one-shot data (profile, fundamentals...): no polling
 * while healthy; while the query is failing, retry with backoff (base, 2x, 4x,
 * ... capped at 16x and 10 min), honouring Retry-After / the 429 cooldown.
 * A non-429 4xx (e.g. 404 unknown ticker) will not fix itself: no retry.
 */
export function retryWhileFailing(base: number) {
  return (query: { state: QueryStateLike }): number | false => {
    const s = query.state
    if (s.status !== 'error') {
      streaks.delete(query)
      return false
    }
    if (isHttpError(s.error) && s.error.status >= 400 && s.error.status < 500 && s.error.status !== 429) return false
    const prev = streaks.get(query)
    const count = prev && prev.errorAt === s.errorUpdatedAt ? prev.count : (prev?.count ?? 0) + 1
    streaks.set(query, { errorAt: s.errorUpdatedAt, count })
    let delay = base * 2 ** Math.min(count - 1, 4)
    if (isHttpError(s.error) && s.error.retryAfterMs != null) delay = Math.max(delay, s.error.retryAfterMs)
    return Math.min(Math.max(delay, cooldownRemainingMs()), MAX_POLL_MS)
  }
}

/**
 * `refetchInterval` function for React Query: `refetchInterval: backoffInterval(30_000)`.
 * Pass `false`/0 to disable polling.
 */
export function backoffInterval(base: number | false) {
  return (query: { state: QueryStateLike }): number | false => {
    if (!base) return false
    return nextPollDelay(base, query.state, query)
  }
}
