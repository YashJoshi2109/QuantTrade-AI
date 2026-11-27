'use client'

import { Loader2, RefreshCw, CloudOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ResearchStatusResult } from '@/lib/researchData'

/**
 * Calm "we're working on it" banner for the Research header (desktop + mobile).
 * Shown only when a core source failed; says which, what real fallback is on
 * screen (source + as-of time), and offers a manual retry on top of the
 * automatic backoff.
 */
export function ResearchStatusBanner({
  status,
  className,
  compact = false,
}: {
  status: Pick<ResearchStatusResult, 'kind' | 'headline' | 'detail' | 'retry' | 'retrying' | 'rateLimited'>
  className?: string
  compact?: boolean
}) {
  if (status.kind !== 'degraded' && status.kind !== 'unavailable') return null
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="research-status-banner"
      data-kind={status.kind}
      className={cn(
        'flex items-start gap-3 rounded-xl border px-3.5 py-3',
        'border-amber-500/30 bg-amber-50 text-amber-900',
        'dark:border-amber-400/25 dark:bg-[#1d1708] dark:text-amber-100',
        className,
      )}
    >
      <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={cn('font-semibold leading-snug', compact ? 'text-[13px]' : 'text-sm')}>{status.headline}</p>
        <p className={cn('mt-0.5 leading-snug text-amber-800 dark:text-amber-200/80', compact ? 'text-[12px]' : 'text-[13px]')}>
          {status.detail}
        </p>
      </div>
      <button
        type="button"
        onClick={status.retry}
        disabled={status.retrying}
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors',
          'border-amber-600/30 bg-white text-amber-900 hover:bg-amber-100',
          'dark:border-amber-300/30 dark:bg-transparent dark:text-amber-100 dark:hover:bg-amber-300/10',
          'disabled:cursor-wait disabled:opacity-70',
          compact && 'min-h-[36px]',
        )}
      >
        {status.retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
        {status.retrying ? 'Retrying' : 'Retry'}
      </button>
    </div>
  )
}
