'use client'

import { cn } from '@/lib/utils'
import {
  STATE_DOT,
  STATE_LABEL,
  STATE_TEXT,
  formatAge,
  formatLatency,
  groupServices,
  quotaPercent,
  secondsSince,
  sparklinePath,
  type HistoryPoint,
  type ServiceStatus,
  type SystemStatus,
} from '@/lib/systemStatus'
import { useNow } from './SystemStatusProvider'

export function StatusDot({ state, className }: { state: keyof typeof STATE_DOT; className?: string }) {
  return (
    <span className={cn('relative inline-flex h-2.5 w-2.5 shrink-0', className)} aria-hidden>
      {(state === 'down' || state === 'degraded') && (
        <span className={cn('absolute inset-0 rounded-full opacity-60 animate-ping', STATE_DOT[state])} />
      )}
      <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', STATE_DOT[state])} />
    </span>
  )
}

function QuotaBar({ svc }: { svc: ServiceStatus }) {
  const q = svc.quota
  const pct = quotaPercent(q)
  if (!q || pct == null) return null
  const tone = pct >= 100 ? 'bg-rose-500' : pct >= 90 ? 'bg-amber-500' : 'bg-sky-500'
  return (
    <div className="mt-1.5">
      <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
        <span>
          Quota {q.used}/{q.limit}
          {q.window ? ` per ${q.window}` : ''}
        </span>
        <span>{q.remaining} left</span>
      </div>
      <div
        className="mt-0.5 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden"
        role="meter"
        aria-label={`${svc.name} quota used`}
        aria-valuemin={0}
        aria-valuemax={q.limit}
        aria-valuenow={q.used}
      >
        <div className={cn('h-full rounded-full transition-[width] duration-500', tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function Sparkline({ points, className }: { points: HistoryPoint[]; className?: string }) {
  const w = 120
  const h = 28
  const path = sparklinePath(points, w, h)
  const last = points[points.length - 1]
  const stroke =
    last?.status === 'down' ? 'stroke-rose-500' : last?.status === 'degraded' ? 'stroke-amber-500' : 'stroke-sky-500'
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn('h-7 w-[120px]', className)} role="img"
      aria-label={path ? 'Latency over the last 5 minutes' : 'Not enough latency samples yet'}>
      <line x1="0" x2={w} y1={h - 0.5} y2={h - 0.5} className="stroke-slate-200 dark:stroke-slate-700" strokeWidth="1" />
      {path ? (
        <polyline points={path} fill="none" className={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      ) : (
        <text x={w / 2} y={h / 2 + 3} textAnchor="middle" className="fill-slate-400 text-[8px]">
          collecting…
        </text>
      )}
    </svg>
  )
}

export function ServiceRow({
  svc,
  status,
  receivedAt,
  now,
  history,
  dense,
}: {
  svc: ServiceStatus
  status: SystemStatus
  receivedAt: number
  now: number
  history?: HistoryPoint[]
  dense?: boolean
}) {
  const checked = secondsSince(svc.last_checked_at, status.generated_at, receivedAt, now)
  const lastOk = secondsSince(svc.last_ok_at, status.generated_at, receivedAt, now)
  return (
    <li className={cn('flex gap-3', dense ? 'py-2' : 'py-3')} data-testid={`svc-${svc.id}`}>
      <StatusDot state={svc.status} className="mt-1" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13px] font-semibold text-slate-900 dark:text-slate-100">{svc.name}</span>
          <span className={cn('shrink-0 text-[11px] font-medium', STATE_TEXT[svc.status])}>{STATE_LABEL[svc.status]}</span>
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-slate-600 dark:text-slate-300 break-words">{svc.detail}</p>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
          {svc.latency_ms != null && <span>Latency {formatLatency(svc.latency_ms)}</span>}
          <span>Checked {checked == null ? '—' : `${formatAge(checked)} ago`}</span>
          {svc.status !== 'not_configured' && (
            <span>Last OK {lastOk == null ? 'never' : lastOk < 2 ? 'now' : `${formatAge(lastOk)} ago`}</span>
          )}
        </div>
        <QuotaBar svc={svc} />
        {history && (
          <div className="mt-1 sm:hidden">
            <Sparkline points={history} />
          </div>
        )}
      </div>
      {history && (
        <div className="hidden sm:block shrink-0 self-center">
          <Sparkline points={history} />
        </div>
      )}
    </li>
  )
}

export function SystemStatusSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-slate-200 dark:divide-slate-800" aria-busy="true" aria-label="Loading system status">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex gap-3 py-3">
          <span className="mt-1 h-2.5 w-2.5 rounded-full bg-slate-200 dark:bg-slate-700 animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-1/3 rounded bg-slate-200 dark:bg-slate-700 animate-pulse" />
            <div className="h-2.5 w-4/5 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function SystemStatusList({
  status,
  receivedAt,
  history,
  dense,
}: {
  status: SystemStatus
  receivedAt: number
  history?: Record<string, HistoryPoint[]>
  dense?: boolean
}) {
  const now = useNow(1000)
  return (
    <div className="space-y-4">
      {groupServices(status).map((g) => (
        <section key={g.label} aria-label={g.label}>
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{g.label}</h3>
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {g.services.map((svc) => (
              <ServiceRow
                key={svc.id}
                svc={svc}
                status={status}
                receivedAt={receivedAt}
                now={now}
                history={history ? history[svc.id] ?? [] : undefined}
                dense={dense}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
