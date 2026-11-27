/**
 * Server-side logo resolution for the `/api/logo` proxy.
 *
 * Sources, in order (each with a short timeout):
 *   1. Logo.dev ticker endpoint, only when LOGO_DEV_PUBLISHABLE_KEY / NEXT_PUBLIC_LOGO_DEV_TOKEN
 *      is set (`fallback=404` so it never returns a generated monogram).
 *   2. FMP's public logo CDN (no key; covers most US stocks and ETFs, 404 when unknown).
 *   3. Finnhub profile2 `logo`, only when FINNHUB_API_KEY is set (60 req/min, so last).
 *
 * Results are cached in-process: hits (bounded LRU by count and bytes) and misses
 * (TTL; definitive misses longer than transient ones). Concurrent requests for the same
 * symbol share one upstream lookup.
 */

export const HIT_CACHE_CONTROL = 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400'
export const MISS_CACHE_CONTROL = 'public, max-age=86400, s-maxage=86400'
export const TRANSIENT_CACHE_CONTROL = 'public, max-age=300, s-maxage=300'

export type LogoResult =
  | { kind: 'hit'; body: ArrayBuffer; contentType: string; source: string }
  | { kind: 'miss' } // every source answered "no logo"
  | { kind: 'transient' } // at least one source errored / timed out / rate-limited

/** Upstream answer: an image, a definitive "none", or an error worth retrying later. */
type SourceAnswer = { image: { body: ArrayBuffer; contentType: string } } | 'none' | 'error'
type Source = { name: string; fetch: (symbol: string) => Promise<SourceAnswer> }

const UPSTREAM_TIMEOUT_MS = 3500
const MAX_IMAGE_BYTES = 512 * 1024
const HIT_MAX_ENTRIES = 1000
const HIT_MAX_BYTES = 24 * 1024 * 1024
export const MISS_TTL_MS = 12 * 60 * 60 * 1000
export const TRANSIENT_TTL_MS = 5 * 60 * 1000
const UA = 'QuantTrade-NextLogoProxy/1.1'

async function fetchImage(url: string, fetcher: typeof fetch): Promise<SourceAnswer> {
  try {
    const r = await fetcher(url, {
      headers: { Accept: 'image/*', 'User-Agent': UA },
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
    if (r.status === 404 || r.status === 400 || r.status === 410) return 'none'
    if (!r.ok) return 'error'
    const ct = r.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || ''
    if (!ct.startsWith('image/')) return 'none'
    const body = await r.arrayBuffer()
    if (body.byteLength < 64 || body.byteLength > MAX_IMAGE_BYTES) return 'none'
    return { image: { body, contentType: ct } }
  } catch {
    return 'error'
  }
}

export function defaultSources(env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch): Source[] {
  const out: Source[] = []
  const logoDevKey = env.LOGO_DEV_PUBLISHABLE_KEY?.trim() || env.NEXT_PUBLIC_LOGO_DEV_TOKEN?.trim() || ''
  if (logoDevKey) {
    out.push({
      name: 'logo.dev',
      fetch: (s) =>
        fetchImage(
          `https://img.logo.dev/ticker/${encodeURIComponent(s)}?token=${encodeURIComponent(logoDevKey)}&fallback=404`,
          fetcher,
        ),
    })
  }
  out.push({
    name: 'fmp',
    fetch: (s) => fetchImage(`https://financialmodelingprep.com/image-stock/${encodeURIComponent(s)}.png`, fetcher),
  })
  const finnhubKey = env.FINNHUB_API_KEY?.trim() || ''
  if (finnhubKey) {
    out.push({
      name: 'finnhub',
      fetch: async (s) => {
        try {
          const prof = await fetcher(
            `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(s)}&token=${encodeURIComponent(finnhubKey)}`,
            { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) },
          )
          if (!prof.ok) return prof.status === 404 ? 'none' : 'error'
          const data = (await prof.json().catch(() => null)) as { logo?: unknown } | null
          const logo = typeof data?.logo === 'string' ? data.logo.trim() : ''
          if (!logo.startsWith('https://')) return 'none'
          return fetchImage(logo, fetcher)
        } catch {
          return 'error'
        }
      },
    })
  }
  return out
}

export function createLogoResolver(opts: { sources: () => Source[]; now?: () => number }) {
  const now = opts.now ?? Date.now
  const hits = new Map<string, Extract<LogoResult, { kind: 'hit' }>>() // insertion order = LRU
  let hitBytes = 0
  const misses = new Map<string, { kind: 'miss' | 'transient'; until: number }>()
  const inflight = new Map<string, Promise<LogoResult>>()

  function rememberHit(symbol: string, r: Extract<LogoResult, { kind: 'hit' }>) {
    const prev = hits.get(symbol)
    if (prev) {
      hitBytes -= prev.body.byteLength
      hits.delete(symbol)
    }
    hits.set(symbol, r)
    hitBytes += r.body.byteLength
    while (hits.size > HIT_MAX_ENTRIES || hitBytes > HIT_MAX_BYTES) {
      const oldest = hits.keys().next().value as string | undefined
      if (oldest === undefined) break
      hitBytes -= hits.get(oldest)!.body.byteLength
      hits.delete(oldest)
    }
  }

  async function lookup(symbol: string): Promise<LogoResult> {
    let transient = false
    for (const src of opts.sources()) {
      const a = await src.fetch(symbol)
      if (a === 'error') {
        transient = true
        continue
      }
      if (a === 'none') continue
      return { kind: 'hit', body: a.image.body, contentType: a.image.contentType, source: src.name }
    }
    return transient ? { kind: 'transient' } : { kind: 'miss' }
  }

  async function resolve(symbol: string): Promise<LogoResult> {
    const hit = hits.get(symbol)
    if (hit) {
      hits.delete(symbol)
      hits.set(symbol, hit) // refresh LRU position
      return hit
    }
    const miss = misses.get(symbol)
    if (miss) {
      if (miss.until > now()) return { kind: miss.kind }
      misses.delete(symbol)
    }
    const pending = inflight.get(symbol)
    if (pending) return pending
    const p = lookup(symbol)
      .then((r) => {
        if (r.kind === 'hit') rememberHit(symbol, r)
        else misses.set(symbol, { kind: r.kind, until: now() + (r.kind === 'miss' ? MISS_TTL_MS : TRANSIENT_TTL_MS) })
        if (misses.size > 20000) misses.clear()
        return r
      })
      .finally(() => inflight.delete(symbol))
    inflight.set(symbol, p)
    return p
  }

  return { resolve, stats: () => ({ hits: hits.size, hitBytes, misses: misses.size, inflight: inflight.size }) }
}

const shared = createLogoResolver({ sources: () => defaultSources() })

export function resolveLogo(symbol: string): Promise<LogoResult> {
  return shared.resolve(symbol)
}
