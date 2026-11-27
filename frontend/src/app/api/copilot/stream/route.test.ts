// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import * as route from './route'

function req(body: unknown, token = 'tok') {
  return new NextRequest('http://localhost/api/copilot/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('copilot stream proxy route', () => {
  it('runs on the Node.js runtime with a 300s limit (deep answers outlast 120s)', () => {
    expect(route.runtime).toBe('nodejs')
    expect(route.maxDuration).toBeGreaterThanOrEqual(300)
  })

  it('streams backend SSE (including heartbeat events) through unbuffered and forwards the abort signal', async () => {
    const sse = 'event: heartbeat\ndata: {"ts":"2026-11-27T00:00:00+00:00"}\n\nevent: done\ndata: {}\n\n'
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await route.POST(req({ message: 'hi' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Accel-Buffering')).toBe('no')
    expect(await res.text()).toBe(sse)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.signal).toBeDefined()
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('rejects unauthenticated requests without calling the backend', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const r = new NextRequest('http://localhost/api/copilot/stream', {
      method: 'POST', body: JSON.stringify({ message: 'hi' }),
    })
    const res = await route.POST(r)
    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
