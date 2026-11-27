'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Lock, Search } from 'lucide-react'
import { Card, CardSkeleton, ErrorBox, Note, PageHeader, TableWrap, td, th, useAdminQuery } from '@/components/admin/AdminUI'
import { fmtAgo, fmtBytes, fmtInt } from '@/lib/admin'
import { cn } from '@/lib/utils'

function DataInner() {
  const params = useSearchParams()
  const router = useRouter()
  const table = params.get('table')
  const [filter, setFilter] = useState('')
  const tables = useAdminQuery<any>('/data/tables')
  const fresh = useAdminQuery<any>('/data/freshness')
  const list: any[] = (tables.data?.tables || []).filter((t: any) => !filter || t.name.includes(filter.toLowerCase()))
  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader title="Data Intelligence" page="data" noRange exportData={tables.data ? { tables: tables.data.tables, datasets: fresh.data?.datasets || [] } : null}
        subtitle="Read-only database explorer and dataset freshness. Queries run in a READ ONLY transaction with a statement timeout; sensitive columns are always redacted; every table view is audited." />
      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <Card title="Tables" subtitle={tables.data ? `${tables.data.tables.length} tables` : 'Loading…'}>
          <label className="relative mb-2 block">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter tables" aria-label="Filter tables"
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-xs outline-none dark:border-slate-700 dark:bg-[#0a1120]" />
          </label>
          {tables.error && <ErrorBox error={tables.error} />}
          {!tables.data ? <CardSkeleton rows={8} className="border-0 p-0" /> : (
            <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto pr-1 xl:max-h-[70vh]">
              {list.map((t) => (
                <li key={t.name}>
                  <button onClick={() => router.replace(`/admin/data?table=${encodeURIComponent(t.name)}`, { scroll: false })}
                    className={cn('flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs',
                      table === t.name ? 'bg-blue-600/10 text-blue-700 dark:bg-blue-500/15 dark:text-white' : 'hover:bg-slate-50 dark:hover:bg-slate-900')}>
                    <span className="truncate font-mono">{t.name}{t.redacted_columns.length ? <Lock className="ml-1 inline h-3 w-3 text-amber-500" aria-label="has redacted columns" /> : null}</span>
                    <span className="shrink-0 tabular-nums text-slate-400">{t.row_count_estimated ? '~' : ''}{fmtInt(t.row_count)} · {fmtBytes(t.size_bytes)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="min-w-0 space-y-4">
          {table ? <TableBrowser table={table} /> : (
            <Card title="Dataset freshness" subtitle="Latest timestamp per dataset">
              {!fresh.data ? <CardSkeleton rows={6} className="border-0 p-0" /> : (
                <TableWrap><thead><tr>{['Dataset', 'Column', 'Latest', 'Age'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                    {fresh.data.datasets.map((d: any) => <tr key={d.table}><td className={`${td} font-mono`}>{d.table}</td><td className={td}>{d.column}</td><td className={td}>{d.latest ?? '—'}</td><td className={td}>{fmtAgo(d.latest)}</td></tr>)}
                  </tbody></TableWrap>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function TableBrowser({ table }: { table: string }) {
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<string | null>(null)
  const [order, setOrder] = useState<'asc' | 'desc'>('asc')
  const [fcol, setFcol] = useState('')
  const [fval, setFval] = useState('')
  const [applied, setApplied] = useState<{ c: string; v: string } | null>(null)
  useEffect(() => { setPage(1); setSort(null); setFcol(''); setFval(''); setApplied(null) }, [table])
  const qs = new URLSearchParams({ page: String(page), page_size: '25', order })
  if (sort) qs.set('sort', sort)
  if (applied) { qs.set('filter_col', applied.c); qs.set('filter_val', applied.v) }
  const { data, error } = useAdminQuery<any>(`/data/tables/${encodeURIComponent(table)}?${qs.toString()}`)
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1
  return (
    <Card title={<span className="font-mono">{table}</span>} subtitle={data ? `${fmtInt(data.total)} rows · page ${page} of ${pages}` : 'Loading…'}
      right={data && (
        <form className="flex flex-wrap items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(fcol && fval ? { c: fcol, v: fval } : null) }}>
          <select value={fcol} onChange={(e) => setFcol(e.target.value)} aria-label="Filter column" className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-[#0a1120]">
            <option value="">Filter column…</option>
            {data.columns.filter((c: any) => !c.redacted && !c.masked).map((c: any) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
          <input value={fval} onChange={(e) => setFval(e.target.value)} placeholder="contains…" aria-label="Filter value" className="w-28 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-[#0a1120]" />
          <button className="rounded-lg bg-blue-600 px-2 py-1 text-xs font-semibold text-white">Apply</button>
        </form>
      )}>
      {error && <ErrorBox error={error} />}
      {!data ? <CardSkeleton rows={8} className="border-0 p-0" /> : (
        <>
          <TableWrap>
            <thead><tr>{data.columns.map((c: any) => (
              <th key={c.name} className={th}>
                {c.redacted || c.masked ? <span className="text-amber-600 dark:text-amber-400" title={c.masked ? 'Masked (reveal from the user directory, audited)' : 'Always redacted'}>{c.name} <Lock className="inline h-3 w-3" /></span> : (
                  <button onClick={() => { if (sort === c.name) setOrder(order === 'asc' ? 'desc' : 'asc'); else { setSort(c.name); setOrder('asc') } }}
                    className={cn('uppercase', sort === c.name && 'text-blue-600 dark:text-cyan-400')}>{c.name}{sort === c.name ? (order === 'asc' ? ' ↑' : ' ↓') : ''}</button>
                )}
                <span className="block text-[9px] font-normal normal-case text-slate-400">{c.type}</span>
              </th>
            ))}</tr></thead>
            <tbody className="divide-y divide-slate-100 font-mono dark:divide-slate-800/70">
              {data.rows.length === 0 && <tr><td className={td} colSpan={data.columns.length}>No rows</td></tr>}
              {data.rows.map((r: any, i: number) => (
                <tr key={i}>{data.columns.map((c: any) => (
                  <td key={c.name} className={cn(td, 'max-w-[240px] truncate text-[11px]', c.redacted && 'text-amber-600 dark:text-amber-400')} title={typeof r[c.name] === 'string' ? r[c.name] : undefined}>
                    {r[c.name] === null ? <span className="text-slate-400">null</span> : typeof r[c.name] === 'object' ? JSON.stringify(r[c.name]) : String(r[c.name])}
                  </td>
                ))}</tr>
              ))}
            </tbody>
          </TableWrap>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <span>Read-only · this view was written to the audit log</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-slate-200 px-2.5 py-1 disabled:opacity-40 dark:border-slate-700">Previous</button>
              <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-lg border border-slate-200 px-2.5 py-1 disabled:opacity-40 dark:border-slate-700">Next</button>
            </div>
          </div>
          <Note>Redacted by column name (password, hash, secret, token, api_key, otp, passkey keys / sign counts / credential ids, refresh, session ids, stripe_* ids, google_id, phone, date of birth), binary columns, and transcript / message content.</Note>
        </>
      )}
    </Card>
  )
}

export default function DataPage() {
  return <Suspense fallback={<CardSkeleton rows={8} />}><DataInner /></Suspense>
}
