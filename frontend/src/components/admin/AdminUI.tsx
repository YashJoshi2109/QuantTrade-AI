'use client'

/**
 * Admin console primitives: opaque cards, KPI tiles with sparklines, status
 * pills, range control, confirm-with-reason dialog, charts. Every value shown
 * comes from the backend; a missing value renders "—" with the reason.
 */
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Area, AreaChart, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Legend } from 'recharts'
import { Download, RefreshCw, X, AlertTriangle, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { adminFetch, DASH, exportReport, fmtDelta, RANGES, RangeKey, statusTone, Tone } from '@/lib/admin'

// ── Range context ────────────────────────────────────────────────────────────

interface AdminCtx {
  range: RangeKey
  setRange: (r: RangeKey) => void
}

const Ctx = createContext<AdminCtx>({ range: '7d', setRange: () => {} })

export function AdminRangeProvider({ children }: { children: ReactNode }) {
  const [range, setRangeState] = useState<RangeKey>('7d')
  useEffect(() => {
    try {
      const saved = localStorage.getItem('admin.range') as RangeKey | null
      if (saved && RANGES.some((r) => r.key === saved)) setRangeState(saved)
    } catch {
      /* storage blocked */
    }
  }, [])
  const setRange = (r: RangeKey) => {
    setRangeState(r)
    try {
      localStorage.setItem('admin.range', r)
    } catch {
      /* storage blocked */
    }
  }
  return <Ctx.Provider value={{ range, setRange }}>{children}</Ctx.Provider>
}

export function useAdminRange() {
  return useContext(Ctx)
}

/** react-query wrapper for admin GETs; `path` may contain the range already. */
export function useAdminQuery<T = any>(path: string | null, opts?: { refetchMs?: number }) {
  return useQuery<T>({
    queryKey: ['admin', path],
    queryFn: () => adminFetch<T>(path as string),
    enabled: !!path,
    refetchInterval: opts?.refetchMs,
    staleTime: 15_000,
    retry: (n, err: any) => n < 1 && !(err?.status >= 400 && err?.status < 500),
  })
}

// ── Surfaces ─────────────────────────────────────────────────────────────────

export const cardCls =
  'rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-[#0c1424] dark:shadow-none'

export function Card({ title, subtitle, right, children, className }: {
  title?: ReactNode; subtitle?: ReactNode; right?: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <section className={cn(cardCls, 'p-4 md:p-5 min-w-0', className)}>
      {(title || right) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-800/80', className)} />
}

export function CardSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn(cardCls, 'p-5 space-y-3', className)}>
      <Skeleton className="h-4 w-40" />
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
    </div>
  )
}

/** A value, or "—" with the reason as a tooltip + visible hint. */
export function Val({ v, reason, className }: { v: ReactNode; reason?: string | null; className?: string }) {
  if (v === null || v === undefined || v === DASH || v === '') {
    return (
      <span className={cn('text-slate-400 dark:text-slate-500', className)} title={reason || 'No data'}>
        {DASH}
      </span>
    )
  }
  return <span className={className}>{v}</span>
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : 'Request failed'
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-200">
      <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" aria-hidden /> {msg}</span>
      {onRetry && <button onClick={onRetry} className="text-xs font-semibold underline">Retry</button>}
    </div>
  )
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
      <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

// ── Status ───────────────────────────────────────────────────────────────────

const TONE: Record<Tone, string> = {
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30',
  degraded: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30',
  down: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30',
  pending: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-300 dark:border-slate-600/40',
  info: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30',
}
const DOT: Record<Tone, string> = {
  ok: 'bg-emerald-500', degraded: 'bg-amber-500', down: 'bg-rose-500', pending: 'bg-slate-400', info: 'bg-blue-500',
}

export function StatusPill({ status, label, tone }: { status?: string | null; label?: ReactNode; tone?: Tone }) {
  const t = tone || statusTone(status)
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium', TONE[t])}>
      <span className={cn('h-1.5 w-1.5 rounded-full', DOT[t])} />
      {label ?? (status ? status.replace(/_/g, ' ') : DASH)}
    </span>
  )
}

// ── Page header ──────────────────────────────────────────────────────────────

export function PageHeader({ title, subtitle, page, exportData, noRange }: {
  title: string; subtitle: string; page: string; exportData?: Record<string, unknown> | null; noRange?: boolean
}) {
  const { range, setRange } = useAdminRange()
  const qc = useQueryClient()
  const [menu, setMenu] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const refresh = async () => {
    setSpinning(true)
    await qc.invalidateQueries({ queryKey: ['admin'] })
    setTimeout(() => setSpinning(false), 400)
  }
  return (
    <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-600 dark:text-cyan-400">QuantTrade / Admin intelligence</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 md:text-3xl dark:text-white">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!noRange && (
          <div role="radiogroup" aria-label="Time range" className="flex rounded-xl border border-slate-200 bg-white p-0.5 dark:border-slate-800 dark:bg-[#0c1424]">
            {RANGES.map((r) => (
              <button
                key={r.key}
                role="radio"
                aria-checked={range === r.key}
                onClick={() => setRange(r.key)}
                className={cn('rounded-lg px-3 py-1.5 text-xs font-semibold tabular-nums transition-colors',
                  range === r.key ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white')}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
        <button onClick={refresh} aria-label="Refresh" className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 hover:text-slate-900 dark:border-slate-800 dark:bg-[#0c1424] dark:text-slate-400 dark:hover:text-white">
          <RefreshCw className={cn('h-4 w-4', spinning && 'animate-spin')} />
        </button>
        <div className="relative">
          <button
            onClick={() => setMenu((m) => !m)}
            disabled={!exportData}
            className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
            aria-haspopup="menu"
            aria-expanded={menu}
          >
            <Download className="h-3.5 w-3.5" /> Export report
          </button>
          {menu && exportData && (
            <div role="menu" className="absolute right-0 z-30 mt-1 w-40 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-[#0f1a2e]">
              {(['csv', 'json'] as const).map((f) => (
                <button key={f} role="menuitem" onClick={() => { setMenu(false); exportReport(page, range, f, exportData) }}
                  className="block w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">
                  Download {f.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── KPI ──────────────────────────────────────────────────────────────────────

export interface KpiData {
  value: number | null
  prior?: number | null
  delta_pct?: number | null
  series?: number[]
  reason?: string | null
  note?: string | null
}

export function KpiCard({ label, icon, data, format, accent = '#3b82f6', invertDelta, hint }: {
  label: string; icon: ReactNode; data?: KpiData | null; format: (v: number | null | undefined) => string
  accent?: string; invertDelta?: boolean; hint?: string
}) {
  const d = fmtDelta(data?.delta_pct)
  const good = invertDelta ? d.tone === 'down' : d.tone === 'up'
  const bad = invertDelta ? d.tone === 'up' : d.tone === 'down'
  const series = (data?.series || []).map((v, i) => ({ i, v }))
  const shown = data ? format(data.value) : DASH
  return (
    <div className={cn(cardCls, 'relative flex min-w-0 flex-col p-4')}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl" style={{ background: `${accent}1f`, color: accent }}>
          {icon}
        </span>
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-white">
        <Val v={shown === DASH ? null : shown} reason={data?.reason} />
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11px]">
        <span className={cn('font-semibold tabular-nums', good && 'text-emerald-600 dark:text-emerald-400', bad && 'text-rose-600 dark:text-rose-400',
          (d.tone === 'flat' || d.tone === 'none') && 'text-slate-400')}>{d.text}</span>
        <span className="truncate text-slate-400 dark:text-slate-500">{data?.reason && data.value == null ? data.reason : hint || data?.note || 'vs prior period'}</span>
      </div>
      <div className="mt-2 h-8">
        {series.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 2, bottom: 0, left: 0, right: 0 }}>
              <defs>
                <linearGradient id={`spark-${label.replace(/\W/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accent} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={accent} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={accent} strokeWidth={1.5} fill={`url(#spark-${label.replace(/\W/g, '')})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-end text-[10px] text-slate-400 dark:text-slate-600">no series</div>
        )}
      </div>
    </div>
  )
}

export function KpiSkeletonRow({ n = 5 }: { n?: number }) {
  return (
    <div className={cn('grid gap-3', n === 6 ? 'keep-cols grid-cols-2 md:grid-cols-3 xl:grid-cols-6' : 'keep-cols grid-cols-2 md:grid-cols-3 xl:grid-cols-5')}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className={cn(cardCls, 'space-y-2 p-4')}>
          <Skeleton className="h-3 w-24" /><Skeleton className="h-7 w-20" /><Skeleton className="h-3 w-16" /><Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  )
}

// ── Charts ───────────────────────────────────────────────────────────────────

export const PALETTE = ['#3b82f6', '#06b6d4', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#64748b']

const axis = { fontSize: 10, fill: '#94a3b8' }
const tooltipStyle = {
  contentStyle: { background: '#0f1a2e', border: '1px solid #1e293b', borderRadius: 10, fontSize: 12, color: '#e2e8f0' },
  labelStyle: { color: '#94a3b8' },
}

export function LineSeries({ data, xKey, lines, height = 240, area }: {
  data: Record<string, any>[]; xKey: string; lines: { key: string; label: string; color: string }[]; height?: number; area?: boolean
}) {
  if (!data.length) return <EmptyChart height={height} />
  const Chart: any = area ? AreaChart : LineChart
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="#94a3b8" strokeOpacity={0.12} vertical={false} />
          <XAxis dataKey={xKey} tick={axis} tickLine={false} axisLine={false} minTickGap={24}
            tickFormatter={(v: string) => (v.length >= 13 ? v.slice(11, 13) + 'h' : v.slice(5))} />
          <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} width={48} />
          <Tooltip {...tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
          {lines.map((l) => area ? (
            <Area key={l.key} type="monotone" dataKey={l.key} name={l.label} stroke={l.color} fill={l.color} fillOpacity={0.12} strokeWidth={2} isAnimationActive={false} />
          ) : (
            <Line key={l.key} type="monotone" dataKey={l.key} name={l.label} stroke={l.color} strokeWidth={2} dot={false} isAnimationActive={false} />
          ))}
        </Chart>
      </ResponsiveContainer>
    </div>
  )
}

export function Donut({ data, center, height = 180 }: { data: { name: string; value: number }[]; center?: ReactNode; height?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (!total) return <EmptyChart height={height} label="No requests in this range" />
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row">
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="95%" paddingAngle={2} stroke="none" isAnimationActive={false}>
              {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip {...tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
        {center && <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">{center}</div>}
      </div>
      <ul className="w-full min-w-0 space-y-1.5 text-xs">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2 text-slate-600 dark:text-slate-300">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="truncate" title={d.name}>{d.name}</span>
            </span>
            <span className="tabular-nums text-slate-500 dark:text-slate-400">{((d.value / total) * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function EmptyChart({ height = 200, label = 'No data in this range' }: { height?: number; label?: string }) {
  return (
    <div style={{ height }} className="flex items-center justify-center rounded-xl border border-dashed border-slate-200 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
      {label}
    </div>
  )
}

/** 30 vertical bars, one per day: green = 100%, amber = degraded samples, red = down, grey = no data. */
export function AvailabilityBars({ days }: { days: { day: string; availability: number | null; worst: string | null; samples: number }[] }) {
  return (
    <div className="flex h-8 items-end gap-[3px]" aria-label="Daily availability, last 30 days">
      {days.map((d) => {
        const color = d.availability == null ? 'bg-slate-200 dark:bg-slate-800'
          : d.worst === 'down' ? 'bg-rose-500' : d.worst === 'degraded' ? 'bg-amber-500' : 'bg-emerald-500'
        return (
          <span key={d.day} title={`${d.day}: ${d.availability == null ? 'no samples' : `${(d.availability * 100).toFixed(2)}% (${d.samples} samples)`}`}
            className={cn('h-full flex-1 rounded-sm', color)} />
        )
      })}
    </div>
  )
}

export function Bar({ value, max, color = '#3b82f6' }: { value: number; max: number; color?: string }) {
  const w = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div className="h-full rounded-full" style={{ width: `${w}%`, background: color }} />
    </div>
  )
}

// ── Tables ───────────────────────────────────────────────────────────────────

export const th = 'px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap'
export const td = 'px-3 py-2.5 text-xs text-slate-700 dark:text-slate-200 whitespace-nowrap tabular-nums'

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="-mx-4 overflow-x-auto md:-mx-5"><table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800/80">{children}</table></div>
}

// ── Confirm dialog with reason ───────────────────────────────────────────────

export function ConfirmDialog({ open, title, description, confirmLabel, danger, onClose, onConfirm, children, extraValid = true }: {
  open: boolean; title: string; description: ReactNode; confirmLabel: string; danger?: boolean
  onClose: () => void; onConfirm: (reason: string) => Promise<void>; children?: ReactNode; extraValid?: boolean
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { if (open) { setReason(''); setErr(null); setBusy(false) } }, [open])
  if (!open) return null
  const valid = reason.trim().length >= 5 && extraValid
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className={cn(cardCls, 'w-full max-w-md rounded-b-none p-5 sm:rounded-2xl')}>
        <div className="flex items-start justify-between gap-3">
          <h3 id="confirm-title" className="text-base font-semibold text-slate-900 dark:text-white">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700 dark:hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">{description}</div>
        {children && <div className="mt-3 space-y-2">{children}</div>}
        <label className="mt-4 block text-xs font-medium text-slate-600 dark:text-slate-300" htmlFor="confirm-reason">
          Reason (required, written to the audit log)
        </label>
        <textarea id="confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={2000}
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-[#0a1120] dark:text-white"
          placeholder="e.g. Support ticket #1234: user requested sign-out on all devices" />
        {err && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
          <button
            disabled={!valid || busy}
            onClick={async () => {
              setBusy(true); setErr(null)
              try { await onConfirm(reason.trim()); onClose() } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); setBusy(false) }
            }}
            className={cn('rounded-xl px-3 py-2 text-xs font-semibold text-white disabled:opacity-50', danger ? 'bg-rose-600 hover:bg-rose-500' : 'bg-blue-600 hover:bg-blue-500')}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function useNowTick(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}

export function useStableMemo<T>(fn: () => T, deps: unknown[]): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(fn, deps)
}
