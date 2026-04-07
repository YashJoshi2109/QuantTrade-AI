/**
 * OG image generation endpoint.
 * GET /api/og?title=...&subtitle=...&type=stock|markets|game|default
 *
 * Calls fal.ai to generate a branded social-preview image and returns
 * a redirect to the generated URL (cached by CDN on subsequent hits).
 */
import { NextRequest, NextResponse } from 'next/server'

const FAL_BASE = 'https://fal.run'
const FAL_API_KEY = process.env.FAL_API_KEY || ''
const MODEL = 'fal-ai/flux/schnell'

// Simple in-process cache so the same title/type doesn't regenerate every request
const _cache = new Map<string, { url: string; ts: number }>()
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 h

const TYPE_THEMES: Record<string, string> = {
  stock:   'dark navy stock market terminal, glowing candlestick charts, Bloomberg aesthetic, electric blue and cyan',
  markets: 'global financial markets, glowing world map with data overlays, gold and cyan accents',
  game:    'epic medieval fantasy kingdom at night, glowing torches, golden coins, mystical atmosphere',
  default: 'futuristic fintech platform, holographic data streams, dark background, cyan and blue neon',
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const title    = (searchParams.get('title')    || 'QuantTrade AI').slice(0, 80)
  const subtitle = (searchParams.get('subtitle') || '').slice(0, 120)
  const type     = searchParams.get('type') || 'default'

  // Fallback: if no key, return a simple JSON response
  if (!FAL_API_KEY) {
    return NextResponse.json({ error: 'FAL_API_KEY not set' }, { status: 503 })
  }

  const cacheKey = `${type}:${title}:${subtitle}`
  const cached = _cache.get(cacheKey)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.redirect(cached.url)
  }

  const theme = TYPE_THEMES[type] || TYPE_THEMES.default
  const prompt = (
    `Stunning social media preview image, ${theme}, ` +
    `professional branding, bold space for title text, ` +
    `'${title}' visible as main headline, dark rich background, ` +
    `cinematic depth of field, 16:9 aspect ratio, no people, high contrast`
  )

  const payload = {
    prompt,
    image_size: { width: 1200, height: 630 },
    num_inference_steps: 4,
    num_images: 1,
    enable_safety_checker: true,
  }

  try {
    const falRes = await fetch(`${FAL_BASE}/${MODEL}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${FAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!falRes.ok) {
      return NextResponse.json({ error: `fal.ai ${falRes.status}` }, { status: 502 })
    }

    const data = await falRes.json()
    const url: string | undefined = data.images?.[0]?.url
    if (!url) return NextResponse.json({ error: 'No image returned' }, { status: 502 })

    _cache.set(cacheKey, { url, ts: Date.now() })
    return NextResponse.redirect(url)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 })
  }
}
