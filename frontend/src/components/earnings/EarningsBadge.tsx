'use client'

/**
 * "Earnings in N days" chip for the Research header. Desktop (ResearchChartHeader)
 * and mobile (MobileResearch) render the same component, so they always agree.
 */
import Link from 'next/link'
import { CalendarClock } from 'lucide-react'
import { dayLabel, earningsBadgeText, fmtEps, hourTitle, useNextEarnings } from '@/lib/earnings'

export default function EarningsBadge({
  symbol, variant, className = '',
}: { symbol: string; variant: 'desktop' | 'mobile'; className?: string }) {
  const { data } = useNextEarnings(symbol)
  const text = earningsBadgeText(data?.days_until)
  if (!data || !data.date || !text) return null
  const detail = `${dayLabel(data.date, 'long')} · ${hourTitle(data.hour)} · EPS est. ${fmtEps(data.eps_estimate)}`
  const soon = (data.days_until ?? 99) <= 7
  const cls =
    variant === 'desktop'
      ? `border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 ${soon ? 'ring-1 ring-amber-400/40' : ''}`
      : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
  return (
    <Link
      href={`/earnings?date=${data.date}`}
      title={detail}
      aria-label={`${text}: ${detail}`}
      data-testid="earnings-badge"
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold ${cls} ${className}`}
    >
      <CalendarClock className="h-3 w-3" aria-hidden />
      {text}
    </Link>
  )
}
