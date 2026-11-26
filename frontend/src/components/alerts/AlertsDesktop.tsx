'use client'

import Link from 'next/link'
import { BellRing, Loader2, LogIn, Mail, Pause, Play, Plus, Repeat, Trash2 } from 'lucide-react'
import AppLayout from '@/components/AppLayout'
import TickerLogo from '@/components/TickerLogo'
import { STATUS_STYLE, describeAlert, distanceToLevel, earningsCountdown } from '@/lib/alerts'
import { AlertForm, FILTERS, Overlay, relTime, useAlertsController } from './AlertsParts'

export default function AlertsDesktop() {
  const c = useAlertsController()
  return (
    <AppLayout>
      <div className="mx-auto max-w-[1100px] px-6 py-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-2.5">
              <BellRing className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-fg-primary">Price alerts</h1>
              <p className="mt-0.5 text-xs text-fg-muted">
                Get notified when a stock crosses a price, moves a set % on the day, or hits an RSI level.
                Triggered alerts appear in <Link href="/notifications" className="text-indigo-600 hover:underline dark:text-indigo-400">Notifications</Link>.
              </p>
            </div>
          </div>
          {c.isAuthenticated && (
            <button
              type="button"
              onClick={() => { c.setPrefill(''); c.setCreateOpen(true) }}
              disabled={c.alerts.length >= c.limit}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-[#fff] hover:bg-indigo-500 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> New alert
            </button>
          )}
        </div>

        {c.authLoading || (c.isAuthenticated && c.loading) ? (
          <div className="hud-card flex h-56 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-fg-muted" /></div>
        ) : !c.isAuthenticated ? (
          <div className="hud-card p-12 text-center">
            <LogIn className="mx-auto mb-4 h-10 w-10 text-fg-muted" />
            <h2 className="text-lg font-semibold text-fg-primary">Sign in to set price alerts</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">Alerts are tied to your account and delivered to your notifications.</p>
            <Link href="/auth" className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-[#fff] hover:bg-indigo-500">
              <LogIn className="h-4 w-4" /> Sign in
            </Link>
          </div>
        ) : c.alerts.length === 0 ? (
          <div className="hud-card mx-auto max-w-lg p-8">
            <h2 className="mb-1 text-lg font-semibold text-fg-primary">Create your first alert</h2>
            <p className="mb-5 text-sm text-fg-muted">Up to {c.limit} alerts. Checked about every 5 minutes.</p>
            <AlertForm initialSymbol={c.prefill} initialCondition={c.prefillCondition} onDone={() => undefined} />
          </div>
        ) : (
          <>
            <div className="mb-4 flex gap-1 rounded-xl border border-line-subtle bg-surface-base p-1" role="tablist" aria-label="Filter alerts">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  role="tab"
                  aria-selected={c.filter === f.id}
                  onClick={() => c.setFilter(f.id)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${
                    c.filter === f.id ? 'border border-indigo-500/20 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' : 'text-fg-muted hover:text-fg-primary'
                  }`}
                >
                  {f.label}
                  <span className="rounded-full bg-surface-raised px-1.5 text-[10px] font-bold">{c.counts[f.id]}</span>
                </button>
              ))}
              <span className="ml-auto self-center pr-2 text-xs text-fg-muted">{c.alerts.length} / {c.limit}</span>
            </div>

            <section className="hud-card overflow-hidden p-0" aria-label="Alerts">
              {c.shown.length === 0 ? (
                <p className="p-8 text-center text-sm text-fg-muted">No {c.filter} alerts.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="whitespace-nowrap text-left text-[11px] uppercase tracking-wide text-fg-muted">
                      <th className="px-4 py-2.5 font-medium">Symbol</th>
                      <th className="px-3 py-2.5 font-medium">Condition</th>
                      <th className="px-3 py-2.5 text-right font-medium">Last price</th>
                      <th className="px-3 py-2.5 font-medium">Status</th>
                      <th className="px-3 py-2.5 font-medium">Last fired</th>
                      <th className="px-3 py-2.5"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.shown.map((a) => {
                      const dist = distanceToLevel(a)
                      return (
                        <tr key={a.id} className="border-t border-line-subtle hover:bg-surface-raised/40">
                          <td className="px-4 py-3">
                            <Link href={`/research?symbol=${a.symbol}`} className="flex items-center gap-2">
                              <TickerLogo symbol={a.symbol} size={24} />
                              <span>
                                <span className="block font-semibold text-fg-primary">{a.symbol}</span>
                                <span className="block max-w-[160px] truncate text-[11px] text-fg-muted">{a.name}</span>
                              </span>
                            </Link>
                          </td>
                          <td className="px-3 py-3">
                            <span className="text-fg-primary">{describeAlert(a)}</span>
                            <span className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-muted">
                              {a.repeat && <span className="inline-flex items-center gap-0.5"><Repeat className="h-3 w-3" /> repeats</span>}
                              {a.notify_email && <span className="inline-flex items-center gap-0.5"><Mail className="h-3 w-3" /> email</span>}
                              {a.note && <span className="max-w-[220px] truncate">“{a.note}”</span>}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            {earningsCountdown(a) ? (
                              <span className="text-xs text-fg-secondary">{earningsCountdown(a)}</span>
                            ) : a.current_price == null ? '—' : `$${a.current_price.toFixed(2)}`}
                            {dist != null && a.status === 'active' && (
                              <span className="block text-[11px] text-fg-muted">{Math.abs(dist).toFixed(1)}% {dist > 0 ? 'below level' : 'above level'}</span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS_STYLE[a.status]}`}>{a.status}</span>
                          </td>
                          <td className="px-3 py-3 text-xs text-fg-secondary">
                            {a.trigger_count > 0 ? `${relTime(a.last_triggered_at)} · ${a.trigger_count}×` : 'Never'}
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => c.toggle(a)}
                                aria-label={a.status === 'active' ? `Pause ${a.symbol} alert` : `Activate ${a.symbol} alert`}
                                title={a.status === 'active' ? 'Pause' : a.status === 'triggered' ? 'Re-activate' : 'Resume'}
                                className="rounded p-1.5 text-fg-muted hover:bg-surface-raised hover:text-fg-primary"
                              >
                                {a.status === 'active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                              </button>
                              <button type="button" onClick={() => c.remove(a)} aria-label={`Delete ${a.symbol} alert`} className="rounded p-1.5 text-fg-muted hover:bg-red-500/10 hover:text-red-500">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </div>
      <Overlay open={c.createOpen} onClose={() => c.setCreateOpen(false)} title="New alert" variant="modal">
        <AlertForm key={`${c.prefill}-${c.prefillCondition}`} initialSymbol={c.prefill} initialCondition={c.prefillCondition} onDone={() => c.setCreateOpen(false)} />
      </Overlay>
    </AppLayout>
  )
}
