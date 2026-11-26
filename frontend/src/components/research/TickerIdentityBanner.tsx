'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import {
  fetchTickerIdentity,
  identityWarning,
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

/** Warning shown on the Research views when a ticker's identity is stale or mismatched. */
export function TickerIdentityBanner({
  identity,
  compact = false,
}: {
  identity: TickerIdentity | null | undefined
  compact?: boolean
}) {
  const w = identityWarning(identity)
  if (!w) return null
  return (
    <div
      role="alert"
      data-testid="ticker-identity-warning"
      className={`flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 ${
        compact ? 'px-3 py-2' : 'px-4 py-3'
      }`}
    >
      <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={`font-semibold text-amber-200 ${compact ? 'text-[12px]' : 'text-sm'}`}>{w.title}</p>
        <p className={`text-amber-200/80 ${compact ? 'text-[11px] leading-snug' : 'text-xs'} mt-0.5`}>{w.body}</p>
        {w.successorHref && (
          <Link
            href={w.successorHref}
            className={`mt-1.5 inline-flex items-center gap-1 font-medium text-amber-300 hover:text-amber-200 underline-offset-2 hover:underline ${
              compact ? 'text-[11px]' : 'text-xs'
            }`}
          >
            View {w.successorSymbol} <ArrowRight className="w-3 h-3" aria-hidden />
          </Link>
        )}
      </div>
    </div>
  )
}
