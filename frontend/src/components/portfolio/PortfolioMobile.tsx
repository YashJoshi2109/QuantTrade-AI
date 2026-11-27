'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, Briefcase, Download, FlaskConical, Loader2, LogIn, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2, Upload,
} from 'lucide-react'
import { ImportTradesForm, PerformancePanel } from './PortfolioHistoryParts'
import PortfolioForecastCard from '@/components/forecast/PortfolioForecastCard'
import TickerLogo from '@/components/TickerLogo'
import { fmtDate, fmtMoney, fmtPct, fmtQty, pnlClass } from '@/lib/portfolio'
import {
  AllocationDonut, CreatePortfolioForm, KpiGrid, Overlay, SimulatedBadge, SimulatedBanner, TradeForm,
} from './PortfolioParts'
import { usePortfolioController } from './usePortfolioController'

type Section = 'holdings' | 'activity'

export default function PortfolioMobile() {
  const c = usePortfolioController()
  const s = c.selected
  const [section, setSection] = useState<Section>('holdings')
  const [menuOpen, setMenuOpen] = useState(false)

  const menuAction = (fn: () => void) => () => {
    setMenuOpen(false)
    fn()
  }

  return (
    <div className="space-y-4 pt-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-indigo-500" />
          <h1 className="text-lg font-bold text-fg-primary">Portfolio</h1>
        </div>
        {c.isAuthenticated && c.portfolios.length > 0 && (
          <button
            type="button"
            onClick={() => c.setCreateOpen(true)}
            disabled={c.portfolios.length >= c.limit}
            aria-label="New portfolio"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line-subtle bg-surface-raised text-fg-secondary active:scale-95 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>

      {c.authLoading || (c.isAuthenticated && c.list.isLoading) ? (
        <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-fg-muted" /></div>
      ) : !c.isAuthenticated ? (
        <div className="rounded-2xl border border-line-subtle bg-surface-raised p-6 text-center">
          <LogIn className="mx-auto mb-3 h-8 w-8 text-fg-muted" />
          <p className="text-sm font-semibold text-fg-primary">Sign in to track your portfolio</p>
          <p className="mt-1 text-xs text-fg-muted">Holdings, P&amp;L and paper trading are private to your account.</p>
          <Link href="/auth" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-[#fff]">
            <LogIn className="h-4 w-4" /> Sign in
          </Link>
        </div>
      ) : c.portfolios.length === 0 ? (
        <div className="rounded-2xl border border-line-subtle bg-surface-raised p-4">
          <p className="mb-3 text-sm font-semibold text-fg-primary">Create your first portfolio</p>
          <CreatePortfolioForm onDone={(id) => c.select(id)} />
        </div>
      ) : (
        <>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide" role="tablist" aria-label="Portfolios">
            {c.portfolios.map((p) => (
              <button
                key={p.id}
                role="tab"
                aria-selected={p.id === c.selectedId}
                onClick={() => c.select(p.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  p.id === c.selectedId
                    ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                    : 'border-line-subtle bg-surface-raised text-fg-secondary'
                }`}
              >
                {p.simulated && <FlaskConical className="h-3 w-3 text-amber-500" aria-label="Simulated" />}
                {p.name}
              </button>
            ))}
          </div>

          {!s ? (
            <div className="flex h-48 items-center justify-center">
              {c.detailError ? <p className="text-sm text-red-500">{c.detailError.message}</p> : <Loader2 className="h-6 w-6 animate-spin text-fg-muted" />}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <h2 className="truncate text-base font-semibold text-fg-primary">{s.name}</h2>
                  {s.simulated && <SimulatedBadge />}
                </div>
                <div className="relative">
                  <button
                    type="button"
                    aria-label="Portfolio actions"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((v) => !v)}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-line-subtle bg-surface-raised text-fg-secondary"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {menuOpen && (
                    <div className="absolute right-0 z-30 mt-1 w-52 overflow-hidden rounded-xl border border-line-default bg-white text-sm shadow-xl dark:bg-slate-900" role="menu">
                      {[
                        ...(!s.simulated ? [{ icon: Upload, label: 'Import trades CSV', fn: () => c.setImportOpen(true) }] : []),
                        { icon: Download, label: 'Export holdings CSV', fn: () => c.exportCsv('holdings') },
                        { icon: Download, label: 'Export transactions CSV', fn: () => c.exportCsv('transactions') },
                        { icon: Pencil, label: 'Rename', fn: c.rename },
                        ...(s.simulated ? [{ icon: RotateCcw, label: 'Reset paper account', fn: c.reset }] : []),
                        { icon: Trash2, label: 'Delete portfolio', fn: c.remove },
                      ].map(({ icon: Icon, label, fn }) => (
                        <button key={label} type="button" role="menuitem" onClick={menuAction(fn)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-fg-secondary active:bg-surface-raised">
                          <Icon className="h-4 w-4" /> {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {s.simulated && <SimulatedBanner />}
              <KpiGrid s={s} cols={2} />
              {s.stale_quotes.length > 0 && (
                <p className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> No live price for {s.stale_quotes.join(', ')}; excluded from value until a quote is available.
                </p>
              )}

              <button
                type="button"
                onClick={() => c.setTrade({})}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-[#fff] active:scale-[0.99]"
              >
                <Plus className="h-4 w-4" /> {s.simulated ? 'Place simulated order' : 'Add transaction'}
              </button>

              <PerformancePanel key={s.id} portfolioId={s.id} simulated={s.simulated} compact />

              <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-1 rounded-xl border border-line-subtle bg-surface-raised/50 p-1" role="tablist">
                {(['holdings', 'activity'] as const).map((k) => (
                  <button
                    key={k}
                    role="tab"
                    aria-selected={section === k}
                    onClick={() => setSection(k)}
                    className={`rounded-lg py-1.5 text-xs font-semibold ${section === k ? 'bg-surface-base text-fg-primary shadow-sm' : 'text-fg-secondary'}`}
                  >
                    {k === 'holdings' ? `Holdings (${s.holdings.length})` : `Activity (${s.transaction_count})`}
                  </button>
                ))}
              </div>

              {section === 'holdings' ? (
                <>
                  {s.holdings.length === 0 ? (
                    <p className="py-6 text-center text-sm text-fg-muted">
                      {s.simulated ? 'No positions yet. Place a simulated order to start.' : 'No holdings yet. Add a buy transaction.'}
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {s.holdings.map((h) => (
                        <li key={h.symbol} className="rounded-xl border border-line-subtle bg-surface-raised p-3">
                          <div className="flex items-center gap-3">
                            <TickerLogo symbol={h.symbol} size={32} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline justify-between gap-2">
                                <Link prefetch={false} href={`/research?symbol=${h.symbol}`} className="font-semibold text-fg-primary">{h.symbol}</Link>
                                <span className="tabular-nums text-sm font-semibold text-fg-primary">{fmtMoney(h.market_value)}</span>
                              </div>
                              <div className="flex items-baseline justify-between gap-2 text-[11px]">
                                <span className="truncate text-fg-muted">{fmtQty(h.quantity)} sh · avg {fmtMoney(h.avg_cost)}</span>
                                <span className={`tabular-nums ${pnlClass(h.unrealized_pnl)}`}>
                                  {fmtMoney(h.unrealized_pnl, { signed: true })} ({fmtPct(h.unrealized_pnl_percent)})
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="mt-2 flex items-center justify-between text-[11px]">
                            <span className="text-fg-muted">
                              {fmtMoney(h.price)} <span className={pnlClass(h.change_percent)}>{fmtPct(h.change_percent)}</span> · {h.weight == null ? '—' : `${h.weight.toFixed(1)}%`} of portfolio
                            </span>
                            <span className="flex gap-1">
                              <button type="button" className="rounded-md bg-emerald-500/10 px-2.5 py-1 font-semibold text-emerald-700 dark:text-emerald-400" onClick={() => c.setTrade({ symbol: h.symbol, side: 'BUY' })}>Buy</button>
                              <button type="button" className="rounded-md bg-red-500/10 px-2.5 py-1 font-semibold text-red-600 dark:text-red-400" onClick={() => c.setTrade({ symbol: h.symbol, side: 'SELL' })}>Sell</button>
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="rounded-xl border border-line-subtle bg-surface-raised p-3">
                    <p className="mb-2 text-xs font-semibold text-fg-primary">Allocation</p>
                    <AllocationDonut slices={s.allocation} size={110} />
                  </div>
                  <PortfolioForecastCard holdings={s.holdings} className="!p-3" />
                </>
              ) : c.txnsLoading ? (
                <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-fg-muted" /></div>
              ) : c.txns.length === 0 ? (
                <p className="py-6 text-center text-sm text-fg-muted">No transactions yet.</p>
              ) : (
                <ul className="divide-y divide-line-subtle overflow-hidden rounded-xl border border-line-subtle bg-surface-raised">
                  {c.txns.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 px-3 py-2.5">
                      <span className={`w-14 shrink-0 text-[10px] font-bold uppercase ${t.type === 'BUY' ? 'text-emerald-600 dark:text-emerald-400' : t.type === 'SELL' ? 'text-red-600 dark:text-red-400' : 'text-indigo-600 dark:text-indigo-400'}`}>{t.type}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-fg-primary">
                          {t.symbol}{' '}
                          {t.type !== 'DIVIDEND' && <span className="text-xs font-normal text-fg-muted">{fmtQty(t.quantity)} @ {fmtMoney(t.price)}</span>}
                        </p>
                        <p className="text-[11px] text-fg-muted">{fmtDate(t.date)}{t.realized_pnl != null && <span className={`ml-1 ${pnlClass(t.realized_pnl)}`}>· {fmtMoney(t.realized_pnl, { signed: true })}</span>}</p>
                      </div>
                      <span className="tabular-nums text-sm text-fg-primary">{fmtMoney(t.amount)}</span>
                      {!s.simulated && (
                        <button type="button" aria-label={`Delete ${t.type} ${t.symbol}`} onClick={() => c.deleteTxn(t.id)} className="p-1 text-fg-muted active:text-red-500">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}

      <Overlay open={c.createOpen} onClose={() => c.setCreateOpen(false)} title="New portfolio" variant="sheet">
        <CreatePortfolioForm onDone={(id) => { c.setCreateOpen(false); c.select(id) }} />
      </Overlay>
      {s && !s.simulated && (
        <Overlay open={c.importOpen} onClose={() => c.setImportOpen(false)} title="Import trades from CSV" variant="sheet">
          <ImportTradesForm portfolioId={s.id} onDone={() => c.setImportOpen(false)} />
        </Overlay>
      )}
      {s && (
        <Overlay open={!!c.trade} onClose={() => c.setTrade(null)} title={s.simulated ? 'Simulated order' : 'Add transaction'} variant="sheet">
          <TradeForm
            key={`${c.trade?.symbol}-${c.trade?.side}`}
            portfolio={s}
            initialSymbol={c.trade?.symbol}
            initialSide={c.trade?.side}
            onDone={() => c.setTrade(null)}
          />
        </Overlay>
      )}
    </div>
  )
}
