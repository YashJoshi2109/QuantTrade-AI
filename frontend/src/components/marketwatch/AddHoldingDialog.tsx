'use client'

/**
 * "Add holding" from a watch row: records a position the user already owns
 * (quantity + average price) as a BUY entry in a *tracked* portfolio ledger, the
 * same write the Portfolio page's "Add transaction" makes. It is bookkeeping
 * only: no order is placed, routed or simulated. Paper portfolios are excluded
 * because their trades must be simulated fills at the server's price.
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Briefcase, Loader2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Overlay } from '@/components/alerts/AlertsParts'
import { fmtMoney, portfolioApi, portfolioKeys, todayIso } from '@/lib/portfolio'
import { usePortfolioList } from '@/lib/usePortfolios'
import { fmtLtp, marketwatchKeys, type WatchQuote } from '@/lib/marketwatch'
import { useToast } from '@/components/Toast'

const NEW = -1

export default function AddHoldingDialog({
  symbol, quote, open, onClose, variant,
}: { symbol: string | null; quote?: WatchQuote; open: boolean; onClose: () => void; variant: 'modal' | 'sheet' }) {
  const toast = useToast()
  const qc = useQueryClient()
  const list = usePortfolioList(open)
  const tracked = useMemo(() => (list.data?.portfolios ?? []).filter((p) => p.kind === 'tracked'), [list.data])
  const [pid, setPid] = useState<number>(NEW)
  const [newName, setNewName] = useState('My Holdings')
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')
  const [date, setDate] = useState(todayIso())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setQty('')
    setPrice(quote?.price != null ? quote.price.toFixed(2) : '')
    setDate(todayIso())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, symbol])

  useEffect(() => {
    if (!open) return
    setPid((cur) => (cur !== NEW && tracked.some((p) => p.id === cur) ? cur : tracked[0]?.id ?? NEW))
  }, [open, tracked])

  const q = Number(qty)
  const p = Number(price)
  const err =
    qty.trim() === '' || price.trim() === ''
      ? null
      : !(q > 0) ? 'Quantity must be above 0'
      : !(p > 0) ? 'Average price must be above 0'
      : date > todayIso() ? 'Date cannot be in the future'
      : pid === NEW && !newName.trim() ? 'Name the new portfolio'
      : null
  const ready = qty.trim() !== '' && price.trim() !== '' && !err

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!symbol || !ready || busy) return
    setBusy(true)
    try {
      let target = pid
      if (target === NEW) {
        const created = await portfolioApi.create({ name: newName.trim(), kind: 'tracked' })
        target = created.id
      }
      await portfolioApi.addTransaction(target, {
        symbol, type: 'BUY', quantity: q, price: p, trade_date: date, notes: 'Added from Marketwatch',
      })
      qc.invalidateQueries({ queryKey: portfolioKeys.list })
      qc.invalidateQueries({ queryKey: portfolioKeys.detail(target) })
      qc.invalidateQueries({ queryKey: portfolioKeys.txns(target) })
      qc.invalidateQueries({ queryKey: marketwatchKeys.holdings })
      toast.success(`${symbol}: ${q} @ ${fmtLtp(p)} recorded`)
      onClose()
    } catch (er) {
      toast.error(er instanceof Error ? er.message : 'Could not record holding')
    } finally {
      setBusy(false)
    }
  }

  const input = 'w-full rounded-lg border border-line-default bg-surface-base px-3 py-2 tabular-nums text-fg-primary focus:outline-none focus:ring-2 focus:ring-indigo-500'

  return (
    <Overlay open={open} onClose={onClose} title={symbol ? `Add holding · ${symbol}` : 'Add holding'} variant={variant}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs text-fg-muted">
          Record shares you already own to track cost basis and P&amp;L. This only updates your QuantTrade ledger. No order is placed.
        </p>
        <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3">
          <div>
            <label htmlFor="mw-h-qty" className="mb-1 block text-xs font-medium text-fg-secondary">Quantity</label>
            <input id="mw-h-qty" inputMode="decimal" autoComplete="off" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0" className={input} />
          </div>
          <div>
            <label htmlFor="mw-h-price" className="mb-1 block text-xs font-medium text-fg-secondary">Avg. price (USD)</label>
            <input id="mw-h-price" inputMode="decimal" autoComplete="off" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" className={input} />
          </div>
        </div>
        <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3">
          <div>
            <label htmlFor="mw-h-date" className="mb-1 block text-xs font-medium text-fg-secondary">Bought on</label>
            <input id="mw-h-date" type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor="mw-h-port" className="mb-1 block text-xs font-medium text-fg-secondary">Portfolio</label>
            {list.isLoading ? (
              <div className="h-[38px] animate-pulse rounded-lg bg-surface-raised" />
            ) : (
              <select id="mw-h-port" value={pid} onChange={(e) => setPid(Number(e.target.value))} className={input}>
                {tracked.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
                <option value={NEW}>+ New tracked portfolio</option>
              </select>
            )}
          </div>
        </div>
        {pid === NEW && !list.isLoading && (
          <input value={newName} maxLength={100} onChange={(e) => setNewName(e.target.value)} aria-label="New portfolio name" className={input} />
        )}
        <div className="flex items-center justify-between rounded-lg bg-surface-raised px-3 py-2 text-xs">
          <span className="text-fg-muted">Cost basis</span>
          <span className="tabular-nums font-semibold text-fg-primary">{q > 0 && p > 0 ? fmtMoney(q * p) : '—'}</span>
        </div>
        <p className="min-h-[1rem] text-xs text-red-600 dark:text-red-400" aria-live="polite">{err}</p>
        <button
          type="submit"
          disabled={!ready || busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-[#fff] hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Briefcase className="h-4 w-4" />}
          Record holding
        </button>
        <p className="text-center text-[11px] text-fg-muted">
          Sold some? Record it on the <Link href="/portfolio" className="underline">Portfolio</Link> page.
        </p>
      </form>
    </Overlay>
  )
}
