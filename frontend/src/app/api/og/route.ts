/**
 * OG image endpoint (PUBLIC — social-preview crawlers).
 * GET /api/og?title=...&subtitle=...&type=stock|markets|game|default
 *
 * Never spends on fal.ai directly. The backend (GET /api/v1/ai-image/og) caches
 * each generated image persistently per (type, title, subtitle, template
 * version), so every image is generated at most once, rate limits misses per
 * IP and stops at a global daily cap (AI_OG_IMAGES_PER_DAY). When it says
 * "fallback" (cap hit, rate limited, unavailable) we redirect to a static image.
 */
import { NextRequest, NextResponse } from 'next/server'
import { backendBaseUrl, clientIp, createRateLimiter } from '@/lib/server-auth'

const FALLBACK_PATH = '/og-fallback.png'
const rateLimit = createRateLimiter(20, 60_000) // per IP; cache hits are cheap but still bounded

// Generated URLs are immutable; let the CDN keep the redirect for a day.
const CACHED = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800'
const SHORT = 'public, max-age=300, s-maxage=600'

function fallback(req: NextRequest): NextResponse {
  const res = NextResponse.redirect(new URL(FALLBACK_PATH, req.nextUrl.origin), 302)
  res.headers.set('Cache-Control', SHORT)
  return res
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const title = (searchParams.get('title') || 'QuantTrade AI').slice(0, 80)
  const subtitle = (searchParams.get('subtitle') || '').slice(0, 120)
  const type = (searchParams.get('type') || 'default').slice(0, 20)

  if (!rateLimit(clientIp(req))) return fallback(req)

  const base = backendBaseUrl(req)
  if (!base) return fallback(req)
  try {
    const qs = new URLSearchParams({ title, subtitle, type })
    const res = await fetch(`${base}/api/v1/ai-image/og?${qs}`, {
      headers: { 'X-Forwarded-For': clientIp(req) },
      cache: 'no-store',
    })
    if (!res.ok) return fallback(req)
    const data = (await res.json()) as { url?: unknown }
    if (typeof data.url !== 'string' || !/^https:\/\//.test(data.url)) return fallback(req)
    const out = NextResponse.redirect(data.url, 302)
    out.headers.set('Cache-Control', CACHED)
    return out
  } catch {
    return fallback(req)
  }
}
