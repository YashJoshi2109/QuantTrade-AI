'use client'

/**
 * For pages whose state lives in the URL (screener filters, compare tickers):
 * remember the last query string per user, and when the user comes back to
 * the bare path, put it back in the URL.
 *
 * Returns the query string the page should render from. While the restore is
 * in flight it already returns the saved one, so the page does not flash its
 * defaults (or fire a default query) first. A link with its own query string
 * always wins over the saved one.
 */
import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { usePersistentState } from './persistentState'

/** Keep only the params a page owns, in a stable order. */
export function pickParams(qs: string, allowed?: readonly string[]): string {
  if (!allowed) return qs.replace(/^\?/, '')
  const src = new URLSearchParams(qs)
  const out = new URLSearchParams()
  for (const k of allowed) {
    const v = src.get(k)
    if (v != null && v !== '') out.set(k, v)
  }
  return out.toString()
}

const isQs = (v: unknown) => (typeof v === 'string' && v.length <= 4000 && !/[\s#]/.test(v) ? v.replace(/^\?/, '') : undefined)

export function usePersistedQuery(key: string, currentQs: string, opts: { allowed?: readonly string[] } = {}): string {
  const router = useRouter()
  const pathname = usePathname()
  const qs = pickParams(currentQs, opts.allowed)
  const [saved, setSaved, ctl] = usePersistentState<string>(key, '', { version: 1, validate: isQs })
  const decided = useRef(false)
  // The saved query being put back into the URL (ref: read by the effect below in the same commit).
  const targetRef = useRef<string | null>(null)
  const [target, setTarget] = useState<string | null>(null)

  useEffect(() => {
    if (!ctl.restored || decided.current) return
    decided.current = true
    if (!qs && saved) {
      targetRef.current = saved
      setTarget(saved)
      router.replace(`${pathname}?${saved}`, { scroll: false })
    }
  }, [ctl.restored, qs, saved, router, pathname])

  // Remember the URL state once the restore decision is made.
  useEffect(() => {
    if (!decided.current) return
    if (targetRef.current !== null) {
      if (!qs) return // replace still in flight
      targetRef.current = null // landed (or the user moved on)
      setTarget(null)
    }
    setSaved(qs)
  }, [qs, target, setSaved])

  if (qs) return qs
  if (target) return target
  if (!decided.current && ctl.restored) return saved
  return qs
}
