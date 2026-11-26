'use client'

/**
 * Responsive SVG line chart for % series sharing one date axis (portfolio vs
 * SPY, /compare tickers). Gaps (null) break the line. Hover or touch shows a
 * crosshair with every series' value for that day. Theme colours come from
 * CSS variables so light and dark both work.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fmtAxisDate,
  lastValue,
  linePath,
  nearestIndex,
  niceTicks,
  scaleLinear,
  valueDomain,
  xTickIndexes,
  type ChartSeries,
} from '@/lib/lineChart'

const PAD = { top: 12, right: 12, bottom: 24, left: 46 }

function fmtPctAxis(v: number): string {
  const s = Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1)
  return `${v > 0 ? '+' : ''}${s}%`
}

export function fmtPctValue(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`
}

export default function NormalizedLineChart({
  dates,
  series,
  height = 260,
  ariaLabel,
  showLegend = true,
}: {
  dates: string[]
  series: ChartSeries[]
  height?: number
  ariaLabel: string
  showLegend?: boolean
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const n = dates.length
  const innerW = Math.max(0, width - PAD.left - PAD.right)
  const innerH = Math.max(0, height - PAD.top - PAD.bottom)
  const [lo, hi] = useMemo(() => valueDomain(series), [series])
  const ticks = useMemo(() => niceTicks(lo, hi, 4), [lo, hi])
  const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = scaleLinear(lo, hi, PAD.top + innerH, PAD.top)
  const spanDays = n > 1 ? (Date.parse(dates[n - 1]) - Date.parse(dates[0])) / 86_400_000 : 0
  const xt = xTickIndexes(n, width < 420 ? 3 : 5)

  const onMove = (clientX: number) => {
    const el = wrap.current
    if (!el || n === 0) return
    const rect = el.getBoundingClientRect()
    setHover(nearestIndex(clientX - rect.left, PAD.left, innerW, n))
  }

  const hi_ = hover != null && hover < n ? hover : null

  return (
    <div>
      {showLegend && (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {series.map((s) => {
            const v = hi_ != null ? s.values[hi_] : lastValue(s.values)
            return (
              <li key={s.key} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-0.5 w-4 rounded"
                  style={{ background: s.color, opacity: s.dashed ? 0.8 : 1 }}
                  aria-hidden
                />
                <span className="text-fg-secondary">{s.label}</span>
                <span className="font-semibold tabular-nums text-fg-primary">{fmtPctValue(v)}</span>
              </li>
            )
          })}
        </ul>
      )}
      <div
        ref={wrap}
        className="relative w-full touch-pan-y select-none"
        style={{ height }}
        onPointerMove={(e) => onMove(e.clientX)}
        onPointerDown={(e) => onMove(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        {width > 0 && n > 0 && (
          <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block">
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--border-subtle)"
                  strokeDasharray={t === 0 ? undefined : '2 4'}
                  strokeWidth={t === 0 ? 1.25 : 1}
                />
                <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize="10" fill="var(--text-muted)">
                  {fmtPctAxis(t)}
                </text>
              </g>
            ))}
            {xt.map((i) => (
              <text
                key={i}
                x={x(i)}
                y={height - 6}
                textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                fontSize="10"
                fill="var(--text-muted)"
              >
                {fmtAxisDate(dates[i], spanDays)}
              </text>
            ))}
            {series.map((s) => (
              <path
                key={s.key}
                d={linePath(s.values, x, y)}
                fill="none"
                stroke={s.color}
                strokeWidth={s.dashed ? 1.5 : 2}
                strokeDasharray={s.dashed ? '5 4' : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {hi_ != null && (
              <g>
                <line x1={x(hi_)} x2={x(hi_)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--border-strong)" />
                {series.map((s) => {
                  const v = s.values[hi_]
                  return v == null ? null : (
                    <circle key={s.key} cx={x(hi_)} cy={y(v)} r={3.5} fill={s.color} stroke="var(--surface-base)" strokeWidth={1.5} />
                  )
                })}
              </g>
            )}
          </svg>
        )}
        {hi_ != null && (
          <div
            className="pointer-events-none absolute top-1 rounded-md border border-line-default bg-surface-overlay px-2 py-1 text-[11px] shadow-lg"
            style={{
              left: Math.min(Math.max(x(hi_) - 60, 0), Math.max(0, width - 130)),
              background: 'var(--surface-overlay, var(--surface-base))',
            }}
          >
            <p className="font-medium text-fg-secondary">{fmtAxisDate(dates[hi_], 0)}{spanDays > 300 ? `, ${dates[hi_].slice(0, 4)}` : ''}</p>
          </div>
        )}
      </div>
    </div>
  )
}
