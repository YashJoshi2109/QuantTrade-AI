/**
 * fal.ai client helpers — all calls go through /api/fal (server-side proxy)
 * so the API key is never exposed to the browser.
 */

export type FalModel = 'fal-ai/flux/schnell' | 'fal-ai/flux/dev'

interface GenerateOptions {
  model?: FalModel
  width?: number
  height?: number
  steps?: number
}

export async function falGenerate(
  prompt: string,
  opts: GenerateOptions = {}
): Promise<string | null> {
  try {
    const res = await fetch('/api/fal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...opts }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.url || null
  } catch {
    return null
  }
}

// ── Typed helpers ──────────────────────────────────────────────────────────────

export async function generateStockVisual(
  symbol: string,
  companyName: string,
  sentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral'
): Promise<string | null> {
  const sentimentDesc = {
    bullish: 'upward trending green glowing stock chart, rising candlesticks, bull, green neon',
    bearish: 'downward red glowing stock chart, falling candlesticks, bear, red neon',
    neutral: 'mixed candlestick chart, blue and cyan holographic display',
  }[sentiment]

  const prompt =
    `Professional financial data visualization, dark navy #0a0e1a background, ` +
    `${sentimentDesc}, ` +
    `Bloomberg terminal aesthetic, glowing holographic display, ` +
    `"${symbol}" ticker prominent, "${companyName}" caption, ` +
    `cinematic neon lighting, ultra-detailed, no people, photorealistic`

  return falGenerate(prompt, { width: 1200, height: 630, steps: 4 })
}

export async function generateGameAsset(
  assetType: 'character' | 'building' | 'scene' | 'item',
  name: string
): Promise<string | null> {
  const prompts: Record<string, string> = {
    character:
      `Full-body medieval fantasy character portrait: ${name}, ` +
      `detailed RPG concept art, dramatic lighting, dark atmospheric background, ` +
      `highly detailed clothing and gear, digital painting style`,
    building:
      `Isometric medieval fantasy building: ${name}, ` +
      `warm torchlight glow, detailed stonework, game asset style, ` +
      `dark atmospheric background, vibrant colors`,
    scene:
      `Wide cinematic medieval fantasy scene: ${name}, ` +
      `moonlit atmosphere, epic environment art, detailed world-building, ` +
      `dark fantasy painting, volumetric light`,
    item:
      `Fantasy item illustration: ${name}, ` +
      `glowing magical aura, medieval style, dark background, ` +
      `detailed game icon art, dramatic lighting`,
  }

  const isPortrait = assetType === 'character' || assetType === 'item'
  return falGenerate(prompts[assetType]!, {
    model: 'fal-ai/flux/dev',
    width: isPortrait ? 768 : 1024,
    height: isPortrait ? 1024 : 576,
    steps: 6,
  })
}

export function ogImageUrl(title: string, subtitle = '', type = 'default'): string {
  const params = new URLSearchParams({ title, subtitle, type })
  return `/api/og?${params}`
}
