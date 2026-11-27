'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { formatResetsIn, type UsageMeter } from '@/lib/copilot-usage'
import { cn } from '@/lib/utils'

/**
 * Header usage meter: the binding limit (requests or token budget), in words.
 * Click/Enter opens a short explanation with the reset time. No colour alarms:
 * a low allowance turns the bar amber, an empty one shows the reset time.
 */
export default function CopilotUsageMeter({
  meter,
  resetsAt,
  now,
  isPro,
  onUpgrade,
  compact,
}: {
  meter: UsageMeter
  /** Absolute reset time (ms epoch) so the countdown stays right between fetches. */
  resetsAt: number | null
  now: number
  isPro?: boolean
  onUpgrade?: () => void
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (meter.state === 'unknown') {
    return <span className="text-[13px] text-[var(--cp-ink-3)]" aria-hidden>&nbsp;</span>
  }

  const secondsLeft = resetsAt != null ? Math.max(0, (resetsAt - now) / 1000) : meter.resetsInSeconds
  const resets = formatResetsIn(secondsLeft)
  const empty = meter.state === 'exhausted' || meter.state === 'paused'
  const short = empty
    ? compact ? resets.replace('resets in ', 'Resets in ') : `${meter.headline}, ${resets}`
    : compact && meter.questionsLeft != null
      ? `${meter.estimated ? '~' : ''}${meter.questionsLeft} left`
      : meter.headline
  const pct = meter.fractionLeft == null ? null : Math.round(meter.fractionLeft * 100)

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`AI allowance: ${meter.headline}. ${resets}. Show details`}
        className={cn(
          'flex min-h-[36px] items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium tabular-nums transition-colors',
          'text-[var(--cp-ink-2)] hover:bg-[var(--cp-sunken)]',
          empty && 'text-[var(--cp-caution-ink)]',
        )}
      >
        {pct != null && !empty && (
          <span aria-hidden className="relative h-1.5 w-10 overflow-hidden rounded-full bg-[var(--cp-line)]">
            <span
              className={cn('absolute inset-y-0 left-0 rounded-full', meter.state === 'low' ? 'bg-[var(--cp-caution-ink)]' : 'bg-[var(--cp-accent)]')}
              style={{ width: `${Math.max(4, pct)}%` }}
            />
          </span>
        )}
        <span className="whitespace-nowrap">{short}</span>
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="AI allowance details"
          className="absolute right-0 top-full z-[80] mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-[var(--cp-line)] bg-[var(--cp-panel)] p-4 text-left shadow-[var(--cp-shadow)]"
        >
          <p className="text-sm font-semibold text-[var(--cp-ink)]">{meter.headline}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--cp-ink-2)]">{meter.detail || `Your allowance ${resets}.`}</p>
          {meter.binding === 'tokens' && !empty && (
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--cp-ink-3)]">
              Long, multi-source answers use more of the allowance than quick questions.
            </p>
          )}
          {!isPro && onUpgrade && (
            <button
              type="button"
              onClick={onUpgrade}
              className="mt-3 text-[13px] font-semibold text-[var(--cp-accent-ink)] underline underline-offset-2"
            >
              See Pro plans for a larger daily allowance
            </button>
          )}
        </div>
      )}
    </div>
  )
}
