'use client'

import { Landmark } from 'lucide-react'
import { Skeleton } from '@/components/Skeleton'
import { SourceLine } from '@/components/research/SourceLine'
import { curvePath, useYieldCurve } from '@/lib/publicData'
import { cn } from '@/lib/utils'

const W = 320
const H = 110
const COMPARE_STYLE: Record<string, string> = {
  '30d ago': 'stroke-slate-400 dark:stroke-slate-500',
  '365d ago': 'stroke-amber-500/70',
}

/** US Treasury par yield curve (Markets page, desktop + mobile). */
export default function YieldCurveCard({ className }: { className?: string }) {
  const { data, isLoading, isError, refetch } = useYieldCurve()
  const ok = data?.status === 'ok' && data.points.length > 1

  return (
    <section
      className={cn('rounded-2xl border border-line-subtle bg-surface-raised p-4', className)}
      aria-label="US Treasury yield curve"
      aria-busy={isLoading || undefined}
      data-testid="yield-curve-card"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-fg-primary">
          <Landmark className="h-4 w-4 text-blue-500" aria-hidden />
          Treasury yield curve
        </h2>
        {ok && data?.spreads && (
          <div className="flex gap-2 text-[11px] tabular-nums">
            {data.spreads['10y_2y_bp'] !== undefined && (
              <Spread label="10Y–2Y" bp={data.spreads['10y_2y_bp']} />
            )}
            {data.spreads['10y_3m_bp'] !== undefined && (
              <Spread label="10Y–3M" bp={data.spreads['10y_3m_bp']} />
            )}
          </div>
        )}
      </div>

      {isLoading || (data?.syncing && !ok) ? (
        <div className="space-y-2" data-testid="yield-curve-skeleton">
          <Skeleton className="h-[110px] w-full" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ) : isError ? (
        <p className="text-[13px] text-fg-muted">
          Yield curve could not be loaded.{' '}
          <button type="button" className="text-blue-500 underline" onClick={() => refetch()}>Retry</button>
        </p>
      ) : !ok ? (
        <p className="text-[13px] text-fg-muted">No Treasury yield-curve data loaded yet.</p>
      ) : (
        <CurveChart data={data!} />
      )}
      <SourceLine attribution={data?.attribution} extra="daily par yield curve rates" testId="yield-curve-source" />
    </section>
  )
}

function Spread({ label, bp }: { label: string; bp: number }) {
  return (
    <span className={cn('rounded-md px-1.5 py-0.5', bp < 0 ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400')}>
      {label} {bp > 0 ? '+' : ''}{bp.toFixed(0)}bp
    </span>
  )
}

function CurveChart({ data }: { data: NonNullable<ReturnType<typeof useYieldCurve>['data']> }) {
  const tenors = data.points.map((p) => p.tenor)
  const all = [data.points, ...(data.comparisons ?? []).map((c) => c.points)].flat().map((p) => p.yield_pct)
  const lo = Math.floor((Math.min(...all) - 0.1) * 4) / 4
  const hi = Math.ceil((Math.max(...all) + 0.1) * 4) / 4
  const labelTenors = ['1M', '3M', '1Y', '2Y', '5Y', '10Y', '30Y'].filter((t) => tenors.includes(t))
  const by = Object.fromEntries(data.points.map((p) => [p.tenor, p.yield_pct]))
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="h-auto w-full" role="img" aria-label={`Par yields on ${data.date}: ${labelTenors.map((t) => `${t} ${by[t]}%`).join(', ')}`}>
        {[lo, (lo + hi) / 2, hi].map((v) => {
          const y = H - ((v - lo) / (hi - lo)) * H
          return (
            <g key={v}>
              <line x1={0} x2={W} y1={y} y2={y} className="stroke-slate-200 dark:stroke-white/10" strokeWidth={1} />
              <text x={0} y={y - 2} textAnchor="start" className="fill-slate-400 text-[7px]">{v.toFixed(2)}%</text>
            </g>
          )
        })}
        {(data.comparisons ?? []).map((c) => (
          <polyline key={c.label} points={curvePath(c.points, tenors, W, H, lo, hi)} fill="none" strokeWidth={1.25} strokeDasharray="4 3" className={COMPARE_STYLE[c.label] ?? 'stroke-slate-400'} />
        ))}
        <polyline points={curvePath(data.points, tenors, W, H, lo, hi)} fill="none" strokeWidth={2.25} className="stroke-blue-600 dark:stroke-blue-400" />
        {labelTenors.map((t) => {
          const x = (tenors.indexOf(t) / (tenors.length - 1)) * W
          return (
            <text key={t} x={Math.min(Math.max(x, 8), W - 8)} y={H + 12} textAnchor="middle" className="fill-slate-500 text-[7px]">{t}</text>
          )
        })}
      </svg>
      <div className="keep-cols mt-2 grid grid-cols-4 gap-1.5 text-center sm:grid-cols-7">
        {labelTenors.map((t) => (
          <div key={t} className="rounded-md bg-slate-100 px-1 py-1 dark:bg-white/5">
            <div className="text-[10px] text-fg-muted">{t}</div>
            <div className="text-[12px] font-semibold tabular-nums text-fg-primary">{by[t]?.toFixed(2)}%</div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-fg-muted">
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-blue-600 dark:bg-blue-400" /> {data.date}</span>
        {(data.comparisons ?? []).map((c) => (
          <span key={c.label} className="flex items-center gap-1"><span className="inline-block h-0 w-4 border-t border-dashed border-slate-400" /> {c.date} ({c.label})</span>
        ))}
      </div>
    </div>
  )
}
