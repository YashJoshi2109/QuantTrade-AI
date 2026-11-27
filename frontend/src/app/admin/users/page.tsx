'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Activity, CalendarDays, Gauge, Repeat, Search, UserPlus, Users } from 'lucide-react'
import {
  Card, CardSkeleton, ErrorBox, KpiCard, KpiSkeletonRow, PageHeader, StatusPill, TableWrap, td, th, useAdminQuery, useAdminRange,
} from '@/components/admin/AdminUI'
import UserDrawer from '@/components/admin/UserDrawer'
import { fmtAgo, fmtAvg, fmtCompact, fmtDate, fmtInt, fmtPct, fmtUsd } from '@/lib/admin'
import { cn } from '@/lib/utils'

const SORTS = [
  { key: 'created_at', label: 'Joined' }, { key: 'last_login', label: 'Last sign-in' },
  { key: 'username', label: 'Username' }, { key: 'id', label: 'ID' },
]

function UsersInner() {
  const { range } = useAdminRange()
  const params = useSearchParams()
  const router = useRouter()
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  const [plan, setPlan] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState('created_at')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const open = params.get('user')
  useEffect(() => { const t = setTimeout(() => { setDq(q.trim()); setPage(1) }, 250); return () => clearTimeout(t) }, [q])

  const kpis = useAdminQuery<any>(`/users/kpis?range=${range}`)
  const qs = new URLSearchParams({ range, sort, order, page: String(page), page_size: '25' })
  if (dq) qs.set('q', dq)
  if (plan) qs.set('plan', plan)
  if (status) qs.set('status', status)
  const list = useAdminQuery<any>(`/users?${qs.toString()}`)
  const k = kpis.data?.kpis
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.page_size)) : 1
  const setOpen = (id: number | null) => router.replace(id ? `/admin/users?user=${id}` : '/admin/users', { scroll: false })

  const toggleSort = (key: string) => {
    if (sort === key) setOrder(order === 'asc' ? 'desc' : 'asc')
    else { setSort(key); setOrder('desc') }
  }

  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader title="User Intelligence" page="users" exportData={kpis.data && list.data ? { kpis: kpis.data.kpis, users: list.data.rows } : null}
        subtitle="Engagement, retention and the user directory. Emails are masked; transcripts, passwords, tokens and payment credentials are never shown here." />
      {kpis.error && <ErrorBox error={kpis.error} onRetry={() => kpis.refetch()} />}
      {!k ? <KpiSkeletonRow n={6} /> : (
        <div className="keep-cols grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <KpiCard label="DAU (avg/day)" icon={<Activity className="h-4 w-4" />} data={k.dau} format={fmtAvg} />
          <KpiCard label="7-day active" icon={<CalendarDays className="h-4 w-4" />} data={k.active_7d} format={fmtInt} accent="#06b6d4" hint="vs previous 7 days" />
          <KpiCard label="30-day active" icon={<Users className="h-4 w-4" />} data={k.active_30d} format={fmtInt} accent="#8b5cf6" hint="vs previous 30 days" />
          <KpiCard label="New registrations" icon={<UserPlus className="h-4 w-4" />} data={k.new_registrations} format={fmtInt} accent="#10b981" />
          <KpiCard label="Day-7 retention" icon={<Repeat className="h-4 w-4" />} data={k.day7_retention} format={(v) => fmtPct(v)} accent="#f59e0b" hint={k.day7_retention?.note || ''} />
          <KpiCard label="DAU / MAU" icon={<Gauge className="h-4 w-4" />} data={k.dau_mau} format={(v) => fmtPct(v)} accent="#ec4899" hint="today / 30-day active" />
        </div>
      )}

      <Card className="mt-4" title="User directory" subtitle={list.data ? `${fmtInt(list.data.total)} accounts` : 'Loading…'}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email or ID" aria-label="Search users"
                className="w-44 rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-xs outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-[#0a1120]" />
            </label>
            <select value={plan} onChange={(e) => { setPlan(e.target.value); setPage(1) }} aria-label="Plan filter"
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-[#0a1120]">
              <option value="">All plans</option><option value="free">Free</option><option value="pro">Pro</option><option value="admin">Admin</option>
            </select>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} aria-label="Status filter"
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-[#0a1120]">
              <option value="">All statuses</option><option value="active">Active</option><option value="unverified">Unverified</option><option value="suspended">Suspended</option>
            </select>
          </div>
        }>
        {list.error && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}
        {!list.data ? <CardSkeleton rows={8} className="border-0 p-0 shadow-none" /> : list.data.rows.length === 0 ? (
          <p className="py-10 text-center text-xs text-slate-400">No users match these filters</p>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <TableWrap>
                <thead><tr>
                  <th className={th}><SortBtn k="username" label="User" sort={sort} order={order} onClick={toggleSort} /></th>
                  <th className={th}>Email</th><th className={th}>Plan</th><th className={th}>Status</th>
                  <th className={th}>AI requests</th><th className={th}>Tokens</th><th className={th}>Est. AI cost</th>
                  <th className={th}><SortBtn k="created_at" label="Joined" sort={sort} order={order} onClick={toggleSort} /></th>
                  <th className={th}><SortBtn k="last_login" label="Last sign-in" sort={sort} order={order} onClick={toggleSort} /></th>
                  <th className={th}>Last activity</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {list.data.rows.map((u: any) => (
                    <tr key={u.id} onClick={() => setOpen(u.id)} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/50">
                      <td className={td}><span className="font-semibold">{u.username}</span> <span className="text-slate-400">#{u.id}</span></td>
                      <td className={td}>{u.email_masked}</td>
                      <td className={td}>{u.plan}</td>
                      <td className={td}><StatusPill status={u.status} /></td>
                      <td className={td}>{fmtInt(u.ai_requests)}</td>
                      <td className={td}>{fmtCompact(u.ai_tokens)}</td>
                      <td className={td}>{fmtUsd(u.ai_cost_usd, 4)}</td>
                      <td className={td}>{fmtDate(u.created_at)}</td>
                      <td className={td}>{fmtAgo(u.last_login)}</td>
                      <td className={td}>{fmtAgo(u.last_activity)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
            {/* Mobile cards */}
            <ul className="space-y-2 md:hidden">
              <li className="flex items-center gap-2 text-[11px] text-slate-500">
                Sort:
                <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded border border-slate-200 bg-transparent px-1 py-0.5 dark:border-slate-700">
                  {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <button onClick={() => setOrder(order === 'asc' ? 'desc' : 'asc')} className="rounded border border-slate-200 px-1.5 dark:border-slate-700">{order}</button>
              </li>
              {list.data.rows.map((u: any) => (
                <li key={u.id}>
                  <button onClick={() => setOpen(u.id)} className="w-full rounded-xl border border-slate-200 p-3 text-left dark:border-slate-800">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{u.username} <span className="text-xs font-normal text-slate-400">#{u.id}</span></span>
                      <StatusPill status={u.status} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-500">{u.email_masked} · {u.plan}</p>
                    <p className="mt-1 text-[11px] tabular-nums text-slate-500">{fmtInt(u.ai_requests)} AI req · {fmtUsd(u.ai_cost_usd, 4)} · active {fmtAgo(u.last_activity)}</p>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
              <span className="tabular-nums">Page {page} of {pages}</span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-slate-200 px-2.5 py-1 disabled:opacity-40 dark:border-slate-700">Previous</button>
                <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-lg border border-slate-200 px-2.5 py-1 disabled:opacity-40 dark:border-slate-700">Next</button>
              </div>
            </div>
          </>
        )}
      </Card>
      {open && <UserDrawer userId={Number(open)} onClose={() => setOpen(null)} />}
    </div>
  )
}

function SortBtn({ k, label, sort, order, onClick }: { k: string; label: string; sort: string; order: string; onClick: (k: string) => void }) {
  return (
    <button onClick={() => onClick(k)} className={cn('uppercase', sort === k && 'text-blue-600 dark:text-cyan-400')} aria-label={`Sort by ${label}`}>
      {label}{sort === k ? (order === 'asc' ? ' ↑' : ' ↓') : ''}
    </button>
  )
}

export default function UsersPage() {
  return <Suspense fallback={<KpiSkeletonRow n={6} />}><UsersInner /></Suspense>
}
