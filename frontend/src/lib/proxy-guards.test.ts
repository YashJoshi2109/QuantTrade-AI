import { describe, expect, it, vi } from 'vitest'
import { clampMaxTokens, COPILOT_LIMITS, parseFalRequest, sanitizeMessages } from './proxy-guards'
import { createRateLimiter, getAuthToken, getSessionUser } from './server-auth'

function fakeReq(opts: { cookie?: string; auth?: string; origin?: string } = {}) {
  const headers = new Headers()
  if (opts.auth) headers.set('authorization', opts.auth)
  return {
    headers,
    cookies: { get: (n: string) => (n === 'qt_access_token' && opts.cookie ? { value: opts.cookie } : undefined) },
    nextUrl: { origin: opts.origin ?? 'https://app.example' },
  }
}

describe('copilot guards', () => {
  it('clamps max_tokens', () => {
    expect(clampMaxTokens(1_000_000)).toBe(COPILOT_LIMITS.maxTokens)
    expect(clampMaxTokens(-5)).toBe(1)
    expect(clampMaxTokens('lots')).toBe(1024)
    expect(clampMaxTokens(512)).toBe(512)
  })

  it('rejects malformed messages and bad roles', () => {
    expect(sanitizeMessages(undefined)).toBeNull()
    expect(sanitizeMessages([])).toBeNull()
    expect(sanitizeMessages([{ role: 'tool', content: 'x' }])).toBeNull()
    expect(sanitizeMessages([{ role: 'user', content: { evil: 1 } }])).toBeNull()
  })

  it('rejects oversized total content', () => {
    const big = 'a'.repeat(COPILOT_LIMITS.maxTotalChars + 1)
    expect(sanitizeMessages([{ role: 'user', content: big }])).toBeNull()
  })

  it('trims long histories but keeps the system prompt', () => {
    const msgs = [{ role: 'system', content: 'sys' }]
    for (let i = 0; i < 100; i++) msgs.push({ role: 'user', content: `m${i}` })
    const out = sanitizeMessages(msgs)!
    expect(out).toHaveLength(COPILOT_LIMITS.maxMessages)
    expect(out[0]).toEqual({ role: 'system', content: 'sys' })
    expect(out[out.length - 1]!.content).toBe('m99')
  })

  it('strips extra fields from messages', () => {
    expect(sanitizeMessages([{ role: 'user', content: 'hi', name: 'x' }])).toEqual([{ role: 'user', content: 'hi' }])
  })
})

describe('fal guards', () => {
  it('rejects models outside the allowlist (no path injection)', () => {
    expect(parseFalRequest({ prompt: 'x', model: 'fal-ai/some-expensive-video-model' })).toEqual({ error: 'Unsupported model' })
    expect(parseFalRequest({ prompt: 'x', model: '../../admin' })).toEqual({ error: 'Unsupported model' })
  })

  it('clamps dimensions and steps', () => {
    const r = parseFalRequest({ prompt: 'x', width: 99999, height: 1, steps: 500 })
    expect(r).toMatchObject({ model: 'fal-ai/flux/schnell', width: 1536, height: 256, steps: 8 })
  })

  it('accepts the app callers as-is', () => {
    expect(parseFalRequest({ prompt: 'x', width: 1200, height: 630, steps: 4 })).toMatchObject({ width: 1200, height: 630, steps: 4 })
    expect(parseFalRequest({ prompt: 'x', model: 'fal-ai/flux/dev', width: 768, height: 1024, steps: 6 })).toMatchObject({
      model: 'fal-ai/flux/dev',
      steps: 6,
    })
  })

  it('requires a prompt', () => {
    expect(parseFalRequest({})).toEqual({ error: 'prompt is required' })
  })
})

describe('server auth', () => {
  it('reads token from cookie, then Bearer header', () => {
    expect(getAuthToken(fakeReq({ cookie: 'c1' }))).toBe('c1')
    expect(getAuthToken(fakeReq({ auth: 'Bearer h1' }))).toBe('h1')
    expect(getAuthToken(fakeReq())).toBeNull()
  })

  it('returns null without a token and never calls the backend', async () => {
    const f = vi.fn()
    expect(await getSessionUser(fakeReq(), f as unknown as typeof fetch)).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('validates the token against /api/v1/auth/me', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: 7 }), { status: 200 }))
    const user = await getSessionUser(fakeReq({ cookie: 'tok' }), f as unknown as typeof fetch)
    expect(user).toEqual({ id: 7 })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/\/api\/v1\/auth\/me$/)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('fails closed on backend rejection or network error', async () => {
    const reject = vi.fn(async () => new Response('{}', { status: 401 }))
    expect(await getSessionUser(fakeReq({ cookie: 'bad' }), reject as unknown as typeof fetch)).toBeNull()
    const boom = vi.fn(async () => {
      throw new Error('down')
    })
    expect(await getSessionUser(fakeReq({ cookie: 'x' }), boom as unknown as typeof fetch)).toBeNull()
  })

  it('rate limiter blocks after limit and resets after window', () => {
    const check = createRateLimiter(2, 1000)
    expect(check('k', 0)).toBe(true)
    expect(check('k', 1)).toBe(true)
    expect(check('k', 2)).toBe(false)
    expect(check('other', 2)).toBe(true)
    expect(check('k', 1001)).toBe(true)
  })
})
