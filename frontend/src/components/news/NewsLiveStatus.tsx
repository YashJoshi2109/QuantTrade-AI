'use client'

import type { UseNewsFeedResult } from '@/hooks/useNewsFeed'

/** Small "Live · 4s delay" / "Polling 60s" indicator shared by every news surface. */
export function NewsLiveStatus({
  feed,
  className = '',
}: {
  feed: Pick<UseNewsFeedResult, 'isLive' | 'lagSeconds' | 'mode' | 'socketStatus'>
  className?: string
}) {
  const { isLive, lagSeconds, mode } = feed
  const label = isLive
    ? `Live${lagSeconds != null ? ` · ${lagSeconds}s delay` : ''}`
    : mode === 'legacy'
      ? 'Auto-refresh 60s'
      : feed.socketStatus === 'connecting'
        ? 'Connecting…'
        : 'Auto-refresh 60s'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
        isLive ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-line-subtle bg-surface-raised text-fg-muted'
      } ${className}`}
      title={mode === 'legacy' ? 'Unified feed not available yet — showing legacy headlines' : undefined}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${isLive ? 'bg-emerald-400 motion-safe:animate-pulse' : 'bg-fg-muted'}`}
        aria-hidden
      />
      {label}
    </span>
  )
}

/** Polite, visually hidden live region; the hook rate-limits the text. */
export function NewsLiveRegion({ message }: { message: string }) {
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  )
}
