'use client'

/**
 * Animated number for stat cards: eases from the previous value to the new one.
 * Returns the target unchanged when the user prefers reduced motion, on the
 * server, or when the target is unknown (null), so "—" never animates.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const useIso = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** easeOutCubic interpolation, t in [0, 1]. */
export function countUpValue(from: number, to: number, t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return from + (to - from) * (1 - Math.pow(1 - c, 3))
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return true
  }
}

export function useCountUp(target: number | null | undefined, durationMs = 700): number | null {
  const known = typeof target === 'number' && Number.isFinite(target)
  const [shown, setShown] = useState<number | null>(known ? target : null)
  const from = useRef<number>(0)

  useIso(() => {
    if (!known) {
      setShown(null)
      return
    }
    const to = target as number
    if (prefersReducedMotion() || durationMs <= 0) {
      from.current = to
      setShown(to)
      return
    }
    const start = performance.now()
    const a = from.current
    let raf = 0
    setShown(a)
    const step = (now: number) => {
      const t = (now - start) / durationMs
      const v = countUpValue(a, to, t)
      setShown(v)
      if (t < 1) raf = requestAnimationFrame(step)
      else from.current = to
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      from.current = to
    }
  }, [known, target, durationMs])

  return known ? shown : null
}
