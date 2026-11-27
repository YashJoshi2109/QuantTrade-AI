'use client'

/**
 * /status — the same live probe results as the top-bar pill, plus a latency
 * sparkline per service from the last ~5 minutes (kept in this browser only).
 */
import AppLayout from '@/components/AppLayout'
import BottomNav from '@/components/layout/BottomNav'
import SystemStatusList, { StatusDot, SystemStatusSkeleton } from '@/components/status/SystemStatusList'
import { useNow, useSystemStatus } from '@/components/status/SystemStatusProvider'
import { formatAge, issueServices, pillView, secondsSince } from '@/lib/systemStatus'
import { cn } from '@/lib/utils'

const BANNER = {
  ok: 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950',
  degraded: 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950',
  down: 'border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950',
  unknown: 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
} as const

export default function StatusPage() {
  const { data, receivedAt, failed, history } = useSystemStatus()
  const now = useNow(1000)
  const view = pillView(data, failed)
  const issues = issueServices(data)
  const updated = data ? secondsSince(data.generated_at, data.generated_at, receivedAt, now) : null

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl pb-24 md:pb-8">
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">System status</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Every service QuantTrade depends on, checked continuously by the API. Quota-metered providers are
          reported from real usage counters, never by spending calls.
        </p>

        <div className={cn('mt-4 rounded-2xl border p-4', BANNER[view.tone])} role="status" aria-live="polite">
          <div className="flex items-center gap-2">
            <StatusDot state={view.tone === 'unknown' ? 'pending' : view.tone} />
            <span className="text-base font-semibold text-slate-900 dark:text-slate-100">{view.label}</span>
          </div>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            {data
              ? `Updated ${formatAge(updated)} ago · refreshes every second while this tab is visible`
              : failed
                ? 'The status API is not answering. Retrying every 10 seconds.'
                : 'Loading live probe results…'}
            {data && failed ? ' · status API not answering, retrying every 10s' : ''}
          </p>
          {issues.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-slate-700 dark:text-slate-200">
              {issues.map((s) => (
                <li key={s.id}>
                  <span className="font-semibold">{s.name}:</span> {s.detail}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          {data ? (
            <SystemStatusList status={data} receivedAt={receivedAt} history={history} />
          ) : (
            <SystemStatusSkeleton rows={10} />
          )}
        </div>
        <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
          Sparklines show each check&apos;s latency over the last 5 minutes, recorded in this browser since you opened
          the page.
        </p>
      </div>
      <BottomNav />
    </AppLayout>
  )
}
