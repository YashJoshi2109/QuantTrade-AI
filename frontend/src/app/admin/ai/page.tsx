'use client'

import { BrainCircuit, CheckCircle2, Coins, Database, Timer, Zap } from 'lucide-react'
import {
  Bar, Card, CardSkeleton, Donut, ErrorBox, KpiCard, KpiSkeletonRow, LineSeries, Note, PageHeader, StatusPill, TableWrap, td, th,
  useAdminQuery, useAdminRange, Val,
} from '@/components/admin/AdminUI'
import { fmtCompact, fmtDate, fmtInt, fmtMs, fmtPct, fmtUsd } from '@/lib/admin'

const NOT_INSTR = 'Not instrumented yet: Copilot request metrics start with this release'

export default function AiPage() {
  const { range } = useAdminRange()
  const { data, error, refetch } = useAdminQuery<any>(`/ai?range=${range}`)
  const u = data?.usage
  const c = data?.copilot
  const t = u?.totals || {}
  const p = u?.prior || {}
  const cReason = c && !c.requests ? (c.instrumented ? 'No Copilot requests in this range' : NOT_INSTR) : undefined
  const kp = (value: any, prior?: any, series?: number[], reason?: string) => ({
    value, prior, series, reason,
    delta_pct: typeof value === 'number' && typeof prior === 'number' && prior ? ((value - prior) / prior) * 100 : null,
  })

  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader title="AI Observability" page="ai" exportData={data}
        subtitle="Every paid model call recorded by the AI guard, plus Copilot runtime quality from request traces (no prompt or answer text is stored)." />
      {error && <ErrorBox error={error} onRetry={() => refetch()} />}
      {!data ? <KpiSkeletonRow n={6} /> : (
        <div className="keep-cols grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <KpiCard label="Total requests" icon={<BrainCircuit className="h-4 w-4" />} data={kp(t.calls, p.calls, u.series.map((s: any) => s.calls))} format={fmtCompact} />
          <KpiCard label="Estimated model spend" icon={<Coins className="h-4 w-4" />} data={kp(t.cost_usd, p.cost_usd, u.series.map((s: any) => s.cost_usd))} format={(v) => fmtUsd(v)} accent="#f59e0b" invertDelta />
          <KpiCard label="p95 response latency" icon={<Timer className="h-4 w-4" />} data={kp(c.p95_ms, null, undefined, cReason)} format={fmtMs} accent="#8b5cf6" hint="Copilot, end to end" />
          <KpiCard label="Token consumption" icon={<Zap className="h-4 w-4" />} data={kp(t.calls == null ? null : (t.input_tokens || 0) + (t.output_tokens || 0), p.calls == null ? null : (p.input_tokens || 0) + (p.output_tokens || 0), u.series.map((s: any) => s.tokens))} format={fmtCompact} accent="#06b6d4" />
          <KpiCard label="RAG retrieval p95" icon={<Database className="h-4 w-4" />} data={kp(c.retrieval_p95_ms, null, undefined, cReason || (c.retrieval_p95_ms == null ? 'No retrieval calls in this range' : undefined))} format={fmtMs} accent="#ec4899" hint="filing search tools" />
          <KpiCard label="Request success" icon={<CheckCircle2 className="h-4 w-4" />} data={kp(c.success_rate, null, undefined, cReason)} format={(v) => fmtPct(v)} accent="#10b981" hint={t.calls ? `${fmtPct(t.errors / t.calls)} provider-call errors` : ''} />
        </div>
      )}
      {!data ? <div className="mt-4"><CardSkeleton rows={6} /></div> : (
        <>
          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2" title="Request activity" subtitle="Provider calls and spend per bucket">
              <LineSeries data={u.series} xKey="bucket" area lines={[{ key: 'calls', label: 'Calls', color: '#3b82f6' }]} />
            </Card>
            <Card title="Model routing" subtitle="Share of calls by model · provider">
              <Donut data={u.by_model.map((m: any) => ({ name: `${m.model} · ${m.provider}`, value: m.calls }))}
                center={<><div className="text-lg font-bold tabular-nums">{fmtCompact(t.calls)}</div><div className="text-[10px] text-slate-400">calls</div></>} />
            </Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Card title="AI quality and runtime controls" subtitle={c.collecting_since ? `From copilot_request_metrics, collecting since ${fmtDate(c.collecting_since)}` : NOT_INSTR}>
              <TableWrap>
                <thead><tr><th className={th}>Control</th><th className={th}>Value</th><th className={th}>Definition</th></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  <Row k="Citation coverage" v={c.citation_coverage == null ? null : fmtPct(c.citation_coverage)} r={cReason} d="Answered requests with at least one source citation" />
                  <Row k="Retrieval empty-result rate" v={c.retrieval_empty_rate == null ? null : fmtPct(c.retrieval_empty_rate)} r={cReason || 'No retrieval calls'} d="Filing-search tool calls that returned no facts" />
                  <Row k="Provider fallback rate" v={c.fallback_rate == null ? null : fmtPct(c.fallback_rate)} r={cReason} d="Requests answered by a fallback model, not the primary" />
                  <Row k="Rate-limit errors" v={c.requests ? fmtInt(c.rate_limit_errors) : null} r={cReason} d="Requests stopped by the AI quota / budget guard" />
                  <Row k="Safety-filter events" v={c.requests ? fmtInt(c.safety_events) : null} r={cReason} d="Refusals or post-check policy flags" />
                  <Row k="First token p50" v={c.first_token_p50_ms == null ? null : fmtMs(c.first_token_p50_ms)} r={cReason} d="Time to first streamed token" />
                  <Row k="Copilot failures" v={c.requests ? `${fmtInt(c.failures)} of ${fmtInt(c.requests)}` : null} r={cReason} d="Requests that ended with an error" />
                </tbody>
              </TableWrap>
              <Note>Live ring (this API process, last {c.live_ring?.requests ?? 0} requests): error rate {c.live_ring?.error_rate == null ? '—' : fmtPct(c.live_ring.error_rate)}, p95 {fmtMs(c.live_ring?.p95_ms)}.</Note>
            </Card>
            <Card title="Budgets (today, live)" subtitle="Global, hourly, system and per-provider circuit breakers from the AI guard">
              {u.budgets?.daily_budget_usd == null ? <p className="text-xs text-slate-400"><Val v={null} reason={u.budgets?.reason} /> {u.budgets?.reason}</p> : (
                <div className="space-y-3 text-xs">
                  <Budget label="Global daily" spent={u.budgets.today_spent_usd} cap={u.budgets.daily_budget_usd} />
                  <Budget label="This hour" spent={u.budgets.this_hour_spent_usd} cap={u.budgets.hourly_budget_usd} />
                  <Budget label="System / background" spent={u.budgets.system_spent_usd} cap={u.budgets.system_budget_usd} />
                  {Object.entries(u.budgets.providers || {}).map(([k, v]: any) => <Budget key={k} label={k} spent={v.spent_usd} cap={v.budget_usd} />)}
                  <p className="text-[11px] text-slate-500">Counter store: {u.budgets.store}{u.budgets.paused ? <> · <StatusPill status="down" label={`paused: ${u.budgets.paused}`} /></> : ''}</p>
                </div>
              )}
            </Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Card title="By feature" subtitle="Calls and spend per product feature">
              <TableWrap><thead><tr><th className={th}>Feature</th><th className={th}>Calls</th><th className={th}>Cost</th></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {u.by_feature.length === 0 && <tr><td className={td} colSpan={3}>No calls in this range</td></tr>}
                  {u.by_feature.map((f: any) => <tr key={f.feature}><td className={td}>{f.feature}</td><td className={td}>{fmtInt(f.calls)}</td><td className={td}>{fmtUsd(f.cost_usd, 4)}</td></tr>)}
                </tbody></TableWrap>
            </Card>
            <Card title="Top users by AI spend" subtitle="In this range">
              <TableWrap><thead><tr><th className={th}>User</th><th className={th}>Calls</th><th className={th}>Tokens</th><th className={th}>Cost</th></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {u.top_users.length === 0 && <tr><td className={td} colSpan={4}>No user calls in this range</td></tr>}
                  {u.top_users.map((r: any) => <tr key={r.user_id}><td className={td}><a href={`/admin/users?user=${r.user_id}`} className="font-semibold text-blue-600 dark:text-cyan-400">{r.username || `#${r.user_id}`}</a></td><td className={td}>{fmtInt(r.calls)}</td><td className={td}>{fmtCompact(r.tokens)}</td><td className={td}>{fmtUsd(r.cost_usd, 4)}</td></tr>)}
                </tbody></TableWrap>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

function Row({ k, v, r, d }: { k: string; v: string | null; r?: string; d: string }) {
  return <tr><td className={td}>{k}</td><td className={`${td} font-semibold`}><Val v={v} reason={r} /></td><td className={`${td} whitespace-normal text-slate-500 dark:text-slate-400`}>{d}</td></tr>
}

function Budget({ label, spent, cap }: { label: string; spent: number; cap: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between"><span className="capitalize">{label}</span><span className="tabular-nums text-slate-500">{fmtUsd(spent, 4)} / {fmtUsd(cap)}</span></div>
      <Bar value={spent || 0} max={cap || 0} color={cap && spent / cap > 0.8 ? '#ef4444' : '#3b82f6'} />
    </div>
  )
}
