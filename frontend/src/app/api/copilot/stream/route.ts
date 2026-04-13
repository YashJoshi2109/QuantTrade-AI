import { NextRequest } from 'next/server'

/**
 * SSE proxy to backend /api/v1/copilot/stream
 * Forwards auth token and streams back SSE events
 */

const API_URL = process.env.BACKEND_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || ''

export const runtime = 'edge'
export const maxDuration = 120

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Forward auth token from cookie or header
  const authToken =
    request.cookies.get('access_token')?.value ||
    request.headers.get('authorization')?.replace('Bearer ', '') ||
    ''

  if (!authToken) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const backendRes = await fetch(`${API_URL}/api/v1/copilot/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(body),
    })

    if (!backendRes.ok) {
      const errText = await backendRes.text().catch(() => backendRes.statusText)
      return new Response(JSON.stringify({ error: errText }), {
        status: backendRes.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!backendRes.body) {
      return new Response(JSON.stringify({ error: 'No response body' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(backendRes.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Backend connection failed' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
