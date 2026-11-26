'use client'

/**
 * React Query wiring for portfolios, shared by the desktop and mobile views so
 * both always show the same data and invalidate the same keys after a write.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { portfolioApi, portfolioKeys, type PortfolioKind } from '@/lib/portfolio'

const REFRESH_MS = 60_000
const SELECTED_KEY = 'qt.portfolio.selected'

export function usePortfolioList(enabled: boolean) {
  return useQuery({
    queryKey: portfolioKeys.list,
    queryFn: portfolioApi.list,
    enabled,
    refetchInterval: REFRESH_MS,
    staleTime: 20_000,
  })
}

export function usePortfolioDetail(id: number | null) {
  return useQuery({
    queryKey: id ? portfolioKeys.detail(id) : ['portfolios', 'none'],
    queryFn: () => portfolioApi.get(id as number),
    enabled: !!id,
    refetchInterval: REFRESH_MS,
    staleTime: 20_000,
  })
}

export function usePortfolioTxns(id: number | null) {
  return useQuery({
    queryKey: id ? portfolioKeys.txns(id) : ['portfolios', 'none', 'txns'],
    queryFn: () => portfolioApi.transactions(id as number),
    enabled: !!id,
    staleTime: 20_000,
  })
}

/** Selected portfolio id, remembered per browser; falls back to the first portfolio. */
export function useSelectedPortfolio(ids: number[] | undefined) {
  const [selected, setSelected] = useState<number | null>(null)
  useEffect(() => {
    if (!ids) return
    if (selected && ids.includes(selected)) return
    let saved: number | null = null
    try {
      const raw = window.localStorage.getItem(SELECTED_KEY)
      saved = raw ? Number(raw) : null
    } catch {
      saved = null
    }
    setSelected(saved && ids.includes(saved) ? saved : ids[0] ?? null)
  }, [ids, selected])
  const select = (id: number | null) => {
    setSelected(id)
    try {
      if (id) window.localStorage.setItem(SELECTED_KEY, String(id))
    } catch {
      /* storage unavailable: selection just isn't remembered */
    }
  }
  return [selected, select] as const
}

export function usePortfolioMutations(id: number | null) {
  const qc = useQueryClient()
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: portfolioKeys.list })
    if (id) {
      qc.invalidateQueries({ queryKey: portfolioKeys.detail(id) })
      qc.invalidateQueries({ queryKey: portfolioKeys.txns(id) })
    }
  }
  return {
    create: useMutation({
      mutationFn: (b: { name: string; kind: PortfolioKind; starting_cash?: number }) => portfolioApi.create(b),
      onSuccess: () => qc.invalidateQueries({ queryKey: portfolioKeys.list }),
    }),
    rename: useMutation({
      mutationFn: (name: string) => portfolioApi.rename(id as number, name),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: () => portfolioApi.remove(id as number),
      onSuccess: () => qc.invalidateQueries({ queryKey: portfolioKeys.list }),
    }),
    addTxn: useMutation({
      mutationFn: (b: Parameters<typeof portfolioApi.addTransaction>[1]) => portfolioApi.addTransaction(id as number, b),
      onSuccess: invalidate,
    }),
    deleteTxn: useMutation({
      mutationFn: (txnId: number) => portfolioApi.deleteTransaction(id as number, txnId),
      onSuccess: invalidate,
    }),
    order: useMutation({
      mutationFn: (b: Parameters<typeof portfolioApi.paperOrder>[1]) => portfolioApi.paperOrder(id as number, b),
      onSuccess: invalidate,
    }),
    reset: useMutation({
      mutationFn: () => portfolioApi.reset(id as number),
      onSuccess: invalidate,
    }),
  }
}
