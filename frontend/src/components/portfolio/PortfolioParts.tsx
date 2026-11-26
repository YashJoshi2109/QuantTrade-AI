'use client'

/**
 * Building blocks shared by the desktop and mobile Portfolio views.
 * Containers (modal vs. bottom sheet, table vs. cards) differ per view; the
 * forms, numbers and copy come from here so the two never drift apart.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FlaskConical, Loader2, X } from 'lucide-react'
import { fetchQuote } from '@/lib/api'
import {
  estimateOrder,
  fmtMoney,
  fmtPct,
  fmtQty,
  pnlClass,
  sliceColor,
  todayIso,
  type AllocationSlice,
  type PortfolioKind,
  type PortfolioSummary,
  type TxnType,
} from '@/lib/portfolio'
import { usePortfolioMutations } from '@/lib/usePortfolios'
import { useToast } from '@/components/Toast'

const inputCls =
  'w-full rounded-lg border border-line-default bg-surface-base px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-indigo-500/40'
const labelCls = 'block text-xs font-medium text-fg-secondary mb-1'
const primaryBtn =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-[#fff] hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed'

export const SIMULATED_COPY =
  'Paper trading is a simulation with virtual money. Orders fill instantly at the latest available price and are never sent to a broker.'

export function SimulatedBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400 ${className}`}
    >
      <FlaskConical className="h-3 w-3" aria-hidden /> Simulated
    </span>
  )
}

export function SimulatedBanner() {
  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300"
    >
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p>
        <strong className="font-semibold">Simulated account.</strong> {SIMULATED_COPY}
      </p>
    </div>
  )
}

/** Modal on desktop, bottom sheet on mobile. Closes on Escape and backdrop click. */
export function Overlay({
  open,
  onClose,
  title,
  variant,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  variant: 'modal' | 'sheet'
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    ref.current?.querySelector<HTMLElement>('input,select,button')?.focus()
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
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-fg-secondary hover:bg-surface-raised"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Headline numbers. Same metrics on both views; `cols` controls the grid. */
export function KpiGrid({ s, cols = 4 }: { s: PortfolioSummary; cols?: 2 | 4 }) {
  const items: { label: string; value: string; sub?: string; cls?: string }[] = [
    {
      label: s.simulated ? 'Account value' : 'Market value',
      value: fmtMoney(s.total_value),
      sub: s.simulated ? `Cash ${fmtMoney(s.cash)}` : `Cost basis ${fmtMoney(s.cost_basis)}`,
    },
    {
      label: 'Today',
      value: fmtMoney(s.day_change, { signed: true }),
      sub: fmtPct(s.day_change_percent),
      cls: pnlClass(s.day_change),
    },
    {
      label: 'Unrealized P&L',
      value: fmtMoney(s.unrealized_pnl, { signed: true }),
      sub: s.simulated ? `Total return ${fmtPct(s.total_return_percent)}` : fmtPct(s.total_return_percent),
      cls: pnlClass(s.unrealized_pnl),
    },
    {
      label: 'Realized + dividends',
      value: fmtMoney(s.realized_pnl + s.dividends, { signed: true }),
      sub: `Dividends ${fmtMoney(s.dividends)}`,
      cls: pnlClass(s.realized_pnl + s.dividends),
    },
  ]
  return (
    <div className={`grid gap-3 ${cols === 4 ? 'grid-cols-[repeat(2,minmax(0,1fr))] lg:grid-cols-4' : 'grid-cols-[repeat(2,minmax(0,1fr))]'}`}>
      {items.map((k) => (
        <div key={k.label} className="hud-card p-3 sm:p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">{k.label}</p>
          <p className={`mt-1 text-lg font-bold tabular-nums sm:text-xl ${k.cls ?? 'text-fg-primary'}`}>{k.value}</p>
          {k.sub && <p className={`mt-0.5 text-xs tabular-nums ${k.cls ?? 'text-fg-secondary'}`}>{k.sub}</p>}
        </div>
      ))}
    </div>
  )
}

/** SVG donut + legend. No chart lib needed for a handful of slices. */
export function AllocationDonut({ slices, size = 140 }: { slices: AllocationSlice[]; size?: number }) {
  const total = slices.reduce((a, s) => a + s.value, 0)
  const r = 15.915 // circumference 100
  let offset = 25
  if (!slices.length || total <= 0) {
    return <p className="text-sm text-fg-muted">No priced holdings yet.</p>
  }
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 42 42" width={size} height={size} role="img" aria-label="Allocation by sector">
        <circle cx="21" cy="21" r={r} fill="none" stroke="currentColor" className="text-surface-raised" strokeWidth="6" />
        {slices.map((s, i) => {
          const pct = (s.value / total) * 100
          const el = (
            <circle
              key={s.label}
              cx="21"
              cy="21"
              r={r}
              fill="none"
              stroke={sliceColor(s.label, i)}
              strokeWidth="6"
              strokeDasharray={`${pct} ${100 - pct}`}
              strokeDashoffset={offset}
            >
              <title>{`${s.label}: ${s.weight.toFixed(1)}%`}</title>
            </circle>
          )
          offset -= pct
          return el
        })}
      </svg>
      <ul className="min-w-0 max-w-[260px] flex-1 space-y-1.5">
        {slices.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: sliceColor(s.label, i) }} />
            <span className="min-w-0 flex-1 truncate text-fg-secondary">{s.label}</span>
            <span className="tabular-nums font-medium text-fg-primary">{s.weight.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function CreatePortfolioForm({ onDone }: { onDone: (id: number) => void }) {
  const toast = useToast()
  const { create } = usePortfolioMutations(null)
  const [kind, setKind] = useState<PortfolioKind>('tracked')
  const [name, setName] = useState('')
  const [cash, setCash] = useState('100000')
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const body =
      kind === 'paper'
        ? { name: name.trim() || 'Paper account', kind, starting_cash: Number(cash) }
        : { name: name.trim() || 'My holdings', kind }
    create.mutate(body, {
      onSuccess: (p) => {
        toast.success(`${p.name} created`)
        onDone(p.id)
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not create portfolio'),
    })
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset>
        <legend className={labelCls}>Type</legend>
        <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-2">
          {(
            [
              ['tracked', 'Track holdings', 'Record trades you made at your broker.'],
              ['paper', 'Paper trading', 'Practice with virtual cash. Simulated.'],
            ] as const
          ).map(([k, t, d]) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={`rounded-xl border p-3 text-left transition-colors ${
                kind === k ? 'border-indigo-500 bg-indigo-500/10' : 'border-line-default hover:bg-surface-raised'
              }`}
            >
              <span className="block text-sm font-semibold text-fg-primary">{t}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-fg-muted">{d}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <label className={labelCls} htmlFor="pf-name">Name</label>
        <input
          id="pf-name"
          className={inputCls}
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={kind === 'paper' ? 'Paper account' : 'My holdings'}
        />
      </div>
      {kind === 'paper' && (
        <>
          <div>
            <label className={labelCls} htmlFor="pf-cash">Starting virtual cash (USD)</label>
            <input
              id="pf-cash"
              className={inputCls}
              type="number"
              min={1000}
              max={10000000}
              step={1000}
              value={cash}
              onChange={(e) => setCash(e.target.value)}
              required
            />
          </div>
          <SimulatedBanner />
        </>
      )}
      <button type="submit" className={`${primaryBtn} w-full`} disabled={create.isPending}>
        {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Create portfolio
      </button>
    </form>
  )
}

/** Tracked: record a trade/dividend. Paper: place a SIMULATED market order. */
export function TradeForm({
  portfolio,
  initialSymbol = '',
  initialSide = 'BUY',
  onDone,
}: {
  portfolio: PortfolioSummary
  initialSymbol?: string
  initialSide?: TxnType
  onDone: () => void
}) {
  const toast = useToast()
  const m = usePortfolioMutations(portfolio.id)
  const paper = portfolio.simulated
  const [symbol, setSymbol] = useState(initialSymbol)
  const [type, setType] = useState<TxnType>(paper && initialSide === 'DIVIDEND' ? 'BUY' : initialSide)
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')
  const [amount, setAmount] = useState('')
  const [fees, setFees] = useState('')
  const [date, setDate] = useState(todayIso())
  const [notes, setNotes] = useState('')

  const sym = symbol.trim().toUpperCase()
  const validSym = /^[A-Z0-9.\-]{1,10}$/.test(sym)
  const held = useMemo(
    () => portfolio.holdings.find((h) => h.symbol === sym)?.quantity ?? 0,
    [portfolio.holdings, sym]
  )
  // Live price preview for paper orders (the server re-prices at submit).
  const quote = useQuery({
    queryKey: ['portfolio-order-quote', sym],
    queryFn: () => fetchQuote(sym, 'high'),
    enabled: paper && validSym,
    staleTime: 15_000,
  })
  const livePrice = quote.data?.price && quote.data.price > 0 ? quote.data.price : null
  const est = paper && type !== 'DIVIDEND' ? estimateOrder(type, Number(qty), livePrice, portfolio.cash, held) : null
  const pending = m.addTxn.isPending || m.order.isPending

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validSym) return toast.error('Enter a valid ticker')
    if (paper) {
      if (type === 'DIVIDEND') return
      if (est?.error) return toast.error(est.error)
      m.order.mutate(
        { symbol: sym, side: type, quantity: Number(qty) },
        {
          onSuccess: (r) => {
            toast.success(
              `Simulated ${r.order.type === 'BUY' ? 'buy' : 'sell'} filled: ${fmtQty(r.order.quantity)} ${r.order.symbol} @ ${fmtMoney(r.order.fill_price)}`
            )
            onDone()
          },
          onError: (err) => toast.error(err instanceof Error ? err.message : 'Order rejected'),
        }
      )
      return
    }
    const body =
      type === 'DIVIDEND'
        ? { symbol: sym, type, amount: Number(amount), trade_date: date, notes: notes || undefined }
        : {
            symbol: sym,
            type,
            quantity: Number(qty),
            price: Number(price),
            fees: fees ? Number(fees) : 0,
            trade_date: date,
            notes: notes || undefined,
          }
    m.addTxn.mutate(body, {
      onSuccess: (t) => {
        toast.success(`${t.type === 'DIVIDEND' ? 'Dividend' : t.type === 'BUY' ? 'Buy' : 'Sell'} recorded for ${t.symbol}`)
        onDone()
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not save transaction'),
    })
  }

  const sides: TxnType[] = paper ? ['BUY', 'SELL'] : ['BUY', 'SELL', 'DIVIDEND']
  return (
    <form onSubmit={submit} className="space-y-4">
      {paper && <SimulatedBanner />}
      <div className={`grid ${sides.length === 2 ? 'grid-cols-[repeat(2,minmax(0,1fr))]' : 'grid-cols-[repeat(3,minmax(0,1fr))]'} gap-1 rounded-xl border border-line-subtle bg-surface-raised/50 p-1`} role="radiogroup" aria-label="Side">
        {sides.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={type === s}
            onClick={() => setType(s)}
            className={`rounded-lg py-1.5 text-sm font-semibold transition-colors ${
              type === s
                ? s === 'SELL'
                  ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                  : s === 'BUY'
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                    : 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400'
                : 'text-fg-secondary hover:text-fg-primary'
            }`}
          >
            {s === 'DIVIDEND' ? 'Dividend' : s === 'BUY' ? 'Buy' : 'Sell'}
          </button>
        ))}
      </div>
      <div>
        <label className={labelCls} htmlFor="tf-sym">Ticker</label>
        <input
          id="tf-sym"
          className={`${inputCls} uppercase`}
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="AAPL"
          autoComplete="off"
          maxLength={10}
          required
        />
        {held > 0 && <p className="mt-1 text-[11px] text-fg-muted">You hold {fmtQty(held)} shares</p>}
      </div>

      {type === 'DIVIDEND' ? (
        <div>
          <label className={labelCls} htmlFor="tf-amt">Cash received (USD)</label>
          <input id="tf-amt" className={inputCls} type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3">
          <div>
            <label className={labelCls} htmlFor="tf-qty">Shares</label>
            <input id="tf-qty" className={inputCls} type="number" min="0.000001" step="any" value={qty} onChange={(e) => setQty(e.target.value)} required />
          </div>
          {paper ? (
            <div>
              <span className={labelCls}>Market price</span>
              <p className="flex h-[38px] items-center text-sm font-semibold tabular-nums text-fg-primary">
                {!validSym ? '—' : quote.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-fg-muted" /> : livePrice ? fmtMoney(livePrice) : 'Unavailable'}
              </p>
            </div>
          ) : (
            <div>
              <label className={labelCls} htmlFor="tf-price">Price per share</label>
              <input id="tf-price" className={inputCls} type="number" min="0.0001" step="any" value={price} onChange={(e) => setPrice(e.target.value)} required />
            </div>
          )}
        </div>
      )}

      {!paper && (
        <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3">
          <div>
            <label className={labelCls} htmlFor="tf-date">Trade date</label>
            <input id="tf-date" className={inputCls} type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          {type !== 'DIVIDEND' && (
            <div>
              <label className={labelCls} htmlFor="tf-fees">Fees (optional)</label>
              <input id="tf-fees" className={inputCls} type="number" min="0" step="0.01" value={fees} onChange={(e) => setFees(e.target.value)} />
            </div>
          )}
        </div>
      )}
      {!paper && (
        <div>
          <label className={labelCls} htmlFor="tf-notes">Notes (optional)</label>
          <input id="tf-notes" className={inputCls} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      )}

      {paper && (
        <div className="rounded-xl border border-line-subtle bg-surface-raised/50 p-3 text-xs">
          <div className="flex justify-between text-fg-secondary">
            <span>Estimated {type === 'SELL' ? 'proceeds' : 'cost'}</span>
            <span className="tabular-nums font-semibold text-fg-primary">{fmtMoney(est?.notional ?? null)}</span>
          </div>
          <div className="mt-1 flex justify-between text-fg-secondary">
            <span>Simulated cash</span>
            <span className="tabular-nums">{fmtMoney(portfolio.cash)}</span>
          </div>
          {est?.error && qty !== '' && <p className="mt-2 text-red-600 dark:text-red-400">{est.error}</p>}
        </div>
      )}

      <button type="submit" className={`${primaryBtn} w-full`} disabled={pending || (paper && !!est?.error && qty !== '')}>
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {paper ? `Place simulated ${type === 'SELL' ? 'sell' : 'buy'}` : 'Save transaction'}
      </button>
    </form>
  )
}
