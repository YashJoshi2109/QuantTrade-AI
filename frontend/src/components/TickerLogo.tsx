'use client'

import { useEffect, useMemo, useState } from 'react'

/**
 * Derive a TradingView `s3-symbol-logo` slug from a Yahoo-style company name.
 */
function tradingViewSlugFromCompanyName(name: string): string | null {
  let s = name.trim().toLowerCase()
  if (!s) return null
  s = s.replace(/&/g, 'and')
  for (;;) {
    const next = s
      .replace(
        /\s*,?\s*(incorporated|inc\.?|corp\.?|corporation|plc|ltd\.?|limited|s\.a\.|s\.p\.a\.|n\.v\.|n\.v\b|se\b|ag\b|spa\b|holdings?|holding|group|co\.|company)\s*$/i,
        '',
      )
      .trim()
    if (next === s) break
    s = next
  }
  s = s.replace(/[''`]/g, '')
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s.length >= 2 ? s : null
}

function tradingViewSlugCandidates(name: string): string[] {
  const full = tradingViewSlugFromCompanyName(name)
  if (!full) return []
  const parts = full.split('-').filter(Boolean)
  const out: string[] = []
  for (let n = parts.length; n >= 1; n--) {
    const slug = parts.slice(0, n).join('-')
    if (slug.length >= 2) out.push(slug)
  }
  return Array.from(new Set(out))
}

/** Same-origin Next proxy (backend + Logo.dev + Finnhub fallbacks on server). */
function nextLogoProxyUrl(ticker: string): string {
  return `/api/logo?symbol=${encodeURIComponent(ticker)}`
}

function buildLogoCandidateUrls(
  ticker: string,
  companyName: string | null | undefined,
  explicitSrc: string | null | undefined,
): string[] {
  const out: string[] = []
  const push = (u: string) => {
    if (u && !out.includes(u)) out.push(u)
  }

  const direct = explicitSrc?.trim()
  if (direct) push(direct)

  push(nextLogoProxyUrl(ticker))

  const pub = process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN?.trim()
  if (pub) {
    push(
      `https://img.logo.dev/ticker/${encodeURIComponent(ticker)}?token=${encodeURIComponent(pub)}`,
    )
  }

  for (const slug of tradingViewSlugCandidates(companyName || '')) {
    push(`https://s3-symbol-logo.tradingview.com/${slug}.svg`)
    push(`https://s3-symbol-logo.tradingview.com/${slug}--big.svg`)
  }

  return out
}

/**
 * Ticker logos: `/api/logo` (server proxies Logo.dev / Finnhub / backend), optional
 * `NEXT_PUBLIC_LOGO_DEV_TOKEN`, then TradingView name slugs. No hardcoded API keys in client code.
 */
export default function TickerLogo({
  symbol,
  size = 28,
  className = '',
  companyName,
  logoSrc,
}: {
  symbol: string
  size?: number
  className?: string
  companyName?: string | null
  logoSrc?: string | null
}) {
  const ticker = symbol?.toUpperCase().replace(/[^A-Z0-9]/g, '') || ''
  const urls = useMemo(
    () => (ticker ? buildLogoCandidateUrls(ticker, companyName, logoSrc) : []),
    [ticker, companyName, logoSrc],
  )

  const [index, setIndex] = useState(0)

  useEffect(() => {
    setIndex(0)
  }, [ticker, urls.join('|')])

  if (!ticker) return null

  if (!urls.length || index >= urls.length) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg bg-surface-raised/80 border border-line-subtle text-fg-muted font-bold shrink-0 ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.38 }}
      >
        {ticker.slice(0, 2)}
      </div>
    )
  }

  const src = urls[index]

  return (
    <img
      key={src}
      src={src}
      alt={`${ticker} logo`}
      width={size}
      height={size}
      className={`rounded-lg object-contain shrink-0 ${className}`}
      style={{ width: size, height: size }}
      onError={() => setIndex((i) => i + 1)}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
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
