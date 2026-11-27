'use client'

/**
 * Shared by AlertsDesktop and AlertsMobile: the create form, the overlay
 * container (modal / bottom sheet) and the page controller hook.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Loader2, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/Toast'
import {
  CONDITION_META,
  CONDITION_ORDER,
  describeAlert,
  isEarningsCondition,
  useAlertMutations,
  useAlerts,
  validateThreshold,
  type AlertCondition,
  type AlertStatus,
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

export const FILTERS: { id: AlertFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'triggered', label: 'Triggered' },
  { id: 'paused', label: 'Paused' },
]

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
