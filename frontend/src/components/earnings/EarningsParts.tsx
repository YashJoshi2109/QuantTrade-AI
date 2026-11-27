'use client'

/**
 * Shared by EarningsDesktop and EarningsMobile: the page controller (week, day,
 * filters, data) and small presentational pieces both layouts render.
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { BellPlus } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  addDays,
  CAP_TIER_OPTIONS,
  groupByDay,
  hourShort,
  hourTitle,
  parseDay,
  SCOPE_OPTIONS,
  todayNY,
  useEarningsCalendar,
  weekDays,
  weekStart,
  type CapTier,
  type EarningsHour,
  type EarningsRow,
  type EarningsScope,
} from '@/lib/earnings'

export const PER_DAY_PREVIEW = 25

/** Within a day: biggest companies first; unknown market cap last. */
export function sortForDay(rows: EarningsRow[]): EarningsRow[] {
  return [...rows].sort((a, b) => (b.market_cap ?? -1) - (a.market_cap ?? -1) || a.symbol.localeCompare(b.symbol))
}

export function alertHref(symbol: string): string {
  return `/alerts?symbol=${encodeURIComponent(symbol)}&condition=earnings_within_days`
}

function initialFromUrl(): { monday: string; day: string | null } {
  const today = todayNY()
  try {
    const d = new URLSearchParams(window.location.search).get('date')
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(parseDay(d).getTime())) {
      return { monday: weekStart(d), day: d }
    }
  } catch {
    /* no-op */
  }
  return { monday: weekStart(today), day: null }
}

export function useEarningsController() {
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const [monday, setMonday] = useState(() => weekStart(todayNY()))
  const [day, setDay] = useState<string | null>(null) // null = whole week
  const [scope, setScope] = useState<EarningsScope>('all')
  const [cap, setCap] = useState<CapTier | ''>('')
  const [sector, setSector] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  // /earnings?date=YYYY-MM-DD opens that week with the day selected (Research badge link).
  useEffect(() => {
    const init = initialFromUrl()
    setMonday(init.monday)
    setDay(init.day)
  }, [])

  // Signed out: personal scopes are not available.
  useEffect(() => {
    if (!authLoading && !isAuthenticated && scope !== 'all') setScope('all')
  }, [authLoading, isAuthenticated, scope])

  const days = useMemo(() => weekDays(monday), [monday])
  const params = { start: monday, end: addDays(monday, 6), scope, cap, sector }
  const q = useEarningsCalendar(params, !authLoading)
  const data = q.data
  const today = data?.today || todayNY()

  const grouped = useMemo(() => {
    const g = groupByDay(data?.rows ?? [], days)
    for (const k of Object.keys(g)) g[k] = sortForDay(g[k])
    return g
  }, [data, days])
  const weekendRows = useMemo(
    () => Object.entries(grouped).filter(([d]) => !days.includes(d)).flatMap(([, r]) => r),
    [grouped, days],
  )
  const visibleDays = day ? [day] : days
  const sectors = data?.sectors ?? []

  const shiftWeek = (n: number) => {
    setMonday((m) => addDays(m, 7 * n))
    setDay(null)
    setExpanded({})
  }
  const goToday = () => {
    setMonday(weekStart(today))
    const dow = parseDay(today).getUTCDay()
    setDay(dow >= 1 && dow <= 5 ? today : null)
    setExpanded({})
  }

  return {
    isAuthenticated, authLoading,
    loading: q.isLoading || authLoading, fetching: q.isFetching, error: q.error as Error | null,
    data, today, monday, days, day, setDay, visibleDays, grouped, weekendRows,
    scope, setScope, cap, setCap, sector, setSector, sectors,
    expanded, setExpanded, shiftWeek, goToday,
    isThisWeek: monday === weekStart(today),
    filtersActive: scope !== 'all' || !!cap || !!sector,
    clearFilters: () => { setScope('all'); setCap(''); setSector('') },
  }
}

export type EarningsController = ReturnType<typeof useEarningsController>

export const scopeOptions = SCOPE_OPTIONS
export const capOptions = CAP_TIER_OPTIONS

export function HourPill({ hour, className = '' }: { hour: EarningsHour | null; className?: string }) {
  const tone =
    hour === 'bmo'
      ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
      : hour === 'amc'
        ? 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300'
        : hour === 'dmh'
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : 'border-line-subtle bg-surface-raised text-fg-muted'
  return (
    <span title={hourTitle(hour)} className={`inline-flex rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-bold ${tone} ${className}`}>
      {hourShort(hour)}
    </span>
  )
}

export function AlertLink({ symbol, compact = false }: { symbol: string; compact?: boolean }) {
  return (
    <Link
      href={alertHref(symbol)}
      title={`Alert me before ${symbol} reports`}
      aria-label={`Set an earnings alert for ${symbol}`}
      className={`inline-flex items-center justify-center rounded-lg text-fg-muted hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400 ${compact ? 'h-8 w-8' : 'h-7 w-7'}`}
    >
      <BellPlus className="h-4 w-4" />
    </Link>
  )
}

export function SourceNote({ sources }: { sources?: { finnhub: boolean; nasdaq: boolean } }) {
  const names = [sources?.finnhub && 'Finnhub', sources?.nasdaq && 'Nasdaq'].filter(Boolean).join(' + ')
  return (
    <p className="text-[11px] leading-relaxed text-fg-muted">
      {names ? `Data: ${names}.` : 'Data: Finnhub and Nasdaq calendars.'} BMO = before market open, AMC = after
      market close. Estimates are analyst consensus and can change; companies sometimes move report dates.
      Surprise = (actual − estimate) ÷ |estimate|. Missing figures show as “—”. Not investment advice.
    </p>
  )
}
