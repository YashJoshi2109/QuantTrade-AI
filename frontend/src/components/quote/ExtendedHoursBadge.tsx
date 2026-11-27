'use client'

import { Moon } from 'lucide-react'
import type { ExtendedBadge } from '@/lib/canonicalQuote'
import { cn } from '@/lib/utils'

/**
 * Labelled extended-hours print ("After hours 423.01 +4.18%"), shown NEXT TO
 * the regular-session price, never in place of it. Shared by the desktop
 * research header and MobileResearch.
 */
export function ExtendedHoursBadge({ badge, className }: { badge?: ExtendedBadge | null; className?: string }) {
  if (!badge) return null
  const pct =
    badge.changePercent === null ? '' : `${badge.changePercent >= 0 ? '+' : ''}${badge.changePercent.toFixed(2)}%`
  const when = badge.time
    ? new Date(badge.time).toLocaleString('en-US', {
        timeZone: 'America/New_York',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }) + ' ET'
    : undefined
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-line-subtle bg-surface-raised px-2 py-0.5 font-mono text-[11px] text-fg-muted',
        className,
      )}
      title={`${badge.label} trade${when ? ` at ${when}` : ''}, vs the regular-session close`}
      aria-label={badge.text}
      data-testid="extended-hours-badge"
    >
      <Moon className="h-3 w-3" aria-hidden />
      <span>{badge.label}</span>
      <span className="text-fg-primary">{badge.price.toFixed(2)}</span>
      {pct && <span className={badge.up ? 'text-emerald-400' : 'text-red-400'}>{pct}</span>}
    </span>
  )
}
