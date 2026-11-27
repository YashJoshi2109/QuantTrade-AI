import { NextRequest, NextResponse } from 'next/server'
import {
  HIT_CACHE_CONTROL,
  MISS_CACHE_CONTROL,
  TRANSIENT_CACHE_CONTROL,
  resolveLogo,
  type LogoResult,
} from '@/lib/logoResolver'

export const dynamic = 'force-dynamic'

const SYMBOL_OK = /^[A-Za-z0-9.\-]{1,24}$/

function toResponse(r: LogoResult): NextResponse {
  if (r.kind === 'hit') {
    return new NextResponse(r.body.slice(0), {
      status: 200,
      headers: {
        'Content-Type': r.contentType,
        'Cache-Control': HIT_CACHE_CONTROL,
        'X-Logo-Source': r.source,
      },
    })
  }
  // Always a fast, tiny 404 (never 5xx: a 5xx is replaced by the CDN's HTML error page
  // and is not cacheable). The client shows initials on any non-image response.
  return new NextResponse(null, {
    status: 404,
    headers: {
      'Cache-Control': r.kind === 'miss' ? MISS_CACHE_CONTROL : TRANSIENT_CACHE_CONTROL,
      'X-Logo-Source': 'none',
    },
  })
}

/**
 * Same-origin logo proxy: Logo.dev (when a key is configured) then FMP's public logo CDN
 * then Finnhub profile2. Hits and misses are cached in-process and via HTTP cache headers.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('symbol')?.trim() ?? ''
  const symbol = raw.toUpperCase()
  if (!symbol || !SYMBOL_OK.test(symbol)) {
    return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 })
  }
  return toResponse(await resolveLogo(symbol))
}
