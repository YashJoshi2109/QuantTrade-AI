// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { MISS_TTL_MS, TRANSIENT_TTL_MS, createLogoResolver, defaultSources } from './logoResolver'

const png = (n = 200) => new Uint8Array(n).fill(1).buffer

function fakeFetch(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: string[] = []
  const f = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const key = Object.keys(routes).find((k) => url.includes(k))
    if (!key) return new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } })
    return routes[key]()
  }) as unknown as typeof fetch
  return { f, calls }
}

const img = () => new Response(png(), { status: 200, headers: { 'content-type': 'image/png' } })

describe('logoResolver', () => {
  it('returns the first source with an image and caches the hit', async () => {
    const { f, calls } = fakeFetch({ 'image-stock/AAPL.png': img })
    const r = createLogoResolver({ sources: () => defaultSources({}, f) })
    const a = await r.resolve('AAPL')
    expect(a.kind).toBe('hit')
    if (a.kind === 'hit') {
      expect(a.source).toBe('fmp')
      expect(a.contentType).toBe('image/png')
    }
    await r.resolve('AAPL')
    expect(calls).toHaveLength(1)
  })

  it('caches a definitive miss and does not ask upstream again until the TTL passes', async () => {
    let t = 1_000
    const { f, calls } = fakeFetch({})
    const r = createLogoResolver({ sources: () => defaultSources({}, f), now: () => t })
    expect((await r.resolve('CRY')).kind).toBe('miss')
    expect((await r.resolve('CRY')).kind).toBe('miss')
    expect(calls).toHaveLength(1)
    t += MISS_TTL_MS + 1
    await r.resolve('CRY')
    expect(calls).toHaveLength(2)
  })

  it('treats upstream errors as transient with a short TTL', async () => {
    let t = 0
    const { f, calls } = fakeFetch({ 'image-stock/MUY.png': () => new Response('rate limited', { status: 429 }) })
    const r = createLogoResolver({ sources: () => defaultSources({}, f), now: () => t })
    expect((await r.resolve('MUY')).kind).toBe('transient')
    await r.resolve('MUY')
    expect(calls).toHaveLength(1)
    t += TRANSIENT_TTL_MS + 1
    await r.resolve('MUY')
    expect(calls).toHaveLength(2)
  })

  it('rejects non-image bodies (HTML error pages) as a miss', async () => {
    const { f } = fakeFetch({
      'image-stock/X.png': () => new Response('<html>'.repeat(200), { status: 200, headers: { 'content-type': 'text/html' } }),
    })
    const r = createLogoResolver({ sources: () => defaultSources({}, f) })
    expect((await r.resolve('X')).kind).toBe('miss')
  })

  it('shares one upstream lookup between concurrent requests', async () => {
    const { f, calls } = fakeFetch({ 'image-stock/SPY.png': img })
    const r = createLogoResolver({ sources: () => defaultSources({}, f) })
    const out = await Promise.all([r.resolve('SPY'), r.resolve('SPY'), r.resolve('SPY')])
    expect(out.every((o) => o.kind === 'hit')).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('asks logo.dev with fallback=404 first when a key is set, then falls through', async () => {
    const { f, calls } = fakeFetch({ 'image-stock/JEPI.png': img })
    const r = createLogoResolver({ sources: () => defaultSources({ LOGO_DEV_PUBLISHABLE_KEY: 'pk' }, f) })
    const a = await r.resolve('JEPI')
    expect(a.kind === 'hit' && a.source).toBe('fmp')
    expect(calls[0]).toContain('img.logo.dev/ticker/JEPI')
    expect(calls[0]).toContain('fallback=404')
  })

  it('uses Finnhub profile2 logo as the last source', async () => {
    const { f, calls } = fakeFetch({
      'finnhub.io/api/v1/stock/profile2': () => Response.json({ logo: 'https://static2.finnhub.io/logo/abc.png' }),
      'static2.finnhub.io/logo/abc.png': img,
    })
    const r = createLogoResolver({ sources: () => defaultSources({ FINNHUB_API_KEY: 'k' }, f) })
    const a = await r.resolve('ZZZ')
    expect(a.kind === 'hit' && a.source).toBe('finnhub')
    expect(calls).toHaveLength(3)
  })
})
