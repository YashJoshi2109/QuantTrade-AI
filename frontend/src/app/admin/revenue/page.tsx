'use client'

import { CreditCard, Percent, TrendingDown, UserCheck, Users, Wallet } from 'lucide-react'
import {
  Bar, Card, CardSkeleton, ErrorBox, KpiCard, KpiSkeletonRow, Note, PageHeader, StatusPill, TableWrap, td, th, useAdminQuery, useAdminRange,
} from '@/components/admin/AdminUI'
import { fmtDate, fmtInt, fmtPct, fmtUsd } from '@/lib/admin'

export default function RevenuePage() {
  const { range } = useAdminRange()
  const { data, error, refetch } = useAdminQuery<any>(`/revenue?range=${range}`)
  const s = data?.summary
  const k = (value: any, reason?: string) => ({ value, reason })
  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader title="Revenue & Plans" page="revenue" exportData={data}
        subtitle="Subscriptions mirrored from Stripe webhooks (read-only). MRR uses live Stripe price amounts; nothing here can change billing." />
      {error && <ErrorBox error={error} onRetry={() => refetch()} />}
      {!s ? <KpiSkeletonRow n={6} /> : !s.available ? <ErrorBox error={new Error(s.reason || 'Billing data unavailable')} /> : (
        <>
          <div className="keep-cols grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard label="MRR" icon={<CreditCard className="h-4 w-4" />} data={k(s.mrr_usd, s.mrr_reason)} format={(v) => fmtUsd(v)} accent="#f59e0b" hint="current" />
            <KpiCard label="Paid subscribers" icon={<UserCheck className="h-4 w-4" />} data={k(s.paid_subscribers)} format={fmtInt} accent="#10b981" hint={`${fmtInt(s.trialing)} trialing`} />
            <KpiCard label="Paid share" icon={<Percent className="h-4 w-4" />} data={k(s.paid_share, 'no users')} format={(v) => fmtPct(v)} hint="of all accounts" />
            <KpiCard label="Churn (range)" icon={<TrendingDown className="h-4 w-4" />} data={k(s.churn_rate, 'no paid or churned subscriptions')} format={(v) => fmtPct(v)} accent="#ef4444" hint={`${fmtInt(s.churned_in_range)} churned`} />
            <KpiCard label="ARPU" icon={<Users className="h-4 w-4" />} data={k(s.arpu_usd, s.mrr_reason || 'MRR unavailable')} format={(v) => fmtUsd(v, 2)} accent="#8b5cf6" hint="MRR / all users" />
            <KpiCard label="ARPPU" icon={<Wallet className="h-4 w-4" />} data={k(s.arppu_usd, s.mrr_reason || 'MRR unavailable')} format={(v) => fmtUsd(v, 2)} accent="#06b6d4" hint="MRR / paying users" />
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <Card title="Free vs paid" subtitle={`${fmtInt(s.total_users)} accounts`}>
              <div className="space-y-3 text-xs">
                <div><div className="mb-1 flex justify-between"><span>Paid</span><span className="tabular-nums">{fmtInt(s.paid_subscribers)}</span></div><Bar value={s.paid_subscribers} max={s.total_users || 0} color="#10b981" /></div>
                <div><div className="mb-1 flex justify-between"><span>Free</span><span className="tabular-nums">{fmtInt(s.free_users)}</span></div><Bar value={s.free_users || 0} max={s.total_users || 0} color="#64748b" /></div>
              </div>
              <Note>Pending cancellations (cancel at period end): {fmtInt(s.cancel_at_period_end)} · Stripe webhook events in range: {fmtInt(s.billing_events_in_range)}</Note>
            </Card>
            <Card title="Subscriptions by status">
              <ul className="space-y-1.5 text-xs">{Object.entries(s.by_status).length === 0 ? <li className="text-slate-400">No subscriptions</li> :
                Object.entries(s.by_status).map(([k2, v]: any) => <li key={k2} className="flex justify-between"><StatusPill status={k2 === 'active' || k2 === 'trialing' ? 'ok' : k2 === 'past_due' ? 'degraded' : 'down'} label={k2} /><span className="tabular-nums">{fmtInt(v)}</span></li>)}</ul>
            </Card>
            <Card title="Entitled plans">
              <ul className="space-y-1.5 text-xs">{Object.entries(s.by_plan).length === 0 ? <li className="text-slate-400">No paid plans</li> :
                Object.entries(s.by_plan).map(([k2, v]: any) => <li key={k2} className="flex justify-between"><span>{k2}</span><span className="tabular-nums">{fmtInt(v)}</span></li>)}</ul>
            </Card>
          </div>
        </>
      )}
      {!data ? <div className="mt-4"><CardSkeleton rows={6} /></div> : (
        <Card className="mt-4" title="Subscriptions" subtitle="Most recently updated (up to 200)">
          <TableWrap><thead><tr>{['User', 'Plan', 'Status', 'Entitled', 'Period end', 'Cancels', 'Updated'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {data.subscriptions.length === 0 && <tr><td className={td} colSpan={7}>No subscriptions recorded</td></tr>}
              {data.subscriptions.map((r: any) => (
                <tr key={r.user_id}><td className={td}><a className="font-semibold text-blue-600 dark:text-cyan-400" href={`/admin/users?user=${r.user_id}`}>{r.username}</a></td>
                  <td className={td}>{r.plan}</td><td className={td}><StatusPill status={r.entitled ? 'ok' : 'down'} label={r.status} /></td>
                  <td className={td}>{r.entitled ? 'Yes' : 'No'}</td><td className={td}>{fmtDate(r.current_period_end)}</td>
                  <td className={td}>{r.cancel_at_period_end ? 'At period end' : '—'}</td><td className={td}>{fmtDate(r.updated_at)}</td></tr>
              ))}
            </tbody></TableWrap>
        </Card>
      )}
    </div>
  )
}
