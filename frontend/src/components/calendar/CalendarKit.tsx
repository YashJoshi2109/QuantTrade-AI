'use client'

/**
 * Shared building blocks for the Earnings and Dividends calendars (desktop + mobile):
 * glass cards, page header, animated stat cards, week navigation, day cards with
 * proportional bars, segmented control, search, CSV export, sortable headers, the
 * "—" with a reason, and empty / error states. Purely presentational: every value
 * shown is passed in from the live API by the page controllers.
 */
import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ArrowUpRight, ChevronLeft, ChevronRight, Download, Loader2, Search, X } from 'lucide-react'
import { Skeleton } from '@/components/Skeleton'
import { useCountUp } from '@/lib/useCountUp'
import PageHeading from '@/components/seo/PageHeading'

// The app's mobile CSS forces .grid-cols-* to one column; arbitrary templates are exempt.
export const GRID2 = 'grid-cols-[repeat(2,minmax(0,1fr))]'
export const GRID4 = 'grid-cols-[repeat(4,minmax(0,1fr))]'
export const GRID6 = 'grid-cols-[repeat(6,minmax(0,1fr))]'

export type Tone = 'indigo' | 'emerald' | 'amber' | 'sky' | 'violet'
const ACCENT_HEX: Record<Tone, string> = {
  indigo: '#6366f1', emerald: '#10b981', amber: '#f59e0b', sky: '#0ea5e9', violet: '#8b5cf6',
}
const TONE_TEXT: Record<Tone, string> = {
  indigo: 'text-indigo-600 dark:text-indigo-400',
  emerald: 'text-emerald-600 dark:text-emerald-400',
  amber: 'text-amber-600 dark:text-amber-400',
  sky: 'text-sky-600 dark:text-sky-400',
  violet: 'text-violet-600 dark:text-violet-400',
}
const TONE_TILE: Record<Tone, string> = {
  indigo: 'bg-indigo-500/10 border-indigo-500/20',
  emerald: 'bg-emerald-500/10 border-emerald-500/20',
  amber: 'bg-amber-500/10 border-amber-500/20',
  sky: 'bg-sky-500/10 border-sky-500/20',
  violet: 'bg-violet-500/10 border-violet-500/20',
}
const TONE_BAR: Record<Tone, string> = {
  indigo: 'bg-indigo-500', emerald: 'bg-emerald-500', amber: 'bg-amber-500', sky: 'bg-sky-500', violet: 'bg-violet-500',
}

export function accentStyle(tone: Tone): CSSProperties {
  return { ['--cal-accent' as string]: ACCENT_HEX[tone] } as CSSProperties
}

export function GlassCard({ children, className = '', tone, accent = false, glow = false, as: As = 'div', ...rest }: {
  children: ReactNode
  className?: string
  tone?: Tone
  accent?: boolean
  glow?: boolean
  as?: 'div' | 'section' | 'aside' | 'article'
} & Record<string, unknown>) {
  return (
    <As
      {...rest}
      className={`cal-glass ${accent ? 'cal-accent' : ''} ${glow ? 'cal-glow overflow-hidden' : ''} ${className}`}
      style={tone ? accentStyle(tone) : undefined}
    >
      {children}
    </As>
  )
}

export function PageHeader({ icon, title, subtitle, link, tone, compact = false, right }: {
  icon: ReactNode
  title: string
  subtitle: string
  link: { href: string; label: string }
  tone: Tone
  compact?: boolean
  right?: ReactNode
}) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className={`flex shrink-0 items-center justify-center rounded-2xl border ${TONE_TILE[tone]} ${TONE_TEXT[tone]} ${compact ? 'h-10 w-10' : 'h-12 w-12'}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <PageHeading mobile={compact} className={`font-bold tracking-tight text-fg-primary ${compact ? 'text-lg' : 'text-2xl'}`}>{title}</PageHeading>
          <p className={`text-fg-muted ${compact ? 'text-[11px] leading-snug' : 'mt-0.5 text-sm'}`}>{subtitle}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {right}
        <Link
          href={link.href}
          className={`cal-lift inline-flex items-center gap-1 rounded-xl border border-line-default font-semibold text-fg-primary hover:border-indigo-500/40 ${compact ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm'}`}
        >
          {link.label} <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </header>
  )
}

/** "—" that explains itself on hover / to screen readers. */
export function Dash({ reason }: { reason: string }) {
  return (
    <span title={reason} aria-label={`Not available: ${reason}`} className="cursor-help text-fg-muted">—</span>
  )
}

export function CountUp({ value, format }: { value: number | null; format: (n: number) => string }) {
  const v = useCountUp(value)
  return <>{v === null ? '—' : format(v)}</>
}

export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US')

export function StatCard({ label, icon, tone, value, format = fmtInt, reason, sub, loading, bar, compact = false, children }: {
  label: string
  icon?: ReactNode
  tone: Tone
  /** null = unknown ("—" + reason). Ignored when `children` is given. */
  value?: number | null
  format?: (n: number) => string
  reason?: string
  sub?: ReactNode
  loading?: boolean
  /** Optional 0..1 meter under the value. */
  bar?: number | null
  compact?: boolean
  children?: ReactNode
}) {
  return (
    <GlassCard tone={tone} accent className={`cal-lift min-w-0 ${compact ? 'px-3 py-2.5' : 'px-4 py-3.5'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className={`truncate font-semibold uppercase tracking-[0.08em] text-fg-muted ${compact ? 'text-[9px]' : 'text-[10px]'}`}>{label}</p>
        {icon && <span className={`shrink-0 ${TONE_TEXT[tone]}`}>{icon}</span>}
      </div>
      <div className={`mt-1 truncate font-semibold tabular-nums text-fg-primary ${compact ? 'text-lg' : 'text-[26px] leading-9'}`}>
        {loading ? (
          <Skeleton className={`inline-block align-middle ${compact ? 'h-5 w-12' : 'h-7 w-20'}`} />
        ) : children ?? (value === null || value === undefined ? (
          <span title={reason} aria-label={reason ? `Not available: ${reason}` : undefined} className="cursor-help text-fg-muted">—</span>
        ) : (
          <CountUp value={value} format={format} />
        ))}
      </div>
      {bar !== undefined && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-200/70 dark:bg-white/[0.06]" aria-hidden>
          <div className={`cal-bar-anim h-full rounded-full ${TONE_BAR[tone]}`} style={{ width: `${loading || bar == null ? 0 : Math.round(bar * 100)}%` }} />
        </div>
      )}
      <div className={`mt-1 truncate text-fg-muted ${compact ? 'min-h-[14px] text-[10px]' : 'min-h-[16px] text-xs'}`}>
        {loading ? <Skeleton className="h-2.5 w-24" /> : sub}
      </div>
    </GlassCard>
  )
}

export function WeekNav({ label, onPrev, onNext, onToday, todayDisabled, fetching, compact = false }: {
  label: string
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  todayDisabled: boolean
  fetching?: boolean
  compact?: boolean
}) {
  const btn = `cal-lift flex items-center justify-center rounded-xl border border-line-default text-fg-secondary hover:text-fg-primary ${compact ? 'h-9 w-9' : 'h-9 w-9'}`
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={onPrev} aria-label="Previous week" className={btn}><ChevronLeft className="h-4 w-4" /></button>
      <span className={`text-center font-semibold tabular-nums text-fg-primary ${compact ? 'min-w-0 flex-1 text-sm' : 'min-w-[170px] text-sm'}`} aria-live="polite">
        {label}
        {fetching && <Loader2 className="ml-1.5 inline h-3.5 w-3.5 animate-spin align-[-2px] text-fg-muted" aria-label="Refreshing" />}
      </span>
      <button type="button" onClick={onNext} aria-label="Next week" className={btn}><ChevronRight className="h-4 w-4" /></button>
      <button
        type="button"
        onClick={onToday}
        disabled={todayDisabled}
        className="cal-lift h-9 rounded-xl border border-line-default px-3 text-sm font-semibold text-fg-primary disabled:cursor-default disabled:opacity-50 disabled:hover:transform-none"
      >
        Today
      </button>
    </div>
  )
}

export interface DayCardItem {
  id: string | null
  title: string
  subtitle?: string
  count: number
  frac: number
  isToday?: boolean
}

export function DayCards({ items, selected, onSelect, loading, unavailable = false, unit, tone, scroll = false, label }: {
  items: DayCardItem[]
  /** Calendar failed to load: counts are unknown ("—"), not zero. */
  unavailable?: boolean
  selected: string | null
  onSelect: (id: string | null) => void
  loading: boolean
  unit: (n: number) => string
  tone: Tone
  scroll?: boolean
  label: string
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={scroll ? 'cal-scroll -mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1' : `grid ${GRID6} gap-2.5`}
    >
      {items.map((it) => {
        const on = selected === it.id
        return (
          <button
            key={it.id ?? 'week'}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(it.id)}
            className={`cal-glass cal-lift relative min-w-0 snap-start px-3 py-2.5 text-left ${scroll ? 'w-[124px] shrink-0' : ''} ${on ? '!border-indigo-500/60 ring-2 ring-indigo-500/25' : ''}`}
          >
            <span className="flex items-center justify-between gap-1">
              <span className={`truncate text-xs font-semibold ${on ? 'text-indigo-600 dark:text-indigo-300' : 'text-fg-primary'}`}>{it.title}</span>
              {it.isToday && <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[9px] font-bold uppercase text-amber-700 dark:text-amber-400">Today</span>}
            </span>
            {it.subtitle && <span className="block truncate text-[10px] text-fg-muted">{it.subtitle}</span>}
            <span className="mt-1 block h-6 text-lg font-semibold tabular-nums text-fg-primary">
              {loading ? <Skeleton className="mt-1 h-4 w-10" /> : unavailable ? <Dash reason="Calendar unavailable" /> : <CountUp value={it.count} format={fmtInt} />}
              {!loading && !unavailable && <span className="ml-1 text-[10px] font-medium text-fg-muted">{unit(it.count)}</span>}
            </span>
            <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-slate-200/70 dark:bg-white/[0.06]" aria-hidden>
              <span
                className={`cal-bar-anim block h-full rounded-full ${on ? 'bg-indigo-500' : TONE_BAR[tone]} ${on ? '' : 'opacity-70'}`}
                style={{ width: `${loading || unavailable ? 0 : Math.round(it.frac * 100)}%` }}
              />
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function Segmented<T extends string>({ options, value, onChange, label, lockedReason, scroll = false }: {
  options: { id: T; label: string; locked?: boolean }[]
  value: T
  onChange: (v: T) => void
  label: string
  lockedReason?: string
  scroll?: boolean
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`cal-inset flex gap-1 rounded-xl border border-line-subtle p-1 ${scroll ? 'cal-scroll overflow-x-auto' : ''}`}>
      {options.map((o) => {
        const on = o.id === value
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.locked}
            title={o.locked ? lockedReason : undefined}
            onClick={() => onChange(o.id)}
            className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'cal-solid text-indigo-600 shadow-sm ring-1 ring-indigo-500/25 dark:text-indigo-300' : 'text-fg-muted hover:text-fg-primary'}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export const selectCls =
  'cal-solid h-9 rounded-xl border border-line-default px-2.5 text-sm text-fg-primary focus:outline-none focus:ring-2 focus:ring-indigo-500/40'

export function SearchBox({ value, onChange, placeholder, className = '' }: {
  value: string; onChange: (v: string) => void; placeholder: string; className?: string
}) {
  return (
    <label className={`cal-solid flex h-9 min-w-0 items-center gap-2 rounded-xl border border-line-default px-2.5 focus-within:ring-2 focus-within:ring-indigo-500/40 ${className}`}>
      <Search className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm text-fg-primary placeholder:text-fg-muted focus:outline-none"
      />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="Clear search" className="text-fg-muted hover:text-fg-primary">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </label>
  )
}

export function ExportButton({ onClick, disabled, compact = false }: { onClick: () => void; disabled: boolean; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'Nothing to export' : 'Download the rows shown as CSV'}
      className={`cal-lift inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-line-default px-3 text-sm font-semibold text-fg-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:transform-none ${compact ? 'w-full justify-center' : ''}`}
    >
      <Download className="h-4 w-4" /> Export CSV
    </button>
  )
}

export function SortTh<K extends string>({ k, label, sort, onSort, align = 'right', title, className = '' }: {
  k: K
  label: string
  sort: { key: K; dir: 'asc' | 'desc' }
  onSort: (k: K) => void
  align?: 'left' | 'right'
  title?: string
  className?: string
}) {
  const active = sort.key === k
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th
      scope="col"
      className={`cal-solid sticky top-0 z-10 whitespace-nowrap border-b border-line-subtle px-2 py-2.5 font-semibold ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      title={title}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`group inline-flex items-center gap-0.5 uppercase hover:text-fg-primary ${active ? 'text-indigo-600 dark:text-indigo-300' : ''} ${align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        {label}
        <Icon className={`h-3 w-3 ${active ? '' : 'hidden'}`} />
      </button>
    </th>
  )
}

export function PlainTh({ children, align = 'left', className = '', title }: { children?: ReactNode; align?: 'left' | 'right' | 'center'; className?: string; title?: string }) {
  return (
    <th scope="col" title={title} className={`cal-solid sticky top-0 z-10 whitespace-nowrap border-b border-line-subtle px-2 py-2.5 font-semibold uppercase ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'} ${className}`}>
      {children}
    </th>
  )
}

/** Skeleton rows shaped like the real table / card list. */
export function TableSkeleton({ rows = 8, cols }: { rows?: number; cols: number }) {
  return (
    <div className="divide-y divide-line-subtle" aria-label="Loading" role="status">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
          <div className="w-40 shrink-0 space-y-1.5"><Skeleton className="h-3 w-16" /><Skeleton className="h-2.5 w-28" /></div>
          {Array.from({ length: Math.max(0, cols - 1) }).map((__, j) => <Skeleton key={j} className="h-3 flex-1" />)}
        </div>
      ))}
    </div>
  )
}

export function CardListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul className="space-y-2" aria-label="Loading" role="status">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="cal-glass p-3">
          <div className="flex items-center gap-3"><Skeleton className="h-9 w-9 rounded-lg" /><div className="flex-1 space-y-1.5"><Skeleton className="h-3 w-20" /><Skeleton className="h-2.5 w-36" /></div></div>
          <div className={`mt-3 grid ${GRID2} gap-2`}><Skeleton className="h-6" /><Skeleton className="h-6" /></div>
        </li>
      ))}
    </ul>
  )
}

export function StateBox({ icon, title, body, actions, tone = 'muted' }: {
  icon?: ReactNode; title: string; body?: ReactNode; actions?: ReactNode; tone?: 'muted' | 'warn'
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center" role={tone === 'warn' ? 'alert' : undefined}>
      <span className={tone === 'warn' ? 'text-amber-500' : 'text-fg-muted'}>{icon ?? <AlertTriangle className="h-7 w-7" />}</span>
      <p className="text-sm font-semibold text-fg-primary">{title}</p>
      {body && <p className="max-w-md text-xs text-fg-muted">{body}</p>}
      {actions && <div className="mt-2 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  )
}

export const ghostBtn =
  'cal-lift inline-flex items-center gap-1.5 rounded-xl border border-line-default px-3 py-1.5 text-sm font-semibold text-fg-primary'
export const primaryBtn =
  'cal-lift inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-[#fff] hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60'

/** Small labelled pill for watchlist / portfolio membership. */
export function MemberTags({ watch, held }: { watch: boolean; held: boolean }) {
  return (
    <>
      {held && <span className="rounded bg-emerald-500/10 px-1 text-[9px] font-bold uppercase text-emerald-700 dark:text-emerald-400">Held</span>}
      {watch && <span className="rounded bg-indigo-500/10 px-1 text-[9px] font-bold uppercase text-indigo-600 dark:text-indigo-400">Watch</span>}
    </>
  )
}

/** Animated horizontal comparison bar (0..1). */
export function MeterBar({ frac, className }: { frac: number; className: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-200/70 dark:bg-white/[0.06]" aria-hidden>
      <div className={`cal-grow-x h-full rounded-full ${className}`} style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%` }} />
    </div>
  )
}
