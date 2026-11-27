/**
 * Typed HTTP errors for fetchers that feed React Query.
 *
 * A fetcher that swallows a 429 (or parses its `{"detail": ...}` body as data)
 * hides the rate limit from React Query, so polling keeps hammering the backend
 * and the UI renders garbage. Fetchers throw `HttpError` instead; the shared
 * query policy (lib/queryPolicy) reads `status` / `retryAfterMs` to decide
 * whether to retry and how long to back off.
 */

export class HttpError extends Error {
  readonly status: number
  /** Server-requested wait (Retry-After), in ms; null when absent/unparseable. */
  readonly retryAfterMs: number | null
  readonly url: string

  constructor(status: number, url: string, retryAfterMs: number | null = null, message?: string) {
    super(message ?? `HTTP ${status} for ${url}`)
    this.name = 'HttpError'
    this.status = status
    this.url = url
    this.retryAfterMs = retryAfterMs
  }
}

const MAX_RETRY_AFTER_MS = 10 * 60_000

/**
 * Parse a Retry-After header: delta-seconds ("30") or an HTTP date.
 * Returns ms to wait (>= 0, capped at 10 min) or null.
 */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | null {
  if (value == null) return null
  const v = value.trim()
  if (!v) return null
  if (/^\d+(\.\d+)?$/.test(v)) {
    return Math.min(Math.round(parseFloat(v) * 1000), MAX_RETRY_AFTER_MS)
  }
  const at = Date.parse(v)
  if (Number.isNaN(at)) return null
  return Math.min(Math.max(0, at - now), MAX_RETRY_AFTER_MS)
}

export function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError || (
    typeof err === 'object' && err !== null && (err as { name?: string }).name === 'HttpError' &&
    typeof (err as { status?: unknown }).status === 'number'
  )
}

export function isRateLimited(err: unknown): boolean {
  return isHttpError(err) && err.status === 429
}

export function httpErrorFrom(response: Response, url?: string): HttpError {
  return new HttpError(
    response.status,
    url ?? response.url ?? '',
    parseRetryAfter(response.headers?.get?.('Retry-After') ?? null),
  )
}

/** Throw an HttpError when the backend rate-limited this call (429). */
export function throwIfRateLimited(response: Response, url?: string): void {
  if (response.status === 429) throw httpErrorFrom(response, url)
}

/** Throw an HttpError for any non-2xx response. */
export function throwIfNotOk(response: Response, url?: string): void {
  if (!response.ok) throw httpErrorFrom(response, url)
}

/** GET JSON, throwing HttpError on non-2xx. */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  throwIfNotOk(res, url)
  return (await res.json()) as T
}
