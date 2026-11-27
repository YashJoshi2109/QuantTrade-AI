'use client'

import { useId, useMemo } from 'react'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { CardSkeleton as Skeleton } from './ResearchCard'
import { cn } from '@/lib/utils'
import type { MACDPoint } from '@/lib/indicators'
import {
  BOLLINGER_RULE,
  MACD_RULE,
  MOMENTUM_RULE,
  RSI_RULE,
  TREND_RULE,
  VOLATILITY_RULE,
  bollingerPosition,
  fmtNum,
  fmtSigned,
  fmtUsd,
  macdSignal,
  momentumFromRsi,
  rsiZone,
  smaRows,
  toneText,
  trendSignal,
  volatilityFromBollinger,
  type TechnicalInputs,
} from '@/lib/researchTechnicals'
import { CardTitle, RangeBar, ResearchCard, RuleTip } from './ResearchCard'

/**
 * Technical-analysis cards shared by the desktop right rail and MobileResearch.
 * Every value comes from /api/v1/indicators (plus the canonical quote price);
 * derivations live in lib/researchTechnicals. Missing value -> "—".
 */

interface CardProps {
  inputs: TechnicalInputs | null
  loading?: boolean
  className?: string
  compact?: boolean
}

// ── Trend gauge ─────────────────────────────────────────────────────────

function Gauge({ score }: { score: number | null }) {
  const gid = useId().replace(/:/g, '')
  // Semicircle: left (-1, bearish) to right (+1, bullish).
  const angle = score === null ? null : Math.PI * (1 - (score + 1) / 2)
  const cx = 100
  const cy = 96
  const r = 80
  const needle =
    angle === null ? null : { x: cx + (r - 14) * Math.cos(angle), y: cy - (r - 14) * Math.sin(angle) }
  return (
    <svg viewBox="0 0 200 110" className="mx-auto block w-full max-w-[220px]" role="img" aria-hidden>
      <defs>
        <linearGradient id={`g${gid}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#ef4444" />
          <stop offset="50%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#10b981" />
        </linearGradient>
      </defs>
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke={`url(#g${gid})`}
        strokeWidth={12}
        strokeLinecap="round"
      />
      {needle && (
        <>
          <line x1={cx} y1={cy} x2={needle.x} y2={needle.y} className="stroke-slate-700 dark:stroke-slate-200" strokeWidth={3} strokeLinecap="round" />
          <circle cx={cx} cy={cy} r={6} className="fill-slate-700 dark:fill-slate-200" />
        </>
      )}
    </svg>
  )
}

export function TrendSummaryCard({ inputs, loading, className }: CardProps) {
  const trend = trendSignal(inputs)
  return (
    <ResearchCard className={className} testId="trend-summary-card" busy={loading}>
      <CardTitle rule={TREND_RULE}>Trend summary</CardTitle>
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="mx-auto h-[100px] w-[200px] rounded-t-full" />
          <Skeleton className="mx-auto h-5 w-24" />
          <Skeleton className="mx-auto h-3 w-40" />
        </div>
      ) : (
        <>
          <Gauge score={trend?.score ?? null} />
          <div className="-mt-1 flex justify-between px-2 text-[10px] uppercase tracking-wide text-fg-muted">
            <span>Bearish</span>
            <span>Bullish</span>
          </div>
          <p className={cn('mt-2 text-center text-lg font-semibold', toneText(trend?.tone))} data-testid="trend-label">
            {trend?.label ?? '—'}
          </p>
          <p className="mt-0.5 text-center text-[12px] text-fg-muted">
            {trend ? trend.reason : 'Not enough indicator data'}
          </p>
        </>
      )}
    </ResearchCard>
  )
}

// ── RSI ─────────────────────────────────────────────────────────────────

export function RsiCard({ inputs, loading, className, compact }: CardProps) {
  const rsi = inputs?.rsi
  const zone = rsiZone(rsi)
  const pos = zone ? Math.min(100, Math.max(0, rsi as number)) : null
  return (
    <ResearchCard className={className} testId="rsi-card" busy={loading}>
      <CardTitle rule={RSI_RULE}>RSI (14)</CardTitle>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-2 w-full" />
        </div>
      ) : (
        <>
          <div className={cn('flex items-baseline gap-2', compact && 'flex-col gap-0')}>
            <span className="text-2xl font-semibold tabular-nums text-fg-primary">{fmtNum(rsi, 1)}</span>
            <span className={cn('text-[12px] font-medium', zone && zone !== 'Neutral' ? toneText('caution') : 'text-fg-secondary')}>
              {zone ?? '—'}
            </span>
          </div>
          <div className="relative mt-3">
            <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
              <div className="h-full bg-amber-500/50" style={{ width: '30%' }} />
              <div className="h-full bg-slate-300 dark:bg-white/15" style={{ width: '40%' }} />
              <div className="h-full bg-amber-500/50" style={{ width: '30%' }} />
            </div>
            {pos !== null && (
              <div
                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-blue-600 shadow dark:border-[#0f1520] dark:bg-blue-400"
                style={{ left: `${pos}%` }}
                aria-hidden
              />
            )}
          </div>
          <div className="relative mt-1.5 h-3 text-[10px] tabular-nums text-fg-muted">
            <span className="absolute left-0">0</span>
            <span className="absolute -translate-x-1/2" style={{ left: '30%' }}>30</span>
            <span className="absolute -translate-x-1/2" style={{ left: '70%' }}>70</span>
            <span className="absolute right-0">100</span>
          </div>
        </>
      )}
    </ResearchCard>
  )
}

// ── Moving averages ─────────────────────────────────────────────────────

export function MovingAveragesCard({ inputs, loading, className, showTrend = false }: CardProps & { showTrend?: boolean }) {
  const rows = smaRows(inputs)
  const trend = trendSignal(inputs)
  return (
    <ResearchCard className={className} testId="moving-averages-card" busy={loading}>
      <CardTitle
        right={
          showTrend && !loading && trend ? (
            <span className={cn('text-[12px] font-medium', toneText(trend.tone))}>{trend.label} trend</span>
          ) : undefined
        }
      >
        Moving averages
      </CardTitle>
      <ul className="divide-y divide-line-subtle">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between py-2 text-[13px] first:pt-0 last:pb-0">
            <span className="text-fg-muted">{r.label}</span>
            {loading ? (
              <Skeleton className="h-4 w-20" />
            ) : (
              <span className="flex items-center gap-1.5 tabular-nums font-medium text-fg-primary">
                {fmtUsd(r.value)}
                {r.above === true && (
                  <ArrowUpRight className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-label="Price above" />
                )}
                {r.above === false && (
                  <ArrowDownRight className="h-4 w-4 text-red-600 dark:text-red-400" aria-label="Price below" />
                )}
                {r.above === null && <span className="inline-block w-4" aria-hidden />}
              </span>
            )}
          </li>
        ))}
      </ul>
    </ResearchCard>
  )
}

// ── MACD ────────────────────────────────────────────────────────────────

function MacdMiniChart({ points }: { points: MACDPoint[] }) {
  const path = useMemo(() => {
    if (points.length < 2) return null
    const W = 200
    const H = 56
    const max = Math.max(1e-9, ...points.map((p) => Math.max(Math.abs(p.macd), Math.abs(p.signal), Math.abs(p.histogram))))
    const y = (v: number) => H / 2 - (v / max) * (H / 2 - 2)
    const step = W / points.length
    const line = (k: 'macd' | 'signal') =>
      points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step + step / 2).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' ')
    const bars = points.map((p, i) => ({
      x: i * step + step * 0.15,
      w: step * 0.7,
      y: Math.min(y(p.histogram), H / 2),
      h: Math.abs(y(p.histogram) - H / 2),
      up: p.histogram >= 0,
    }))
    return { W, H, macd: line('macd'), signal: line('signal'), bars }
  }, [points])
  if (!path) return null
  return (
    <svg viewBox={`0 0 ${path.W} ${path.H}`} preserveAspectRatio="none" className="mt-3 h-14 w-full" aria-hidden data-testid="macd-mini-chart">
      <line x1={0} x2={path.W} y1={path.H / 2} y2={path.H / 2} className="stroke-slate-300 dark:stroke-white/10" strokeWidth={0.5} />
      {path.bars.map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width={b.w} height={Math.max(0.5, b.h)} className={b.up ? 'fill-emerald-500/45' : 'fill-red-500/45'} />
      ))}
      <path d={path.macd} fill="none" stroke="#3b82f6" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
      <path d={path.signal} fill="none" stroke="#f59e0b" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function MacdCard({
  inputs,
  loading,
  className,
  history = [],
  compact,
}: CardProps & { history?: MACDPoint[] }) {
  const m = macdSignal(inputs?.macd)
  return (
    <ResearchCard className={className} testId="macd-card" busy={loading}>
      <CardTitle rule={`${MACD_RULE} Mini chart: last ${history.length || 60} sessions, computed from daily closes.`}>MACD</CardTitle>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-3 w-24" />
        </div>
      ) : (
        <>
          <div className={cn('flex items-baseline gap-2', compact && 'flex-col gap-0')}>
            <span className="text-2xl font-semibold tabular-nums text-fg-primary">{fmtSigned(m?.macd, 2, false)}</span>
            <span className={cn('text-[12px] font-medium', toneText(m?.tone))}>{m?.label ?? '—'}</span>
          </div>
          <MacdMiniChart points={history} />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] tabular-nums text-fg-muted">
            <span>
              <span className="mr-1 inline-block h-0.5 w-3 align-middle bg-amber-500" aria-hidden />
              Signal {fmtSigned(m?.signal, 2, false)}
            </span>
            {!compact && (
              <span>
                <span className="mr-1 inline-block h-0.5 w-3 align-middle bg-blue-500" aria-hidden />
                MACD line
              </span>
            )}
            {!compact && (
              <span>
                <span className={cn('mr-1 inline-block h-2 w-1.5 align-middle', (m?.histogram ?? 0) >= 0 ? 'bg-emerald-500/60' : 'bg-red-500/60')} aria-hidden />
                Hist {fmtSigned(m?.histogram, 2)}
              </span>
            )}
          </div>
        </>
      )}
    </ResearchCard>
  )
}

// ── Bollinger ───────────────────────────────────────────────────────────

export function BollingerCard({ inputs, loading, className }: CardProps) {
  const bb = inputs?.bollinger_bands
  const pos = bollingerPosition(inputs?.price, bb)
  const vol = volatilityFromBollinger(bb)
  return (
    <ResearchCard className={className} testId="bollinger-card" busy={loading}>
      <CardTitle
        rule={BOLLINGER_RULE}
        right={!loading && <span className="text-[12px] font-medium text-fg-secondary">{pos?.label ?? '—'}</span>}
      >
        Bollinger Bands
      </CardTitle>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-3 w-full" />
        </div>
      ) : (
        <>
          <RangeBar
            position={pos ? Math.min(1, Math.max(0, pos.position)) : null}
            lowLabel={`Lower ${fmtUsd(bb?.lower)}`}
            highLabel={`Upper ${fmtUsd(bb?.upper)}`}
          />
          <div className="mt-2 flex justify-between text-[11px] tabular-nums text-fg-muted">
            <span>Middle {fmtUsd(bb?.middle)}</span>
            <span>Width {vol ? `${fmtNum(vol.bandwidthPct, 1)}%` : '—'}</span>
          </div>
        </>
      )}
    </ResearchCard>
  )
}

// ── Summary tiles (under the tab bar) ───────────────────────────────────

export function TechnicalSummaryTiles({ inputs, loading, className }: CardProps) {
  const trend = trendSignal(inputs)
  const mom = momentumFromRsi(inputs?.rsi)
  const vol = volatilityFromBollinger(inputs?.bollinger_bands)
  const tiles = [
    { key: 'trend', label: 'Trend', value: trend?.label, tone: trend?.tone, sub: trend ? `Score ${fmtSigned(trend.score, 2)}` : undefined, rule: TREND_RULE },
    { key: 'momentum', label: 'Momentum', value: mom?.label, tone: mom?.tone, sub: inputs?.rsi != null ? `RSI ${fmtNum(inputs.rsi, 1)}` : undefined, rule: MOMENTUM_RULE },
    { key: 'volatility', label: 'Volatility', value: vol?.label, tone: vol?.tone, sub: vol ? `BB width ${fmtNum(vol.bandwidthPct, 1)}%` : undefined, rule: VOLATILITY_RULE },
  ]
  return (
    <div className={cn('grid grid-cols-[repeat(3,minmax(0,1fr))] gap-2 sm:gap-3', className)} data-testid="technical-summary-tiles">
      {tiles.map((t) => (
        <div key={t.key} className="rs-card min-w-0 px-3 py-2.5" aria-busy={loading || undefined}>
          <div className="flex items-center gap-1 text-[11px] text-fg-muted">
            <span className="truncate">{t.label}</span>
            <RuleTip rule={t.rule} className="ml-auto" />
          </div>
          {loading ? (
            <>
              <Skeleton className="mt-1.5 h-5 w-16" />
              <Skeleton className="mt-1 h-3 w-14" />
            </>
          ) : (
            <>
              <div className={cn('mt-0.5 truncate text-[15px] font-semibold', toneText(t.tone))} data-testid={`summary-${t.key}`}>
                {t.value ?? '—'}
              </div>
              <div className="truncate text-[11px] tabular-nums text-fg-muted">{t.sub ?? ' '}</div>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
