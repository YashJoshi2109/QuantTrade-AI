'use client'

/**
 * Building blocks of the Kite-style Marketwatch, shared by the desktop page
 * (MarketwatchDesktop) and the mobile view (layout/MobileWatchlist).
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  BellRing, Briefcase, Check, ChevronLeft, ChevronRight, LineChart, Loader2, MoreHorizontal,
  Pencil, Plus, Search, Trash2, X,
} from 'lucide-react'
import { searchSymbols, type SearchResult } from '@/lib/api'
import {
  SORT_LABEL, SYMBOL_RE, dirClass, fmtLtp, fmtSigned, holdingsTotals,
  type HeldSummary, type HoldingRow, type SortMode, type WatchItem, type WatchList, type WatchQuote,
} from '@/lib/marketwatch'
import { fmtMoney, fmtPct, fmtQty } from '@/lib/portfolio'
import { Skeleton } from '@/components/Skeleton'
import { HOLDINGS_TAB } from './useMarketwatchController'

export const researchHref = (s: string) => `/research?symbol=${encodeURIComponent(s)}`

// ── list tabs ────────────────────────────────────────────────────────────────

export function ListTabs({
  lists, activeKey, onSelect, onCreate, holdingsCount, canCreate, compact,
}: {
  lists: WatchList[]
  activeKey: string
  onSelect: (key: string) => void
  onCreate: () => void
  holdingsCount: number | null
  canCreate: boolean
  compact?: boolean
}) {
  const tab = (active: boolean) =>
    `relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-xs font-semibold transition-colors ${
      compact ? 'h-8 rounded-full border' : 'h-9 border-b-2'
    } ${
      active
        ? compact
          ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300'
          : 'border-indigo-500 text-fg-primary'
        : compact
          ? 'border-line-subtle bg-surface-raised text-fg-secondary'
          : 'border-transparent text-fg-muted hover:text-fg-primary'
    }`
  return (
    <div
      role="tablist"
      aria-label="Watchlists"
      className={`flex items-center overflow-x-auto scrollbar-hide ${compact ? 'gap-2' : 'gap-0.5 border-b border-line-subtle'}`}
    >
      {lists.map((l, i) => (
        <button
          key={l.id}
          role="tab"
          aria-selected={activeKey === String(l.id)}
          onClick={() => onSelect(String(l.id))}
          title={compact ? undefined : `${l.name} (${i + 1})`}
          className={tab(activeKey === String(l.id))}
        >
          {l.name}
          <span className="tabular-nums font-normal opacity-60">{l.items.length}</span>
        </button>
      ))}
      {canCreate && (
        <button type="button" onClick={onCreate} aria-label="New watchlist" title="New watchlist" className={`${tab(false)} !px-2`}>
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
      <span className="flex-1" />
      <button
        role="tab"
        aria-selected={activeKey === HOLDINGS_TAB}
        onClick={() => onSelect(HOLDINGS_TAB)}
        className={tab(activeKey === HOLDINGS_TAB)}
        title={compact ? undefined : `Holdings (${lists.length + 1})`}
      >
        <Briefcase className="h-3.5 w-3.5" />
        Holdings
        {holdingsCount != null && <span className="tabular-nums font-normal opacity-60">{holdingsCount}</span>}
      </button>
    </div>
  )
}

// ── search to add ────────────────────────────────────────────────────────────

export function SearchAdd({
  listName, inList, onAdd, adding, inputRef, compact,
}: {
  listName: string
  inList: (s: string) => boolean
  onAdd: (symbol: string) => Promise<boolean>
  adding: boolean
  inputRef?: React.RefObject<HTMLInputElement>
  compact?: boolean
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [hi, setHi] = useState(0)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const term = q.trim()
    if (!term) {
      setResults([])
      setLoading(false)
      setFailed(false)
      return
    }
    setLoading(true)
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const r = await searchSymbols(term, 8)
        if (!cancelled) {
          setResults(r)
          setFailed(false)
          setHi(0)
        }
      } catch {
        if (!cancelled) {
          setResults([])
          setFailed(true)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [q])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const typed = q.trim().toUpperCase()
  const options: { symbol: string; name: string | null; exchange: string | null }[] = results.length
    ? results.map((r) => ({ symbol: r.symbol.toUpperCase(), name: r.name, exchange: r.exchange }))
    : !loading && SYMBOL_RE.test(typed)
      ? [{ symbol: typed, name: null, exchange: null }]
      : []

  const pick = async (sym: string) => {
    if (inList(sym)) return
    const ok = await onAdd(sym)
    if (ok) {
      setQ('')
      setResults([])
    }
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHi((h) => Math.min(h + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHi((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const o = options[hi] ?? options[0]
      if (o) pick(o.symbol)
    } else if (e.key === 'Escape') {
      if (q) setQ('')
      else (e.target as HTMLInputElement).blur()
      setOpen(false)
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" aria-hidden />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        role="combobox"
        aria-expanded={open && !!q}
        aria-controls="mw-search-results"
        aria-label={`Search and add to ${listName}`}
        autoComplete="off"
        spellCheck={false}
        placeholder={compact ? `Search & add to ${listName}` : `Search & add  (e.g. AAPL, Nvidia)`}
        className={`w-full rounded-lg border border-line-subtle bg-surface-raised pl-9 pr-10 text-sm text-fg-primary placeholder:text-fg-muted focus:border-indigo-500/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 ${compact ? 'h-10' : 'h-9'}`}
      />
      {loading || adding ? (
        <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-fg-muted" />
      ) : q ? (
        <button type="button" aria-label="Clear search" onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-muted hover:text-fg-primary">
          <X className="h-3.5 w-3.5" />
        </button>
      ) : !compact ? (
        <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-line-default px-1.5 text-[10px] text-fg-muted">/</kbd>
      ) : null}

      {open && q.trim() && (
        <ul
          id="mw-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-lg border border-line-default bg-white py-1 shadow-xl dark:bg-slate-900"
        >
          {loading && !results.length ? (
            Array.from({ length: 3 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-2">
                <Skeleton className="h-3.5 w-14" />
                <Skeleton className="h-3 flex-1" />
              </li>
            ))
          ) : options.length === 0 ? (
            <li className="px-3 py-3 text-xs text-fg-muted">{failed ? 'Search is unavailable right now.' : `No matches for “${q.trim()}”.`}</li>
          ) : (
            options.map((o, i) => {
              const added = inList(o.symbol)
              return (
                <li key={o.symbol} role="option" aria-selected={i === hi}>
                  <button
                    type="button"
                    onMouseEnter={() => setHi(i)}
                    onClick={() => pick(o.symbol)}
                    disabled={added || adding}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${i === hi ? 'bg-surface-hover' : ''} disabled:cursor-default`}
                  >
                    <span className="w-16 shrink-0 font-semibold text-fg-primary">{o.symbol}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-fg-secondary">{o.name ?? 'Add by ticker'}</span>
                    {o.exchange && <span className="shrink-0 text-[10px] uppercase text-fg-muted">{o.exchange}</span>}
                    {added ? (
                      <span className="flex shrink-0 items-center gap-1 text-[11px] text-fg-muted"><Check className="h-3.5 w-3.5" />Added</span>
                    ) : (
                      <Plus className="h-4 w-4 shrink-0 text-indigo-500" aria-label={`Add ${o.symbol}`} />
                    )}
                  </button>
                </li>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}

// ── list toolbar (sort + rename / move / delete) ─────────────────────────────

export function ListToolbar({
  list, count, sort, onSort, onRename, onShift, onDelete, isFirst, isLast, updatedAt,
}: {
  list: WatchList
  count: number
  sort: SortMode
  onSort: (s: SortMode) => void
  onRename: (name: string) => void
  onShift: (delta: number) => void
  onDelete: () => void
  isFirst: boolean
  isLast: boolean
  updatedAt?: number
}) {
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(list.name)
  const [confirm, setConfirm] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => setName(list.name), [list.name])
  useEffect(() => {
    if (!menu) {
      setConfirm(false)
      return
    }
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setMenu(false)
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menu])

  return (
    <div className="flex h-9 items-center gap-2 text-xs text-fg-muted">
      {editing ? (
        <form
          className="flex min-w-0 flex-1 items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            onRename(name)
            setEditing(false)
          }}
        >
          <input
            autoFocus
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
            aria-label="Watchlist name"
            className="h-7 min-w-0 flex-1 rounded border border-line-default bg-surface-base px-2 text-xs text-fg-primary focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
          <button type="submit" aria-label="Save name" className="rounded p-1 text-fg-secondary hover:bg-surface-hover"><Check className="h-3.5 w-3.5" /></button>
        </form>
      ) : (
        <span className="min-w-0 flex-1 truncate">
          <span className="tabular-nums">{count}</span> symbol{count === 1 ? '' : 's'}
          {updatedAt ? <span className="ml-2 hidden tabular-nums sm:inline">· updated {new Date(updatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span> : null}
        </span>
      )}
      <label className="sr-only" htmlFor={`mw-sort-${list.id}`}>Sort</label>
      <select
        id={`mw-sort-${list.id}`}
        value={sort}
        onChange={(e) => onSort(e.target.value as SortMode)}
        className="h-7 rounded border border-line-subtle bg-surface-raised px-1.5 text-xs text-fg-secondary focus:outline-none"
      >
        {(Object.keys(SORT_LABEL) as SortMode[]).map((k) => (
          <option key={k} value={k}>{SORT_LABEL[k]}</option>
        ))}
      </select>
      <div ref={ref} className="relative">
        <button type="button" aria-label="Watchlist options" aria-expanded={menu} onClick={() => setMenu((m) => !m)} className="rounded p-1.5 text-fg-secondary hover:bg-surface-hover">
          <MoreHorizontal className="h-4 w-4" />
        </button>
        {menu && (
          <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-44 rounded-lg border border-line-default bg-white py-1 text-xs shadow-xl dark:bg-slate-900">
            <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => { setEditing(true); setMenu(false) }}>Rename</MenuItem>
            <MenuItem icon={<ChevronLeft className="h-3.5 w-3.5" />} disabled={isFirst} onClick={() => { onShift(-1); setMenu(false) }}>Move tab left</MenuItem>
            <MenuItem icon={<ChevronRight className="h-3.5 w-3.5" />} disabled={isLast} onClick={() => { onShift(1); setMenu(false) }}>Move tab right</MenuItem>
            {!list.is_default && (
              <MenuItem
                icon={<Trash2 className="h-3.5 w-3.5" />}
                danger
                onClick={() => {
                  if (!confirm) return setConfirm(true)
                  onDelete()
                  setMenu(false)
                }}
              >
                {confirm ? 'Click again to delete' : 'Delete watchlist'}
              </MenuItem>
            )}
            {list.is_default && <p className="px-3 py-1.5 text-[11px] text-fg-muted">Default list: also your Watchlist on other pages.</p>}
          </div>
        )}
      </div>
    </div>
  )
}

function MenuItem({ icon, children, onClick, disabled, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-hover disabled:opacity-40 ${danger ? 'text-red-600 dark:text-red-400' : 'text-fg-secondary'}`}
    >
      {icon}
      {children}
    </button>
  )
}

// ── rows ─────────────────────────────────────────────────────────────────────

export function HeldBadge({ h }: { h?: HeldSummary }) {
  if (!h || (h.quantity <= 0 && h.simulatedQuantity <= 0)) return null
  const real = h.quantity > 0
  const qty = real ? h.quantity : h.simulatedQuantity
  return (
    <span
      title={`${real ? 'Held' : 'Held (paper, simulated)'}: ${fmtQty(qty)} in ${h.portfolios.join(', ')}`}
      className="inline-flex items-center gap-0.5 rounded bg-indigo-500/10 px-1 py-px text-[10px] font-medium tabular-nums text-indigo-600 dark:text-indigo-300"
    >
      <Briefcase className="h-2.5 w-2.5" aria-hidden />
      {fmtQty(qty)}
      {!real && <span className="opacity-70">P</span>}
    </span>
  )
}

export interface RowActions {
  onChart?: (s: string) => void
  onAlert: (s: string) => void
  onHolding: (s: string) => void
  onRemove?: (s: string) => void
}

export function WatchRow({
  item, quote, held, selected, onSelect, actions, quotesLoading, alertCount,
  draggable, onDragStart, onDragOver, onDrop, dropHint,
}: {
  item: WatchItem
  quote?: WatchQuote
  held?: HeldSummary
  selected: boolean
  onSelect: () => void
  actions: RowActions
  quotesLoading: boolean
  alertCount: number
  draggable: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  dropHint?: 'above' | 'below' | null
}) {
  const s = item.symbol
  const pending = quotesLoading && !quote
  return (
    <li
      data-symbol={s}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      aria-selected={selected}
      role="option"
      onClick={onSelect}
      onDoubleClick={() => actions.onChart?.(s)}
      className={`group relative flex h-11 cursor-pointer select-none items-center gap-2 border-b border-line-subtle px-3 text-sm transition-colors last:border-b-0 ${
        selected ? 'bg-indigo-500/[0.07]' : 'hover:bg-surface-hover'
      }`}
    >
      {selected && <span className="absolute inset-y-0 left-0 w-0.5 bg-indigo-500" aria-hidden />}
      {dropHint && <span className={`absolute inset-x-0 h-0.5 bg-indigo-500 ${dropHint === 'above' ? 'top-0' : 'bottom-0'}`} aria-hidden />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-fg-primary">{s}</span>
          <HeldBadge h={held} />
          {alertCount > 0 && (
            <span title={`${alertCount} active price alert${alertCount === 1 ? '' : 's'}`} className="inline-flex items-center text-amber-500">
              <BellRing className="h-3 w-3" aria-hidden />
              <span className="sr-only">{alertCount} alerts</span>
            </span>
          )}
        </div>
        <div className="truncate text-[11px] text-fg-muted">{item.name ?? item.exchange ?? ' '}</div>
      </div>

      {/* figures: fixed widths so nothing shifts when prices tick */}
      <div className="flex items-center gap-3 tabular-nums group-hover:invisible group-focus-within:invisible">
        {pending ? (
          <>
            <Skeleton className="h-3.5 w-12" />
            <Skeleton className="h-3.5 w-16" />
          </>
        ) : quote?.unavailable || !quote ? (
          <span className="w-[7.5rem] text-right text-xs text-fg-muted">No quote</span>
        ) : (
          <>
            <span className={`w-14 text-right text-xs ${dirClass(quote.change)}`}>{fmtSigned(quote.change_percent)}%</span>
            <span className={`w-[4.5rem] text-right font-medium ${dirClass(quote.change)}`}>{fmtLtp(quote.price)}</span>
          </>
        )}
      </div>

      {/* hover actions (Kite-style), replace the figures in place */}
      <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        {actions.onChart && <IconAction label={`Chart ${s} (C)`} onClick={() => actions.onChart?.(s)}><LineChart className="h-3.5 w-3.5" /></IconAction>}
        <Link
          href={researchHref(s)}
          onClick={(e) => e.stopPropagation()}
          title={`Research ${s} (Enter)`}
          className="flex h-7 items-center rounded-md border border-line-default bg-white px-2 text-[11px] font-semibold text-fg-secondary hover:text-fg-primary dark:bg-slate-900"
        >
          Research
        </Link>
        <IconAction label={`Price alert on ${s} (A)`} onClick={() => actions.onAlert(s)}><BellRing className="h-3.5 w-3.5" /></IconAction>
        <IconAction label={`Add ${s} holding (H)`} onClick={() => actions.onHolding(s)}><Briefcase className="h-3.5 w-3.5" /></IconAction>
        {actions.onRemove && (
          <IconAction label={`Remove ${s} (Del)`} danger onClick={() => actions.onRemove?.(s)}><Trash2 className="h-3.5 w-3.5" /></IconAction>
        )}
      </div>
    </li>
  )
}

function IconAction({ label, onClick, children, danger }: { label: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`flex h-7 w-7 items-center justify-center rounded-md border border-line-default bg-white text-fg-secondary dark:bg-slate-900 ${danger ? 'hover:text-red-500' : 'hover:text-fg-primary'}`}
    >
      {children}
    </button>
  )
}

/** Skeleton matching WatchRow's layout (same height, same columns). */
export function WatchRowsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <ul aria-hidden className="divide-y divide-line-subtle">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex h-11 items-center gap-2 px-3">
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-14" />
            <Skeleton className="h-2.5 w-28" />
          </div>
          <Skeleton className="h-3.5 w-12" />
          <Skeleton className="h-3.5 w-16" />
        </li>
      ))}
    </ul>
  )
}

// ── holdings ─────────────────────────────────────────────────────────────────

export function HoldingsSummary({ rows }: { rows: HoldingRow[] }) {
  const real = rows.filter((r) => !r.simulated)
  const t = holdingsTotals(real.length ? real : rows)
  const simulatedOnly = real.length === 0 && rows.length > 0
  return (
    <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line-subtle bg-line-subtle text-xs">
      <Stat label="Current value" value={fmtMoney(t.marketValue, { compact: true })} />
      <Stat label="Unrealized P&L" value={fmtMoney(t.unrealizedPnl, { signed: true, compact: true })} sub={fmtPct(t.unrealizedPct)} cls={dirClass(t.unrealizedPnl)} />
      <Stat label="Day's P&L" value={fmtMoney(t.dayChange, { signed: true, compact: true })} cls={dirClass(t.dayChange)} />
      <p className="col-span-3 bg-surface-raised px-3 py-1.5 text-[11px] text-fg-muted">
        {simulatedOnly ? 'Paper (simulated) portfolios only.' : rows.some((r) => r.simulated) ? 'Tracked portfolios; simulated paper holdings excluded from totals.' : 'All tracked portfolios.'}
        {t.unpriced > 0 && ` ${t.unpriced} without a live quote excluded.`}
      </p>
    </div>
  )
}

function Stat({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="bg-surface-raised px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-fg-muted">{label}</div>
      <div className={`mt-0.5 tabular-nums text-sm font-semibold ${cls ?? 'text-fg-primary'}`}>{value}</div>
      {sub && <div className={`tabular-nums text-[11px] ${cls ?? 'text-fg-muted'}`}>{sub}</div>}
    </div>
  )
}

export function HoldingRowView({
  h, selected, onSelect, onAlert, onHolding,
}: { h: HoldingRow; selected: boolean; onSelect: () => void; onAlert: (s: string) => void; onHolding: (s: string) => void }) {
  return (
    <li
      role="option"
      aria-selected={selected}
      data-symbol={h.symbol}
      onClick={onSelect}
      className={`group relative flex h-12 cursor-pointer items-center gap-2 border-b border-line-subtle px-3 text-sm last:border-b-0 ${selected ? 'bg-indigo-500/[0.07]' : 'hover:bg-surface-hover'}`}
    >
      {selected && <span className="absolute inset-y-0 left-0 w-0.5 bg-indigo-500" aria-hidden />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-fg-primary">{h.symbol}</span>
          {h.simulated && <span className="rounded bg-amber-500/10 px-1 text-[10px] font-medium text-amber-700 dark:text-amber-400">Paper</span>}
        </div>
        <div className="truncate text-[11px] tabular-nums text-fg-muted">
          {fmtQty(h.quantity)} @ {fmtLtp(h.avg_cost)} · {h.portfolio_name}
        </div>
      </div>
      <div className="text-right tabular-nums group-hover:invisible group-focus-within:invisible">
        {h.price == null ? (
          <span className="text-xs text-fg-muted">No quote</span>
        ) : (
          <>
            <div className={`text-sm font-medium ${dirClass(h.unrealized_pnl)}`}>{fmtMoney(h.unrealized_pnl, { signed: true })}</div>
            <div className="text-[11px] text-fg-muted">
              LTP {fmtLtp(h.price)} <span className={dirClass(h.unrealized_pnl_percent)}>{fmtPct(h.unrealized_pnl_percent)}</span>
            </div>
          </>
        )}
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        <Link href={researchHref(h.symbol)} onClick={(e) => e.stopPropagation()} className="flex h-7 items-center rounded-md border border-line-default bg-white px-2 text-[11px] font-semibold text-fg-secondary hover:text-fg-primary dark:bg-slate-900">Research</Link>
        <IconAction label={`Price alert on ${h.symbol}`} onClick={() => onAlert(h.symbol)}><BellRing className="h-3.5 w-3.5" /></IconAction>
        {!h.simulated && <IconAction label={`Add more ${h.symbol}`} onClick={() => onHolding(h.symbol)}><Plus className="h-3.5 w-3.5" /></IconAction>}
      </div>
    </li>
  )
}

export function HoldingsEmpty() {
  return (
    <div className="px-6 py-10 text-center">
      <Briefcase className="mx-auto mb-3 h-7 w-7 text-fg-muted" aria-hidden />
      <p className="text-sm font-semibold text-fg-primary">No holdings yet</p>
      <p className="mx-auto mt-1 max-w-xs text-xs text-fg-muted">
        Use the briefcase on any watch row to record shares you own, or import trades on the Portfolio page. They appear here with live P&amp;L.
      </p>
      <Link href="/portfolio" className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-line-default px-3 py-1.5 text-xs font-semibold text-fg-secondary hover:bg-surface-hover">
        Open Portfolio
      </Link>
    </div>
  )
}
