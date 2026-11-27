'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Activity, BrainCircuit, CreditCard, Eye, EyeOff, UserPlus, Users } from 'lucide-react'
import {
  AvailabilityBars, Bar, Card, CardSkeleton, Donut, ErrorBox, KpiCard, KpiSkeletonRow, LineSeries, Note, PageHeader,
  StatusPill, TableWrap, td, th, useAdminQuery, useAdminRange, Val,
} from '@/components/admin/AdminUI'
import { ActivityFeed, Stat } from '@/components/admin/AdminBlocks'
import { adminPost, fmtAvg, fmtAgo, fmtCompact, fmtDate, fmtInt, fmtMs, fmtPct, fmtUsd } from '@/lib/admin'

export default function CommandCenter() {
  const { range } = useAdminRange()
  const { data, error, isLoading, refetch } = useAdminQuery<any>(`/overview?range=${range}`)

  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader title="Command Center" page="overview" exportData={data}
        subtitle="Users, AI spend, revenue and platform health in one view. Every number is read live from the production database, Redis counters, Stripe and the status collector." />
      {error && <div className="mb-4"><ErrorBox error={error} onRetry={() => refetch()} /></div>}
      {isLoading || !data ? (
        <div className="space-y-4"><KpiSkeletonRow n={5} /><div className="grid gap-4 xl:grid-cols-3"><CardSkeleton className="xl:col-span-2" rows={6} /><CardSkeleton rows={6} /></div></div>
      ) : (
        <div className="space-y-4">
          <div className="keep-cols grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <KpiCard label="Total registered users" icon={<Users className="h-4 w-4" />} data={data.kpis.total_users} format={fmtInt} />
            <KpiCard label="Daily active users" icon={<Activity className="h-4 w-4" />} data={data.kpis.dau} format={fmtAvg} accent="#06b6d4" hint="avg/day vs prior period" />
            <KpiCard label="New registrations" icon={<UserPlus className="h-4 w-4" />} data={data.kpis.new_registrations} format={fmtInt} accent="#8b5cf6" />
            <KpiCard label="AI requests" icon={<BrainCircuit className="h-4 w-4" />} data={data.kpis.ai_requests} format={fmtCompact} accent="#10b981" hint="provider calls vs prior" />
            <KpiCard label="MRR" icon={<CreditCard className="h-4 w-4" />} data={data.kpis.mrr} format={(v) => fmtUsd(v)} accent="#f59e0b" hint="Stripe, current" />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2" title="User engagement" subtitle="Daily, weekly and monthly active users, plus returning users (signed up before that day).">
              <LineSeries data={data.engagement.series} xKey="day" lines={[
                { key: 'dau', label: 'DAU', color: '#3b82f6' }, { key: 'wau', label: 'WAU', color: '#06b6d4' },
                { key: 'mau', label: 'MAU', color: '#8b5cf6' }, { key: 'returning', label: 'Returning', color: '#10b981' },
              ]} />
              <Note>Activity = any authenticated API call, AI usage or sign-in that day (user_activity_days, ai_usage_events, user_login_events).</Note>
            </Card>
            <AiCard ai={data.ai} />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <HealthCard health={data.health} />
            <SubscriptionCard s={data.subscriptions} />
            <ActivityFeed items={data.activity} />
          </div>

          <RecentUsers rows={data.recent_users || []} />
        </div>
      )}
    </div>
  )
}

function AiCard({ ai }: { ai: any }) {
  const donut = (ai.by_model || []).map((m: any) => ({ name: `${m.model} · ${m.provider}`, value: m.calls }))
  return (
    <Card title="AI observability" subtitle="Requests by model and provider in this range" right={<Link href="/admin/ai" className="text-xs font-semibold text-blue-600 dark:text-cyan-400">Details</Link>}>
      <Donut data={donut} center={<><div className="text-lg font-bold tabular-nums">{fmtCompact(ai.totals?.calls)}</div><div className="text-[10px] text-slate-400">calls</div></>} />
      <dl className="keep-cols mt-4 grid grid-cols-3 gap-2 text-center">
        <Stat label="Est. cost" value={fmtUsd(ai.totals?.cost_usd)} />
        <Stat label="Copilot p95" value={ai.p95_ms == null ? null : fmtMs(ai.p95_ms)} reason="No Copilot requests recorded in this range" />
        <Stat label="Success rate" value={ai.success_rate == null ? null : fmtPct(ai.success_rate)} reason="No Copilot requests recorded in this range" />
      </dl>
      {ai.budgets && ai.budgets.daily_budget_usd != null && (
        <div className="mt-4 space-y-1.5">
          <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>Global AI budget today</span><span className="tabular-nums">{fmtUsd(ai.budgets.today_spent_usd)} / {fmtUsd(ai.budgets.daily_budget_usd)}</span>
          </div>
          <Bar value={ai.budgets.today_spent_usd || 0} max={ai.budgets.daily_budget_usd || 0} color={ai.budgets.paused ? '#ef4444' : '#10b981'} />
        </div>
      )}
    </Card>
  )
}

function HealthCard({ health }: { health: any }) {
  const a = health.availability || {}
  return (
    <Card title="System health" subtitle={a.collecting_since ? `30-day availability (collecting since ${fmtDate(a.collecting_since)})` : 'Status history: collecting (no snapshots yet)'}
      right={<StatusPill status={health.overall} />}>
      <AvailabilityBars days={a.days || []} />
      <p className="mt-1 text-right text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
        Overall <Val v={a.overall == null ? null : fmtPct(a.overall, 2)} reason="No status snapshots stored yet" />
      </p>
      <ul className="mt-3 max-h-64 space-y-1.5 overflow-y-auto pr-1">
        {(health.services || []).map((s: any) => (
          <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-slate-700 dark:text-slate-200" title={s.detail || ''}>{s.name}</span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="tabular-nums text-slate-400">{s.latency_ms == null ? '—' : fmtMs(s.latency_ms)}</span>
              <StatusPill status={s.status} />
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function SubscriptionCard({ s }: { s: any }) {
  if (!s?.available) return <Card title="Subscription intelligence"><p className="text-xs text-slate-500"><Val v={null} reason={s?.reason} /> {s?.reason}</p></Card>
  const total = s.total_users || 0
  return (
    <Card title="Subscription intelligence" subtitle="Stripe subscriptions mirrored in the database (read-only)" right={<Link href="/admin/revenue" className="text-xs font-semibold text-blue-600 dark:text-cyan-400">Details</Link>}>
      <div className="text-3xl font-bold tabular-nums"><Val v={s.mrr_usd == null ? null : fmtUsd(s.mrr_usd)} reason={s.mrr_reason} /></div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">MRR{s.mrr_reason ? ` · ${s.mrr_reason}` : ''}</p>
      <div className="mt-4 space-y-3 text-xs">
        <div><div className="mb-1 flex justify-between"><span>Paid</span><span className="tabular-nums">{fmtInt(s.paid_subscribers)}</span></div><Bar value={s.paid_subscribers || 0} max={total} color="#10b981" /></div>
        <div><div className="mb-1 flex justify-between"><span>Free</span><span className="tabular-nums">{fmtInt(s.free_users)}</span></div><Bar value={s.free_users || 0} max={total} color="#64748b" /></div>
      </div>
      <dl className="keep-cols mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
        <Stat label="Paid share" value={s.paid_share == null ? null : fmtPct(s.paid_share)} reason="no users" />
        <Stat label="Churn (range)" value={s.churn_rate == null ? null : fmtPct(s.churn_rate)} reason="no paid or churned subscriptions" />
        <Stat label="ARPU" value={s.arpu_usd == null ? null : fmtUsd(s.arpu_usd, 2)} reason={s.mrr_reason || 'MRR unavailable'} />
        <Stat label="Paid subs" value={fmtInt(s.paid_subscribers)} />
      </dl>
    </Card>
  )
}

function RecentUsers({ rows }: { rows: any[] }) {
  const [revealed, setRevealed] = useState<Record<string, string> | null>(null)
  const [busy, setBusy] = useState(false)
  const toggle = async () => {
    if (revealed) { setRevealed(null); return }
    setBusy(true)
    try {
      const r = await adminPost<{ emails: Record<string, string> }>('/users/reveal-emails', { user_ids: rows.map((u) => u.id), reason: 'Command Center: recent user activity' })
      setRevealed(r.emails)
    } finally { setBusy(false) }
  }
  return (
    <Card title="Recent user activity" subtitle="Most recently active accounts in this range"
      right={rows.length > 0 && (
        <button onClick={toggle} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
          {revealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />} {revealed ? 'Mask emails' : 'Reveal emails (audited)'}
        </button>
      )}>
      {rows.length === 0 ? <p className="py-6 text-center text-xs text-slate-400">No user activity recorded in this range</p> : (
        <TableWrap>
          <thead><tr>{['User', 'Email', 'Plan', 'Status', 'AI requests', 'Tokens', 'Est. AI cost', 'Last activity', ''].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
            {rows.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                <td className={td}><span className="font-semibold">{u.username}</span> <span className="text-slate-400">#{u.id}</span></td>
                <td className={td}>{revealed?.[String(u.id)] ?? u.email_masked}</td>
                <td className={td}>{u.plan}</td>
                <td className={td}><StatusPill status={u.status} /></td>
                <td className={td}>{fmtInt(u.ai_requests)}</td>
                <td className={td}>{fmtCompact(u.ai_tokens)}</td>
                <td className={td}>{fmtUsd(u.ai_cost_usd, 4)}</td>
                <td className={td}>{fmtAgo(u.last_activity)}</td>
                <td className={td}><Link href={`/admin/users?user=${u.id}`} className="font-semibold text-blue-600 dark:text-cyan-400">Open →</Link></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Card>
  )
}
