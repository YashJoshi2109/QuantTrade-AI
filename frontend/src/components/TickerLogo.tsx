'use client'

import { useState } from 'react'
import { TrendingUp } from 'lucide-react'

const LOGO_DEV_TOKEN = 'pk_XK6bTK58Timdy18G_vTb1A'

/**
 * Ticker logo using img.logo.dev API.
 * Falls back to a styled letter badge if the logo fails to load.
 */
export default function TickerLogo({
  symbol,
  size = 28,
  className = '',
}: {
  symbol: string
  size?: number
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const ticker = symbol?.toUpperCase().replace(/[^A-Z0-9]/g, '') || ''

  if (!ticker) return null

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg bg-slate-800/80 border border-slate-700/50 text-slate-400 font-bold shrink-0 ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.38 }}
      >
        {ticker.slice(0, 2)}
      </div>
    )
  }

  return (
    <img
      src={`https://img.logo.dev/ticker/${ticker}?token=${LOGO_DEV_TOKEN}`}
      alt={`${ticker} logo`}
      width={size}
      height={size}
      className={`rounded-lg object-contain shrink-0 ${className}`}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  )
}

/**
 * Compact inline ticker badge with logo + symbol text.
 * Used in watchlists, movers, basket holdings, etc.
 */
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
      <TickerLogo symbol={symbol} size={size} />
      <div className="flex flex-col min-w-0">
        <span className="text-xs font-bold text-white truncate">{symbol?.toUpperCase()}</span>
        {showName && name && (
          <span className="text-[10px] text-slate-500 truncate leading-tight">{name}</span>
        )}
      </div>
    </div>
  )
}
