'use client'

import { useEffect, useState } from 'react'

/**
 * Current time, available only after hydration.
 *
 * Rendering `new Date()` / `toLocale*()` during SSR produced different text on
 * the server (UTC, build/request time) and in the browser (local zone, later
 * time), which threw React hydration error #418 on the home page. Components
 * render a neutral placeholder while this is `null`, then the real value.
 *
 * @param refreshMs optional re-render interval (e.g. 60_000 for a clock).
 */
export function useClientNow(refreshMs?: number): Date | null {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    if (!refreshMs) return
    const id = setInterval(() => setNow(new Date()), refreshMs)
    return () => clearInterval(id)
  }, [refreshMs])
  return now
}
