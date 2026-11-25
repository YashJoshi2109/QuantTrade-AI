/**
 * Input validation for the Next.js proxies to paid AI APIs (/api/copilot,
 * /api/fal). Kept out of the route files so they can be unit tested (Next
 * route modules may only export route handlers/config).
 */

// ── /api/copilot (Groq) ─────────────────────────────────────────────────────

export const COPILOT_LIMITS = {
  maxTokens: 2048, // the app's own caller (copilot-api.ts) requests 2048
  maxMessages: 40,
  maxTotalChars: 60_000,
} as const

const ALLOWED_ROLES = new Set(['system', 'user', 'assistant'])

export type ChatMessage = { role: string; content: string }

/**
 * Returns a cleaned copy, or null when the payload is malformed or too large.
 * Long histories are trimmed (leading system prompt + most recent turns) rather
 * than rejected, so long-running chats keep working.
 */
export function sanitizeMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  let items: unknown[] = raw
  if (items.length > COPILOT_LIMITS.maxMessages) {
    const first = items[0] as { role?: unknown } | null
    const keepSystem = !!first && typeof first === 'object' && first.role === 'system'
    items = keepSystem
      ? [first, ...items.slice(-(COPILOT_LIMITS.maxMessages - 1))]
      : items.slice(-COPILOT_LIMITS.maxMessages)
  }
  let total = 0
  const out: ChatMessage[] = []
  for (const m of items) {
    if (!m || typeof m !== 'object') return null
    const { role, content } = m as { role?: unknown; content?: unknown }
    if (typeof role !== 'string' || !ALLOWED_ROLES.has(role) || typeof content !== 'string') return null
    total += content.length
    if (total > COPILOT_LIMITS.maxTotalChars) return null
    out.push({ role, content })
  }
  return out
}

export function clampMaxTokens(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 1024
  return Math.min(Math.max(n, 1), COPILOT_LIMITS.maxTokens)
}

// ── /api/fal (image generation) ─────────────────────────────────────────────

/** Only models the app actually uses (see src/lib/fal.ts FalModel). */
export const FAL_ALLOWED_MODELS = ['fal-ai/flux/schnell', 'fal-ai/flux/dev'] as const
export const FAL_DEFAULT_MODEL = FAL_ALLOWED_MODELS[0]
export const FAL_LIMITS = {
  minSide: 256,
  maxSide: 1536,
  maxSteps: 8,
  maxPromptChars: 2000,
} as const

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback
  return Math.min(Math.max(n, min), max)
}

export type FalRequest = {
  model: (typeof FAL_ALLOWED_MODELS)[number]
  prompt: string
  width: number
  height: number
  steps: number
}

/** Validate + clamp a /api/fal body. Returns an error string on rejection. */
export function parseFalRequest(body: unknown): FalRequest | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid JSON body' }
  const b = body as Record<string, unknown>
  const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : ''
  if (!prompt) return { error: 'prompt is required' }
  if (prompt.length > FAL_LIMITS.maxPromptChars) return { error: 'prompt is too long' }
  const model = b.model === undefined || b.model === null || b.model === '' ? FAL_DEFAULT_MODEL : b.model
  if (typeof model !== 'string' || !(FAL_ALLOWED_MODELS as readonly string[]).includes(model)) {
    return { error: 'Unsupported model' }
  }
  return {
    model: model as FalRequest['model'],
    prompt,
    width: clampInt(b.width, 1024, FAL_LIMITS.minSide, FAL_LIMITS.maxSide),
    height: clampInt(b.height, 576, FAL_LIMITS.minSide, FAL_LIMITS.maxSide),
    steps: clampInt(b.steps, 4, 1, FAL_LIMITS.maxSteps),
  }
}
