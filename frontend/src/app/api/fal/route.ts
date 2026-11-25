/**
 * Next.js API proxy for fal.ai — keeps FAL_API_KEY server-side only.
 * POST /api/fal  (requires a signed-in session)
 * Body: { model?, prompt, width?, height?, steps? }
 *   model  — must be one of FAL_ALLOWED_MODELS (see src/lib/proxy-guards.ts)
 *   width/height/steps — clamped server-side
 * Returns: { url: string } or { error: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { clientIp, createRateLimiter, getSessionUser } from '@/lib/server-auth'
import { parseFalRequest } from '@/lib/proxy-guards'

const FAL_BASE = 'https://fal.run'
const FAL_API_KEY = process.env.FAL_API_KEY || ''

const rateLimit = createRateLimiter(10, 60_000) // 10 images / min per IP+user

export async function POST(req: NextRequest) {
  if (!FAL_API_KEY) {
    return NextResponse.json({ error: 'Image generation not configured' }, { status: 503 })
  }

  const user = await getSessionUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!rateLimit(`${clientIp(req)}:${user.id}`)) {
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

  const payload = {
    prompt: parsed.prompt,
    image_size: { width: parsed.width, height: parsed.height },
    num_inference_steps: parsed.steps,
    num_images: 1,
    enable_safety_checker: true,
  }

  try {
    // parsed.model is from a fixed allowlist, so the upstream path is constant.
    const falRes = await fetch(`${FAL_BASE}/${parsed.model}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${FAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!falRes.ok) {
      const text = await falRes.text().catch(() => '')
      console.error('fal.ai upstream error', falRes.status, text.slice(0, 500))
      return NextResponse.json({ error: 'Image generation failed' }, { status: 502 })
    }

    const data = await falRes.json()
    const images: Array<{ url: string }> = data.images || []
    if (!images.length) {
      return NextResponse.json({ error: 'Image generation failed' }, { status: 502 })
    }

    return NextResponse.json({ url: images[0]!.url })
  } catch (err) {
    console.error('fal.ai proxy failure', err)
    return NextResponse.json({ error: 'Image generation failed' }, { status: 502 })
  }
}
