'use client'

import Link from 'next/link'
import { BellRing, Mail, Pause, Play, Plus, Repeat, Trash2 } from 'lucide-react'
import TickerLogo from '@/components/TickerLogo'
import { STATUS_STYLE, describeAlert, distanceToLevel, earningsCountdown } from '@/lib/alerts'
import { AlertForm, AlertsListSkeleton, FILTERS, Overlay, SuggestedAlerts, relTime, useAlertsController } from './AlertsParts'
import SignInPrompt from '@/components/ui/SignInPrompt'
import PageHeading from '@/components/seo/PageHeading'

export default function AlertsMobile() {
  const c = useAlertsController()
  return (
    <div className="space-y-4 pt-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BellRing className="h-5 w-5 text-amber-500" />
          <PageHeading mobile className="text-lg font-bold text-fg-primary">Price alerts</PageHeading>
        </div>
        {c.isAuthenticated && c.alerts.length > 0 && (
          <button
            type="button"
            aria-label="New alert"
            onClick={() => { c.setPrefill(''); c.setCreateOpen(true) }}
            disabled={c.alerts.length >= c.limit}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line-subtle bg-surface-raised text-fg-secondary active:scale-95 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>
      <p className="text-xs text-fg-muted">
        Price, daily % move and RSI alerts. Triggered alerts land in{' '}
        <Link href="/notifications" className="text-indigo-600 dark:text-indigo-400">Notifications</Link>.
      </p>

      {c.authLoading || (c.isAuthenticated && c.loading) ? (
        <AlertsListSkeleton rows={4} compact />
      ) : !c.isAuthenticated ? (
        <>
          <SignInPrompt
            compact
            icon={BellRing}
            title="Sign in to set price alerts"
            description="Alerts are tied to your account and delivered to your notifications."
          />
          <SuggestedAlerts variant="mobile" signedIn={false} alerts={[]} prominent />
        </>
      ) : c.alerts.length === 0 ? (
        <>
          <SuggestedAlerts variant="mobile" signedIn alerts={c.alerts} prominent />
          <div className="rounded-2xl border border-line-subtle bg-surface-raised p-4">
            <p className="mb-3 text-sm font-semibold text-fg-primary">Create your own alert</p>
            <AlertForm initialSymbol={c.prefill} initialCondition={c.prefillCondition} onDone={() => undefined} />
          </div>
        </>
      ) : (
        <>
          <SuggestedAlerts variant="mobile" signedIn alerts={c.alerts} atLimit={c.alerts.length >= c.limit} />
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide" role="tablist" aria-label="Filter alerts">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={c.filter === f.id}
                onClick={() => c.setFilter(f.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  c.filter === f.id ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' : 'border-line-subtle bg-surface-raised text-fg-secondary'
                }`}
              >
                {f.label} <span className="opacity-70">{c.counts[f.id]}</span>
              </button>
            ))}
          </div>

          {c.shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-muted">No {c.filter} alerts.</p>
          ) : (
            <ul className="space-y-2">
              {c.shown.map((a) => {
                const dist = distanceToLevel(a)
                return (
                  <li key={a.id} className="rounded-xl border border-line-subtle bg-surface-raised p-3">
                    <div className="flex items-center gap-3">
                      <TickerLogo symbol={a.symbol} size={32} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <Link prefetch={false} href={`/research?symbol=${a.symbol}`} className="font-semibold text-fg-primary">{a.symbol}</Link>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${STATUS_STYLE[a.status]}`}>{a.status}</span>
                        </div>
                        <p className="text-xs text-fg-secondary">{describeAlert(a)}</p>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-fg-muted">
                      <span className="min-w-0 truncate">
                        {earningsCountdown(a) ?? (a.current_price == null ? 'Price n/a' : `$${a.current_price.toFixed(2)}`)}
                        {dist != null && a.status === 'active' && ` · ${Math.abs(dist).toFixed(1)}% to level`}
                        {a.trigger_count > 0 && ` · fired ${relTime(a.last_triggered_at)}`}
                        {a.repeat && <Repeat className="ml-1 inline h-3 w-3" aria-label="repeats" />}
                        {a.notify_email && <Mail className="ml-1 inline h-3 w-3" aria-label="email" />}
                      </span>
                      <span className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => c.toggle(a)}
                          aria-label={a.status === 'active' ? `Pause ${a.symbol} alert` : `Activate ${a.symbol} alert`}
                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-base text-fg-secondary active:scale-95"
                        >
                          {a.status === 'active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => c.remove(a)}
                          aria-label={`Delete ${a.symbol} alert`}
                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 text-red-600 active:scale-95 dark:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </span>
                    </div>
                    {a.note && <p className="mt-1 truncate text-[11px] text-fg-muted">“{a.note}”</p>}
                  </li>
                )
              })}
            </ul>
          )}
          <p className="text-center text-[11px] text-fg-muted">{c.alerts.length} of {c.limit} alerts · checked about every 5 minutes</p>
        </>
      )}

      <Overlay open={c.createOpen} onClose={() => c.setCreateOpen(false)} title="New alert" variant="sheet">
        <AlertForm key={`${c.prefill}-${c.prefillCondition}`} initialSymbol={c.prefill} initialCondition={c.prefillCondition} onDone={() => c.setCreateOpen(false)} />
      </Overlay>
    </div>
  )
}
