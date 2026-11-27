'use client'

/**
 * Right slide-over for one user: account & entitlement, AI consumption,
 * watchlists, holdings, alerts, backtests, sessions, and the four audited
 * actions. Conversation transcripts are only fetched through the explicit,
 * audited "View conversation" action.
 */
import { ReactNode, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Eye, KeyRound, LogOut, ShieldAlert, ShieldCheck, Sparkles, X } from 'lucide-react'
import { ConfirmDialog, LineSeries, Note, Skeleton, StatusPill, useAdminQuery, useAdminRange, Val } from './AdminUI'
import { adminPost, fmtAgo, fmtCompact, fmtDate, fmtInt, fmtUsd } from '@/lib/admin'
import { cn } from '@/lib/utils'

type Action = 'revoke' | 'suspend' | 'unsuspend' | 'quota' | 'plan' | null

export default function UserDrawer({ userId, onClose }: { userId: number; onClose: () => void }) {
  const { range } = useAdminRange()
  const qc = useQueryClient()
  const { data, error, isLoading } = useAdminQuery<any>(`/users/${userId}?range=${range}`)
  const [action, setAction] = useState<Action>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [conv, setConv] = useState<{ id: string; title: string | null } | null>(null)
  const [transcript, setTranscript] = useState<any>(null)
  const [plan, setPlan] = useState<'free' | 'pro' | 'default'>('default')
  const [quota, setQuota] = useState({ req: '', tok: '', reset: true, clear: false })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !action && !conv) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [action, conv, onClose])
  useEffect(() => { setEmail(null); setTranscript(null) }, [userId])

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin'] })
  const u = data?.user
  const c = data?.controls
  const isAdminTarget = u?.tier === 'admin'

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="User details">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-[#0a1220]">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          {u ? (
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">User #{u.id}</p>
              <h2 className="truncate text-lg font-bold">{u.full_name || u.username}</h2>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>@{u.username}</span>·
                <span>{email ?? u.email_masked}</span>
                {!email && (
                  <button className="font-semibold text-blue-600 dark:text-cyan-400" onClick={async () => {
                    const r = await adminPost<{ emails: Record<string, string> }>('/users/reveal-emails', { user_ids: [u.id], reason: 'User drawer' })
                    setEmail(r.emails[String(u.id)] || null)
                  }}>Reveal (audited)</button>
                )}
              </p>
            </div>
          ) : <Skeleton className="h-10 w-48" />}
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {error && <p className="text-sm text-rose-500">{(error as Error).message}</p>}
          {isLoading || !data ? <div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div> : (
            <>
              <Section title="Account & entitlement">
                <Grid>
                  <KV k="Plan" v={u.plan} />
                  <KV k="Account status" v={<StatusPill status={u.status} />} />
                  <KV k="Subscription" v={data.subscription ? `${data.subscription.plan_label} · ${data.subscription.status}` : null} reason="No Stripe subscription" />
                  <KV k="Renews / ends" v={data.subscription?.current_period_end ? fmtDate(data.subscription.current_period_end) : null} reason="No billing period" />
                  <KV k="Joined" v={fmtDate(u.created_at)} />
                  <KV k="Last sign-in" v={u.last_login ? fmtDate(u.last_login) : null} reason="Never signed in" />
                  <KV k="Last activity" v={u.last_activity ? fmtAgo(u.last_activity) : null} reason="No activity recorded" />
                  <KV k="Email verified" v={u.is_verified ? (u.email_verified_at ? fmtDate(u.email_verified_at) : 'Yes') : 'No'} />
                  <KV k="Sign-in methods" v={[...u.auth_methods, ...(data.passkeys?.length ? [`passkey ×${data.passkeys.length}`] : [])].join(', ') || null} />
                  <KV k="Access scope" v={`${data.access_scope.label}${data.access_scope.unlimited_ai ? ' · unlimited AI (global budget applies)' : ''}${data.access_scope.beta_features ? ' · beta features' : ''}`} />
                </Grid>
                {c?.suspended_at && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/50 dark:text-rose-200">Suspended {fmtDate(c.suspended_at)}: {c.suspended_reason}</p>}
                {(c?.plan_override || c?.ai_quota_override) && (
                  <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-300">
                    Admin overrides: {c.plan_override ? `plan=${c.plan_override} ` : ''}{c.ai_quota_override ? `quota=${JSON.stringify(c.ai_quota_override)}` : ''}
                  </p>
                )}
              </Section>

              <Section title="AI consumption">
                <Grid>
                  <KV k={`Requests (${range})`} v={fmtInt(data.ai.range.requests)} />
                  <KV k={`Tokens (${range})`} v={fmtCompact(data.ai.range.tokens)} />
                  <KV k={`Est. cost (${range})`} v={fmtUsd(data.ai.range.cost_usd, 4)} />
                  <KV k="Today: requests" v={data.ai.today?.requests_used == null ? null : `${fmtInt(data.ai.today.requests_used)} / ${data.ai.today.requests_limit < 0 ? '∞' : fmtInt(data.ai.today.requests_limit)}`} reason={data.ai.today?.reason} />
                  <KV k="Today: tokens" v={data.ai.today?.tokens_used == null ? null : `${fmtCompact(data.ai.today.tokens_used)} / ${data.ai.today.tokens_limit < 0 ? '∞' : fmtCompact(data.ai.today.tokens_limit)}`} reason={data.ai.today?.reason} />
                  <KV k="Today: cost" v={data.ai.today?.cost_usd == null ? null : fmtUsd(data.ai.today.cost_usd, 4)} reason={data.ai.today?.reason} />
                </Grid>
                <div className="mt-3"><LineSeries data={data.ai.history_30d} xKey="day" height={150} area lines={[{ key: 'requests', label: 'Requests / day (30d)', color: '#3b82f6' }]} /></div>
              </Section>

              <Section title={`Watchlist (${data.watchlist.length})`}>
                {data.watchlist.length ? <Chips items={data.watchlist.map((w: any) => w.symbol)} /> : <Empty>No watchlist symbols</Empty>}
                {data.marketwatch.map((l: any) => (
                  <div key={l.id} className="mt-2"><p className="mb-1 text-[11px] font-semibold text-slate-500">{l.name}{l.is_default ? ' (default)' : ''}</p>
                    {l.symbols.length ? <Chips items={l.symbols} /> : <Empty>Empty list</Empty>}</div>
                ))}
              </Section>

              <Section title={`Portfolios (${data.portfolios.length})`}>
                {data.portfolios.length === 0 ? <Empty>No portfolios</Empty> : data.portfolios.map((p: any) => (
                  <div key={p.id} className="mb-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                    <p className="text-xs font-semibold">{p.name} <span className="font-normal text-slate-400">{p.paper ? 'paper' : 'real'} · cash {fmtUsd(p.cash)}</span></p>
                    {p.holdings.length === 0 ? <Empty>No holdings</Empty> : (
                      <table className="mt-1 w-full text-[11px] tabular-nums"><tbody>
                        {p.holdings.map((h: any) => (
                          <tr key={h.symbol} className="text-slate-600 dark:text-slate-300"><td className="py-0.5 font-semibold">{h.symbol}</td><td>{h.quantity}</td><td>avg {fmtUsd(h.avg_cost)}</td><td className="text-right">{fmtUsd(h.market_value)}</td></tr>
                        ))}
                      </tbody></table>
                    )}
                  </div>
                ))}
              </Section>

              <Section title={`Price alerts (${data.alerts.length})`}>
                {data.alerts.length === 0 ? <Empty>No alerts</Empty> : (
                  <ul className="space-y-1 text-xs">{data.alerts.slice(0, 20).map((a: any) => (
                    <li key={a.id} className="flex justify-between gap-2"><span><b>{a.symbol}</b> {a.condition.replace(/_/g, ' ')} {a.threshold}</span><StatusPill status={a.status === 'triggered' ? 'degraded' : a.status === 'active' ? 'ok' : 'pending'} label={a.status} /></li>
                  ))}</ul>
                )}
              </Section>

              <Section title={`Backtests (${data.backtests.length})`}>
                {data.backtests.length === 0 ? <Empty>No backtest jobs held on this API process (jobs expire after a few hours)</Empty> : (
                  <ul className="space-y-1 text-xs">{data.backtests.map((b: any) => (
                    <li key={b.id} className="flex justify-between"><span>{b.kind} · {fmtAgo(new Date(b.created * 1000).toISOString())}</span><StatusPill status={b.status === 'done' ? 'ok' : b.status === 'error' || b.status === 'failed' ? 'down' : 'pending'} label={b.status} /></li>
                  ))}</ul>
                )}
              </Section>

              <Section title={`Copilot conversations (${data.conversations.count ?? '—'})`}>
                <Note>Titles only. Opening a transcript requires a reason and is written to the audit log.</Note>
                <ul className="mt-2 space-y-1">{data.conversations.items.slice(0, 30).map((cv: any) => (
                  <li key={cv.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate">{cv.title || 'Untitled'} <span className="text-slate-400">· {cv.messages} msgs · {fmtAgo(cv.updated_at)}</span></span>
                    <button onClick={() => setConv({ id: cv.id, title: cv.title })} className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-cyan-400"><Eye className="h-3 w-3" />View</button>
                  </li>
                ))}</ul>
                {transcript && (
                  <div className="mt-3 max-h-80 space-y-2 overflow-y-auto rounded-xl border border-amber-300 bg-amber-50/50 p-3 dark:border-amber-800 dark:bg-amber-950/20">
                    <div className="flex justify-between text-[11px] font-semibold text-amber-700 dark:text-amber-300"><span>Transcript: {transcript.title || 'Untitled'} (access logged)</span><button onClick={() => setTranscript(null)}>Close</button></div>
                    {transcript.messages.map((m: any, i: number) => (
                      <div key={i} className="text-xs"><span className="font-semibold capitalize">{m.role}:</span> <span className="whitespace-pre-wrap">{m.content}</span></div>
                    ))}
                  </div>
                )}
              </Section>

              <Section title="Sessions & sign-ins">
                <Note>{data.sessions.note}</Note>
                <p className="mt-2 text-xs">Likely active sessions: <b className="tabular-nums">{data.sessions.active_estimate.length}</b>{c?.sessions_revoked_at ? ` · last revoked ${fmtDate(c.sessions_revoked_at)}` : ''}</p>
                {data.logins.length === 0 ? <Empty>No sign-ins recorded yet (history starts with this release)</Empty> : (
                  <ul className="mt-2 space-y-1 text-[11px]">{data.logins.slice(0, 15).map((l: any, i: number) => (
                    <li key={i} className="flex justify-between gap-2"><span className="truncate">{l.method} · {l.ip || '—'} · <span className="text-slate-400" title={l.user_agent || ''}>{(l.user_agent || '').slice(0, 40)}</span></span>
                      <span className="shrink-0">{l.success ? fmtAgo(l.ts) : <span className="text-rose-500">blocked ({l.note})</span>}</span></li>
                  ))}</ul>
                )}
              </Section>

              <Section title="Privacy boundaries">
                <Note>Prompts and transcripts, passwords and hashes, session tokens, passkey keys, and payment credentials are not shown. Transcripts open only through the audited action above; every action and sensitive read is written to the admin audit log.</Note>
              </Section>
            </>
          )}
        </div>

        {u && (
          <div className="keep-cols grid grid-cols-2 gap-2 border-t border-slate-200 p-4 sm:grid-cols-4 dark:border-slate-800">
            <ActBtn icon={<LogOut className="h-3.5 w-3.5" />} onClick={() => setAction('revoke')}>Revoke sessions</ActBtn>
            {c?.suspended_at
              ? <ActBtn icon={<ShieldCheck className="h-3.5 w-3.5" />} onClick={() => setAction('unsuspend')}>Unsuspend</ActBtn>
              : <ActBtn danger disabled={isAdminTarget} icon={<ShieldAlert className="h-3.5 w-3.5" />} onClick={() => setAction('suspend')}>Suspend</ActBtn>}
            <ActBtn icon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => setAction('quota')}>AI quota</ActBtn>
            <ActBtn disabled={isAdminTarget} icon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => setAction('plan')}>Change plan</ActBtn>
          </div>
        )}
      </aside>

      <ConfirmDialog open={action === 'revoke'} title="Revoke all sessions" confirmLabel="Sign out everywhere" onClose={() => setAction(null)}
        description="Every token issued to this user stops working immediately. They can sign in again."
        onConfirm={async (reason) => { await adminPost(`/users/${userId}/revoke-sessions`, { reason }); refresh() }} />
      <ConfirmDialog open={action === 'suspend'} danger title="Suspend account" confirmLabel="Suspend" onClose={() => setAction(null)}
        description="Blocks sign-in and every API call, and revokes all sessions. User data is kept."
        onConfirm={async (reason) => { await adminPost(`/users/${userId}/suspend`, { reason }); refresh() }} />
      <ConfirmDialog open={action === 'unsuspend'} title="Unsuspend account" confirmLabel="Unsuspend" onClose={() => setAction(null)}
        description="The user can sign in again."
        onConfirm={async (reason) => { await adminPost(`/users/${userId}/unsuspend`, { reason }); refresh() }} />
      <ConfirmDialog open={action === 'plan'} title="Change plan tier" confirmLabel="Apply" onClose={() => setAction(null)}
        description="Overrides the Stripe-derived tier for AI quotas and premium features. Billing in Stripe is not changed."
        onConfirm={async (reason) => { await adminPost(`/users/${userId}/plan`, { reason, plan }); refresh() }}>
        <select value={plan} onChange={(e) => setPlan(e.target.value as any)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-[#0a1120]" aria-label="Plan">
          <option value="default">Follow Stripe (remove override)</option><option value="pro">Pro</option><option value="free">Free</option>
        </select>
      </ConfirmDialog>
      <ConfirmDialog open={action === 'quota'} title="Adjust AI quota" confirmLabel="Apply" onClose={() => setAction(null)}
        extraValid={quota.reset || quota.clear || !!quota.req || !!quota.tok}
        description="Override this user's daily AI limits (-1 = unlimited; the global budget always applies) and/or reset today's usage."
        onConfirm={async (reason) => {
          const body: any = { reason, reset_today: quota.reset, clear_override: quota.clear }
          if (quota.req && !quota.clear) body.req_per_day = Number(quota.req)
          if (quota.tok && !quota.clear) body.tokens_per_day = Number(quota.tok)
          await adminPost(`/users/${userId}/ai-quota`, body); refresh()
        }}>
        <div className="keep-cols grid grid-cols-2 gap-2">
          <input inputMode="numeric" placeholder="Requests / day" value={quota.req} onChange={(e) => setQuota({ ...quota, req: e.target.value.replace(/[^0-9-]/g, '') })} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-[#0a1120]" aria-label="Requests per day" />
          <input inputMode="numeric" placeholder="Tokens / day" value={quota.tok} onChange={(e) => setQuota({ ...quota, tok: e.target.value.replace(/[^0-9-]/g, '') })} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-[#0a1120]" aria-label="Tokens per day" />
        </div>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={quota.reset} onChange={(e) => setQuota({ ...quota, reset: e.target.checked })} /> Reset today&apos;s usage counters</label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={quota.clear} onChange={(e) => setQuota({ ...quota, clear: e.target.checked })} /> Remove existing override (back to tier defaults)</label>
      </ConfirmDialog>
      <ConfirmDialog open={!!conv} title="View conversation transcript" confirmLabel="View transcript" onClose={() => setConv(null)}
        description={<>You are about to read <b>{conv?.title || 'an untitled conversation'}</b>. This access is written to the audit log with your reason.</>}
        onConfirm={async (reason) => { setTranscript(await adminPost(`/users/${userId}/conversations/${conv!.id}/view`, { reason })) }} />
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section><h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{title}</h3>{children}</section>
}
function Grid({ children }: { children: ReactNode }) {
  return <dl className="keep-cols grid grid-cols-2 gap-x-4 gap-y-2">{children}</dl>
}
function KV({ k, v, reason }: { k: string; v: ReactNode; reason?: string }) {
  return <div className="min-w-0"><dt className="text-[10px] text-slate-400">{k}</dt><dd className="truncate text-xs font-medium tabular-nums"><Val v={v} reason={reason} /></dd></div>
}
function Chips({ items }: { items: string[] }) {
  return <div className="flex flex-wrap gap-1">{items.map((s) => <span key={s} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold dark:bg-slate-800">{s}</span>)}</div>
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="text-xs text-slate-400">{children}</p>
}
function ActBtn({ children, icon, onClick, danger, disabled }: { children: ReactNode; icon: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button disabled={disabled} onClick={onClick} title={disabled ? 'Not available for admin accounts' : undefined}
      className={cn('flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-[11px] font-semibold disabled:opacity-40',
        danger ? 'border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/40'
          : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800')}>
      {icon}{children}
    </button>
  )
}
