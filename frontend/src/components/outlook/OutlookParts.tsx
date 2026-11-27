'use client'

/**
 * Shared by OutlookDesktop and OutlookMobile: page controller (tab, symbol, portfolio
 * link) and the small building blocks every Outlook panel uses.
 */
import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Info, RefreshCw } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { usePortfolioDetail, usePortfolioList, useSelectedPortfolio } from '@/lib/usePortfolios'
import { DEFAULT_SYMBOL, fmtPrice, normalizeSymbol, QUALITY_HELP, QUALITY_TEXT, type Quality } from '@/lib/outlook'
import { Skeleton } from '@/components/Skeleton'
import { cn } from '@/lib/utils'

export type OutlookTab = 'implied' | 'calendar' | 'hedge' | 'scenario'

export const TABS: { id: OutlookTab; label: string; short: string; blurb: string }[] = [
  { id: 'implied', label: 'Market-implied outlook', short: 'Outlook', blurb: 'What option prices say about the range ahead.' },
  { id: 'calendar', label: 'Event calendar', short: 'Events', blurb: 'Upcoming catalysts and the move priced for each.' },
  { id: 'hedge', label: 'Hedge planner', short: 'Hedge', blurb: 'Protective put vs collar vs trimming, at expiry.' },
  { id: 'scenario', label: 'Scenario planner', short: 'Scenarios', blurb: 'Your portfolio under a shock or a replayed crash.' },
]

const TAB_IDS = TABS.map((t) => t.id)

export interface PortfolioHolding {
  symbol: string
  quantity: number
  price: number | null
}

function readUrl(): { tab: OutlookTab | null; symbol: string | null } {
  if (typeof window === 'undefined') return { tab: null, symbol: null }
  const q = new URLSearchParams(window.location.search)
  const t = q.get('tab') as OutlookTab | null
  return { tab: t && TAB_IDS.includes(t) ? t : null, symbol: normalizeSymbol(q.get('symbol') || '') }
}

function writeUrl(tab: OutlookTab, symbol: string) {
  try {
    const q = new URLSearchParams(window.location.search)
    q.set('tab', tab)
    q.set('symbol', symbol)
    window.history.replaceState(null, '', `${window.location.pathname}?${q}`)
  } catch {
    /* history unavailable: state just isn't in the URL */
  }
}

export function useOutlookController() {
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const [tab, setTabState] = useState<OutlookTab>('implied')
  const [symbol, setSymbolState] = useState<string>(DEFAULT_SYMBOL)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const u = readUrl()
    if (u.tab) setTabState(u.tab)
    if (u.symbol) setSymbolState(u.symbol)
    setReady(true)
  }, [])

  useEffect(() => {
    if (ready) writeUrl(tab, symbol)
  }, [ready, tab, symbol])

  const setTab = useCallback((t: OutlookTab) => setTabState(t), [])
  const setSymbol = useCallback((raw: string) => {
    const s = normalizeSymbol(raw)
    if (s) setSymbolState(s)
  }, [])

  const list = usePortfolioList(isAuthenticated && !authLoading)
  const portfolios = useMemo(() => list.data?.portfolios ?? [], [list.data])
  const ids = useMemo(() => (list.data ? portfolios.map((p) => p.id) : undefined), [list.data, portfolios])
  const [portfolioId, setPortfolioId] = useSelectedPortfolio(ids)
  const detail = usePortfolioDetail(isAuthenticated ? portfolioId : null)
  const holdings: PortfolioHolding[] = useMemo(
    () =>
      (detail.data?.holdings ?? [])
        .filter((h) => h.quantity > 0)
        .map((h) => ({ symbol: h.symbol, quantity: h.quantity, price: h.price })),
    [detail.data],
  )

  return {
    ready,
    tab,
    setTab,
    symbol,
    setSymbol,
    isAuthenticated,
    authLoading,
    portfolios,
    portfolioId,
    setPortfolioId,
    holdings,
    holdingsLoading: isAuthenticated && (list.isLoading || (!!portfolioId && detail.isLoading)),
    simulated: !!detail.data?.simulated,
  }
}

export type OutlookController = ReturnType<typeof useOutlookController>

/** Debounced copy of a value (for typed inputs that trigger requests). */
export function useDebounced<T>(value: T, ms = 450): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

// ── building blocks ─────────────────────────────────────────────────────────

/** The shared Skeleton with a fill that stays visible on both themes' card backgrounds. */
export function Bone({ className, height }: { className?: string; height?: number }) {
  return <Skeleton className={cn('bg-slate-400/20 dark:bg-white/10', className)} height={height} />
}

export function Panel({
  title,
  subtitle,
  right,
  children,
  className = '',
  compact = false,
  label,
}: {
  title: string
  subtitle?: ReactNode
  right?: ReactNode
  children: ReactNode
  className?: string
  compact?: boolean
  label?: string
}) {
  return (
    <section
      aria-label={label || title}
      className={
        compact
          ? `rounded-2xl border border-line-subtle bg-surface-raised p-4 ${className}`
          : `hud-card p-5 ${className}`
      }
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className={`${compact ? 'text-sm' : 'text-base'} font-semibold text-fg-primary`}>{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{subtitle}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  )
}

export function Stat({
  label,
  value,
  sub,
  tone = 'text-fg-primary',
  big = false,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: string
  big?: boolean
}) {
  return (
    <div className="min-w-0 rounded-xl border border-line-subtle bg-surface-base px-3 py-2.5">
      <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{label}</p>
      <p className={`mt-1 font-semibold tabular-nums ${big ? 'text-2xl' : 'text-lg'} ${tone}`}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-[11px] tabular-nums text-fg-muted">{sub}</p>}
    </div>
  )
}

export function StatSkeleton({ big = false }: { big?: boolean }) {
  return (
    <div className="rounded-xl border border-line-subtle bg-surface-base px-3 py-2.5" aria-hidden>
      <Bone className="h-2.5 w-16" />
      <Bone className={`mt-2 ${big ? 'h-7' : 'h-5'} w-24`} />
      <Bone className="mt-1.5 h-2.5 w-20" />
    </div>
  )
}

export function QualityBadge({ q }: { q: Quality }) {
  const cls =
    q === 'good'
      ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
      : q === 'fair'
        ? 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-400'
        : 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400'
  return (
    <span title={QUALITY_HELP[q]} className={`inline-flex items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
      {QUALITY_TEXT[q]}
    </span>
  )
}

export function ErrorState({
  error,
  onRetry,
  hint = 'Option data comes from Public.com or yfinance; quotes can be missing outside market hours.',
}: {
  error: unknown
  onRetry?: () => void
  hint?: string
}) {
  const msg = error instanceof Error ? error.message : 'Something went wrong.'
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm text-fg-secondary">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
      <div className="min-w-0 flex-1">
        <p className="text-fg-primary">{msg}</p>
        <p className="mt-0.5 text-xs text-fg-muted">{hint}</p>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line-default px-2.5 py-1 text-xs font-medium text-fg-primary hover:bg-surface-raised">
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </button>
      )}
    </div>
  )
}

/** Shown when the quoted price disagreed with the option book and figures use the parity price. */
export function SpotNotice({ meta, spot }: { meta?: { spot_basis?: string; quoted_spot?: number | null } | null; spot?: number | null }) {
  if (!meta || meta.spot_basis !== 'option_parity') return null
  return (
    <p role="note" className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-fg-secondary">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
      <span>
        The last quoted price ({fmtPrice(meta.quoted_spot)}) is out of step with the option quotes, so figures are measured
        from the price the options imply ({fmtPrice(spot)}, put-call parity). This happens with stale or after-hours prints.
      </span>
    </p>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line-default px-4 py-6 text-center text-sm text-fg-muted">{children}</p>
}

export function Disclaimer({ text, compact = false }: { text?: string; compact?: boolean }) {
  return (
    <p className={`flex items-start gap-2 rounded-xl border border-line-subtle bg-surface-base p-3 leading-relaxed text-fg-muted ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        <strong className="font-semibold text-fg-secondary">Educational, not advice.</strong>{' '}
        {text ||
          'Option-implied figures are risk-neutral: they reflect what option prices imply, including the premium paid for protection, not real-world odds. Nothing on this page places or routes orders.'}
      </span>
    </p>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
}: {
  value: T
  options: { id: T; label: string; disabled?: boolean; title?: string }[]
  onChange: (v: T) => void
  label: string
  size?: 'sm' | 'md'
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-xl border border-line-subtle bg-surface-base p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.id)}
          className={`rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'} ${
            value === o.id
              ? 'bg-indigo-500/10 text-indigo-600 ring-1 ring-indigo-500/25 dark:text-indigo-400'
              : 'text-fg-muted hover:text-fg-primary'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export const inputCls =
  'w-full rounded-lg border border-line-default bg-surface-base px-2.5 py-1.5 text-sm tabular-nums text-fg-primary placeholder:text-fg-muted focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/40'

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] text-fg-muted">{hint}</span>}
    </label>
  )
}

const QUICK = ['SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA', 'MSFT']

/** Symbol entry + quick picks (portfolio holdings first when signed in). */
export function SymbolBar({ c, compact = false }: { c: OutlookController; compact?: boolean }) {
  const [draft, setDraft] = useState(c.symbol)
  useEffect(() => setDraft(c.symbol), [c.symbol])
  const holdingSyms = c.holdings.map((h) => h.symbol).slice(0, compact ? 4 : 8)
  const picks = [...holdingSyms, ...QUICK.filter((s) => !holdingSyms.includes(s))].slice(0, compact ? 6 : 12)
  const valid = !!normalizeSymbol(draft)
  return (
    <div className={`flex ${compact ? 'flex-col gap-2' : 'flex-wrap items-center gap-3'}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          c.setSymbol(draft)
        }}
        className="flex items-center gap-2"
      >
        <input
          aria-label="Symbol"
          value={draft}
          onChange={(e) => setDraft(e.target.value.toUpperCase())}
          maxLength={10}
          className={`${inputCls} ${compact ? 'flex-1' : 'w-32'} font-semibold uppercase`}
          placeholder="Symbol"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          type="submit"
          disabled={!valid}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-[#fff] hover:bg-indigo-500 disabled:opacity-50"
        >
          Analyse
        </button>
      </form>
      <div className={`flex gap-1.5 ${compact ? 'overflow-x-auto pb-1 no-scrollbar' : 'flex-wrap'}`}>
        {picks.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => c.setSymbol(s)}
            aria-pressed={s === c.symbol}
            className={`shrink-0 rounded-md border px-2 py-1 text-xs font-semibold tabular-nums ${
              s === c.symbol
                ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                : 'border-line-subtle text-fg-secondary hover:border-line-default hover:text-fg-primary'
            }`}
            title={holdingSyms.includes(s) ? 'In your portfolio' : undefined}
          >
            {s}
            {holdingSyms.includes(s) && <span className="ml-1 text-[9px] font-medium text-fg-muted">held</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Table-shaped skeleton: header bar + ``rows`` lines of ``cols`` cells. */
export function TableSkeleton({ rows = 6, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div aria-hidden className="space-y-2">
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: cols }).map((_, i) => <Bone key={i} className="h-2.5 w-3/4" />)}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="grid gap-3 border-t border-line-subtle pt-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }).map((_, i) => <Bone key={i} className="h-4" />)}
        </div>
      ))}
    </div>
  )
}

export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return <Bone className="w-full rounded-xl" height={height} />
}
