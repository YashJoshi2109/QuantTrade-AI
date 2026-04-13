import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const SYMBOL_OK = /^[A-Za-z0-9.\-]{1,24}$/

async function fetchLogoDevImage(symbol: string, token: string): Promise<Response | null> {
  const url = `https://img.logo.dev/ticker/${encodeURIComponent(symbol)}?token=${encodeURIComponent(token)}`
  const r = await fetch(url, {
    headers: { Accept: 'image/*,*/*;q=0.8', 'User-Agent': 'QuantTrade-NextLogoProxy/1.0' },
    cache: 'no-store',
  })
  return r.ok ? r : null
}

async function fetchFinnhubLogoImage(symbol: string, apiKey: string): Promise<Response | null> {
  const prof = await fetch(
    `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`,
    { headers: { Accept: 'application/json' }, cache: 'no-store' },
  )
  if (!prof.ok) return null
  const data = (await prof.json().catch(() => null)) as { logo?: string } | null
  const logoUrl = typeof data?.logo === 'string' ? data.logo.trim() : ''
  if (!logoUrl || !logoUrl.startsWith('http')) return null
  const img = await fetch(logoUrl, {
    headers: { Accept: 'image/*,*/*;q=0.8', 'User-Agent': 'QuantTrade-NextLogoProxy/1.0' },
    cache: 'no-store',
  })
  return img.ok ? img : null
}

async function imageResponseFromUpstream(res: Response): Promise<NextResponse> {
  const buf = await res.arrayBuffer()
  let ct = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png'
  if (!ct.startsWith('image/')) ct = 'image/png'
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': ct,
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
    },
  })
}

/**
 * Same-origin logo proxy. Works without BACKEND_INTERNAL_URL when Logo.dev or Finnhub keys exist.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('symbol')?.trim() ?? ''
  const symbol = raw.toUpperCase()
  if (!symbol || !SYMBOL_OK.test(symbol)) {
    return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 })
  }

  const base = (process.env.BACKEND_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '')
  const logoKey =
    process.env.LOGO_DEV_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN?.trim() ||
    ''
  const finnhubKey = process.env.FINNHUB_API_KEY?.trim() || ''

  // 1) Backend (Logo.dev key on API)
  if (base) {
    try {
      const upstream = `${base}/api/v1/market/logo/${encodeURIComponent(symbol)}`
      const res = await fetch(upstream, {
        headers: { Accept: 'image/*,*/*;q=0.8', 'User-Agent': 'QuantTrade-NextLogoProxy/1.0' },
        cache: 'no-store',
      })
      if (res.ok) {
        const buf = await res.arrayBuffer()
        let ct = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png'
        if (!ct.startsWith('image/')) ct = 'image/png'
        return new NextResponse(buf, {
          status: 200,
          headers: {
            'Content-Type': ct,
            'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
          },
        })
      }
    } catch {
      /* fall through */
    }
  }

  // 2) Logo.dev from server env (no backend required)
  if (logoKey) {
    try {
      const r = await fetchLogoDevImage(symbol, logoKey)
      if (r) return await imageResponseFromUpstream(r)
    } catch {
      /* fall through */
    }
  }

  // 3) Finnhub profile2 logo URL
  if (finnhubKey) {
    try {
      const r = await fetchFinnhubLogoImage(symbol, finnhubKey)
      if (r) return await imageResponseFromUpstream(r)
    } catch {
      /* fall through */
    }
  }

  return NextResponse.json(
    {
      error: 'Logo unavailable',
      hint: 'Set BACKEND_INTERNAL_URL or NEXT_PUBLIC_API_URL with LOGO_DEV_PUBLISHABLE_KEY on the API, or set LOGO_DEV_PUBLISHABLE_KEY / NEXT_PUBLIC_LOGO_DEV_TOKEN or FINNHUB_API_KEY for Next.',
    },
    { status: 502 },
  )
}
