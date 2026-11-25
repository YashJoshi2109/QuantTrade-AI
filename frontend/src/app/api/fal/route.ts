/**
 * Image generation proxy — forwards to the backend's guarded fal.ai endpoint
 * (POST /api/v1/ai-image/generate), which enforces auth, email verification,
 * images/day per user, per-IP limits, the fal + global daily budgets, and
 * caches identical requests. This route never holds or spends the fal key.
 *
 * POST /api/fal  (requires a signed-in session)
 * Body: { model?, prompt, width?, height?, steps? }  — validated/clamped here too
 * Returns: { url: string } or { error: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { backendBaseUrl, clientIp, createRateLimiter, getAuthToken } from '@/lib/server-auth'
import { parseFalRequest } from '@/lib/proxy-guards'

const rateLimit = createRateLimiter(10, 60_000) // speed bump; the backend owns the real quota

export async function POST(req: NextRequest) {
  const token = getAuthToken(req)
  if (!token) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!rateLimit(`${clientIp(req)}:${token.slice(-16)}`)) {
    return NextResponse.json(
      { error: 'Too many requests. Please slow down.' },
      { status: 429, headers: { 'Retry-After': '60' } }
    )
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = parseFalRequest(raw)
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const base = backendBaseUrl(req)
  if (!base) return NextResponse.json({ error: 'Image generation unavailable' }, { status: 503 })
  try {
    const res = await fetch(`${base}/api/v1/ai-image/generate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Forwarded-For': clientIp(req),
      },
      body: JSON.stringify(parsed),
      cache: 'no-store',
    })
    const data = (await res.json().catch(() => ({}))) as { url?: unknown; detail?: unknown }
    if (!res.ok || typeof data.url !== 'string') {
      const detail = typeof data.detail === 'string' ? data.detail : 'Image generation failed'
      return NextResponse.json({ error: detail }, { status: res.ok ? 502 : res.status })
    }
    return NextResponse.json({ url: data.url })
  } catch (err) {
    console.error('image proxy failure', err)
    return NextResponse.json({ error: 'Image generation failed' }, { status: 502 })
  }
}
