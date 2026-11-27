'use client'

/**
 * GTT-style price alert from a watch row (single trigger, Kite-like): the user
 * types one trigger price and the direction follows from where it sits against
 * the last price. Reuses the Price Alerts backend (/api/v1/alerts price_above /
 * price_below). An alert only notifies; it never places an order.
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowDownRight, ArrowUpRight, BellRing, Loader2, Trash2 } from 'lucide-react'
import { Overlay } from '@/components/alerts/AlertsParts'
import { describeAlert, useAlertMutations, useAlerts } from '@/lib/alerts'
import { dirClass, fmtLtp, fmtSigned, gttCondition, pctFrom, type WatchQuote } from '@/lib/marketwatch'
import { useToast } from '@/components/Toast'

const QUICK = [-5, -2, 2, 5]

export default function PriceAlertDialog({
  symbol, quote, open, onClose, variant,
}: { symbol: string | null; quote?: WatchQuote; open: boolean; onClose: () => void; variant: 'modal' | 'sheet' }) {
  const toast = useToast()
  const alerts = useAlerts(open)
  const m = useAlertMutations()
  const [raw, setRaw] = useState('')
  const [repeat, setRepeat] = useState(false)
  const [note, setNote] = useState('')
  const ltp = quote?.price ?? null

  useEffect(() => {
    if (open) {
      setRaw('')
      setRepeat(false)
      setNote('')
    }
  }, [open, symbol])

  const trigger = Number(raw)
  const cond = raw.trim() ? gttCondition(trigger, ltp) : null
  const away = raw.trim() ? pctFrom(ltp, trigger) : null
  const existing = useMemo(
    () => (alerts.data?.alerts ?? []).filter((a) => a.symbol === symbol && (a.condition === 'price_above' || a.condition === 'price_below') && a.status !== 'triggered'),
    [alerts.data, symbol]
  )
  const error = !raw.trim()
    ? null
    : !Number.isFinite(trigger) || trigger <= 0
      ? 'Enter a price above 0'
      : ltp == null
        ? 'No live price right now, so the direction cannot be set'
        : cond == null
          ? 'Trigger equals the last price; pick a level above or below it'
          : null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!symbol || !cond || error) return
    try {
      await m.create.mutateAsync({ symbol, condition: cond, threshold: Number(trigger.toFixed(4)), repeat, note: note.trim() || undefined })
      toast.success(`Alert set: ${symbol} ${cond === 'price_above' ? '≥' : '≤'} ${fmtLtp(trigger)}`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create alert')
    }
  }

  return (
    <Overlay open={open} onClose={onClose} title={symbol ? `Price alert · ${symbol}` : 'Price alert'} variant={variant}>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-baseline justify-between rounded-lg border border-line-subtle bg-surface-raised px-3 py-2">
          <span className="text-xs text-fg-muted">Last price</span>
          <span className="tabular-nums text-sm font-semibold text-fg-primary">
            {fmtLtp(ltp)}{' '}
            <span className={`text-xs font-medium ${dirClass(quote?.change_percent)}`}>
              {quote?.change_percent != null ? `${fmtSigned(quote.change_percent)}%` : ''}
            </span>
          </span>
        </div>

        <div>
          <label htmlFor="mw-alert-trigger" className="mb-1 block text-xs font-medium text-fg-secondary">Trigger price (USD)</label>
          <input
            id="mw-alert-trigger"
            inputMode="decimal"
            autoComplete="off"
            value={raw}
            onChange={(e) => setRaw(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder={ltp != null ? fmtLtp(ltp).replace(/,/g, '') : '0.00'}
            className="w-full rounded-lg border border-line-default bg-surface-base px-3 py-2 tabular-nums text-fg-primary focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {ltp != null && (
            <div className="mt-2 flex gap-1.5">
              {QUICK.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setRaw((ltp * (1 + p / 100)).toFixed(2))}
                  className="flex-1 rounded-md border border-line-subtle bg-surface-raised px-2 py-1 text-xs tabular-nums text-fg-secondary hover:bg-surface-hover"
                >
                  {p > 0 ? '+' : '−'}{Math.abs(p)}%
                </button>
              ))}
            </div>
          )}
          <p className="mt-2 min-h-[1.25rem] text-xs" aria-live="polite">
            {error ? (
              <span className="text-red-600 dark:text-red-400">{error}</span>
            ) : cond ? (
              <span className="inline-flex items-center gap-1 text-fg-secondary">
                {cond === 'price_above' ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                Notifies when the price {cond === 'price_above' ? 'rises to or above' : 'falls to or below'}{' '}
                <span className="tabular-nums font-semibold text-fg-primary">{fmtLtp(trigger)}</span>
                <span className="tabular-nums text-fg-muted">({fmtSigned(away)}% from last)</span>
              </span>
            ) : (
              <span className="text-fg-muted">Above the last price = rise alert; below = drop alert.</span>
            )}
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-fg-secondary">
          <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} className="h-4 w-4 rounded border-line-default" />
          Re-arm after it fires (repeat)
        </label>
        <input
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          aria-label="Note"
          className="w-full rounded-lg border border-line-default bg-surface-base px-3 py-2 text-sm text-fg-primary focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />

        <button
          type="submit"
          disabled={!cond || !!error || m.create.isPending}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-[#fff] hover:bg-indigo-500 disabled:opacity-50"
        >
          {m.create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
          Set alert
        </button>
        <p className="text-center text-[11px] text-fg-muted">
          Alerts notify you in <Link href="/notifications" className="underline">Notifications</Link>. They never place an order.
        </p>

        {existing.length > 0 && (
          <div className="border-t border-line-subtle pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Active on {symbol}</p>
            <ul className="space-y-1.5">
              {existing.map((a) => (
                <li key={a.id} className="flex items-center justify-between rounded-md bg-surface-raised px-2.5 py-1.5 text-xs">
                  <span className="tabular-nums text-fg-secondary">
                    {describeAlert(a)}
                    {a.status === 'paused' && <span className="ml-1.5 text-fg-muted">(paused)</span>}
                  </span>
                  <button
                    type="button"
                    aria-label={`Delete alert: ${describeAlert(a)}`}
                    onClick={() => m.remove.mutate(a.id)}
                    className="rounded p-1 text-fg-muted hover:bg-surface-hover hover:text-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>
    </Overlay>
  )
}
