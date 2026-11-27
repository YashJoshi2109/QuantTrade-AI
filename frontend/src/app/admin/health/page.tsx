'use client'

import { Activity, AlertTriangle, Cpu, Gauge, MemoryStick, Timer } from 'lucide-react'
import {
  AvailabilityBars, Card, CardSkeleton, ErrorBox, KpiCard, KpiSkeletonRow, Note, PageHeader, StatusPill, TableWrap, td, th,
  useAdminQuery, useAdminRange, Val,
} from '@/components/admin/AdminUI'
import { ActivityFeed } from '@/components/admin/AdminBlocks'
import { fmtDate, fmtInt, fmtMs, fmtPct } from '@/lib/admin'

export default function HealthPage() {
  const { range } = useAdminRange()
  const { data, error, refetch } = useAdminQuery<any>(`/health?range=${range}`, { refetchMs: 30_000 })
  const a = data?.availability
  const api = data?.api
  const host = data?.host
  const k = (value: any, reason?: string) => ({ value, reason })
  const apiReason = api && !api.requests ? 'No API requests recorded by this process in the range' : undefined
  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader title="System Health" page="health" exportData={data}
        subtitle="Live probes of every dependency (API, AWS RDS PostgreSQL, Redis, market data, AI providers), persisted every 5 minutes for availability history." />
      {error && <ErrorBox error={error} onRetry={() => refetch()} />}
      {!data ? <KpiSkeletonRow n={6} /> : (
        <div className="keep-cols grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <KpiCard label="Availability (30d)" icon={<Activity className="h-4 w-4" />} data={k(a.overall, a.collecting_since ? undefined : 'Collecting: no status snapshots stored yet')} format={(v) => fmtPct(v, 2)} accent="#10b981" hint={a.collecting_since ? `since ${fmtDate(a.collecting_since)}` : ''} />
          <KpiCard label="API p95" icon={<Timer className="h-4 w-4" />} data={k(api.p95_ms, apiReason)} format={fmtMs} accent="#8b5cf6" hint={`${fmtInt(api.requests)} requests, this process`} />
          <KpiCard label="Active incidents" icon={<AlertTriangle className="h-4 w-4" />} data={k(data.incidents)} format={fmtInt} accent="#f59e0b" hint="services degraded or down" />
          <KpiCard label="CPU utilization" icon={<Cpu className="h-4 w-4" />} data={k(host.cpu_percent == null ? null : host.cpu_percent / 100, host.reason)} format={(v) => fmtPct(v)} accent="#3b82f6" hint={host.cpu_count ? `${host.cpu_count} cores, API host` : ''} />
          <KpiCard label="Memory utilization" icon={<MemoryStick className="h-4 w-4" />} data={k(host.memory_percent == null ? null : host.memory_percent / 100, host.reason)} format={(v) => fmtPct(v)} accent="#06b6d4" hint={host.memory_total_mb ? `${fmtInt(host.memory_used_mb)} / ${fmtInt(host.memory_total_mb)} MB` : ''} />
          <KpiCard label="API error rate" icon={<Gauge className="h-4 w-4" />} data={k(api.error_rate, apiReason)} format={(v) => fmtPct(v, 2)} accent="#ef4444" invertDelta hint={`${fmtInt(api.errors_5xx)} 5xx responses`} />
        </div>
      )}
      {!data ? <div className="mt-4"><CardSkeleton rows={8} /></div> : (
        <>
          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2" title="System health" subtitle={a.collecting_since ? `30-day availability · ${fmtInt(a.samples)} snapshots since ${fmtDate(a.collecting_since)}` : 'Availability history: collecting (snapshots every 5 minutes on the status leader)'}
              right={<StatusPill status={data.overall} />}>
              <AvailabilityBars days={a.days} />
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {data.services.map((s: any) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2 dark:border-slate-800">
                    <span className="min-w-0"><span className="block truncate text-xs font-medium">{s.name}</span><span className="block truncate text-[10px] text-slate-400" title={s.detail || ''}>{s.detail || s.group}</span></span>
                    <StatusPill status={s.status} />
                  </li>
                ))}
              </ul>
            </Card>
            <ActivityFeed items={data.activity} />
          </div>
          <Card className="mt-4" title="Service inventory" subtitle={`Status generated ${fmtDate(data.generated_at)}${data.collector?.running === false ? ' · collector not running in this API process' : ''}`}>
            <TableWrap><thead><tr>{['Service', 'Group', 'Status', 'Latency', 'Availability (30d)', 'Critical', 'Detail'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {data.services.map((s: any) => (
                  <tr key={s.id}><td className={`${td} font-semibold`}>{s.name}</td><td className={td}>{s.group}</td><td className={td}><StatusPill status={s.status} /></td>
                    <td className={td}><Val v={s.latency_ms == null ? null : fmtMs(s.latency_ms)} reason="No latency for this check" /></td>
                    <td className={td}><Val v={s.availability_30d == null ? null : fmtPct(s.availability_30d, 2)} reason="No stored samples yet" /></td>
                    <td className={td}>{s.critical ? 'Yes' : 'No'}</td><td className={`${td} max-w-xs truncate`} title={s.detail || ''}>{s.detail || '—'}</td></tr>
                ))}
              </tbody></TableWrap>
            <Note>API latency / error rate come from an in-process ring buffer ({api.scope}, since {fmtDate(api.process_started_at)}); CPU and memory are read from the API host with psutil.</Note>
          </Card>
        </>
      )}
    </div>
  )
}
