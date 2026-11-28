/**
 * Server-side (RSC / generateMetadata) reads of public backend endpoints.
 * Results are cached by Next for `revalidate` seconds, so crawlers and
 * metadata generation do not hit the backend on every request.
 */

export function serverBackendBase(): string {
  const configured = process.env.BACKEND_INTERNAL_URL || process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || ''
  return configured.replace(/\/$/, '')
}

export type ServerFetchResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'not_found' }
  /** Backend unreachable / 5xx / not configured: do not treat as missing. */
  | { status: 'unavailable' }

export async function serverGetJson<T>(path: string, revalidate = 300): Promise<ServerFetchResult<T>> {
  const base = serverBackendBase()
  if (!base) return { status: 'unavailable' }
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { Accept: 'application/json' },
      next: { revalidate },
      signal: AbortSignal.timeout(4000),
    })
    if (res.status === 404 || res.status === 410) return { status: 'not_found' }
    if (!res.ok) return { status: 'unavailable' }
    return { status: 'ok', data: (await res.json()) as T }
  } catch {
    return { status: 'unavailable' }
  }
}

/** Plain-text excerpt for meta descriptions: strips markdown/HTML, collapses space, cuts on a word. */
export function excerpt(text: string | null | undefined, max = 155): string {
  const plain = (text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>|~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (plain.length <= max) return plain
  const cut = plain.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:]+$/, '')}…`
}

/** Title cut to fit `max` chars (page part, before the " | QuantTrade AI" suffix). */
export function clampTitle(text: string, max = 44): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:]+$/, '')}…`
}
