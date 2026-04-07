/**
 * Next.js API proxy for fal.ai — keeps FAL_API_KEY server-side only.
 * POST /api/fal
 * Body: { model, prompt, width?, height?, steps? }
 * Returns: { url: string } or { error: string }
 */
import { NextRequest, NextResponse } from 'next/server'

const FAL_BASE = 'https://fal.run'
const FAL_API_KEY = process.env.FAL_API_KEY || ''

export async function POST(req: NextRequest) {
  if (!FAL_API_KEY) {
    return NextResponse.json({ error: 'FAL_API_KEY not configured' }, { status: 503 })
  }

  let body: {
    model?: string
    prompt: string
    width?: number
    height?: number
    steps?: number
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.prompt) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }

  const model = body.model || 'fal-ai/flux/schnell'
  const payload = {
    prompt: body.prompt,
    image_size: { width: body.width || 1024, height: body.height || 576 },
    num_inference_steps: body.steps || 4,
    num_images: 1,
    enable_safety_checker: true,
  }

  try {
    const falRes = await fetch(`${FAL_BASE}/${model}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${FAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!falRes.ok) {
      const text = await falRes.text().catch(() => '')
      return NextResponse.json({ error: `fal.ai error ${falRes.status}: ${text.slice(0, 200)}` }, { status: 502 })
    }

    const data = await falRes.json()
    const images: Array<{ url: string }> = data.images || []
    if (!images.length) {
      return NextResponse.json({ error: 'No images returned' }, { status: 502 })
    }

    return NextResponse.json({ url: images[0]!.url })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 })
  }
}
