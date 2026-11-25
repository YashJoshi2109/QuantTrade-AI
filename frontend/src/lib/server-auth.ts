/**
 * Server-only helpers for Next.js route handlers that proxy paid third-party
 * APIs (Groq, fal.ai). They must never act as open relays: every request has
 * to carry a session the backend accepts, and is rate limited per IP + user.
 *
 * Works in both the edge and node runtimes (fetch + Map only).
 */

export const AUTH_COOKIE = 'qt_access_token'

interface CookieReader {
  get(name: string): { value: string } | undefined
}

export interface AuthRequestLike {
  headers: Headers
  cookies: CookieReader
  nextUrl?: { origin: string }
}

export interface SessionUser {
  id: number
}

/** Session token from the httpOnly cookie, or a Bearer header as fallback. */
export function getAuthToken(req: AuthRequestLike): string | null {
  const cookie = req.cookies.get(AUTH_COOKIE)?.value
  if (cookie) return cookie
  const header = req.headers.get('authorization') || ''
  const m = /^Bearer\s+(.+)$/i.exec(header)
  return m ? m[1]!.trim() : null
}

function backendBase(req: AuthRequestLike): string {
  const configured =
    process.env.BACKEND_INTERNAL_URL || process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || ''
  // Empty = same origin (Next rewrite / nginx proxies /api/v1/* to the backend).
  return (configured || req.nextUrl?.origin || '').replace(/\/$/, '')
}

/**
 * Validate the caller's session against the backend (`/api/v1/auth/me`).
 * Returns null when unauthenticated, the token is invalid, or the backend
 * can't be reached (fail closed).
 */
export async function getSessionUser(
  req: AuthRequestLike,
  fetchImpl: typeof fetch = fetch
): Promise<SessionUser | null> {
  const token = getAuthToken(req)
  if (!token) return null
  const base = backendBase(req)
  if (!base) return null
  try {
    const res = await fetchImpl(`${base}/api/v1/auth/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = (await res.json()) as { id?: unknown }
    return typeof data.id === 'number' ? { id: data.id } : null
  } catch {
    return null
  }
}

export function clientIp(req: AuthRequestLike): string {
  return (
    req.headers.get('cf-connecting-ip') ||
    (req.headers.get('x-forwarded-for') || '').split(',')[0]!.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
}

/**
 * Fixed-window in-memory limiter. Per instance only (serverless instances
 * don't share state) — a speed bump against abuse, not a hard quota.
 */
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>()
  return function check(key: string, now: number = Date.now()): boolean {
    const entry = hits.get(key)
    if (!entry || now >= entry.resetAt) {
      if (hits.size > 10_000) {
        hits.forEach((v, k) => {
          if (now >= v.resetAt) hits.delete(k)
        })
      }
      hits.set(key, { count: 1, resetAt: now + windowMs })
      return true
    }
    if (entry.count >= limit) return false
    entry.count += 1
    return true
  }
}

/** Backend origin for server-side fetches (same-origin when unset). */
export function backendBaseUrl(req: AuthRequestLike): string {
  return backendBase(req)
}

export type AiQuotaResult =
  | { ok: true; maxTokens: number }
  | { ok: false; status: number; detail: string }

/**
 * Ask the backend AI usage guard (POST /api/v1/ai-usage/reserve) for quota
 * before a relay spends on a paid provider. The backend checks auth, email
 * verification, per-user / per-IP limits and the global budget, and charges
 * the worst case (prompt + maxTokens). Fails closed: no answer = no spend.
 */
export async function reserveAiQuota(
  req: AuthRequestLike,
  body: { feature: 'copilot_relay' | 'ai_analysis'; model: string; inputChars: number; maxTokens: number },
  fetchImpl: typeof fetch = fetch
): Promise<AiQuotaResult> {
  const token = getAuthToken(req)
  if (!token) return { ok: false, status: 401, detail: 'Sign in to use AI features.' }
  const base = backendBase(req)
  if (!base) return { ok: false, status: 503, detail: 'AI service unavailable' }
  try {
    const res = await fetchImpl(`${base}/api/v1/ai-usage/reserve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Forwarded-For': clientIp(req),
      },
      body: JSON.stringify({
        feature: body.feature,
        model: body.model,
        input_chars: body.inputChars,
        max_tokens: body.maxTokens,
      }),
      cache: 'no-store',
    })
    const data = (await res.json().catch(() => ({}))) as { detail?: unknown; max_tokens?: unknown }
    if (!res.ok) {
      const detail = typeof data.detail === 'string' ? data.detail : 'AI request not allowed'
      return { ok: false, status: res.status, detail }
    }
    const maxTokens = typeof data.max_tokens === 'number' ? data.max_tokens : body.maxTokens
    return { ok: true, maxTokens }
  } catch {
    return { ok: false, status: 503, detail: 'AI service unavailable' }
  }
}

export function jsonError(message: string, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  })
}
