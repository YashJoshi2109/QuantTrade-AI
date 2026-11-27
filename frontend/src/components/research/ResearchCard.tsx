'use client'

import { Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/Skeleton'

/** Opaque research card (see .rs-card in globals.css). */
export function ResearchCard({
  children,
  className,
  testId,
  as: Tag = 'section',
  ariaLabel,
  busy,
}: {
  children: ReactNode
  className?: string
  testId?: string
  as?: 'section' | 'div'
  ariaLabel?: string
  busy?: boolean
}) {
  return (
    <Tag
      className={cn('rs-card p-4', className)}
      data-testid={testId}
      aria-label={ariaLabel}
      aria-busy={busy || undefined}
    >
      {children}
    </Tag>
  )
}

export function CardTitle({ children, right, rule }: { children: ReactNode; right?: ReactNode; rule?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-fg-primary">
        <span className="truncate">{children}</span>
        {rule && <RuleTip rule={rule} />}
      </h3>
      {right}
    </div>
  )
}

/** Small info icon that shows how a label is derived (title tooltip + accessible name). */
export function RuleTip({ rule, className }: { rule: string; className?: string }) {
  return (
    <span
      tabIndex={0}
      role="img"
      title={rule}
      aria-label={`How this is calculated: ${rule}`}
      className={cn('inline-flex shrink-0 cursor-help text-fg-muted hover:text-fg-secondary focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 rounded', className)}
    >
      <Info className="h-3.5 w-3.5" aria-hidden />
    </span>
  )
}

/** Horizontal range bar with a marker (day range, 52-week range, Bollinger bands). */
export function RangeBar({
  position,
  lowLabel,
  highLabel,
  label,
  className,
  testId,
}: {
  /** 0..1, null = unknown (no marker) */
  position: number | null
  lowLabel: string
  highLabel: string
  label?: string
  className?: string
  testId?: string
}) {
  return (
    <div className={cn('min-w-0', className)} data-testid={testId}>
      {label && <div className="mb-1.5 text-[11px] text-fg-muted">{label}</div>}
      <div className="relative h-1.5 rounded-full bg-slate-200 dark:bg-white/10">
        {position !== null && (
          <>
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-slate-400/60 dark:bg-white/25"
              style={{ width: `${position * 100}%` }}
            />
            <div
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-blue-600 shadow dark:border-[#0f1520] dark:bg-blue-400"
              style={{ left: `${position * 100}%` }}
              aria-hidden
            />
          </>
        )}
      </div>
      <div className="mt-1.5 flex justify-between gap-2 text-[11px] tabular-nums text-fg-muted">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  )
}

/**
 * Skeleton that stays visible on the opaque research cards (the shared
 * Skeleton uses --surface-overlay, which is white-on-white in light mode).
 */
export function CardSkeleton({ className }: { className?: string }) {
  return <Skeleton className={cn('bg-slate-200 dark:bg-white/10', className)} />
}
