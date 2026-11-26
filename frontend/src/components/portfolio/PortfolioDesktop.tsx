'use client'

import Link from 'next/link'
import {
  Briefcase, Download, FlaskConical, Loader2, LogIn, Pencil, Plus, RotateCcw, Trash2, AlertTriangle, Upload,
} from 'lucide-react'
import { ImportTradesForm, PerformancePanel } from './PortfolioHistoryParts'
import AppLayout from '@/components/AppLayout'
import TickerLogo from '@/components/TickerLogo'
import { fmtDate, fmtMoney, fmtPct, fmtQty, pnlClass } from '@/lib/portfolio'
import {
  AllocationDonut, CreatePortfolioForm, KpiGrid, Overlay, SimulatedBadge, SimulatedBanner, TradeForm,
} from './PortfolioParts'
import { usePortfolioController } from './usePortfolioController'

const ghostBtn =
  'inline-flex items-center gap-1.5 rounded-lg border border-line-default px-3 py-1.5 text-xs font-medium text-fg-secondary hover:bg-surface-raised hover:text-fg-primary disabled:opacity-50'

export default function PortfolioDesktop() {
  const c = usePortfolioController()
  const s = c.selected

  return (
    <AppLayout>
      <div className="mx-auto max-w-[1280px] px-6 py-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-2.5">
              <Briefcase className="h-5 w-5 text-indigo-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-fg-primary">Portfolio</h1>
              <p className="mt-0.5 text-xs text-fg-muted">
                Track real holdings with cost basis and P&amp;L, or practice with a simulated paper account.
              </p>
            </div>
          </div>
          {c.isAuthenticated && (
            <button
              type="button"
              onClick={() => c.setCreateOpen(true)}
              disabled={c.portfolios.length >= c.limit}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-[#fff] hover:bg-indigo-500 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> New portfolio
            </button>
          )}
        </div>

        {c.authLoading || (c.isAuthenticated && c.list.isLoading) ? (
          <div className="hud-card flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-fg-muted" /></div>
        ) : !c.isAuthenticated ? (
          <div className="hud-card p-12 text-center">
            <LogIn className="mx-auto mb-4 h-10 w-10 text-fg-muted" />
            <h2 className="text-lg font-semibold text-fg-primary">Sign in to track your portfolio</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">
              Holdings, cost basis, P&amp;L and paper-trading accounts are private to your account.
            </p>
            <Link href="/auth" className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-[#fff] hover:bg-indigo-500">
              <LogIn className="h-4 w-4" /> Sign in
            </Link>
          </div>
        ) : c.portfolios.length === 0 ? (
          <div className="hud-card mx-auto max-w-xl p-8">
            <h2 className="mb-1 text-lg font-semibold text-fg-primary">Create your first portfolio</h2>
            <p className="mb-5 text-sm text-fg-muted">Pick one. You can add up to {c.limit}.</p>
            <CreatePortfolioForm onDone={(id) => c.select(id)} />
          </div>
        ) : (
          <>
            <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-line-subtle bg-surface-base p-1" role="tablist" aria-label="Portfolios">
              {c.portfolios.map((p) => (
                <button
                  key={p.id}
                  role="tab"
                  aria-selected={p.id === c.selectedId}
                  onClick={() => c.select(p.id)}
                  className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    p.id === c.selectedId
                      ? 'border border-indigo-500/20 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                      : 'text-fg-muted hover:bg-surface-raised/60 hover:text-fg-primary'
                  }`}
                >
                  {p.simulated && <FlaskConical className="h-3.5 w-3.5 text-amber-500" aria-label="Simulated" />}
                  {p.name}
                  <span className="tabular-nums text-xs text-fg-muted">{fmtMoney(p.total_value, { compact: true })}</span>
                </button>
              ))}
            </div>

            {!s ? (
              <div className="hud-card flex h-64 items-center justify-center">
                {c.detailError ? <p className="text-sm text-red-500">{c.detailError.message}</p> : <Loader2 className="h-6 w-6 animate-spin text-fg-muted" />}
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-fg-primary">{s.name}</h2>
                    {s.simulated ? <SimulatedBadge /> : <span className="rounded-full bg-surface-raised px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-secondary">Tracked</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => c.setTrade({})} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-[#fff] hover:bg-indigo-500">
                      <Plus className="h-3.5 w-3.5" /> {s.simulated ? 'Simulated order' : 'Add transaction'}
                    </button>
                    {!s.simulated && (
                      <button type="button" className={ghostBtn} onClick={() => c.setImportOpen(true)}>
                        <Upload className="h-3.5 w-3.5" /> Import CSV
                      </button>
                    )}
                    <button type="button" className={ghostBtn} disabled={c.exporting} onClick={() => c.exportCsv('holdings')}>
                      <Download className="h-3.5 w-3.5" /> Holdings CSV
                    </button>
                    <button type="button" className={ghostBtn} disabled={c.exporting} onClick={() => c.exportCsv('transactions')}>
                      <Download className="h-3.5 w-3.5" /> Transactions CSV
                    </button>
                    <button type="button" className={ghostBtn} onClick={c.rename}><Pencil className="h-3.5 w-3.5" /> Rename</button>
                    {s.simulated && <button type="button" className={ghostBtn} onClick={c.reset}><RotateCcw className="h-3.5 w-3.5" /> Reset</button>}
                    <button type="button" className={`${ghostBtn} hover:text-red-500`} onClick={c.remove}><Trash2 className="h-3.5 w-3.5" /> Delete</button>
                  </div>
                </div>

                {s.simulated && <SimulatedBanner />}
                <KpiGrid s={s} />
                {s.stale_quotes.length > 0 && (
                  <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" /> No live price for {s.stale_quotes.join(', ')}. Those holdings are left out of value and P&amp;L until a quote is available.
                  </p>
                )}

                <PerformancePanel key={s.id} portfolioId={s.id} simulated={s.simulated} />

                <div className="grid gap-5 2xl:grid-cols-[1fr_320px]">
                  <section className="hud-card overflow-hidden p-0" aria-label="Holdings">
                    <div className="border-b border-line-subtle px-4 py-3"><h3 className="text-sm font-semibold text-fg-primary">Holdings</h3></div>
                    {s.holdings.length === 0 ? (
                      <p className="p-6 text-center text-sm text-fg-muted">
                        {s.simulated ? 'No positions yet. Place a simulated order to start.' : 'No holdings yet. Add a buy transaction.'}
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="whitespace-nowrap text-left text-[11px] uppercase tracking-wide text-fg-muted">
                              <th className="px-4 py-2 font-medium">Symbol</th>
                              <th className="px-3 py-2 text-right font-medium">Shares</th>
                              <th className="px-3 py-2 text-right font-medium">Avg cost</th>
                              <th className="px-3 py-2 text-right font-medium">Price</th>
                              <th className="px-3 py-2 text-right font-medium">Value</th>
                              <th className="px-3 py-2 text-right font-medium">Today</th>
                              <th className="px-3 py-2 text-right font-medium">Unrealized</th>
                              <th className="px-3 py-2 text-right font-medium">Weight</th>
                              <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
                            </tr>
                          </thead>
                          <tbody>
                            {s.holdings.map((h) => (
                              <tr key={h.symbol} className="border-t border-line-subtle hover:bg-surface-raised/40">
                                <td className="px-4 py-2.5">
                                  <Link href={`/research?symbol=${h.symbol}`} className="flex items-center gap-2">
                                    <TickerLogo symbol={h.symbol} size={24} />
                                    <span>
                                      <span className="block font-semibold text-fg-primary">{h.symbol}</span>
                                      <span className="block max-w-[160px] truncate text-[11px] text-fg-muted">{h.name || h.sector}</span>
                                    </span>
                                  </Link>
                                </td>
                                <td className="px-3 py-2.5 text-right tabular-nums">{fmtQty(h.quantity)}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(h.avg_cost)}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(h.price)}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums font-medium">{fmtMoney(h.market_value)}</td>
                                <td className={`px-3 py-2.5 text-right tabular-nums ${pnlClass(h.change_percent)}`}>{fmtPct(h.change_percent)}</td>
                                <td className={`px-3 py-2.5 text-right tabular-nums ${pnlClass(h.unrealized_pnl)}`}>
                                  {fmtMoney(h.unrealized_pnl, { signed: true })}
                                  <span className="block text-[11px]">{fmtPct(h.unrealized_pnl_percent)}</span>
                                </td>
                                <td className="px-3 py-2.5 text-right tabular-nums text-fg-secondary">{h.weight == null ? '—' : `${h.weight.toFixed(1)}%`}</td>
                                <td className="px-3 py-2.5 text-right">
                                  <div className="flex justify-end gap-1">
                                    <button type="button" className="rounded px-2 py-1 text-[11px] font-semibold text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400" onClick={() => c.setTrade({ symbol: h.symbol, side: 'BUY' })}>Buy</button>
                                    <button type="button" className="rounded px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-500/10 dark:text-red-400" onClick={() => c.setTrade({ symbol: h.symbol, side: 'SELL' })}>Sell</button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  <section className="hud-card p-4 2xl:max-w-none" aria-label="Allocation">
                    <h3 className="mb-3 text-sm font-semibold text-fg-primary">Allocation</h3>
                    <AllocationDonut slices={s.allocation} size={120} />
                  </section>
                </div>

                <section className="hud-card overflow-hidden p-0" aria-label="Transactions">
                  <div className="border-b border-line-subtle px-4 py-3">
                    <h3 className="text-sm font-semibold text-fg-primary">Transactions <span className="font-normal text-fg-muted">({s.transaction_count})</span></h3>
                  </div>
                  {c.txnsLoading ? (
                    <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-fg-muted" /></div>
                  ) : c.txns.length === 0 ? (
                    <p className="p-6 text-center text-sm text-fg-muted">No transactions yet.</p>
                  ) : (
                    <div className="max-h-[420px] overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-surface-base">
                          <tr className="whitespace-nowrap text-left text-[11px] uppercase tracking-wide text-fg-muted">
                            <th className="px-4 py-2 font-medium">Date</th>
                            <th className="px-3 py-2 font-medium">Type</th>
                            <th className="px-3 py-2 font-medium">Symbol</th>
                            <th className="px-3 py-2 text-right font-medium">Shares</th>
                            <th className="px-3 py-2 text-right font-medium">Price</th>
                            <th className="px-3 py-2 text-right font-medium">Amount</th>
                            <th className="px-3 py-2 text-right font-medium">Realized</th>
                            <th className="px-3 py-2 font-medium">Notes</th>
                            {!s.simulated && <th className="px-3 py-2"><span className="sr-only">Delete</span></th>}
                          </tr>
                        </thead>
                        <tbody>
                          {c.txns.map((t) => (
                            <tr key={t.id} className="border-t border-line-subtle">
                              <td className="px-4 py-2 text-fg-secondary">{fmtDate(t.date)}</td>
                              <td className={`px-3 py-2 text-xs font-semibold ${t.type === 'BUY' ? 'text-emerald-600 dark:text-emerald-400' : t.type === 'SELL' ? 'text-red-600 dark:text-red-400' : 'text-indigo-600 dark:text-indigo-400'}`}>{t.type}</td>
                              <td className="px-3 py-2 font-medium text-fg-primary">{t.symbol}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{t.type === 'DIVIDEND' ? '—' : fmtQty(t.quantity)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{t.type === 'DIVIDEND' ? '—' : fmtMoney(t.price)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(t.amount)}</td>
                              <td className={`px-3 py-2 text-right tabular-nums ${pnlClass(t.realized_pnl)}`}>{t.realized_pnl == null ? '—' : fmtMoney(t.realized_pnl, { signed: true })}</td>
                              <td className="max-w-[220px] truncate px-3 py-2 text-xs text-fg-muted">{t.notes}</td>
                              {!s.simulated && (
                                <td className="px-3 py-2 text-right">
                                  <button type="button" aria-label={`Delete ${t.type} ${t.symbol}`} onClick={() => c.deleteTxn(t.id)} className="rounded p-1 text-fg-muted hover:bg-red-500/10 hover:text-red-500">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>
            )}
          </>
        )}
      </div>

      <Overlay open={c.createOpen} onClose={() => c.setCreateOpen(false)} title="New portfolio" variant="modal">
        <CreatePortfolioForm onDone={(id) => { c.setCreateOpen(false); c.select(id) }} />
      </Overlay>
      {s && !s.simulated && (
        <Overlay open={c.importOpen} onClose={() => c.setImportOpen(false)} title="Import trades from CSV" variant="modal">
          <ImportTradesForm portfolioId={s.id} onDone={() => c.setImportOpen(false)} />
        </Overlay>
      )}
      {s && (
        <Overlay
          open={!!c.trade}
          onClose={() => c.setTrade(null)}
          title={s.simulated ? 'Simulated order' : 'Add transaction'}
          variant="modal"
        >
          <TradeForm
            key={`${c.trade?.symbol}-${c.trade?.side}`}
            portfolio={s}
            initialSymbol={c.trade?.symbol}
            initialSide={c.trade?.side}
            onDone={() => c.setTrade(null)}
          />
        </Overlay>
      )}
    </AppLayout>
  )
}
