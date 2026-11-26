'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Filter, Loader2 } from 'lucide-react'
import AppLayout from '@/components/AppLayout'
import TickerLogo from '@/components/TickerLogo'
import { FLAG_TEXT, METRIC_COLUMNS, nextSort, type SortField } from '@/lib/screener'
import {
  ActiveChips, EmptyState, FilterPanel, Pager, PresetBar, RowActions, asOfText, useRowActions, useScreenerController,
  type ScreenerController,
} from './ScreenerParts'

function SortHeader({ c, field, label, title, align = 'right', className = '' }: {
  c: ScreenerController; field: SortField; label: string; title?: string; align?: 'left' | 'right'; className?: string
}) {
  const active = c.activeSort === field
  const Icon = !active ? ArrowUpDown : c.activeOrder === 'asc' ? ArrowUp : ArrowDown
  return (
    <th
      scope="col"
      aria-sort={active ? (c.activeOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`sticky top-0 z-10 whitespace-nowrap bg-surface-base px-3 py-2.5 font-medium ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
    >
      <button
        type="button"
        title={title}
        onClick={() => c.setState(nextSort(c.state, field, c.activeSort, c.activeOrder))}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-fg-primary ${active ? 'text-indigo-600 dark:text-indigo-400' : ''}`}
      >
        {label}
        <Icon className={`h-3 w-3 ${active ? '' : 'opacity-40'}`} />
      </button>
    </th>
  )
}

export default function ScreenerDesktop() {
  const c = useScreenerController()
  const actions = useRowActions()
  const router = useRouter()

  return (
    <AppLayout>
      <div className="mx-auto max-w-[1600px] px-6 py-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2.5">
              <Filter className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-fg-primary">Stock screener</h1>
              <p className="mt-0.5 text-xs text-fg-muted">
                Filter by valuation, growth, profitability, dividends and trend. The URL saves your screen, so you can share it.
              </p>
            </div>
          </div>
          <p className="text-[11px] text-fg-muted">
            {c.data?.as_of && <>Data as of {asOfText(c.data.as_of)}{c.data.refreshing ? ' · refreshing' : ''} · </>}
            {c.data ? `${c.data.universe.toLocaleString()} stocks covered` : ''}
          </p>
        </div>

        <div className="mb-3"><PresetBar c={c} /></div>

        <div className="flex items-start gap-5">
          <aside className="hud-card sticky top-4 max-h-[calc(100vh-120px)] w-[280px] shrink-0 overflow-y-auto p-4" aria-label="Filters">
            <FilterPanel value={c.state} onChange={c.update} meta={c.meta} />
          </aside>

          <section className="min-w-0 flex-1 space-y-3" aria-label="Results">
            <div className="flex min-h-[28px] items-center justify-between gap-3">
              <ActiveChips c={c} />
              <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-fg-muted">
                {c.fetching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {c.data && `${c.total.toLocaleString()} match${c.total === 1 ? '' : 'es'}`}
              </span>
            </div>

            <div className="hud-card overflow-hidden p-0">
              {c.error ? (
                <div className="flex items-center gap-2 p-6 text-sm text-red-600 dark:text-red-400" role="alert">
                  <AlertTriangle className="h-4 w-4" /> {c.error.message}
                </div>
              ) : c.loading ? (
                <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-fg-muted" /></div>
              ) : c.rows.length === 0 ? (
                <EmptyState c={c} />
              ) : (
                <div className={`max-h-[calc(100vh-260px)] overflow-auto ${c.fetching ? 'opacity-70' : ''}`}>
                  <table className="w-full border-separate border-spacing-0 text-sm">
                    <thead>
                      <tr className="text-[11px] text-fg-muted">
                        <SortHeader c={c} field="symbol" label="Symbol" align="left" className="left-0 z-20 pl-4" />
                        <SortHeader c={c} field="sector" label="Sector" align="left" />
                        {METRIC_COLUMNS.map((col) => (
                          <SortHeader key={col.key} c={c} field={col.sort} label={col.label} title={col.title} />
                        ))}
                        <th scope="col" className="sticky top-0 z-10 bg-surface-base px-3 py-2.5"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.rows.map((r) => {
                        const flagText = r.flags.map((f) => FLAG_TEXT[f] ?? f).join('\n')
                        return (
                          <tr
                            key={r.symbol}
                            onClick={() => router.push(`/research?symbol=${encodeURIComponent(r.symbol)}`)}
                            className="group cursor-pointer hover:bg-surface-raised/60"
                          >
                            <td className="sticky left-0 border-t border-line-subtle bg-surface-base py-2 pl-4 pr-3 group-hover:bg-surface-raised">
                              <Link
                                href={`/research?symbol=${encodeURIComponent(r.symbol)}`}
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-2"
                              >
                                <TickerLogo symbol={r.symbol} size={24} />
                                <span className="min-w-0">
                                  <span className="flex items-center gap-1 font-semibold text-fg-primary">
                                    {r.symbol}
                                    {r.flags.length > 0 && (
                                      <span title={flagText} aria-label={flagText}>
                                        <AlertTriangle className="h-3 w-3 text-amber-500" />
                                      </span>
                                    )}
                                  </span>
                                  <span className="block max-w-[150px] truncate text-[11px] text-fg-muted">{r.name ?? ''}</span>
                                </span>
                              </Link>
                            </td>
                            <td className="max-w-[140px] truncate border-t border-line-subtle px-3 py-2 text-xs text-fg-secondary">{r.sector ?? '—'}</td>
                            {METRIC_COLUMNS.map((col) => (
                              <td
                                key={col.key}
                                className={`whitespace-nowrap border-t border-line-subtle px-3 py-2 text-right tabular-nums ${col.tone ? col.tone(r) : 'text-fg-primary'} ${c.activeSort === col.sort ? 'bg-indigo-500/[0.04]' : ''}`}
                              >
                                {col.format(r)}
                              </td>
                            ))}
                            <td className="border-t border-line-subtle px-2 py-2">
                              <RowActions symbol={r.symbol} actions={actions} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <Pager c={c} />
            <p className="text-[11px] leading-relaxed text-fg-muted">
              “—” means we don’t have that number; such stocks never match a filter on it. Values that fail a sanity check
              (for example ROE beyond ±1000%) are hidden and marked <AlertTriangle className="inline h-3 w-3 text-amber-500" />.
              Fundamentals come from company filings and data providers and can lag; technicals use daily closes.
              For research only, not investment advice.
            </p>
          </section>
        </div>
      </div>
    </AppLayout>
  )
}
