'use client'

import { Eye, MousePointerClick, Radio, Timer, UserPlus, Users, Activity, Search } from 'lucide-react'
import {
  Bar, Card, CardSkeleton, Donut, ErrorBox, KpiCard, KpiSkeletonRow, LineSeries, PageHeader, TableWrap, td, th, useAdminQuery, useAdminRange,
} from '@/components/admin/AdminUI'
import { fmtCompact, fmtInt, fmtPct } from '@/lib/admin'

function fmtDur(s: number | null | undefined) {
  if (s == null || !Number.isFinite(s)) return '—'
  const m = Math.floor(s / 60)
  return m ? `${m}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`
}

export default function TrafficPage() {
  const { range } = useAdminRange()
  const st = useAdminQuery<any>('/traffic/status')
  const cfg = st.data
  const ga = useAdminQuery<any>(cfg?.ga4_configured ? `/traffic/ga4?range=${range}` : null)
  const rt = useAdminQuery<any>(cfg?.ga4_configured ? '/traffic/realtime' : null, { refetchMs: 60_000 })
  const gsc = useAdminQuery<any>(cfg?.gsc_configured ? `/traffic/gsc?range=${range}` : null)
  const k = ga.data?.kpis
  const v = (value: any) => ({ value })
  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader title="Traffic" page="traffic" exportData={ga.data || gsc.data ? { ga4: ga.data, search_console: gsc.data, realtime: rt.data } : null}
        subtitle="Google Analytics 4 (site visitors) and Google Search Console (organic search). Cached 15 minutes; realtime every 60 seconds." />
      {st.error && <ErrorBox error={st.error} />}
      {!cfg && !st.error && <KpiSkeletonRow n={6} />}
      {cfg && (!cfg.ga4_configured || !cfg.gsc_configured) && <SetupCard cfg={cfg} />}

      {cfg?.ga4_configured && (
        <>
          {ga.error && <ErrorBox error={ga.error} onRetry={() => ga.refetch()} />}
          {!k ? <KpiSkeletonRow n={6} /> : (
            <div className="keep-cols grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
              <KpiCard label="Active users" icon={<Users className="h-4 w-4" />} data={v(k.active_users)} format={fmtCompact} hint="GA4" />
              <KpiCard label="New users" icon={<UserPlus className="h-4 w-4" />} data={v(k.new_users)} format={fmtCompact} accent="#8b5cf6" hint="GA4" />
              <KpiCard label="Sessions" icon={<Activity className="h-4 w-4" />} data={{ value: k.sessions, series: ga.data.daily.map((d: any) => d.sessions) }} format={fmtCompact} accent="#06b6d4" hint="GA4" />
              <KpiCard label="Page views" icon={<Eye className="h-4 w-4" />} data={{ value: k.page_views, series: ga.data.daily.map((d: any) => d.page_views) }} format={fmtCompact} accent="#10b981" hint="GA4" />
              <KpiCard label="Avg engagement time" icon={<Timer className="h-4 w-4" />} data={v(k.avg_engagement_time_s)} format={(x) => fmtDur(x)} accent="#f59e0b" hint="per active user" />
              <KpiCard label="Engagement rate" icon={<MousePointerClick className="h-4 w-4" />} data={v(k.engagement_rate)} format={(x) => fmtPct(x)} accent="#ec4899" hint={k.bounce_rate == null ? '' : `bounce ${fmtPct(k.bounce_rate)}`} />
              <KpiCard label="Realtime active" icon={<Radio className="h-4 w-4" />} data={{ value: rt.data?.active_users_30m ?? null, reason: rt.error ? (rt.error as Error).message : undefined }} format={fmtInt} accent="#ef4444" hint="last 30 min" />
            </div>
          )}
          {ga.data && (
            <>
              <div className="mt-4 grid gap-4 xl:grid-cols-3">
                <Card className="xl:col-span-2" title="Daily users and sessions" subtitle={`${ga.data.start} → ${ga.data.end}`}>
                  <LineSeries data={ga.data.daily} xKey="date" lines={[{ key: 'users', label: 'Users', color: '#3b82f6' }, { key: 'sessions', label: 'Sessions', color: '#06b6d4' }]} />
                </Card>
                <Card title="Channels" subtitle="Sessions by default channel group">
                  <Donut data={ga.data.channels.map((c: any) => ({ name: c.sessionDefaultChannelGroup, value: c.sessions }))} />
                </Card>
              </div>
              <div className="mt-4 grid gap-4 xl:grid-cols-3">
                <RankCard title="Top pages" rows={ga.data.top_pages} label="pagePath" metric="screenPageViews" metricLabel="Views" mono />
                <RankCard title="Source / medium" rows={ga.data.sources} label="sessionSourceMedium" metric="sessions" metricLabel="Sessions" />
                <div className="space-y-4">
                  <RankCard title="Countries" rows={ga.data.countries} label="country" metric="activeUsers" metricLabel="Users" />
                  <Card title="Devices · new vs returning">
                    <Donut height={120} data={ga.data.devices.map((d: any) => ({ name: d.deviceCategory, value: d.activeUsers }))} />
                    <div className="mt-3"><Donut height={120} data={ga.data.new_vs_returning.filter((d: any) => d.newVsReturning).map((d: any) => ({ name: d.newVsReturning, value: d.activeUsers }))} /></div>
                  </Card>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {cfg?.gsc_configured && (
        <div className="mt-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Search className="h-4 w-4 text-blue-500" /> Search Console · {cfg.gsc_site_url}</h2>
          {gsc.error && <ErrorBox error={gsc.error} onRetry={() => gsc.refetch()} />}
          {!gsc.data ? <CardSkeleton rows={6} /> : (
            <>
              <div className="keep-cols grid grid-cols-2 gap-3 xl:grid-cols-4">
                <KpiCard label="Clicks" icon={<MousePointerClick className="h-4 w-4" />} data={{ value: gsc.data.totals.clicks, series: gsc.data.daily.map((d: any) => d.clicks) }} format={fmtCompact} />
                <KpiCard label="Impressions" icon={<Eye className="h-4 w-4" />} data={{ value: gsc.data.totals.impressions, series: gsc.data.daily.map((d: any) => d.impressions) }} format={fmtCompact} accent="#8b5cf6" />
                <KpiCard label="CTR" icon={<Activity className="h-4 w-4" />} data={{ value: gsc.data.totals.ctr, series: gsc.data.daily.map((d: any) => d.ctr) }} format={(x) => fmtPct(x, 2)} accent="#10b981" />
                <KpiCard label="Avg position" icon={<Search className="h-4 w-4" />} data={{ value: gsc.data.totals.position, series: gsc.data.daily.map((d: any) => d.position) }} format={(x) => (x == null ? '—' : x.toFixed(1))} accent="#f59e0b" invertDelta />
              </div>
              <div className="mt-4 grid gap-4 xl:grid-cols-3">
                <Card className="xl:col-span-1" title="Clicks and impressions over time">
                  <LineSeries data={gsc.data.daily} xKey="date" height={220} lines={[{ key: 'clicks', label: 'Clicks', color: '#3b82f6' }, { key: 'impressions', label: 'Impressions', color: '#8b5cf6' }]} />
                </Card>
                <GscTable title="Top queries" rows={gsc.data.top_queries} k="query" />
                <GscTable title="Top pages" rows={gsc.data.top_pages} k="page" mono />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function RankCard({ title, rows, label, metric, metricLabel, mono }: { title: string; rows: any[]; label: string; metric: string; metricLabel: string; mono?: boolean }) {
  const max = Math.max(0, ...rows.map((r) => r[metric] || 0))
  return (
    <Card title={title} subtitle={metricLabel}>
      {rows.length === 0 ? <p className="text-xs text-slate-400">No data in this range</p> : (
        <ul className="space-y-2 text-xs">{rows.map((r, i) => (
          <li key={i}><div className="mb-1 flex justify-between gap-2"><span className={`truncate ${mono ? 'font-mono text-[11px]' : ''}`} title={r[label]}>{r[label] || '(not set)'}</span><span className="tabular-nums text-slate-500">{fmtInt(r[metric])}</span></div><Bar value={r[metric] || 0} max={max} /></li>
        ))}</ul>
      )}
    </Card>
  )
}

function GscTable({ title, rows, k, mono }: { title: string; rows: any[]; k: string; mono?: boolean }) {
  return (
    <Card title={title}>
      <TableWrap><thead><tr>{[k === 'query' ? 'Query' : 'Page', 'Clicks', 'Impr.', 'CTR', 'Pos.'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
          {rows.length === 0 && <tr><td className={td} colSpan={5}>No data</td></tr>}
          {rows.map((r, i) => <tr key={i}><td className={`${td} max-w-[200px] truncate ${mono ? 'font-mono text-[10px]' : ''}`} title={r[k]}>{mono ? r[k].replace(/^https?:\/\/[^/]+/, '') || '/' : r[k]}</td><td className={td}>{fmtInt(r.clicks)}</td><td className={td}>{fmtCompact(r.impressions)}</td><td className={td}>{fmtPct(r.ctr)}</td><td className={td}>{r.position?.toFixed(1)}</td></tr>)}
        </tbody></TableWrap>
    </Card>
  )
}

function SetupCard({ cfg }: { cfg: any }) {
  const rows = [
    { name: 'GOOGLE_ANALYTICS_SA_JSON', ok: cfg.service_account_valid, note: cfg.service_account_present ? (cfg.service_account_valid ? `service account ${cfg.service_account_email}` : 'present but not a valid service-account key') : 'missing' },
    { name: 'GA4_PROPERTY_ID', ok: cfg.ga4_property_id_valid, note: cfg.ga4_property_id_set ? (cfg.ga4_property_id_valid ? 'set' : 'must be the numeric property id, not the G- measurement id') : `missing (site tag is ${cfg.measurement_id})` },
    { name: 'GSC_SITE_URL', ok: !!cfg.gsc_site_url, note: cfg.gsc_site_url || 'missing (e.g. sc-domain:quanttrade.us)' },
  ]
  return (
    <Card className="mb-4" title="Connect Google Analytics and Search Console" subtitle="This page shows only real data from Google. Finish the setup below to enable it.">
      <ul className="space-y-1.5 text-xs">{rows.map((r) => (
        <li key={r.name} className="flex flex-wrap items-center gap-2"><code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-slate-800">{r.name}</code>
          <span className={r.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>{r.ok ? '✓' : '✗'} {r.note}</span></li>
      ))}</ul>
      <ol className="mt-4 list-decimal space-y-1 pl-5 text-xs text-slate-600 dark:text-slate-300">{cfg.setup_steps.map((s: string) => <li key={s}>{s}</li>)}</ol>
    </Card>
  )
}
