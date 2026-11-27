'use client'

import Link from 'next/link'
import { Bot, ExternalLink, Info } from 'lucide-react'
import { CloudIcon, RainIcon, SunIcon, ThunderIcon } from '@/components/ui/animated-weather-icons'
import {
  botProfileHref,
  cellTone,
  chartBars,
  formatChartValue,
  hostOf,
  safeExternalUrl,
  type BotChart,
  type BotPayload,
  type BotTable,
} from '@/lib/communityBots'

const ACCENT: Record<string, string> = {
  amber: 'border-amber-500/30 bg-amber-500/[0.06]',
  violet: 'border-violet-500/30 bg-violet-500/[0.06]',
  emerald: 'border-emerald-500/30 bg-emerald-500/[0.06]',
  sky: 'border-sky-500/30 bg-sky-500/[0.06]',
  orange: 'border-orange-500/30 bg-orange-500/[0.06]',
  cyan: 'border-cyan-500/30 bg-cyan-500/[0.06]',
  blue: 'border-blue-500/30 bg-blue-500/[0.06]',
}

function WeatherGlyph({ value, size }: { value: string; size: number }) {
  if (value === 'sunny' || value === 'mostly_sunny') return <SunIcon size={size} />
  if (value === 'rainy') return <RainIcon size={size} />
  if (value === 'stormy') return <ThunderIcon size={size} />
  return <CloudIcon size={size} />
}

function toneClass(cell: string | number) {
  const t = cellTone(cell)
  return t === 'up' ? 'text-emerald-400' : t === 'down' ? 'text-red-400' : ''
}

function DataTable({ table, maxRows }: { table: BotTable; maxRows?: number }) {
  const rows = maxRows ? table.rows.slice(0, maxRows) : table.rows
  const hidden = table.rows.length - rows.length
  return (
    <div className="mb-3">
      {table.title && <p className="text-[11px] font-semibold text-fg-muted uppercase tracking-wider mb-1.5">{table.title}</p>}
      <div className="overflow-x-auto -mx-1 px-1 rounded-lg border border-line-subtle">
        <table className="w-full text-[12px] tabular-nums">
          <thead>
            <tr className="bg-surface-hover">
              {table.columns.map((c, i) => (
                <th key={i} className={`px-2 py-1.5 font-semibold text-fg-muted whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="border-t border-line-subtle">
                {row.map((cell, i) => (
                  <td
                    key={i}
                    className={`px-2 py-1.5 ${i === 0 ? 'text-left font-medium text-fg-primary whitespace-nowrap' : 'text-right text-fg-secondary'} ${i > 0 ? toneClass(cell) : ''} ${String(cell).length > 28 ? 'whitespace-normal min-w-[10rem]' : 'whitespace-nowrap'}`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 && <p className="text-[11px] text-fg-muted mt-1">+{hidden} more rows in the full post</p>}
    </div>
  )
}

function BarChart({ chart, maxBars }: { chart: BotChart; maxBars?: number }) {
  const bars = chartBars(chart).slice(0, maxBars ?? 12)
  if (bars.length < 2) return null
  return (
    <figure className="mb-3" aria-label={chart.title}>
      <figcaption className="text-[11px] font-semibold text-fg-muted uppercase tracking-wider mb-1.5">{chart.title}</figcaption>
      <div className="space-y-1">
        {bars.map((b) => (
          <div key={b.label} className="grid grid-cols-[minmax(3.5rem,7rem)_1fr_4.5rem] items-center gap-2 text-[11px]">
            <span className="truncate text-fg-secondary" title={b.label}>{b.label}</span>
            <div className="relative h-3 rounded-sm bg-surface-hover overflow-hidden">
              <div className="absolute inset-y-0 left-1/2 w-px bg-line-subtle" />
              <div
                className={`absolute inset-y-0 rounded-sm ${b.positive ? 'left-1/2 bg-emerald-500/70' : 'right-1/2 bg-red-500/70'}`}
                style={{ width: `${b.pct / 2}%` }}
              />
            </div>
            <span className={`text-right tabular-nums ${b.positive ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatChartValue(b.value, chart.unit)}
            </span>
          </div>
        ))}
      </div>
    </figure>
  )
}

/**
 * Structured body of an automated bot post: lead, highlights, data tables,
 * a small diverging bar chart, headline links, and the automated-post
 * footer (bot name, sources, as-of, not-investment-advice).
 * `compact` is the feed-card version (first table truncated, fewer bars).
 */
export default function BotPostBlock({ payload, compact = false }: { payload: BotPayload; compact?: boolean }) {
  const accent = ACCENT[payload.bot?.accent ?? 'blue'] ?? ACCENT.blue
  const tables = compact ? payload.tables.slice(0, 1) : payload.tables
  const links = payload.links.map((l) => ({ ...l, safe: safeExternalUrl(l.url) })).filter((l) => l.safe)

  return (
    <div className={`rounded-xl border ${accent} p-3 sm:p-3.5 mb-2`} data-testid="bot-post-block">
      <div className="flex items-start gap-3 mb-2">
        {payload.badge?.kind === 'weather' && (
          <div className="shrink-0 flex flex-col items-center">
            <WeatherGlyph value={payload.badge.value} size={compact ? 40 : 56} />
            <span className="text-[11px] font-semibold text-fg-primary mt-0.5">{payload.badge.label}</span>
          </div>
        )}
        <p className="text-[13px] sm:text-sm text-fg-secondary leading-relaxed">{payload.lead}</p>
      </div>

      {payload.highlights.length > 0 && (
        <ul className="mb-3 space-y-1">
          {(compact ? payload.highlights.slice(0, 3) : payload.highlights).map((h, i) => (
            <li key={i} className="text-[12.5px] text-fg-secondary leading-snug flex gap-1.5">
              <span className="text-fg-muted" aria-hidden>•</span>
              <span>{h}</span>
            </li>
          ))}
        </ul>
      )}

      {payload.chart && <BarChart chart={payload.chart} maxBars={compact ? 6 : undefined} />}
      {tables.map((t, i) => (
        <DataTable key={i} table={t} maxRows={compact ? 5 : undefined} />
      ))}

      {!compact && links.length > 0 && (
        <div className="mb-3">
          <p className="text-[11px] font-semibold text-fg-muted uppercase tracking-wider mb-1.5">Headlines (link to the publisher)</p>
          <ul className="space-y-1">
            {links.map((l) => (
              <li key={l.safe!}>
                <a
                  href={l.safe!}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-start gap-1.5 text-[12.5px] text-fg-secondary hover:text-blue-400"
                >
                  <ExternalLink className="w-3 h-3 mt-0.5 shrink-0" aria-hidden />
                  <span>
                    {l.title} <span className="text-fg-muted">— {l.source || hostOf(l.safe!)}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!compact && payload.notes.map((n, i) => (
        <p key={i} className="text-[11px] italic text-fg-muted mb-1">{n}</p>
      ))}

      <div className="mt-2 pt-2 border-t border-line-subtle text-[10.5px] leading-relaxed text-fg-muted space-y-0.5">
        <p className="flex items-center gap-1 font-medium text-fg-secondary">
          <Bot className="w-3 h-3" aria-hidden />
          {payload.automated_label}
          {payload.bot?.slug && (
            <Link prefetch={false}
              href={botProfileHref(payload.bot.slug)}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-0.5 ml-1 text-blue-400 hover:underline"
            >
              <Info className="w-3 h-3" aria-hidden /> Methodology
            </Link>
          )}
        </p>
        <p><span className="font-medium">Sources:</span> {payload.sources.join('; ')}</p>
        <p><span className="font-medium">As of:</span> {payload.as_of_label}</p>
        <p>{payload.disclaimer}</p>
      </div>
    </div>
  )
}
