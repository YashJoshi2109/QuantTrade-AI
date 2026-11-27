'use client'

/**
 * State for the Marketwatch, shared by the desktop page and MobileWatchlist so both
 * views show the same active list, sort, selection and dialogs.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/Toast'
import { useMarketRefreshInterval } from '@/hooks/useMarketRefresh'
import { isStr, oneOf, usePersistentState } from '@/lib/persistentState'
import {
  holdingsBySymbol, moveItem, nextListName, sortItems, useHoldingsWatch, useMarketwatch,
  useMarketwatchMutations, useWatchQuotes, type SortMode, type WatchItem, type WatchList,
} from '@/lib/marketwatch'

export const HOLDINGS_TAB = 'holdings'
export type DialogKind = 'alert' | 'holding'

export function useMarketwatchController() {
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const toast = useToast()
  const refreshMs = useMarketRefreshInterval({ liveInterval: 15_000, extendedInterval: 60_000, closedInterval: 300_000 })

  const mw = useMarketwatch(isAuthenticated)
  const holdings = useHoldingsWatch(isAuthenticated, Math.max(refreshMs, 30_000))
  const muts = useMarketwatchMutations()

  const lists: WatchList[] = useMemo(() => mw.data?.lists ?? [], [mw.data])
  const limits = mw.data?.limits ?? { lists: 10, items_per_list: 100 }

  const [activeKey, setActiveKey] = usePersistentState('marketwatch.active', '', { validate: isStr })
  const [sort, setSort] = usePersistentState<SortMode>('marketwatch.sort', 'manual', {
    validate: oneOf(['manual', 'symbol', 'change', 'ltp'] as const),
  })
  const [selected, setSelected] = usePersistentState('marketwatch.selected', '', { validate: isStr })
  const [dialog, setDialog] = useState<{ kind: DialogKind; symbol: string } | null>(null)

  const isHoldings = activeKey === HOLDINGS_TAB
  const activeList = useMemo<WatchList | null>(() => {
    if (isHoldings) return null
    return lists.find((l) => String(l.id) === activeKey) ?? lists[0] ?? null
  }, [lists, activeKey, isHoldings])

  // Fall back to the first list once lists load and the remembered one is gone.
  useEffect(() => {
    if (!mw.data || isHoldings) return
    if (activeList && String(activeList.id) !== activeKey) setActiveKey(String(activeList.id))
  }, [mw.data, activeList, activeKey, isHoldings, setActiveKey])

  const rawItems: WatchItem[] = useMemo(() => activeList?.items ?? [], [activeList])
  const symbols = useMemo(() => rawItems.map((i) => i.symbol), [rawItems])
  const quotesQ = useWatchQuotes(isHoldings ? [] : symbols, refreshMs)
  const quotes = useMemo(() => quotesQ.data ?? {}, [quotesQ.data])
  const items = useMemo(() => sortItems(rawItems, quotes, sort), [rawItems, quotes, sort])

  const holdingRows = useMemo(() => holdings.data?.holdings ?? [], [holdings.data])
  const held = useMemo(() => holdingsBySymbol(holdingRows), [holdingRows])

  // Selection follows the visible rows.
  const visibleSymbols = useMemo(
    () => (isHoldings ? Array.from(new Set(holdingRows.map((h) => h.symbol))) : items.map((i) => i.symbol)),
    [isHoldings, holdingRows, items]
  )
  useEffect(() => {
    if (visibleSymbols.length && !visibleSymbols.includes(selected)) setSelected(visibleSymbols[0])
  }, [visibleSymbols, selected, setSelected])

  const selectByOffset = useCallback(
    (delta: number) => {
      if (!visibleSymbols.length) return
      const i = visibleSymbols.indexOf(selected)
      const next = Math.max(0, Math.min(visibleSymbols.length - 1, (i < 0 ? 0 : i) + delta))
      setSelected(visibleSymbols[next])
    },
    [visibleSymbols, selected, setSelected]
  )

  const add = useCallback(
    async (symbol: string) => {
      const sym = symbol.trim().toUpperCase()
      if (!activeList) return false
      if (activeList.items.some((i) => i.symbol === sym)) {
        toast.warning(`${sym} is already in ${activeList.name}`)
        setSelected(sym)
        return false
      }
      if (activeList.items.length >= limits.items_per_list) {
        toast.error(`${activeList.name} is full (${limits.items_per_list} symbols)`)
        return false
      }
      try {
        await muts.addItem.mutateAsync({ listId: activeList.id, symbol: sym })
        setSelected(sym)
        toast.success(`${sym} added to ${activeList.name}`)
        return true
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Could not add ${sym}`)
        return false
      }
    },
    [activeList, limits.items_per_list, muts.addItem, setSelected, toast]
  )

  const remove = useCallback(
    (symbol: string) => {
      if (!activeList) return
      const idx = visibleSymbols.indexOf(symbol)
      muts.removeItem.mutate(
        { listId: activeList.id, symbol },
        { onError: (e) => toast.error(e instanceof Error ? e.message : `Could not remove ${symbol}`) }
      )
      const rest = visibleSymbols.filter((s) => s !== symbol)
      if (rest.length) setSelected(rest[Math.min(idx, rest.length - 1)])
    },
    [activeList, muts.removeItem, setSelected, toast, visibleSymbols]
  )

  /** Reorder in stored order. Only meaningful with sort = manual. */
  const move = useCallback(
    (from: number, to: number) => {
      if (!activeList || sort !== 'manual') return
      const next = moveItem(rawItems.map((i) => i.symbol), from, to)
      if (next.join() === rawItems.map((i) => i.symbol).join()) return
      muts.orderItems.mutate(
        { listId: activeList.id, symbols: next },
        { onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not reorder') }
      )
    },
    [activeList, muts.orderItems, rawItems, sort, toast]
  )

  const moveSelected = useCallback(
    (delta: number) => {
      const i = rawItems.findIndex((x) => x.symbol === selected)
      if (i >= 0) move(i, i + delta)
    },
    [move, rawItems, selected]
  )

  const createList = useCallback(async () => {
    if (lists.length >= limits.lists) {
      toast.error(`You can have up to ${limits.lists} watchlists`)
      return
    }
    try {
      const l = await muts.createList.mutateAsync(nextListName(lists))
      setActiveKey(String(l.id))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create watchlist')
    }
  }, [limits.lists, lists, muts.createList, setActiveKey, toast])

  const renameList = useCallback(
    (id: number, name: string) => {
      const n = name.trim().replace(/\s+/g, ' ')
      if (!n) return
      muts.renameList.mutate({ id, name: n }, { onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not rename') })
    },
    [muts.renameList, toast]
  )

  const deleteList = useCallback(
    (id: number) => {
      muts.deleteList.mutate(id, {
        onSuccess: () => setActiveKey(String(lists.find((l) => l.id !== id)?.id ?? '')),
        onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not delete'),
      })
    },
    [lists, muts.deleteList, setActiveKey, toast]
  )

  const shiftList = useCallback(
    (id: number, delta: number) => {
      const ids = lists.map((l) => l.id)
      const i = ids.indexOf(id)
      const next = moveItem(ids, i, i + delta)
      if (next.join() !== ids.join()) muts.orderLists.mutate(next)
    },
    [lists, muts.orderLists]
  )

  const selectTab = useCallback(
    (index: number) => {
      // 1..N = lists, N+1 = Holdings (Kite-style number keys)
      if (index < lists.length) setActiveKey(String(lists[index].id))
      else if (index === lists.length) setActiveKey(HOLDINGS_TAB)
    },
    [lists, setActiveKey]
  )

  // Stable identities: dialogs re-run their focus effect when onClose changes.
  const openDialog = useCallback((kind: DialogKind, symbol: string) => setDialog({ kind, symbol }), [])
  const closeDialog = useCallback(() => setDialog(null), [])

  return {
    isAuthenticated, authLoading,
    loading: authLoading || (isAuthenticated && mw.isLoading),
    error: mw.error as Error | null,
    lists, limits, activeList, activeKey, setActiveKey, isHoldings,
    items, rawItems, quotes, quotesLoading: quotesQ.isLoading && symbols.length > 0, quotesError: quotesQ.error as Error | null,
    quotesUpdatedAt: quotesQ.dataUpdatedAt,
    holdings, holdingRows, held,
    sort, setSort, selected, setSelected, selectByOffset, visibleSymbols,
    dialog, openDialog, closeDialog,
    add, adding: muts.addItem.isPending, remove, move, moveSelected,
    createList, renameList, deleteList, shiftList, selectTab,
  }
}

export type MarketwatchController = ReturnType<typeof useMarketwatchController>
