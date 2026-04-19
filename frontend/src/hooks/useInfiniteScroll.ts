import { useRef, useEffect, useCallback } from 'react'

/**
 * IntersectionObserver-based infinite scroll hook.
 * Returns a ref to attach to a sentinel element at the bottom of the list.
 * Debounced to prevent double-loading.
 */
export function useInfiniteScroll(
  callback: () => void,
  hasMore: boolean,
  options?: { rootMargin?: string; disabled?: boolean }
) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef(false)

  const stableCallback = useCallback(() => {
    if (debounceRef.current || !hasMore) return
    debounceRef.current = true
    callback()
    // Reset debounce after a short delay
    setTimeout(() => {
      debounceRef.current = false
    }, 300)
  }, [callback, hasMore])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || options?.disabled) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore) {
          stableCallback()
        }
      },
      { rootMargin: options?.rootMargin ?? '200px' }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, stableCallback, options?.rootMargin, options?.disabled])

  return sentinelRef
}
