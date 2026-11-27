'use client'

import { Card, Val } from '@/components/admin/AdminUI'
import { fmtAgo } from '@/lib/admin'

export function Stat({ label, value, reason }: { label: string; value: string | null; reason?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-2 py-2 dark:bg-slate-900/60">
      <dt className="text-[10px] text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900 dark:text-white"><Val v={value} reason={reason} /></dd>
    </div>
  )
}

export function ActivityFeed({ items, title = 'Operational activity' }: { items: any[]; title?: string }) {
  return (
    <Card title={title} subtitle="Service status changes, deploys, ML pipeline runs and admin actions">
      {items.length === 0 ? <p className="py-6 text-center text-xs text-slate-400">No operational events in this range</p> : (
        <ol className="max-h-80 space-y-3 overflow-y-auto pr-1">
          {items.map((i, n) => (
            <li key={n} className="flex gap-3">
              <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${i.severity === 'critical' ? 'bg-rose-500' : i.severity === 'warning' ? 'bg-amber-500' : i.severity === 'ok' ? 'bg-emerald-500' : 'bg-blue-500'}`} />
              <div className="min-w-0">
                <p className="text-xs text-slate-800 dark:text-slate-100">{i.title}</p>
                <p className="text-[10px] text-slate-400">{i.kind.replace('_', ' ')} · {fmtAgo(i.ts)}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

