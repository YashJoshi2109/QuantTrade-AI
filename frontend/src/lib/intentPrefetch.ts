/**
 * Intent-based route prefetching for navigation chrome (sidebar, bottom nav,
 * More menu, header, footer, admin nav).
 *
 * Why: Next 16's segment cache turns every viewport-visible <Link> into ~4
 * `_rsc` requests (/_tree, /_head, layout segment, page segment). The desktop
 * sidebar alone showed ~16 routes on load, i.e. ~63 RSC requests per page view
 * for routes the visitor mostly never opens.
 *
 * What: nav links render with `prefetch={false}` and call `prefetchOnce` on
 * hover / focus / touchstart. Each href is prefetched at most once per
 * session (module-level set), so re-hovering or re-rendering never refetches.
 */
import { useMemo } from 'react'
import { useRouter } from 'next/navigation'

export interface Prefetcher {
  prefetch: (href: string) => void
}

const prefetched = new Set<string>()

/**
 * Normalise an href to the key Next caches prefetches by (path + search, no
 * hash). Returns null for anything that is not an in-app route.
 */
export function prefetchKey(href: string | null | undefined): string | null {
  if (!href) return null
  const trimmed = href.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null
  const noHash = trimmed.split('#')[0]
  return noHash || null
}

/**
 * Prefetch `href` through the router unless it was already prefetched this
 * session. Returns true when a prefetch was issued.
 */
export function prefetchOnce(router: Prefetcher, href: string | null | undefined): boolean {
  const key = prefetchKey(href)
  if (!key || prefetched.has(key)) return false
  prefetched.add(key)
  try {
    router.prefetch(key)
  } catch {
    // A failed prefetch only costs speed; the click still navigates. Allow a retry.
    prefetched.delete(key)
    return false
  }
  return true
}

/** Test-only: forget which hrefs were prefetched. */
export function __resetPrefetchedForTests(): void {
  prefetched.clear()
}

export interface IntentPrefetchHandlers {
  onMouseEnter: () => void
  onFocus: () => void
  onTouchStart: () => void
}

/** Hover / focus / touchstart handlers that prefetch `href` once. */
export function useIntentPrefetch(href: string | null | undefined): IntentPrefetchHandlers {
  const router = useRouter()
  return useMemo(() => {
    const fire = () => {
      prefetchOnce(router, href)
    }
    return { onMouseEnter: fire, onFocus: fire, onTouchStart: fire }
  }, [router, href])
}
