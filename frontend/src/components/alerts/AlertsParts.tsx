'use client'

/**
 * Shared by AlertsDesktop and AlertsMobile: the create form, the overlay
 * container (modal / bottom sheet) and the page controller hook.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Check, Loader2, LogIn, Plus, Sparkles, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/Toast'
import TickerLogo from '@/components/TickerLogo'
import { Skeleton } from '@/components/Skeleton'
import {
  CONDITION_META,
  CONDITION_ORDER,
  SOURCE_META,
  describeAlert,
  isEarningsCondition,
  readDismissed,
  useAddSuggestion,
  useAlertMutations,
  useAlertSuggestions,
  useAlerts,
  validateThreshold,
  visibleSuggestions,
  writeDismissed,
  type AlertCondition,
  type AlertStatus,
  type AlertSuggestion,
  type PriceAlert,
} from '@/lib/alerts'

const inputCls =
  'w-full rounded-lg border border-line-default bg-surface-base px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-indigo-500/40'
const labelCls = 'block text-xs font-medium text-fg-secondary mb-1'
// The app's mobile CSS forces .grid-cols-* to one column; arbitrary templates are exempt.
export const GRID2 = 'grid-cols-[repeat(2,minmax(0,1fr))]'
export const GRID3 = 'grid-cols-[repeat(3,minmax(0,1fr))]'

export function Overlay({
  open, onClose, title, variant, children,
}: { open: boolean; onClose: () => void; title: string; variant: 'modal' | 'sheet'; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    ref.current?.querySelector<HTMLElement>('input,select')?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  const sheet = variant === 'sheet'
  return (
    <div
      className={`fixed inset-0 z-[60] flex bg-black/50 backdrop-blur-sm ${sheet ? 'items-end' : 'items-center justify-center p-4'}`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={
          sheet
            ? 'w-full max-h-[88vh] overflow-y-auto rounded-t-3xl border-t border-line-subtle bg-white px-4 pb-8 pt-3 dark:bg-slate-900'
            : 'w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-line-default bg-white p-5 shadow-2xl dark:bg-slate-900'
        }
      >
        {sheet && <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-surface-active" />}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-fg-primary">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full text-fg-secondary hover:bg-surface-raised">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function AlertForm({
  initialSymbol = '', initialCondition = 'price_above', onDone,
}: { initialSymbol?: string; initialCondition?: AlertCondition; onDone: () => void }) {
  const toast = useToast()
  const { create } = useAlertMutations()
  const [symbol, setSymbol] = useState(initialSymbol)
  const [condition, setCondition] = useState<AlertCondition>(initialCondition)
  const [threshold, setThreshold] = useState(isEarningsCondition(initialCondition) ? '3' : '')
  // Earnings alerts default to every quarter (each report still fires only once).
  const [repeat, setRepeat] = useState(isEarningsCondition(initialCondition))
  const pickCondition = (c: AlertCondition) => {
    if (isEarningsCondition(c) !== isEarningsCondition(condition)) {
      setRepeat(isEarningsCondition(c))
      setThreshold(isEarningsCondition(c) ? '3' : '')
    }
    setCondition(c)
  }
  const [email, setEmail] = useState(false)
  const [note, setNote] = useState('')
  const meta = CONDITION_META[condition]
  const err = threshold === '' ? null : validateThreshold(condition, threshold)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const sym = symbol.trim().toUpperCase()
    if (!/^[A-Z0-9.\-]{1,10}$/.test(sym)) return toast.error('Enter a valid ticker')
    const v = validateThreshold(condition, threshold)
    if (v) return toast.error(v)
    create.mutate(
      { symbol: sym, condition, threshold: Number(threshold), repeat, notify_email: email, note: note.trim() || undefined },
      {
        onSuccess: (a) => {
          toast.success(`Alert set: ${a.symbol} ${describeAlert(a).toLowerCase()}`)
          onDone()
        },
        onError: (e2) => toast.error(e2 instanceof Error ? e2.message : 'Could not create alert'),
      }
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className={labelCls} htmlFor="al-sym">Ticker</label>
        <input id="al-sym" className={`${inputCls} uppercase`} value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="AAPL" maxLength={10} autoComplete="off" required />
      </div>
      <div>
        <label className={labelCls} htmlFor="al-cond">Condition</label>
        <select id="al-cond" className={inputCls} value={condition} onChange={(e) => pickCondition(e.target.value as AlertCondition)}>
          {CONDITION_ORDER.map((c) => (
            <option key={c} value={c}>{CONDITION_META[c].label}</option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-fg-muted">{meta.hint}</p>
      </div>
      <div>
        <label className={labelCls} htmlFor="al-thr">
          {meta.unit === 'days' ? 'Days before the report (1–30)' : `Level ${meta.unit === '$' ? '(USD)' : meta.unit === '%' ? '(%)' : '(0–100)'}`}
        </label>
        <input id="al-thr" className={inputCls} type="number" step={meta.step} min={meta.min} max={meta.max} value={threshold} onChange={(e) => setThreshold(e.target.value)} required />
        {err && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{err}</p>}
      </div>
      <div>
        <label className={labelCls} htmlFor="al-note">Note (optional)</label>
        <input id="al-note" className={inputCls} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. breakout above resistance" />
      </div>
      <label className="flex items-start gap-2 text-sm text-fg-primary">
        <input type="checkbox" className="mt-0.5" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
        <span>
          Repeat
          <span className="block text-[11px] text-fg-muted">
            {isEarningsCondition(condition)
              ? 'Keep the alert on for future quarters. Each report notifies you once.'
              : 'Keep the alert on after it fires. It re-arms once the condition is no longer met.'}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm text-fg-primary">
        <input type="checkbox" className="mt-0.5" checked={email} onChange={(e) => setEmail(e.target.checked)} />
        <span>
          Also email me
          <span className="block text-[11px] text-fg-muted">Email delivery is a Pro feature. Everyone gets the in-app notification.</span>
        </span>
      </label>
      <button
        type="submit"
        disabled={create.isPending || !!err}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-[#fff] hover:bg-indigo-500 disabled:opacity-50"
      >
        {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Create alert
      </button>
      <p className="text-center text-[11px] text-fg-muted">Alerts are checked about every 5 minutes using delayed market data.</p>
    </form>
  )
}

export type AlertFilter = 'all' | AlertStatus

export function useAlertsController() {
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const toast = useToast()
  const q = useAlerts(isAuthenticated)
  const m = useAlertMutations()
  const [filter, setFilter] = useState<AlertFilter>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [prefill, setPrefill] = useState('')
  const [prefillCondition, setPrefillCondition] = useState<AlertCondition>('price_above')

  // /alerts?symbol=NVDA opens the create form for that ticker.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const s = params.get('symbol')
      const cond = params.get('condition') as AlertCondition | null
      if (cond && cond in CONDITION_META) setPrefillCondition(cond)
      if (s && /^[A-Za-z0-9.\-]{1,10}$/.test(s)) {
        setPrefill(s.toUpperCase())
        setCreateOpen(true)
      }
    } catch {
      /* no-op */
    }
  }, [])

  const alerts = useMemo(() => q.data?.alerts ?? [], [q.data])
  const counts = useMemo(() => {
    const c: Record<AlertFilter, number> = { all: alerts.length, active: 0, triggered: 0, paused: 0 }
    alerts.forEach((a) => (c[a.status] += 1))
    return c
  }, [alerts])
  const shown = filter === 'all' ? alerts : alerts.filter((a) => a.status === filter)

  const toggle = (a: PriceAlert) => {
    if (a.id < 0) return // optimistic row from a one-click suggestion, not saved yet
    const next = a.status === 'active' ? 'paused' : 'active'
    m.update.mutate(
      { id: a.id, status: next },
      {
        onSuccess: () => toast.success(next === 'paused' ? `${a.symbol} alert paused` : `${a.symbol} alert active`),
        onError: (e) => toast.error(e instanceof Error ? e.message : 'Update failed'),
      }
    )
  }
  const remove = (a: PriceAlert) => {
    if (a.id < 0) return
    if (!window.confirm(`Delete the ${a.symbol} alert (${describeAlert(a).toLowerCase()})?`)) return
    m.remove.mutate(a.id, {
      onSuccess: () => toast.success('Alert deleted'),
      onError: (e) => toast.error(e instanceof Error ? e.message : 'Delete failed'),
    })
  }

  return {
    isAuthenticated, authLoading, loading: q.isLoading, error: q.error as Error | null,
    alerts, shown, counts, limit: q.data?.limit ?? 50,
    filter, setFilter, createOpen, setCreateOpen, prefill, setPrefill, prefillCondition, toggle, remove,
  }
}

/** Suggestions state shared by desktop and mobile: fetch, dismiss (localStorage), optimistic add. */
export function useSuggestedAlerts(signedIn: boolean, alerts: PriceAlert[], enabled: boolean) {
  const toast = useToast()
  const q = useAlertSuggestions(signedIn, enabled)
  const add = useAddSuggestion()
  const [dismissed, setDismissed] = useState<Record<string, number>>({})
  const [added, setAdded] = useState<Record<string, true>>({})
  const [pending, setPending] = useState<string | null>(null)
  useEffect(() => setDismissed(readDismissed()), [])

  const all = useMemo(() => q.data?.suggestions ?? [], [q.data])
  const shown = useMemo(() => visibleSuggestions(all, { ...dismissed, ...added }, alerts), [all, dismissed, added, alerts])

  const dismiss = useCallback((s: AlertSuggestion) => {
    setDismissed((d) => {
      const next = { ...d, [s.id]: Date.now() }
      writeDismissed(next)
      return next
    })
  }, [])

  const addOne = (s: AlertSuggestion) => {
    setPending(s.id)
    setAdded((m) => ({ ...m, [s.id]: true })) // optimistic: card leaves right away
    add.mutate(s, {
      onSuccess: () => toast.success(`Alert set: ${s.symbol} ${describeAlert(s).toLowerCase()}`),
      onError: (e) => {
        setAdded((m) => {
          const next = { ...m }
          delete next[s.id]
          return next
        })
        toast.error(e instanceof Error ? e.message : 'Could not add alert')
      },
      onSettled: () => setPending(null),
    })
  }

  return {
    shown, loading: q.isLoading, error: q.error as Error | null,
    personalized: !!q.data?.personalized, dismiss, add: addOne, pending,
  }
}

function SuggestionCard({
  s, signedIn, onAdd, onDismiss, busy, compact,
}: {
  s: AlertSuggestion; signedIn: boolean; onAdd: () => void; onDismiss: () => void; busy: boolean; compact?: boolean
}) {
  const src = SOURCE_META[s.source]
  return (
    <li className={`relative flex flex-col rounded-xl border border-line-subtle bg-surface-raised p-3 ${compact ? 'w-[264px] shrink-0 snap-start' : ''}`}>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={`Dismiss ${s.symbol} suggestion`}
        className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full text-fg-muted hover:bg-surface-base hover:text-fg-primary"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-center gap-2 pr-7">
        <TickerLogo symbol={s.symbol} size={28} />
        <div className="min-w-0">
          <Link href={`/research?symbol=${s.symbol}`} className="block font-semibold leading-tight text-fg-primary">{s.symbol}</Link>
          <span className="block truncate text-[11px] text-fg-muted">
            {s.current_price != null ? `$${s.current_price.toFixed(2)}` : s.name ?? ''}
            {s.change_percent != null && (
              <span className={s.change_percent >= 0 ? 'ml-1 text-emerald-600 dark:text-emerald-400' : 'ml-1 text-red-600 dark:text-red-400'}>
                {s.change_percent >= 0 ? '+' : ''}{s.change_percent.toFixed(2)}%
              </span>
            )}
          </span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${src.cls}`}>{src.label}</span>
        <span className="text-[11px] font-medium text-fg-secondary">{s.label}</span>
      </div>
      <p className="mt-1.5 text-sm font-medium text-fg-primary">{describeAlert(s)}</p>
      <p className="mt-1 flex-1 text-[12px] leading-snug text-fg-muted">{s.reason}</p>
      {signedIn ? (
        <button
          type="button"
          onClick={onAdd}
          disabled={busy}
          className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-[#fff] hover:bg-indigo-500 active:scale-[0.98] disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add alert
        </button>
      ) : (
        <Link
          href="/auth"
          className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-line-default px-3 py-1.5 text-sm font-semibold text-fg-primary hover:bg-surface-base"
        >
          <LogIn className="h-4 w-4" /> Sign in to add
        </Link>
      )}
    </li>
  )
}

/**
 * "Suggested for you": one-click alert ideas from the user's holdings, watchlist,
 * 52-week extremes, today's movers and upcoming earnings. ``prominent`` is used when
 * the user has no alerts yet (more cards, bigger heading).
 */
export function SuggestedAlerts({
  variant, signedIn, alerts, prominent = false, atLimit = false,
}: { variant: 'desktop' | 'mobile'; signedIn: boolean; alerts: PriceAlert[]; prominent?: boolean; atLimit?: boolean }) {
  const sg = useSuggestedAlerts(signedIn, alerts, !atLimit)
  const [expanded, setExpanded] = useState(false)
  if (atLimit || sg.error || (!sg.loading && sg.shown.length === 0)) return null
  const mobile = variant === 'mobile'
  const cap = mobile ? sg.shown.length : prominent || expanded ? 9 : 3
  const list = sg.shown.slice(0, cap)
  const title = signedIn ? 'Suggested for you' : 'Ideas to watch'
  const sub = signedIn
    ? sg.personalized
      ? 'From your holdings, watchlist and today’s market. One click adds the alert; you can edit or delete it later.'
      : 'From today’s market. Add stocks to your portfolio or watchlist for personal suggestions.'
    : 'Market-based ideas. Sign in to add them and get suggestions for your own holdings.'

  return (
    <section aria-label={title} className={mobile ? '' : prominent ? 'mb-6' : 'mb-5'}>
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <h2 className={`flex items-center gap-1.5 font-semibold text-fg-primary ${prominent && !mobile ? 'text-lg' : 'text-sm'}`}>
            <Sparkles className="h-4 w-4 text-indigo-500" /> {title}
          </h2>
          <p className="mt-0.5 text-[11px] text-fg-muted">{sub}</p>
        </div>
        {!mobile && !prominent && sg.shown.length > 3 && (
          <button type="button" onClick={() => setExpanded((v) => !v)} className="shrink-0 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            {expanded ? 'Show fewer' : `Show all (${Math.min(sg.shown.length, 9)})`}
          </button>
        )}
      </div>
      {sg.loading ? (
        <div className={mobile ? '-mx-4 flex gap-2 overflow-hidden px-4' : `grid gap-3 ${GRID3}`}>
          {[0, 1, 2].map((i) => (
            <div key={i} className={`h-44 animate-pulse rounded-xl border border-line-subtle bg-surface-raised ${mobile ? 'w-[264px] shrink-0' : ''}`} />
          ))}
        </div>
      ) : (
        <ul className={mobile ? '-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide' : `grid gap-3 ${GRID3}`}>
          {list.map((s) => (
            <SuggestionCard
              key={s.id}
              s={s}
              signedIn={signedIn}
              compact={mobile}
              busy={sg.pending === s.id}
              onAdd={() => sg.add(s)}
              onDismiss={() => sg.dismiss(s)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

export const FILTERS: { id: AlertFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'triggered', label: 'Triggered' },
  { id: 'paused', label: 'Paused' },
]

/** Loading placeholder shaped like the alert list (filter tabs, then rows). */
export function AlertsListSkeleton({ rows = 4, compact = false }: { rows?: number; compact?: boolean }) {
  return (
    <div aria-busy="true" aria-label="Loading alerts">
      <div className="mb-4 flex gap-1 rounded-xl border border-line-subtle bg-surface-base p-1">
        {FILTERS.map((f) => (
          <Skeleton key={f.id} className={compact ? 'h-7 w-16 rounded-full' : 'h-8 w-20 rounded-lg'} />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border border-line-subtle bg-surface-raised p-3">
            <Skeleton variant="circular" className="h-9 w-9 shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-2/3" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function relTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso).getTime()
  if (Number.isNaN(d)) return '—'
  const s = Math.max(0, (Date.now() - d) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
