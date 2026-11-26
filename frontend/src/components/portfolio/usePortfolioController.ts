'use client'

/** Page-level state + actions shared by PortfolioDesktop and PortfolioMobile. */
import { useMemo, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/Toast'
import { portfolioApi, type TxnType } from '@/lib/portfolio'
import {
  usePortfolioDetail,
  usePortfolioList,
  usePortfolioMutations,
  usePortfolioTxns,
  useSelectedPortfolio,
} from '@/lib/usePortfolios'

export type TradePreset = { symbol?: string; side?: TxnType } | null

export function usePortfolioController() {
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const toast = useToast()
  const list = usePortfolioList(isAuthenticated)
  const ids = useMemo(() => list.data?.portfolios.map((p) => p.id), [list.data])
  const [selectedId, select] = useSelectedPortfolio(ids)
  const detail = usePortfolioDetail(selectedId)
  const txns = usePortfolioTxns(selectedId)
  const m = usePortfolioMutations(selectedId)

  const [createOpen, setCreateOpen] = useState(false)
  const [trade, setTrade] = useState<TradePreset>(null)
  const [exporting, setExporting] = useState(false)

  const selected = detail.data && detail.data.id === selectedId ? detail.data : null

  const exportCsv = async (type: 'holdings' | 'transactions') => {
    if (!selectedId) return
    setExporting(true)
    try {
      await portfolioApi.exportCsv(selectedId, type)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const rename = () => {
    if (!selected) return
    const name = window.prompt('Rename portfolio', selected.name)?.trim()
    if (!name || name === selected.name) return
    m.rename.mutate(name, {
      onSuccess: () => toast.success('Portfolio renamed'),
      onError: (e) => toast.error(e instanceof Error ? e.message : 'Rename failed'),
    })
  }

  const remove = () => {
    if (!selected) return
    if (!window.confirm(`Delete "${selected.name}" and all of its transactions? This cannot be undone.`)) return
    m.remove.mutate(undefined, {
      onSuccess: () => {
        toast.success('Portfolio deleted')
        select(null)
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : 'Delete failed'),
    })
  }

  const reset = () => {
    if (!selected?.simulated) return
    if (!window.confirm(`Reset "${selected.name}"? All simulated trades are removed and cash goes back to ${selected.starting_cash?.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}.`)) return
    m.reset.mutate(undefined, {
      onSuccess: () => toast.success('Paper account reset'),
      onError: (e) => toast.error(e instanceof Error ? e.message : 'Reset failed'),
    })
  }

  const deleteTxn = (txnId: number) => {
    if (!window.confirm('Delete this transaction? Holdings and P&L will be recalculated.')) return
    m.deleteTxn.mutate(txnId, {
      onSuccess: () => toast.success('Transaction deleted'),
      onError: (e) => toast.error(e instanceof Error ? e.message : 'Delete failed'),
    })
  }

  return {
    isAuthenticated,
    authLoading,
    list,
    portfolios: list.data?.portfolios ?? [],
    limit: list.data?.limit ?? 10,
    selectedId,
    select,
    selected,
    detailLoading: detail.isLoading,
    detailError: detail.error as Error | null,
    txns: txns.data?.transactions ?? [],
    txnsLoading: txns.isLoading,
    createOpen,
    setCreateOpen,
    trade,
    setTrade,
    exporting,
    exportCsv,
    rename,
    remove,
    reset,
    deleteTxn,
  }
}

export type PortfolioController = ReturnType<typeof usePortfolioController>
