/**
 * Run `cb` once the main thread is idle (after hydration and first paint).
 * Falls back to a timeout where requestIdleCallback is missing (Safari).
 * Returns a cancel function, so it can be returned from a useEffect.
 */
export function onIdle(cb: () => void, timeout = 3000): () => void {
  if (typeof window === 'undefined') return () => {}
  const w = window as Window & {
    requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(cb, { timeout })
    return () => w.cancelIdleCallback?.(id)
  }
  const id = window.setTimeout(cb, 1200)
  return () => window.clearTimeout(id)
}
