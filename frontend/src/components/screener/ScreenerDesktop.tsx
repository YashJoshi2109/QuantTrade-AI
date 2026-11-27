'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronsLeft, ChevronsRight, Filter, Loader2, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { SkeletonDataTable } from '@/components/ui/data-skeletons'
import AppLayout from '@/components/AppLayout'
import TickerLogo from '@/components/TickerLogo'
import ForecastBadge from '@/components/forecast/ForecastBadge'
import { useForecastSummaries } from '@/lib/useForecastSummaries'
import { isBool, usePersistentState } from '@/lib/persistentState'
import { DASH, activeFilterCount, nextSort, viewColumns, type ScreenerRow, type SortField } from '@/lib/screener'
import {
  Breadcrumb, EmptyState, ErrorState, FilterPanel, FlagIcon, LEGEND, MetricValue, Pager, PresetBar, SOLID, ScreenSummary,
  SecurityOverview, Sheet, StatCards, SUBTITLE, ViewTabs, useFilterDraft, usePanelCollapsed, useRowActions, useScreenerController,
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
      className={`sticky top-0 z-10 whitespace-nowrap border-b border-line-default px-2 py-2.5 font-medium ${SOLID} ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
    >
      <button
        type="button"
        title={title}
        onClick={() => c.setState(nextSort(c.state, field, c.activeSort, c.activeOrder))}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-fg-primary ${active ? 'font-semibold text-indigo-600 dark:text-indigo-400' : ''}`}
      >
        {label}
        <Icon className={`h-3 w-3 ${active ? '' : 'opacity-40'}`} />
      </button>
    </th>
  )
}

function FiltersAside({ c }: { c: ScreenerController }) {
  const d = useFilterDraft(c)
  const [collapsed, setCollapsed] = usePanelCollapsed()
  const n = activeFilterCount(c.state)

  if (collapsed) {
    return (
      <aside className="rs-card sticky top-4 flex w-12 shrink-0 flex-col items-center gap-3 py-3" aria-label="Filters (collapsed)">
        <button type="button" onClick={() => setCollapsed(false)} aria-label="Expand filter panel" title="Expand filters" className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg-primary">
          <ChevronsRight className="h-4 w-4" />
        </button>
        <SlidersHorizontal className="h-4 w-4 text-fg-muted" aria-hidden />
        {n > 0 && <span className="rounded-full bg-indigo-600 px-1.5 text-[10px] font-bold text-[#fff]" title={`${n} active filter${n === 1 ? '' : 's'}`}>{n}</span>}
      </aside>
    )
  }

  return (
    <aside className="rs-card sticky top-4 flex max-h-[calc(100vh-32px)] w-[272px] shrink-0 flex-col overflow-hidden" aria-label="Filters">
      <div className="flex items-center justify-between border-b border-line-subtle px-4 py-3">
        <h2 className="text-sm font-semibold text-fg-primary">Filters</h2>
        <button type="button" onClick={d.resetAll} className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
          <RotateCcw className="h-3 w-3" /> Reset all
        </button>
      </div>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => { e.preventDefault(); d.apply() }}
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3">
          <FilterPanel value={d.draft} onChange={d.update} meta={c.meta} />
        </div>
        <div className="flex items-center gap-2 border-t border-line-subtle px-3 py-3">
          <button type="button" onClick={() => setCollapsed(true)} aria-label="Collapse filter panel" title="Collapse filters" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line-default text-fg-muted hover:text-fg-primary">
            <ChevronsLeft className="h-4 w-4" />
          </button>
          <button
            type="submit"
            disabled={!d.dirty}
            className="h-9 flex-1 rounded-lg bg-indigo-600 text-sm font-semibold text-[#fff] hover:bg-indigo-500 disabled:opacity-50"
          >
            Apply filters
          </button>
        </div>
      </form>
    </aside>
  )
}

export default function ScreenerDesktop() {
  const c = useScreenerController()
  const actions = useRowActions()
  const [selected, setSelected] = useState<ScreenerRow | null>(null)
  // Optional 1-month forecast column. Cache-only (warm: false): paging through
  // the screener must not start a model fit per row.
  const [showForecast, setShowForecast] = usePersistentState('screener.forecastColumn', false, { validate: isBool })
  const forecasts = useForecastSummaries(c.rows.map((r) => r.symbol), { enabled: showForecast, warm: false })
  const cols = viewColumns(c.view)

  return (
    <AppLayout>
      <div className="mx-auto max-w-[1600px] space-y-5 px-6 py-6">
        <header>
          <Breadcrumb />
          <div className="mt-2 flex items-center gap-3">
            <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-2.5">
              <Filter className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-fg-primary">Stock screener</h1>
              <p className="mt-0.5 text-sm text-fg-muted">{SUBTITLE}</p>
            </div>
          </div>
        </header>

        <StatCards c={c} />
        <PresetBar c={c} />

        <div className="flex items-start gap-4">
          <FiltersAside c={c} />

          <section className="min-w-0 flex-1 space-y-2" aria-label="Results">
            <div className="rs-card overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-3 px-4 pb-2 pt-4">
                <div className="min-w-0">
                  <h2 className="flex items-baseline gap-2 text-base font-semibold text-fg-primary">
                    Screening results
                    <span className="text-sm font-normal tabular-nums text-fg-muted">{c.data ? c.total.toLocaleString('en-US') : ''}</span>
                    {c.fetching && <Loader2 className="h-3.5 w-3.5 animate-spin self-center text-fg-muted" aria-label="Updating" />}
                  </h2>
                  <ScreenSummary c={c} className="mt-0.5" />
                </div>
                <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-fg-secondary" title="Statistical 80% price range in 1 month (experimental). Shown where already computed.">
                  <input type="checkbox" checked={showForecast} onChange={(e) => setShowForecast(e.target.checked)} className="h-3.5 w-3.5 accent-indigo-600" />
                  1M forecast range
                </label>
              </div>
              <div className="border-b border-line-subtle px-3 pb-2"><ViewTabs c={c} /></div>

              {c.error ? (
                <ErrorState c={c} />
              ) : c.loading ? (
                <SkeletonDataTable rows={12} columns={cols.length + 2} rowHeight={53} />
              ) : c.rows.length === 0 ? (
                <EmptyState c={c} />
              ) : (
                <div className={`max-h-[calc(100vh-200px)] overflow-auto ${c.fetching ? 'opacity-70' : ''}`}>
                  <table className="w-full border-separate border-spacing-0 text-sm">
                    <thead>
                      <tr className="text-[11px] text-fg-muted">
                        <SortHeader c={c} field="symbol" label="Symbol / Company" align="left" className="left-0 z-20 pl-4" />
                        <SortHeader c={c} field="sector" label="Sector" align="left" />
                        {cols.map((col) => (
                          <SortHeader key={col.key} c={c} field={col.sort} label={col.label === '1D' || col.label === '1M' ? `${col.label} %` : col.label} title={col.title} />
                        ))}
                        {showForecast && (
                          <th scope="col" className={`sticky top-0 z-10 whitespace-nowrap border-b border-line-default px-3 py-2.5 text-right font-medium uppercase tracking-wide ${SOLID}`} title="Statistical 80% price range in 1 month and how often past ranges held. Experimental, not investment advice. “—” = not computed yet; open Research to compute.">
                            1M range
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {c.rows.map((r) => {
                        const isSel = selected?.symbol === r.symbol
                        const rowBg = isSel ? 'bg-indigo-50 dark:bg-[#1a2140]' : `${SOLID} group-hover:bg-slate-50 dark:group-hover:bg-[#141b28]`
                        return (
                          <tr
                            key={r.symbol}
                            onClick={() => setSelected(r)}
                            aria-selected={isSel}
                            className={`group cursor-pointer ${isSel ? 'bg-indigo-50 dark:bg-[#1a2140]' : 'hover:bg-slate-50 dark:hover:bg-[#141b28]'}`}
                          >
                            <td className={`sticky left-0 border-b border-line-subtle py-2 pl-4 pr-3 ${rowBg} ${isSel ? 'shadow-[inset_3px_0_0_rgb(99,102,241)]' : ''}`}>
                              <button type="button" className="flex items-center gap-2.5 text-left" aria-label={`Open overview of ${r.symbol}`}>
                                <TickerLogo symbol={r.symbol} companyName={r.name} size={26} />
                                <span className="min-w-0">
                                  <span className="flex items-center gap-1 font-semibold text-fg-primary">{r.symbol} <FlagIcon r={r} /></span>
                                  <span className="block max-w-[118px] truncate text-[11px] text-fg-muted">{r.name ?? ''}</span>
                                </span>
                              </button>
                            </td>
                            <td className="max-w-[108px] truncate border-b border-line-subtle px-2 py-2 text-xs text-fg-secondary" title={r.industry ?? undefined}>
                              {r.sector ?? <span title="Sector unavailable" className="text-fg-muted">{DASH}</span>}
                            </td>
                            {cols.map((col) => (
                              <td
                                key={col.key}
                                className={`whitespace-nowrap border-b border-line-subtle px-2 py-2 text-right tabular-nums ${c.activeSort === col.sort ? 'bg-indigo-500/[0.06]' : ''}`}
                              >
                                <MetricValue r={r} col={col} />
                              </td>
                            ))}
                            {showForecast && (
                              <td className="border-b border-line-subtle px-3 py-2" onClick={(e) => e.stopPropagation()}>
                                <ForecastBadge symbol={r.symbol} item={forecasts.byTicker[r.symbol.toUpperCase()]} loading={forecasts.isLoading} h={20} price={r.price} />
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <Pager c={c} className="border-t border-line-subtle px-4 py-2.5" />
            </div>
            <p className="px-1 text-[11px] leading-relaxed text-fg-muted">
              {LEGEND} Values that fail a sanity check are hidden and flagged. For research only, not investment advice.
            </p>
          </section>
        </div>
      </div>

      <Sheet open={!!selected} onClose={() => setSelected(null)} side="right" label={selected ? `${selected.symbol} overview` : 'Security overview'}>
        {selected && <SecurityOverview r={selected} actions={actions} onClose={() => setSelected(null)} />}
      </Sheet>
    </AppLayout>
  )
}
