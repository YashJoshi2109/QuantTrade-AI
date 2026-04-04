import { NextRequest } from 'next/server'

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

export async function POST(request: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GROQ API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: { messages: unknown[]; model?: string; max_tokens?: number }
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const modelId = body.model && GROQ_MODELS.includes(body.model)
    ? body.model
    : GROQ_MODELS[0]

  const groqPayload = {
    model: modelId,
    messages: body.messages,
    max_tokens: body.max_tokens ?? 1024,
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

      const errText = await groqRes.text()
      return new Response(JSON.stringify({ error: errText }), {
        status: groqRes.status,
        headers: { 'Content-Type': 'application/json' },
      })
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
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
