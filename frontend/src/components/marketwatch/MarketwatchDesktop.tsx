'use client'

/**
 * Desktop Marketwatch (Kite-style): named watchlist tabs + Holdings on the left,
 * the selected instrument on the right. Keyboard: / search, ↑↓ (or j/k) move,
 * Enter research, C chart, A alert, H add holding, Del remove, Alt+↑↓ reorder,
 * 1-9 switch tab. Mobile counterpart: components/layout/MobileWatchlist.tsx.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, Keyboard, LogIn, RefreshCw } from 'lucide-react'
import { useAlerts } from '@/lib/alerts'
import { quoteFromHolding, useWatchQuotes, type WatchQuote } from '@/lib/marketwatch'
import { useMarketRefreshInterval } from '@/hooks/useMarketRefresh'
import AddHoldingDialog from './AddHoldingDialog'
import InstrumentPanel from './InstrumentPanel'
import PriceAlertDialog from './PriceAlertDialog'
import {
  HoldingRowView, HoldingsEmpty, HoldingsSummary, ListTabs, ListToolbar, SearchAdd,
  WatchRow, WatchRowsSkeleton, researchHref,
} from './MarketwatchParts'
import { useMarketwatchController } from './useMarketwatchController'

const SHORTCUTS: [string, string][] = [
  ['/', 'Search & add'],
  ['↑ ↓  or  j k', 'Move selection'],
  ['Enter', 'Open research'],
  ['C', 'Chart (detail pane)'],
  ['A', 'Price alert'],
  ['H', 'Add holding'],
  ['Del', 'Remove from list'],
  ['Alt + ↑ ↓', 'Reorder row'],
  ['1 – 9', 'Switch watchlist'],
]

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}

export default function MarketwatchDesktop() {
  const c = useMarketwatchController()
  const router = useRouter()
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ from: number; over: number | null } | null>(null)
  const [showKeys, setShowKeys] = useState(false)
  const alerts = useAlerts(c.isAuthenticated)

  const alertCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const a of alerts.data?.alerts ?? []) if (a.status === 'active') m[a.symbol] = (m[a.symbol] ?? 0) + 1
    return m
  }, [alerts.data])

  const selectedName = useMemo(
    () => c.rawItems.find((i) => i.symbol === c.selected)?.name ?? c.holdingRows.find((h) => h.symbol === c.selected)?.name ?? null,
    [c.rawItems, c.holdingRows, c.selected]
  )
  const selectedQuote: WatchQuote | undefined = c.quotes[c.selected]
  const positions = useMemo(() => c.holdingRows.filter((h) => h.symbol === c.selected), [c.holdingRows, c.selected])

  // Holdings tab rows have server prices but no full quote; fetch one for the pane.
  const needsPaneQuote = c.isHoldings && !!c.selected
  const [paneQuoteSyms, setPaneQuoteSyms] = useState<string[]>([])
  useEffect(() => setPaneQuoteSyms(needsPaneQuote ? [c.selected] : []), [needsPaneQuote, c.selected])

  const chart = useCallback((s: string) => {
    c.setSelected(s)
    detailRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [c])

  // keep the selected row in view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-symbol="${CSS.escape(c.selected)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [c.selected])

  useEffect(() => {
    if (!c.isAuthenticated) return
    const onKey = (e: KeyboardEvent) => {
      if (c.dialog || e.metaKey || e.ctrlKey) return
      if (e.key === '/' && !isTyping(e.target)) {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (isTyping(e.target)) return
      // Only act when the page owns focus (not inside a nav menu or other widget)
      const k = e.key
      if (e.altKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
        e.preventDefault()
        c.moveSelected(k === 'ArrowUp' ? -1 : 1)
        return
      }
      if (e.altKey) return
      if (k === 'ArrowDown' || k === 'j') {
        e.preventDefault()
        c.selectByOffset(1)
      } else if (k === 'ArrowUp' || k === 'k') {
        e.preventDefault()
        c.selectByOffset(-1)
      } else if (k === 'Enter' && c.selected && (e.target === document.body || listRef.current?.contains(e.target as Node))) {
        e.preventDefault()
        router.push(researchHref(c.selected))
      } else if ((k === 'a' || k === 'A') && c.selected) {
        c.openDialog('alert', c.selected)
      } else if ((k === 'h' || k === 'H') && c.selected) {
        c.openDialog('holding', c.selected)
      } else if ((k === 'c' || k === 'C') && c.selected) {
        chart(c.selected)
      } else if ((k === 'Delete' || k === 'Backspace') && c.selected && !c.isHoldings) {
        e.preventDefault()
        c.remove(c.selected)
      } else if (/^[1-9]$/.test(k)) {
        c.selectTab(Number(k) - 1)
      } else if (k === '?') {
        setShowKeys((s) => !s)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [c, chart, router])

  if (!c.authLoading && !c.isAuthenticated) {
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <LogIn className="mx-auto mb-4 h-10 w-10 text-fg-muted" aria-hidden />
        <h1 className="text-xl font-semibold text-fg-primary">Sign in to use Marketwatch</h1>
        <p className="mt-2 text-sm text-fg-secondary">Multiple watchlists, live prices, price alerts and your holdings with P&amp;L, in one place.</p>
        <Link href="/auth" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-[#fff] hover:bg-indigo-500">
          <LogIn className="h-4 w-4" /> Sign in / Register
        </Link>
      </div>
    )
  }

  const list = c.activeList
  const listIdx = list ? c.lists.findIndex((l) => l.id === list.id) : -1
  const holdingsCount = c.holdings.data ? c.holdingRows.length : null
  const dialogQuote = c.dialog ? c.quotes[c.dialog.symbol] : undefined

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-7xl flex-col px-6 py-5">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold text-fg-primary">Marketwatch</h1>
          <p className="mt-0.5 text-xs text-fg-muted">Live regular-session prices from the shared quote feed. Alerts notify only; nothing here places an order.</p>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowKeys((s) => !s)}
            aria-expanded={showKeys}
            className="inline-flex items-center gap-1.5 rounded-md border border-line-subtle px-2.5 py-1.5 text-xs text-fg-secondary hover:bg-surface-hover"
          >
            <Keyboard className="h-3.5 w-3.5" /> Shortcuts <kbd className="rounded border border-line-default px-1 text-[10px]">?</kbd>
          </button>
          {showKeys && (
            <div className="absolute right-0 top-full z-40 mt-1 w-64 rounded-lg border border-line-default bg-white p-3 shadow-xl dark:bg-slate-900">
              <dl className="space-y-1.5 text-xs">
                {SHORTCUTS.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt><kbd className="rounded border border-line-default px-1.5 py-px font-mono text-[10px] text-fg-secondary">{k}</kbd></dt>
                    <dd className="text-fg-muted">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(22rem,26rem)_1fr] gap-4">
        {/* ── marketwatch column ── */}
        <section aria-label="Marketwatch" className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-line-subtle bg-surface-raised/40">
          <div className="space-y-2 border-b border-line-subtle p-3">
            {c.loading ? (
              <div className="h-9 animate-pulse rounded-lg bg-surface-raised" />
            ) : (
              <SearchAdd
                inputRef={searchRef}
                listName={c.isHoldings ? (c.lists[0]?.name ?? 'Watchlist') : (list?.name ?? 'Watchlist')}
                inList={(s) => !!(c.isHoldings ? c.lists[0] : list)?.items.some((i) => i.symbol === s)}
                onAdd={async (s) => {
                  if (c.isHoldings && c.lists[0]) c.setActiveKey(String(c.lists[0].id))
                  return c.add(s)
                }}
                adding={c.adding}
              />
            )}
          </div>
          <div className="px-3">
            {c.loading ? (
              <div className="flex h-9 items-center gap-3"><div className="h-3 w-20 animate-pulse rounded bg-surface-raised" /><div className="h-3 w-16 animate-pulse rounded bg-surface-raised" /></div>
            ) : (
              <ListTabs
                lists={c.lists}
                activeKey={c.isHoldings ? 'holdings' : String(list?.id ?? '')}
                onSelect={c.setActiveKey}
                onCreate={c.createList}
                holdingsCount={holdingsCount}
                canCreate={c.lists.length < c.limits.lists}
              />
            )}
          </div>
          {!c.isHoldings && list && (
            <div className="px-3">
              <ListToolbar
                list={list}
                count={list.items.length}
                sort={c.sort}
                onSort={c.setSort}
                onRename={(n) => c.renameList(list.id, n)}
                onShift={(d) => c.shiftList(list.id, d)}
                onDelete={() => c.deleteList(list.id)}
                isFirst={listIdx <= 0}
                isLast={listIdx >= c.lists.length - 1}
                updatedAt={c.quotesUpdatedAt || undefined}
              />
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {c.error ? (
              <div role="alert" className="m-3 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
                <AlertCircle className="h-4 w-4 shrink-0" /> {c.error.message || 'Could not load watchlists'}
              </div>
            ) : c.loading ? (
              <WatchRowsSkeleton />
            ) : c.isHoldings ? (
              c.holdings.isLoading ? (
                <WatchRowsSkeleton rows={5} />
              ) : c.holdings.error ? (
                <p role="alert" className="m-3 text-xs text-red-600 dark:text-red-400">Could not load holdings.</p>
              ) : c.holdingRows.length === 0 ? (
                <HoldingsEmpty />
              ) : (
                <>
                  <div className="p-3"><HoldingsSummary rows={c.holdingRows} /></div>
                  <ul ref={listRef} role="listbox" aria-label="Holdings" className="border-t border-line-subtle">
                    {c.holdingRows.map((h) => (
                      <HoldingRowView
                        key={`${h.portfolio_id}-${h.symbol}`}
                        h={h}
                        selected={h.symbol === c.selected}
                        onSelect={() => c.setSelected(h.symbol)}
                        onAlert={(s) => c.openDialog('alert', s)}
                        onHolding={(s) => c.openDialog('holding', s)}
                      />
                    ))}
                  </ul>
                </>
              )
            ) : !list || list.items.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="text-sm font-semibold text-fg-primary">{list?.name ?? 'Watchlist'} is empty</p>
                <p className="mt-1 text-xs text-fg-muted">Press <kbd className="rounded border border-line-default px-1">/</kbd> and type a ticker or company name to add it.</p>
              </div>
            ) : (
              <>
                {c.quotesError && (
                  <p role="status" className="mx-3 mt-2 flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                    <RefreshCw className="h-3 w-3" /> Prices are temporarily unavailable; retrying.
                  </p>
                )}
                <ul
                  ref={listRef}
                  role="listbox"
                  aria-label={list.name}
                  onDragEnd={() => setDrag(null)}
                >
                  {c.items.map((it, i) => {
                    const manual = c.sort === 'manual'
                    return (
                      <WatchRow
                        key={it.symbol}
                        item={it}
                        quote={c.quotes[it.symbol]}
                        held={c.held[it.symbol]}
                        selected={it.symbol === c.selected}
                        onSelect={() => c.setSelected(it.symbol)}
                        quotesLoading={c.quotesLoading}
                        alertCount={alertCounts[it.symbol] ?? 0}
                        actions={{
                          onChart: chart,
                          onAlert: (s) => c.openDialog('alert', s),
                          onHolding: (s) => c.openDialog('holding', s),
                          onRemove: c.remove,
                        }}
                        draggable={manual}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move'
                          e.dataTransfer.setData('text/plain', it.symbol)
                          setDrag({ from: i, over: i })
                        }}
                        onDragOver={(e) => {
                          if (!drag) return
                          e.preventDefault()
                          if (drag.over !== i) setDrag({ ...drag, over: i })
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          if (drag) c.move(drag.from, i)
                          setDrag(null)
                        }}
                        dropHint={drag && drag.over === i && drag.from !== i ? (drag.from < i ? 'below' : 'above') : null}
                      />
                    )
                  })}
                </ul>
                {c.sort !== 'manual' && (
                  <p className="px-3 py-2 text-[11px] text-fg-muted">Sorted by {c.sort === 'change' ? '% change' : c.sort === 'ltp' ? 'price' : 'symbol'}. Switch to “My order” to drag rows.</p>
                )}
              </>
            )}
          </div>
          <footer className="flex items-center gap-3 border-t border-line-subtle px-3 py-1.5 text-[10px] text-fg-muted">
            <span><kbd className="font-mono">/</kbd> search</span>
            <span><kbd className="font-mono">↑↓</kbd> move</span>
            <span><kbd className="font-mono">↵</kbd> research</span>
            <span><kbd className="font-mono">A</kbd> alert</span>
            <span><kbd className="font-mono">H</kbd> holding</span>
            {c.sort === 'manual' && !c.isHoldings && <span className="ml-auto">Drag to reorder</span>}
          </footer>
        </section>

        {/* ── detail column ── */}
        <section ref={detailRef} aria-label="Instrument detail" className="min-h-0 overflow-y-auto rounded-xl border border-line-subtle bg-surface-raised/40">
          {c.loading ? (
            <div className="space-y-4 p-4">
              <div className="flex items-center gap-3"><div className="h-9 w-9 animate-pulse rounded-full bg-surface-raised" /><div className="h-4 w-24 animate-pulse rounded bg-surface-raised" /></div>
              <div className="h-7 w-40 animate-pulse rounded bg-surface-raised" />
              <div className="h-24 animate-pulse rounded bg-surface-raised" />
            </div>
          ) : (
            <PaneWithQuote
              symbol={c.selected || null}
              name={selectedName}
              quote={selectedQuote}
              quoteLoading={c.quotesLoading}
              extraQuoteSymbols={paneQuoteSyms}
              positions={positions}
              onAlert={(s) => c.openDialog('alert', s)}
              onHolding={(s) => c.openDialog('holding', s)}
              compareWith={c.visibleSymbols}
            />
          )}
        </section>
      </div>

      <PriceAlertDialog variant="modal" open={c.dialog?.kind === 'alert'} symbol={c.dialog?.symbol ?? null} quote={dialogQuote ?? (c.dialog ? quoteFromHolding(c.dialog.symbol, c.holdingRows) : undefined)} onClose={c.closeDialog} />
      <AddHoldingDialog variant="modal" open={c.dialog?.kind === 'holding'} symbol={c.dialog?.symbol ?? null} quote={dialogQuote ?? (c.dialog ? quoteFromHolding(c.dialog.symbol, c.holdingRows) : undefined)} onClose={c.closeDialog} />
    </div>
  )
}

/** Detail pane that fetches the canonical quote itself when the row has none (Holdings tab). */

function PaneWithQuote(props: Omit<React.ComponentProps<typeof InstrumentPanel>, 'quote'> & { quote?: WatchQuote; extraQuoteSymbols: string[] }) {
  const { extraQuoteSymbols, quote, ...rest } = props
  const refresh = useMarketRefreshInterval({ liveInterval: 15_000, extendedInterval: 60_000, closedInterval: 300_000 })
  const extra = useWatchQuotes(quote ? [] : extraQuoteSymbols, refresh)
  const q = quote ?? (props.symbol ? extra.data?.[props.symbol] : undefined)
  return <InstrumentPanel {...rest} quote={q} quoteLoading={props.quoteLoading || extra.isLoading} />
}
