'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Rocket, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fetchIpoCalendar, type IpoCalendarEntry } from '@/lib/api'
import {
  getExchangeById,
  getExchangesByContinent,
  type Continent,
} from '@/lib/world-exchanges'

function filterIposByScope(
  rows: IpoCalendarEntry[],
  continent?: Continent,
  exchangeId?: string | null
): IpoCalendarEntry[] {
  if (!continent || continent === 'global') return rows
  if (exchangeId) {
    const ex = getExchangeById(exchangeId)
    if (!ex) return rows
    const h = ex.shortName.toUpperCase()
    const filtered = rows.filter((r) => (r.exchange || '').toUpperCase().includes(h))
    return filtered.length > 0 ? filtered : rows
  }
  const hints = getExchangesByContinent(continent).map((e) => e.shortName.toUpperCase())
  const filtered = rows.filter((r) => {
    const ex = (r.exchange || '').toUpperCase()
    return hints.some((hint) => ex.includes(hint))
  })
  return filtered.length > 0 ? filtered : rows
}

export default function IpoRadarWidget({
  continent,
  exchangeId,
  variant = 'default',
  className,
}: {
  continent?: Continent
  exchangeId?: string | null
  variant?: 'default' | 'inline'
  className?: string
}) {
  const {
    data = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['ipoCalendar'],
    queryFn: () => fetchIpoCalendar(),
    refetchInterval: 3_600_000,
    staleTime: 1_800_000,
  })

  const allScoped = useMemo(
    () => filterIposByScope(data.slice(0, 64), continent, exchangeId),
    [data, continent, exchangeId]
  )

  const rows = useMemo(
    () => allScoped.slice(0, variant === 'inline' ? 40 : 10),
    [allScoped, variant]
  )

  const header = (
    <div className="flex w-full items-center justify-between gap-2 shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <Rocket className="w-4 h-4 text-fuchsia-400 shrink-0" />
        <h3 className="font-bold text-white text-sm truncate">IPO Radar</h3>
        <span className="px-1.5 py-0.5 text-[9px] bg-fuchsia-500/20 text-fuchsia-300 rounded font-bold shrink-0">
          PIPELINE
        </span>
      </div>
      <button
        type="button"
        onClick={() => refetch()}
        className="hud-card p-1.5 text-fuchsia-400 hover:text-white transition-colors shrink-0"
        aria-label="Refresh IPO calendar"
      >
        <RefreshCw className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} />
      </button>
    </div>
  )

  const inlineSummary = !isLoading && allScoped.length > 0 && (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line-subtle py-2 text-[10px] text-fg-muted">
      <span>
        <span className="font-mono text-lg font-bold tabular-nums text-fuchsia-300">{allScoped.length}</span>{' '}
        <span className="text-fg-muted">in pipeline</span>
      </span>
      {allScoped[0]?.date && (
        <span>
          Next:{' '}
          <span className="font-mono text-fg-primary">{allScoped[0].date}</span>
          {allScoped[0].symbol?.trim() && (
            <span className="ml-1.5 font-mono text-fuchsia-200/90">{allScoped[0].symbol.trim()}</span>
          )}
        </span>
      )}
      {exchangeId && (
        <span className="rounded border border-line-default bg-surface-raised/50 px-1.5 py-0.5 text-[9px] text-fg-secondary">
          Venue filter
        </span>
      )}
    </div>
  )

  const body = isLoading ? (
    <div
      className={cn(
        'flex gap-2 overflow-x-auto',
        variant === 'inline' ? 'flex-col gap-2 py-2' : 'gap-3 pb-1'
      )}
    >
      {Array.from({ length: variant === 'inline' ? 6 : 4 }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'animate-pulse rounded-lg bg-surface-raised/50',
            variant === 'inline' ? 'h-14 w-full' : 'min-w-[140px] shrink-0 h-16'
          )}
        />
      ))}
    </div>
  ) : rows.length === 0 ? (
    <p className="text-[11px] leading-relaxed text-fg-muted">
      {variant === 'inline'
        ? 'No IPO rows in scope. Calendar fills when the data feed returns listings.'
        : 'No upcoming IPO rows returned. When the backend has a Finnhub API key, the next listings appear here automatically.'}
    </p>
  ) : variant === 'inline' ? (
    <div className="flex min-h-0 flex-1 flex-col">
      {inlineSummary}
      <div className="min-h-0 max-h-[420px] space-y-1.5 overflow-y-auto py-2 pr-0.5 scrollbar-thin">
        {rows.map((ipo, idx) => {
          const sym = ipo.symbol?.trim()
          const href = sym ? `/research?symbol=${encodeURIComponent(sym)}` : undefined
          const Inner = (
            <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-line-default bg-surface-raised/55 px-2.5 py-2 transition-colors hover:border-fuchsia-500/35 sm:grid-cols-[5rem_minmax(0,1fr)_minmax(0,7rem)]">
              <span className="font-mono text-[9px] tabular-nums text-fg-muted">{ipo.date || '—'}</span>
              <div className="min-w-0">
                <div className="font-mono text-xs font-bold text-fg-primary">{sym || '—'}</div>
                <div className="line-clamp-1 text-[10px] text-fg-muted">{ipo.name || '—'}</div>
              </div>
              <div className="min-w-0 text-right">
                <div className="line-clamp-1 text-[9px] text-fg-muted">{ipo.exchange || '—'}</div>
                <div className="line-clamp-1 text-[9px] font-medium text-fuchsia-400/90">
                  {ipo.status || ipo.price || 'IPO'}
                </div>
              </div>
            </div>
          )
          return href ? (
            <Link key={`${ipo.date}-${sym}-${idx}`} href={href} className="block">
              {Inner}
            </Link>
          ) : (
            <div key={`${ipo.date}-${ipo.name}-${idx}`}>{Inner}</div>
          )
        })}
      </div>
    </div>
  ) : (
    <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-thin">
      {rows.map((ipo, idx) => {
        const sym = ipo.symbol?.trim()
        const href = sym ? `/research?symbol=${encodeURIComponent(sym)}` : undefined
        const Inner = (
          <div className="min-w-[155px] rounded-lg border border-line-default bg-surface-raised/70 px-3 py-2.5 hover:border-fuchsia-500/40 transition-colors">
            <div className="text-[10px] text-fg-muted font-mono">{ipo.date || '—'}</div>
            <div className="text-xs font-bold text-fg-primary mt-0.5 line-clamp-2 leading-snug">
              {sym || ipo.name}
            </div>
            <div className="text-[10px] text-fg-secondary mt-1 line-clamp-1">
              {sym ? ipo.name : ipo.exchange || ipo.status || 'IPO'}
            </div>
          </div>
        )
        return href ? (
          <Link key={`${ipo.date}-${sym}-${idx}`} href={href} className="shrink-0">
            {Inner}
          </Link>
        ) : (
          <div key={`${ipo.date}-${ipo.name}-${idx}`} className="shrink-0">
            {Inner}
          </div>
        )
      })}
    </div>
  )

  if (variant === 'inline') {
    return (
      <div className={cn('flex min-h-0 min-w-0 flex-col', className)}>
        <div className="flex h-12 shrink-0 items-center border-b border-line-subtle">{header}</div>
        <div className="flex min-h-0 flex-1 flex-col">{body}</div>
      </div>
    )
  }

  return (
    <div className={cn('hud-panel p-4', className)}>
      <div className="flex items-center justify-between mb-3">{header}</div>
      {body}
    </div>
  )
}
