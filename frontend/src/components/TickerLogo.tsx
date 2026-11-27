'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  acquireLogoSlot,
  isLogoMiss,
  isLogoOk,
  logoProxyUrl,
  markLogoMiss,
  markLogoOk,
} from '@/lib/logoCache'

/**
 * Candidate image URLs, in order: an explicit `logoSrc` the API returned, then our
 * same-origin `/api/logo` proxy (server-side cache over Logo.dev / FMP / Finnhub).
 * No client-side guessing of third-party URLs: every miss falls straight to initials.
 * URLs already known to miss (this session or the last day) are skipped.
 */
export function logoCandidates(ticker: string, explicitSrc?: string | null): string[] {
  if (!ticker) return []
  const out: string[] = []
  const direct = explicitSrc?.trim()
  if (direct) out.push(direct)
  const proxy = logoProxyUrl(ticker)
  if (!out.includes(proxy)) out.push(proxy)
  return out.filter((u) => !isLogoMiss(u))
}

function Initials({ ticker, size, className }: { ticker: string; size: number; className: string }) {
  return (
    <div
      className={`flex items-center justify-center rounded-lg bg-surface-raised/80 border border-line-subtle text-fg-muted font-bold shrink-0 ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden
    >
      {ticker.slice(0, 2)}
    </div>
  )
}

/**
 * Ticker logo with an initials fallback. The image is requested only once the logo is
 * near the viewport, through a shared concurrency limiter, and a miss is remembered so
 * no other row (or later visit) asks for the same symbol again.
 */
export default function TickerLogo({
  symbol,
  size = 28,
  className = '',
  logoSrc,
}: {
  symbol: string
  size?: number
  className?: string
  /** Kept for call-site compatibility; names are no longer used to guess logo URLs. */
  companyName?: string | null
  logoSrc?: string | null
}) {
  const ticker = symbol?.toUpperCase().replace(/[^A-Z0-9]/g, '') || ''
  const urls = useMemo(() => logoCandidates(ticker, logoSrc), [ticker, logoSrc])
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(false)
  // The URL that currently holds a limiter slot (or was a known hit), and the one that loaded.
  const [grantedFor, setGrantedFor] = useState<string | null>(null)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const holder = useRef<HTMLSpanElement>(null)
  const release = useRef<(() => void) | null>(null)

  const src = index < urls.length ? urls[index] : null

  useEffect(() => {
    setIndex(0)
  }, [ticker, logoSrc])

  // Defer the request until the logo is (nearly) on screen.
  useEffect(() => {
    if (visible || !src) return
    const el = holder.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible, src])

  // Take a slot from the shared limiter before rendering the <img>. Known hits are
  // already in the browser cache, so they skip the queue.
  useEffect(() => {
    if (!visible || !src) return
    if (isLogoOk(src)) {
      setGrantedFor(src)
      return
    }
    const rel = acquireLogoSlot(() => setGrantedFor(src))
    release.current = rel
    return () => {
      rel()
      if (release.current === rel) release.current = null
    }
  }, [visible, src])

  if (!ticker) return null
  if (!src) return <Initials ticker={ticker} size={size} className={className} />

  const settle = () => {
    release.current?.()
    release.current = null
  }
  const loaded = loadedFor === src

  return (
    <span
      ref={holder}
      className={`relative inline-flex shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      {!loaded && (
        <span className="absolute inset-0">
          <Initials ticker={ticker} size={size} className="" />
        </span>
      )}
      {visible && grantedFor === src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt={`${ticker} logo`}
          width={size}
          height={size}
          decoding="async"
          className="relative rounded-lg object-contain"
          style={{ width: size, height: size, opacity: loaded ? 1 : 0 }}
          onLoad={() => {
            markLogoOk(src)
            settle()
            setLoadedFor(src)
          }}
          onError={() => {
            markLogoMiss(src)
            settle()
            setIndex((i) => i + 1)
          }}
          referrerPolicy="no-referrer"
        />
      )}
    </span>
  )
}

export function TickerBadge({
  symbol,
  name,
  size = 24,
  className = '',
  showName = false,
}: {
  symbol: string
  name?: string
  size?: number
  className?: string
  showName?: boolean
}) {
  return (
    <div className={`flex items-center gap-2 min-w-0 ${className}`}>
      <TickerLogo symbol={symbol} companyName={name} size={size} />
      <div className="flex flex-col min-w-0">
        <span className="text-xs font-bold text-white truncate">{symbol?.toUpperCase()}</span>
        {showName && name && (
          <span className="text-[10px] text-fg-muted truncate leading-tight">{name}</span>
        )}
      </div>
    </div>
  )
}
