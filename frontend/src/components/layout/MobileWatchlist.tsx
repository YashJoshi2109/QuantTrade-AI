'use client'

/**
 * Mobile Marketwatch: the phone counterpart of components/marketwatch/MarketwatchDesktop.
 * Same controller (useMarketwatchController), same lists, prices and P&L; only the
 * layout differs. Named watchlist pills + Holdings, search-to-add, dense rows with a
 * stored-close sparkline, tap a row for the stock sheet (chart, stats, alert, holding),
 * "Edit" mode to reorder or remove rows. Nothing here places an order.
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, Check, LogIn, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useMarketwatchController } from '@/components/marketwatch/useMarketwatchController'
import {
  HeldBadge, HoldingsEmpty, HoldingsSummary, ListTabs, SearchAdd, WatchRowsSkeleton,
} from '@/components/marketwatch/MarketwatchParts'
import MobileStockSheet from '@/components/marketwatch/MobileStockSheet'
import PriceAlertDialog from '@/components/marketwatch/PriceAlertDialog'
import AddHoldingDialog from '@/components/marketwatch/AddHoldingDialog'
import {
  SORT_LABEL, dirClass, fmtLtp, fmtSigned, quoteFromHolding, sparkPoints, useSparklines, useWatchQuotes,
  type SortMode, type WatchQuote,
} from '@/lib/marketwatch'
import { fmtMoney, fmtPct, fmtQty } from '@/lib/portfolio'
import { useMarketRefreshInterval } from '@/hooks/useMarketRefresh'
import { Skeleton } from '@/components/Skeleton'

const SPARK_W = 56
const SPARK_H = 22

function Spark({ values }: { values?: number[] }) {
  const pts = values ? sparkPoints(values, SPARK_W, SPARK_H) : ''
  if (!pts) return <span className="block h-[22px] w-14" aria-hidden />
  const up = values![values!.length - 1] >= values![0]
  return (
    <svg width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} aria-hidden className="shrink-0">
      <polyline points={pts} fill="none" stroke={up ? '#10b981' : '#ef4444'} strokeWidth={1.25} strokeLinejoin="round" />
    </svg>
  )
}

export default function MobileWatchlist() {
  const c = useMarketwatchController()
  const [sheet, setSheet] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const refresh = useMarketRefreshInterval({ liveInterval: 15_000, extendedInterval: 60_000, closedInterval: 300_000 })

  const list = c.activeList
  const listIdx = list ? c.lists.findIndex((l) => l.id === list.id) : -1
  const symbols = useMemo(() => c.items.map((i) => i.symbol), [c.items])
  const sparks = useSparklines(symbols, !c.isHoldings)

  // The sheet needs a full quote even when opened from Holdings (rows carry the LTP only).
  const sheetNeedsQuote = !!sheet && !c.quotes[sheet]
  const extra = useWatchQuotes(sheetNeedsQuote && sheet ? [sheet] : [], refresh)
  const quoteFor = (s: string | null | undefined): WatchQuote | undefined => (s ? c.quotes[s] ?? extra.data?.[s] : undefined)
  const sheetName = sheet ? c.rawItems.find((i) => i.symbol === sheet)?.name ?? c.holdingRows.find((h) => h.symbol === sheet)?.name ?? null : null
  const sheetPositions = useMemo(() => c.holdingRows.filter((h) => h.symbol === sheet), [c.holdingRows, sheet])

  if (!c.authLoading && !c.isAuthenticated) {
    return (
      <div className="space-y-4">
        <header className="sticky top-0 z-30 border-b border-line-subtle bg-surface-base/95 px-1 pb-2 pt-safe backdrop-blur-xl">
          <h1 className="text-xl font-semibold text-fg-primary">Marketwatch</h1>
          <p className="text-[11px] text-fg-secondary">Multiple watchlists, live prices, alerts and holdings.</p>
        </header>
        <div className="rounded-2xl border border-line-subtle bg-surface-raised p-5 text-center">
          <LogIn className="mx-auto mb-3 h-10 w-10 text-fg-muted" aria-hidden />
          <h2 className="text-[15px] font-semibold text-fg-primary">Sign in to use Marketwatch</h2>
          <p className="mt-1 text-[11px] text-fg-secondary">Your watchlists are tied to your account so they sync across devices.</p>
          <Link href="/auth" className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-full bg-indigo-600 text-[13px] font-semibold text-[#fff]">
            Sign in / Register
          </Link>
        </div>
      </div>
    )
  }

  const dialogQuote = c.dialog ? quoteFor(c.dialog.symbol) ?? quoteFromHolding(c.dialog.symbol, c.holdingRows) : undefined

  return (
    <div className="space-y-3 pb-4">
      <header className="sticky top-0 z-30 space-y-2 border-b border-line-subtle bg-surface-base/95 px-1 pb-2 pt-safe backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-fg-primary">Marketwatch</h1>
            <p className="truncate text-[11px] text-fg-muted">
              {c.isHoldings
                ? 'Holdings across your portfolios'
                : list
                  ? `${list.items.length} symbol${list.items.length === 1 ? '' : 's'} · regular-session prices`
                  : ' '}
            </p>
          </div>
          {!c.isHoldings && list && (
            <div className="relative flex items-center gap-1.5">
              {list.items.length > 0 && (
                <button
                  type="button"
                  onClick={() => setEditing((e) => !e)}
                  aria-pressed={editing}
                  className={`h-8 rounded-full border px-3 text-xs font-semibold ${editing ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300' : 'border-line-subtle bg-surface-raised text-fg-secondary'}`}
                >
                  {editing ? 'Done' : 'Edit'}
                </button>
              )}
              <button
                type="button"
                aria-label="Watchlist options"
                aria-expanded={menu}
                onClick={() => { setMenu((m) => !m); setConfirmDelete(false) }}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-line-subtle bg-surface-raised text-fg-secondary"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {menu && (
                <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-56 rounded-xl border border-line-default bg-white py-1 text-sm shadow-xl dark:bg-slate-900">
                  <p className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Sort</p>
                  {(Object.keys(SORT_LABEL) as SortMode[]).map((k) => (
                    <button key={k} type="button" role="menuitemradio" aria-checked={c.sort === k} onClick={() => { c.setSort(k); setMenu(false) }} className="flex w-full items-center justify-between px-3 py-2 text-left text-fg-secondary">
                      {SORT_LABEL[k]} {c.sort === k && <Check className="h-4 w-4 text-indigo-500" />}
                    </button>
                  ))}
                  <div className="my-1 border-t border-line-subtle" />
                  <button type="button" role="menuitem" onClick={() => { setRenaming(list.name); setMenu(false) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-fg-secondary"><Pencil className="h-4 w-4" /> Rename</button>
                  <button type="button" role="menuitem" disabled={listIdx <= 0} onClick={() => { c.shiftList(list.id, -1); setMenu(false) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-fg-secondary disabled:opacity-40"><ArrowUp className="h-4 w-4 -rotate-90" /> Move tab left</button>
                  <button type="button" role="menuitem" disabled={listIdx >= c.lists.length - 1} onClick={() => { c.shiftList(list.id, 1); setMenu(false) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-fg-secondary disabled:opacity-40"><ArrowDown className="h-4 w-4 -rotate-90" /> Move tab right</button>
                  {list.is_default ? (
                    <p className="px-3 py-2 text-[11px] text-fg-muted">Default list: also your Watchlist on other pages.</p>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        if (!confirmDelete) return setConfirmDelete(true)
                        c.deleteList(list.id)
                        setMenu(false)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 dark:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" /> {confirmDelete ? 'Tap again to delete' : 'Delete watchlist'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {c.loading ? (
          <div className="flex gap-2"><Skeleton className="h-8 w-24 rounded-full" /><Skeleton className="h-8 w-20 rounded-full" /><Skeleton className="h-8 w-24 rounded-full" /></div>
        ) : (
          <ListTabs
            compact
            lists={c.lists}
            activeKey={c.isHoldings ? 'holdings' : String(list?.id ?? '')}
            onSelect={(k) => { c.setActiveKey(k); setEditing(false); setMenu(false) }}
            onCreate={c.createList}
            holdingsCount={c.holdings.data ? c.holdingRows.length : null}
            canCreate={c.lists.length < c.limits.lists}
          />
        )}

        {renaming != null && list && (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              c.renameList(list.id, renaming)
              setRenaming(null)
            }}
          >
            <input
              autoFocus
              value={renaming}
              maxLength={40}
              onChange={(e) => setRenaming(e.target.value)}
              aria-label="Watchlist name"
              className="h-10 min-w-0 flex-1 rounded-lg border border-line-default bg-surface-raised px-3 text-sm text-fg-primary focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            <button type="submit" className="h-10 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-[#fff]">Save</button>
            <button type="button" onClick={() => setRenaming(null)} className="h-10 rounded-lg border border-line-subtle px-3 text-xs text-fg-secondary">Cancel</button>
          </form>
        )}

        {c.loading ? (
          <Skeleton className="h-10 w-full rounded-lg" />
        ) : !c.isHoldings && list ? (
          <SearchAdd compact listName={list.name} inList={(s) => list.items.some((i) => i.symbol === s)} onAdd={c.add} adding={c.adding} />
        ) : null}
      </header>

      <section className="overflow-hidden rounded-2xl border border-line-subtle bg-surface-raised/40">
        {c.error ? (
          <p role="alert" className="p-4 text-xs text-red-600 dark:text-red-400">{c.error.message || 'Could not load watchlists'}</p>
        ) : c.loading ? (
          <WatchRowsSkeleton rows={7} />
        ) : c.isHoldings ? (
          c.holdings.isLoading ? (
            <WatchRowsSkeleton rows={5} />
          ) : c.holdings.error ? (
            <p role="alert" className="p-4 text-xs text-red-600 dark:text-red-400">Could not load holdings.</p>
          ) : c.holdingRows.length === 0 ? (
            <HoldingsEmpty />
          ) : (
            <>
              <div className="p-3"><HoldingsSummary rows={c.holdingRows} /></div>
              <ul className="border-t border-line-subtle">
                {c.holdingRows.map((h) => (
                  <li key={`${h.portfolio_id}-${h.symbol}`}>
                    <button type="button" onClick={() => setSheet(h.symbol)} className="flex h-14 w-full items-center gap-2 border-b border-line-subtle px-3 text-left active:bg-surface-hover">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[15px] font-semibold text-fg-primary">{h.symbol}</span>
                          {h.simulated && <span className="rounded bg-amber-500/10 px-1 text-[10px] font-medium text-amber-700 dark:text-amber-400">Paper</span>}
                        </div>
                        <div className="truncate text-[11px] tabular-nums text-fg-muted">{fmtQty(h.quantity)} @ {fmtLtp(h.avg_cost)} · {h.portfolio_name}</div>
                      </div>
                      <div className="text-right tabular-nums">
                        {h.price == null ? (
                          <span className="text-xs text-fg-muted">No quote</span>
                        ) : (
                          <>
                            <div className={`text-sm font-semibold ${dirClass(h.unrealized_pnl)}`}>{fmtMoney(h.unrealized_pnl, { signed: true })}</div>
                            <div className="text-[11px] text-fg-muted">LTP {fmtLtp(h.price)} <span className={dirClass(h.unrealized_pnl_percent)}>{fmtPct(h.unrealized_pnl_percent)}</span></div>
                          </>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )
        ) : !list || list.items.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm font-semibold text-fg-primary">{list?.name ?? 'Watchlist'} is empty</p>
            <p className="mt-1 text-xs text-fg-muted">Search a ticker or company name above to add it.</p>
          </div>
        ) : (
          <>
            {c.quotesError && <p role="status" className="px-3 pt-2 text-[11px] text-amber-600 dark:text-amber-400">Prices are temporarily unavailable; retrying.</p>}
            {editing && c.sort !== 'manual' && (
              <p className="px-3 pt-2 text-[11px] text-fg-muted">Sorted by {SORT_LABEL[c.sort]}. Switch the sort to “My order” to reorder.</p>
            )}
            <ul>
              {c.items.map((it, i) => {
                const q = c.quotes[it.symbol]
                const pending = c.quotesLoading && !q
                return (
                  <li key={it.symbol} className="flex h-14 items-center border-b border-line-subtle last:border-b-0">
                    <button
                      type="button"
                      onClick={() => (editing ? undefined : setSheet(it.symbol))}
                      disabled={editing}
                      className="flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left active:bg-surface-hover disabled:cursor-default"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[15px] font-semibold text-fg-primary">{it.symbol}</span>
                          <HeldBadge h={c.held[it.symbol]} />
                        </div>
                        <div className="truncate text-[11px] text-fg-muted">{it.name ?? it.exchange ?? ' '}</div>
                      </div>
                      {!editing && <Spark values={sparks.data?.[it.symbol]} />}
                      {!editing && (
                        <div className="w-[5.5rem] text-right tabular-nums">
                          {pending ? (
                            <div className="flex flex-col items-end gap-1"><Skeleton className="h-3.5 w-14" /><Skeleton className="h-3 w-10" /></div>
                          ) : !q || q.unavailable ? (
                            <span className="text-xs text-fg-muted">No quote</span>
                          ) : (
                            <>
                              <div className={`text-sm font-semibold ${dirClass(q.change)}`}>{fmtLtp(q.price)}</div>
                              <div className={`text-[11px] ${dirClass(q.change)}`}>{fmtSigned(q.change_percent)}%</div>
                            </>
                          )}
                        </div>
                      )}
                    </button>
                    {editing && (
                      <div className="flex shrink-0 items-center gap-1 pr-2">
                        <button type="button" aria-label={`Move ${it.symbol} up`} disabled={c.sort !== 'manual' || i === 0} onClick={() => c.move(i, i - 1)} className="flex h-9 w-9 items-center justify-center rounded-full border border-line-subtle text-fg-secondary disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                        <button type="button" aria-label={`Move ${it.symbol} down`} disabled={c.sort !== 'manual' || i === c.items.length - 1} onClick={() => c.move(i, i + 1)} className="flex h-9 w-9 items-center justify-center rounded-full border border-line-subtle text-fg-secondary disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                        <button type="button" aria-label={`Remove ${it.symbol}`} onClick={() => c.remove(it.symbol)} className="flex h-9 w-9 items-center justify-center rounded-full border border-line-subtle text-red-500"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </section>

      <p className="px-1 text-center text-[10px] text-fg-muted">Alerts notify only. Nothing on this page places an order.</p>

      <MobileStockSheet
        open={!!sheet && !c.dialog}
        symbol={sheet}
        name={sheetName}
        quote={quoteFor(sheet)}
        positions={sheetPositions}
        onClose={() => setSheet(null)}
        onAlert={(s) => c.openDialog('alert', s)}
        onHolding={(s) => c.openDialog('holding', s)}
      />
      <PriceAlertDialog variant="sheet" open={c.dialog?.kind === 'alert'} symbol={c.dialog?.symbol ?? null} quote={dialogQuote} onClose={c.closeDialog} />
      <AddHoldingDialog variant="sheet" open={c.dialog?.kind === 'holding'} symbol={c.dialog?.symbol ?? null} quote={dialogQuote} onClose={c.closeDialog} />
    </div>
  )
}
