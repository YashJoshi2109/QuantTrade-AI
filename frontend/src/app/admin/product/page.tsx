'use client'

import { Card, CardSkeleton, ErrorBox, Note, PageHeader, TableWrap, td, th, useAdminQuery, useAdminRange, Val, Bar } from '@/components/admin/AdminUI'
import { fmtDelta, fmtInt, fmtUsd } from '@/lib/admin'
import { cn } from '@/lib/utils'

export default function ProductPage() {
  const { range } = useAdminRange()
  const { data, error, refetch } = useAdminQuery<any>(`/product?range=${range}`)
  const maxAi = Math.max(0, ...(data?.ai_features || []).map((f: any) => f.calls))
  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader title="Product Analytics" page="product" exportData={data}
        subtitle="Feature adoption from first-party tables: created rows in the range vs the previous range of equal length." />
      {error && <ErrorBox error={error} onRetry={() => refetch()} />}
      {!data ? <CardSkeleton rows={8} /> : (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2" title="Feature usage" subtitle="Rows created in the range">
            <TableWrap><thead><tr>{['Feature', 'In range', 'Prior range', 'Change', 'All time'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {data.features.map((f: any) => {
                  const d = fmtDelta(f.delta_pct)
                  return (
                    <tr key={f.key}><td className={td}>{f.label}</td>
                      <td className={`${td} font-semibold`}><Val v={f.in_range == null ? null : fmtInt(f.in_range)} reason={f.reason} /></td>
                      <td className={td}><Val v={f.prior == null ? null : fmtInt(f.prior)} reason={f.reason} /></td>
                      <td className={cn(td, d.tone === 'up' && 'text-emerald-600 dark:text-emerald-400', d.tone === 'down' && 'text-rose-600 dark:text-rose-400')}>{d.text}</td>
                      <td className={td}><Val v={f.total == null ? null : fmtInt(f.total)} reason={f.reason} /></td></tr>
                  )
                })}
              </tbody></TableWrap>
            <Note>Active price alerts right now: {fmtInt(data.active_alerts)}.</Note>
          </Card>
          <div className="space-y-4">
            <Card title="AI features" subtitle="Paid model calls by feature">
              {data.ai_features.length === 0 ? <p className="text-xs text-slate-400">No AI calls in this range</p> : (
                <ul className="space-y-2.5 text-xs">{data.ai_features.map((f: any) => (
                  <li key={f.feature}><div className="mb-1 flex justify-between"><span>{f.feature}</span><span className="tabular-nums text-slate-500">{fmtInt(f.calls)} · {fmtUsd(f.cost_usd, 4)}</span></div><Bar value={f.calls} max={maxAi} /></li>
                ))}</ul>
              )}
            </Card>
            <Card title="Backtest queue" subtitle="This API process">
              <dl className="keep-cols grid grid-cols-2 gap-2 text-xs">
                <div><dt className="text-slate-400">Queued</dt><dd className="font-semibold tabular-nums"><Val v={data.backtests.queued == null ? null : fmtInt(data.backtests.queued)} reason={data.backtests.reason} /></dd></div>
                <div><dt className="text-slate-400">Running</dt><dd className="font-semibold tabular-nums"><Val v={data.backtests.running == null ? null : fmtInt(data.backtests.running)} reason={data.backtests.reason} /></dd></div>
              </dl>
              <p className="mt-2 text-[11px] text-slate-500">Recent outcomes: {(data.backtests.recent_statuses || []).join(', ') || '—'}</p>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
