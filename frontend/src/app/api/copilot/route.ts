import { NextRequest } from 'next/server'
import { clientIp, createRateLimiter, getSessionUser, jsonError } from '@/lib/server-auth'
import { clampMaxTokens, COPILOT_LIMITS, sanitizeMessages } from '@/lib/proxy-guards'

/**
 * GROQ AI Copilot API — Server-side streaming
 * Uses Llama 3.3 70B / Llama 3.1 8B via GROQ (ultra-fast inference)
 * Falls back to smaller model if larger exceeds rate limit
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'mixtral-8x7b-32768',
]

export const runtime = 'edge'
export const maxDuration = 60

const rateLimit = createRateLimiter(20, 60_000) // 20 req / min per IP+user

export async function POST(request: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    return jsonError('AI service not configured', 503)
  }

  const user = await getSessionUser(request)
  if (!user) {
    return jsonError('Authentication required', 401)
  }
  if (!rateLimit(`${clientIp(request)}:${user.id}`)) {
    return jsonError('Too many requests. Please slow down.', 429, { 'Retry-After': '60' })
  }

  let body: { messages: unknown; model?: string; max_tokens?: number }
  try {
    body = await request.json()
  } catch {
    return jsonError('Invalid request body', 400)
  }

  const messages = sanitizeMessages(body?.messages)
  if (!messages) {
    return jsonError(
      `messages must be 1-${COPILOT_LIMITS.maxMessages} {role, content} items with at most ${COPILOT_LIMITS.maxTotalChars} characters in total`,
      400
    )
  }

  const modelId = body.model && GROQ_MODELS.includes(body.model)
    ? body.model
    : GROQ_MODELS[0]

  const groqPayload = {
    model: modelId,
    messages,
    max_tokens: clampMaxTokens(body.max_tokens),
    temperature: 0.7,
    stream: true,
  }

  try {
    const groqRes = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(groqPayload),
    })

    if (!groqRes.ok) {
      // Try fallback model on rate limit
      if (groqRes.status === 429) {
        const fallbackPayload = { ...groqPayload, model: GROQ_MODELS[1] }
        const fallbackRes = await fetch(GROQ_API_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(fallbackPayload),
        })

        if (fallbackRes.ok && fallbackRes.body) {
          return new Response(fallbackRes.body, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
              'X-Model-Used': GROQ_MODELS[1],
            },
          })
        }
      }

      const errText = await groqRes.text().catch(() => '')
      console.error('GROQ upstream error', groqRes.status, errText.slice(0, 500))
      return jsonError(
        groqRes.status === 429 ? 'AI service is busy. Please try again shortly.' : 'AI service error',
        groqRes.status === 429 ? 429 : 502
      )
    }

    if (!groqRes.body) {
      return new Response(JSON.stringify({ error: 'No response body' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(groqRes.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Model-Used': modelId,
      },
    })
  } catch (err) {
    console.error('GROQ proxy failure', err)
    return jsonError('AI service error', 502)
  }
}
