'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Ban } from 'lucide-react'
import {
  fetchTickerIdentity,
  tickerBannerState,
  tickerIdentityQueryKey,
  type TickerIdentity,
} from '@/lib/tickerIdentity'

/** Shared query (desktop + mobile use the same cache key). */
export function useTickerIdentity(symbol: string) {
  return useQuery<TickerIdentity | null>({
    queryKey: tickerIdentityQueryKey(symbol),
    queryFn: () => fetchTickerIdentity(symbol),
    enabled: !!symbol,
    staleTime: 30 * 60_000,
    retry: false,
  })
}

/** Stands in for the quote / chart / technicals of a ticker that stopped trading. */
export function RetiredPricePlaceholder({ identity, compact = false }: { identity: TickerIdentity | null | undefined; compact?: boolean }) {
  const s = tickerBannerState(identity)
  if (!s?.hidePricePanels) return null
  return (
    <section
      data-testid="retired-price-placeholder"
      aria-label="Price data unavailable"
      className={`rs-card text-center text-fg-muted ${compact ? 'p-4 text-[12px]' : 'p-8 text-sm'}`}
    >
      <p className="font-medium text-fg-secondary">No current price data for {identity?.ticker}</p>
      <p className="mt-1">
        Quote, chart and technical indicators are hidden because this ticker no longer trades.
        {s.successorHref && (
          <>
            {' '}
            <Link href={s.successorHref} className="font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400">
              Open {s.successorSymbol}
            </Link>
          </>
        )}
      </p>
    </section>
  )
}

/**
 * Research banner for retired (stopped trading), reused (ticker now another
 * company) and stale-identity tickers. Desktop and mobile render the same
 * state from lib/tickerIdentity.tickerBannerState.
 */
export function TickerIdentityBanner({
  identity,
  compact = false,
}: {
  identity: TickerIdentity | null | undefined
  compact?: boolean
}) {
  const s = tickerBannerState(identity)
  if (!s) return null
  const inactive = s.kind === 'inactive'
  const tone = inactive
    ? 'border-red-500/40 bg-red-500/10 text-red-800 dark:text-red-200'
    : s.prominent
      ? 'border-amber-500/50 bg-amber-500/15 text-amber-900 dark:text-amber-100'
      : 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200'
  const Icon = inactive ? Ban : AlertTriangle
  return (
    <div
      role="alert"
      data-testid="ticker-identity-warning"
      data-banner-kind={s.kind}
      className={`flex items-start gap-2 rounded-lg border ${tone} ${compact ? 'px-3 py-2' : s.prominent ? 'px-4 py-3.5' : 'px-4 py-3'}`}
    >
      <Icon className={`shrink-0 mt-0.5 ${s.prominent && !compact ? 'w-5 h-5' : 'w-4 h-4'}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={`font-semibold ${compact ? 'text-[12px]' : s.prominent ? 'text-[15px]' : 'text-sm'}`}>{s.title}</p>
        <p className={`opacity-80 ${compact ? 'text-[11px] leading-snug' : 'text-xs'} mt-0.5`}>{s.body}</p>
        {s.dataQuality === 'limited' && (
          <span className="mt-1.5 inline-block rounded-full border border-current/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
            Data quality: limited
          </span>
        )}
        {s.successorHref && (
          <Link
            href={s.successorHref}
            data-testid="ticker-successor-link"
            className={`mt-1.5 ml-0 flex w-fit items-center gap-1 font-medium underline-offset-2 hover:underline ${
              compact ? 'text-[11px]' : 'text-xs'
            }`}
          >
            {inactive ? `Go to ${s.successorSymbol}` : `View ${s.successorSymbol}`} <ArrowRight className="w-3 h-3" aria-hidden />
          </Link>
        )}
      </div>
    </div>
  )
}
