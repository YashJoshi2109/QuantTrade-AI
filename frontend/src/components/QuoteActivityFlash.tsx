'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Replaces generic “live pulse” dots: on each refresh, briefly flashes green (bid up)
 * or red (bid down) from a numeric fingerprint of the latest quote snapshot.
 */
export function QuoteActivityFlash({
  fingerprint,
  className = '',
}: {
  /** Changes when underlying prices / movers refresh — e.g. avg of top movers */
  fingerprint: number
  className?: string
}) {
  const prev = useRef<number | null>(null)
  const [flash, setFlash] = useState<'up' | 'down' | null>(null)

  useEffect(() => {
    if (!Number.isFinite(fingerprint)) return
    if (prev.current === null) {
      prev.current = fingerprint
      return
    }
    if (prev.current === fingerprint) return
    const delta = fingerprint - prev.current
    prev.current = fingerprint
    setFlash(delta >= 0 ? 'up' : 'down')
    const t = window.setTimeout(() => setFlash(null), 650)
    return () => window.clearTimeout(t)
  }, [fingerprint])

  return (
    <span
      className={`relative inline-flex h-2 w-2 shrink-0 rounded-full ${className}`}
      aria-hidden
      title="Quote activity"
    >
      <span
        className={`absolute inset-0 rounded-full transition-colors duration-200 ${
          flash === 'up'
            ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.85)]'
            : flash === 'down'
              ? 'bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.85)]'
              : 'bg-slate-600'
        }`}
      />
    </span>
  )
}

export function moversActivityFingerprint(movers: {
  gainers?: { change_percent?: number }[]
  losers?: { change_percent?: number }[]
  actives?: { change_percent?: number }[]
} | null | undefined): number {
  const g = movers?.gainers?.slice(0, 3) ?? []
  const l = movers?.losers?.slice(0, 3) ?? []
  const a = movers?.actives?.slice(0, 2) ?? []
  const sum = (rows: { change_percent?: number }[]) =>
    rows.reduce((acc, r) => acc + (Number.isFinite(r.change_percent) ? r.change_percent! : 0), 0)
  const v = (sum(g) * 100 + sum(l) * 100 + sum(a) * 100) / 100
  return Math.round(v * 1000) / 1000
}
