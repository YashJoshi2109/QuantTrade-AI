'use client'

import { useState } from 'react'
import { KeyRound, LogOut, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Card, CardSkeleton, ErrorBox, KpiCard, KpiSkeletonRow, PageHeader, StatusPill, TableWrap, td, th, useAdminQuery, useAdminRange } from '@/components/admin/AdminUI'
import { fmtAgo, fmtDate, fmtInt } from '@/lib/admin'

export default function SecurityPage() {
  const { range } = useAdminRange()
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const sec = useAdminQuery<any>(`/security?range=${range}`)
  const audit = useAdminQuery<any>(`/audit?page=${page}&page_size=50${action ? `&action=${encodeURIComponent(action)}` : ''}`)
  const s = sec.data
  const k = (value: any) => ({ value })
  const pages = audit.data ? Math.max(1, Math.ceil(audit.data.total / audit.data.page_size)) : 1
  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader title="Security & Audit" page="security" exportData={s && audit.data ? { ...s, audit: audit.data.rows } : null}
        subtitle="Append-only admin audit log, sign-in history, suspensions and session revocations." />
      {sec.error && <ErrorBox error={sec.error} onRetry={() => sec.refetch()} />}
      {!s ? <KpiSkeletonRow n={4} /> : (
        <div className="keep-cols grid grid-cols-2 gap-3 xl:grid-cols-4">
          <KpiCard label="Admin actions" icon={<ShieldCheck className="h-4 w-4" />} data={k(s.admin_actions)} format={fmtInt} hint="audit entries in range" />
          <KpiCard label="Blocked sign-ins" icon={<ShieldAlert className="h-4 w-4" />} data={k(s.blocked_sign_ins)} format={fmtInt} accent="#ef4444" hint="suspended accounts" />
          <KpiCard label="Suspended accounts" icon={<KeyRound className="h-4 w-4" />} data={k(s.suspended.length)} format={fmtInt} accent="#f59e0b" hint="now" />
          <KpiCard label="Sessions revoked" icon={<LogOut className="h-4 w-4" />} data={k(s.sessions_revoked)} format={fmtInt} accent="#8b5cf6" hint="accounts, in range" />
        </div>
      )}
      <Card className="mt-4" title="Admin audit log" subtitle={audit.data ? `${fmtInt(audit.data.total)} entries · append-only` : 'Loading…'}
        right={audit.data && (
          <select value={action} onChange={(e) => { setAction(e.target.value); setPage(1) }} aria-label="Action filter" className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-[#0a1120]">
            <option value="">All actions</option>{audit.data.actions.map((a: string) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}>
        {!audit.data ? <CardSkeleton rows={6} className="border-0 p-0" /> : (
          <>
            <TableWrap><thead><tr>{['Time', 'Actor', 'Action', 'Target', 'Reason', 'IP', 'Details'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {audit.data.rows.length === 0 && <tr><td className={td} colSpan={7}>No audit entries</td></tr>}
                {audit.data.rows.map((r: any) => (
                  <tr key={r.id}><td className={td} title={r.ts}>{fmtDate(r.ts)}</td><td className={td}>{r.actor || `#${r.actor_user_id}`}</td>
                    <td className={td}><StatusPill tone={r.action.startsWith('user.suspend') ? 'down' : r.action.startsWith('user.') ? 'degraded' : 'info'} label={r.action} /></td>
                    <td className={td}>{r.target_type} {r.target_id}</td><td className={`${td} max-w-xs truncate`} title={r.reason || ''}>{r.reason || '—'}</td>
                    <td className={td}>{r.ip || '—'}</td><td className={`${td} max-w-xs truncate font-mono text-[10px]`} title={r.details ? JSON.stringify(r.details) : ''}>{r.details ? JSON.stringify(r.details) : '—'}</td></tr>
                ))}
              </tbody></TableWrap>
            <div className="mt-3 flex justify-end gap-2 text-xs">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-slate-200 px-2.5 py-1 disabled:opacity-40 dark:border-slate-700">Previous</button>
              <span className="self-center tabular-nums text-slate-500">{page} / {pages}</span>
              <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-lg border border-slate-200 px-2.5 py-1 disabled:opacity-40 dark:border-slate-700">Next</button>
            </div>
          </>
        )}
      </Card>
      {s && (
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2" title="Recent sign-ins" subtitle={`Methods: ${Object.entries(s.sign_ins_by_method).map(([m, n]) => `${m} ${n}`).join(' · ') || '—'}`}>
            <TableWrap><thead><tr>{['When', 'User', 'Method', 'Result', 'IP', 'Device'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {s.logins.length === 0 && <tr><td className={td} colSpan={6}>No sign-ins recorded in this range (history starts with this release)</td></tr>}
                {s.logins.map((l: any, i: number) => (
                  <tr key={i}><td className={td}>{fmtAgo(l.ts)}</td><td className={td}><a className="font-semibold text-blue-600 dark:text-cyan-400" href={`/admin/users?user=${l.user_id}`}>{l.username}</a></td>
                    <td className={td}>{l.method}</td><td className={td}><StatusPill status={l.success ? 'ok' : 'down'} label={l.success ? 'success' : l.note || 'blocked'} /></td>
                    <td className={td}>{l.ip || '—'}</td><td className={`${td} max-w-[220px] truncate`} title={l.user_agent || ''}>{l.user_agent || '—'}</td></tr>
                ))}
              </tbody></TableWrap>
          </Card>
          <Card title="Suspended accounts">
            {s.suspended.length === 0 ? <p className="text-xs text-slate-400">No suspended accounts</p> : (
              <ul className="space-y-2 text-xs">{s.suspended.map((x: any) => (
                <li key={x.user_id}><a className="font-semibold text-blue-600 dark:text-cyan-400" href={`/admin/users?user=${x.user_id}`}>{x.username}</a> <span className="text-slate-400">· {fmtDate(x.suspended_at)}</span><p className="text-slate-500">{x.reason}</p></li>
              ))}</ul>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
