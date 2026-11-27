'use client'

/**
 * /compare body, shared by desktop (AppLayout) and mobile (MobileLayout).
 * `variant` only changes density; data, rows, ranking and copy are identical.
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQueries, useQuery } from '@tanstack/react-query'
import { ArrowUpRight, GitCompareArrows, Loader2, Plus, Search, X } from 'lucide-react'
import NormalizedLineChart from '@/components/charts/NormalizedLineChart'
import TickerLogo from '@/components/TickerLogo'
import { searchSymbols, type SearchResult } from '@/lib/api'
import { EXPERIMENTAL_LABEL } from '@/lib/forecastHonesty'
import { oneOf, usePersistentState } from '@/lib/persistentState'
import { lastValue } from '@/lib/lineChart'
import {
  COMPARE_COLORS,
  MAX_COMPARE,
  METRIC_GROUPS,
  MIN_COMPARE,
  PERF_RANGES,
  alignNormalised,
  buildRows,
  compareHref,
  forecastCell,
  loadCloses,
  loadForecast,
  loadSnapshot,
  rangeStartDate,
  type PerfRange,
} from '@/lib/compare'

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const QUICK_SETS = [
  ['AAPL', 'MSFT', 'GOOGL'],
  ['NVDA', 'AMD', 'INTC'],
  ['JPM', 'BAC', 'WFC'],
  ['KO', 'PEP'],
]

export default function CompareView({ symbols, variant }: { symbols: string[]; variant: 'desktop' | 'mobile' }) {
  const router = useRouter()
  const mobile = variant === 'mobile'
  const [range, setRange] = usePersistentState<PerfRange>('compare.range', '1Y', { version: 1, validate: oneOf(PERF_RANGES) })

  const setSymbols = (next: string[]) => router.replace(compareHref(next), { scroll: false })
  const add = (sym: string) => {
    const s = sym.trim().toUpperCase()
    if (!s || symbols.includes(s) || symbols.length >= MAX_COMPARE) return
    setSymbols([...symbols, s])
  }
  const remove = (sym: string) => setSymbols(symbols.filter((s) => s !== sym))

  const snaps = useQueries({
    queries: symbols.map((s) => ({
      queryKey: ['compare', 'snapshot', s],
      queryFn: () => loadSnapshot(s),
      staleTime: 60_000,
    })),
  })
  const forecasts = useQueries({
    queries: symbols.map((s) => ({
      queryKey: ['compare', 'forecast', s],
      queryFn: () => loadForecast(s),
      staleTime: 30 * 60_000,
      retry: 0,
    })),
  })
  const start = useMemo(() => rangeStartDate(range), [range])
  const closes = useQueries({
    queries: symbols.map((s) => ({
      queryKey: ['compare', 'closes', s, range],
      queryFn: () => loadCloses(s, start),
      staleTime: 10 * 60_000,
    })),
  })

  const closesReady = closes.every((q) => !q.isLoading)
  const chart = useMemo(() => {
    if (!closesReady) return null
    const by: Record<string, { timestamp: string; close: number }[]> = {}
    symbols.forEach((s, i) => (by[s] = closes[i].data ?? []))
    const startIso = start.toISOString().slice(0, 10)
    const { dates, values, commonStart } = alignNormalised(by, symbols, startIso)
    return {
      dates,
      lateStart: commonStart && dates.length && dates[0] > addDays(startIso, 7) ? dates[0] : null,
      series: symbols.map((s, i) => ({ key: s, label: s, values: values[s], color: COMPARE_COLORS[i % COMPARE_COLORS.length] })),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closesReady, symbols.join(','), range, closes.map((q) => q.dataUpdatedAt).join(',')])

  const rows = useMemo(() => buildRows(snaps.map((q) => q.data ?? null)), [snaps])
  const loadingAny = snaps.some((q) => q.isLoading)
  const cell = mobile ? 'px-2 py-2' : 'px-3 py-2.5'
  const card = mobile ? 'rounded-2xl border border-line-subtle bg-surface-raised' : 'hud-card'

  return (
    <div className={mobile ? 'space-y-3 pt-3' : 'mx-auto max-w-[1280px] space-y-5 px-6 py-6'}>
      <div className="flex items-center gap-3">
        <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-2.5">
          <GitCompareArrows className="h-5 w-5 text-indigo-500" aria-hidden />
        </div>
        <div className="min-w-0">
          <h1 className={`${mobile ? 'text-lg' : 'text-2xl'} font-bold text-fg-primary`}>Compare stocks</h1>
          <p className="mt-0.5 text-xs text-fg-muted">
            Up to {MAX_COMPARE} tickers side by side. Best value in each row is green, worst is red. Share the page URL to share the comparison.
          </p>
        </div>
      </div>

      <SymbolPicker symbols={symbols} onAdd={add} onRemove={remove} mobile={mobile} />

      {symbols.length < MIN_COMPARE ? (
        <div className={`${card} p-5 text-center`}>
          <p className="text-sm font-semibold text-fg-primary">
            {symbols.length === 0 ? 'Add two to four tickers to compare' : `Add at least one more ticker to compare with ${symbols[0]}`}
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {QUICK_SETS.map((set) => (
              <Link
                key={set.join()}
                href={compareHref(Array.from(new Set([...symbols, ...set])).slice(0, MAX_COMPARE))}
                className="rounded-full border border-line-default px-3 py-1 text-xs font-medium text-fg-secondary hover:border-indigo-500/40 hover:text-fg-primary"
              >
                {set.join(' vs ')}
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <>
          <section className={`${card} p-4`} aria-label="Price performance">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-fg-primary">Price performance</h2>
              <div className="flex items-center gap-1" role="group" aria-label="Range">
                {PERF_RANGES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={r === range}
                    onClick={() => setRange(r)}
                    className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                      r === range ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400' : 'text-fg-muted hover:bg-surface-raised hover:text-fg-primary'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            {!chart ? (
              <div className="flex items-center justify-center" style={{ height: mobile ? 220 : 280 }}>
                <Loader2 className="h-5 w-5 animate-spin text-fg-muted" />
              </div>
            ) : chart.dates.length < 2 ? (
              <p className="py-12 text-center text-sm text-fg-muted">No daily prices stored for this range yet.</p>
            ) : (
              <>
                <NormalizedLineChart
                  dates={chart.dates}
                  series={chart.series}
                  height={mobile ? 220 : 280}
                  ariaLabel={`Normalised price performance, ${range}: ${symbols.join(', ')}`}
                />
                <p className="mt-2 text-[11px] text-fg-muted">
                  % change from the first daily close all tickers share in the range (price only, dividends excluded).
                  {chart.lateStart && ` Starts ${chart.lateStart}: stored prices for at least one ticker begin then.`}
                  {chart.series.some((s) => lastValue(s.values) == null) &&
                    ` No prices for ${chart.series.filter((s) => lastValue(s.values) == null).map((s) => s.key).join(', ')}.`}
                </p>
              </>
            )}
          </section>

          <section className={`${card} overflow-hidden p-0`} aria-label="Side-by-side metrics">
            <div className="overflow-x-auto">
              <table className={`w-full ${mobile ? 'text-xs' : 'text-sm'}`}>
                <thead>
                  <tr className="border-b border-line-subtle">
                    <th className={`sticky left-0 z-10 bg-surface-base text-left text-[11px] font-medium uppercase tracking-wide text-fg-muted ${cell} ${mobile ? 'min-w-[112px]' : 'min-w-[180px]'}`}>
                      Metric
                    </th>
                    {symbols.map((s, i) => {
                      const snap = snaps[i]?.data
                      return (
                        <th key={s} className={`${cell} text-right align-bottom ${mobile ? 'min-w-[92px]' : 'min-w-[150px]'}`}>
                          <div className="flex items-center justify-end gap-1.5">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: COMPARE_COLORS[i] }} aria-hidden />
                            {!mobile && <TickerLogo symbol={s} size={20} />}
                            <Link prefetch={false} href={`/research?symbol=${s}`} className="font-semibold text-fg-primary hover:underline">
                              {s}
                            </Link>
                          </div>
                          <p className="truncate text-[10px] font-normal text-fg-muted" title={snap?.name ?? undefined}>
                            {snaps[i]?.isLoading ? 'Loading…' : snap?.name ?? '—'}
                          </p>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {METRIC_GROUPS.map((g) => (
                    <GroupRows key={g} group={g} rows={rows.filter((r) => r.def.group === g)} cell={cell} cols={symbols.length} loading={loadingAny} />
                  ))}
                  <tr className="bg-surface-raised/40">
                    <td colSpan={symbols.length + 1} className={`${cell} text-[10px] font-semibold uppercase tracking-wide text-fg-muted`}>
                      Statistical forecast, 20 trading days{' '}
                      <span className="ml-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 normal-case tracking-normal text-amber-600 dark:text-amber-400">
                        {EXPERIMENTAL_LABEL}
                      </span>
                    </td>
                  </tr>
                  <tr className="border-t border-line-subtle">
                    <td className={`sticky left-0 z-10 bg-surface-base text-fg-secondary ${cell}`}>Expected move</td>
                    {symbols.map((s, i) => {
                      const q = forecasts[i]
                      const f = forecastCell(q?.data)
                      return (
                        <td key={s} className={`${cell} text-right tabular-nums text-fg-primary`}>
                          {q?.isLoading ? <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-fg-muted" /> : f.main}
                          {f.sub && <span className="block text-[10px] text-fg-muted">{f.sub}</span>}
                        </td>
                      )
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
            <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-subtle ${mobile ? 'px-2 py-2' : 'px-4 py-2.5'} text-[11px] text-fg-muted`}>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/25 ring-1 ring-emerald-500/40" /> Best in row</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-red-500/20 ring-1 ring-red-500/40" /> Worst in row</span>
              <span>Rows without a clear direction (price, market cap, RSI, target, forecast) are not ranked. — means no data.</span>
            </div>
          </section>

          <div className="flex flex-wrap gap-2">
            {symbols.map((s) => (
              <Link prefetch={false}
                key={s}
                href={`/research?symbol=${s}`}
                className="inline-flex items-center gap-1 rounded-lg border border-line-default px-3 py-1.5 text-xs font-medium text-fg-secondary hover:bg-surface-raised hover:text-fg-primary"
              >
                Research {s} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function GroupRows({
  group,
  rows,
  cell,
  cols,
  loading,
}: {
  group: string
  rows: ReturnType<typeof buildRows>
  cell: string
  cols: number
  loading: boolean
}) {
  return (
    <>
      <tr className="bg-surface-raised/40">
        <td colSpan={cols + 1} className={`${cell} text-[10px] font-semibold uppercase tracking-wide text-fg-muted`}>{group}</td>
      </tr>
      {rows.map((r) => (
        <tr key={r.def.key} className="border-t border-line-subtle">
          <td className={`sticky left-0 z-10 bg-surface-base text-fg-secondary ${cell}`} title={r.def.hint}>
            {r.def.label}
          </td>
          {r.display.map((d, i) => {
            const tone =
              i === r.best
                ? 'bg-emerald-500/10 font-semibold text-emerald-700 dark:text-emerald-400'
                : i === r.worst
                  ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                  : 'text-fg-primary'
            return (
              <td
                key={i}
                className={`${cell} text-right tabular-nums ${tone}`}
                aria-label={i === r.best ? `${d}, best` : i === r.worst ? `${d}, worst` : undefined}
              >
                {loading && r.values[i] == null ? <span className="text-fg-muted">…</span> : d}
              </td>
            )
          })}
        </tr>
      ))}
    </>
  )
}

function SymbolPicker({
  symbols,
  onAdd,
  onRemove,
  mobile,
}: {
  symbols: string[]
  onAdd: (s: string) => void
  onRemove: (s: string) => void
  mobile: boolean
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const full = symbols.length >= MAX_COMPARE
  const { data: results = [], isFetching } = useQuery<SearchResult[]>({
    queryKey: ['compare', 'search', q.trim()],
    queryFn: () => searchSymbols(q, 6),
    enabled: open && q.trim().length > 0 && !full,
    staleTime: 60_000,
  })
  const pick = (s: string) => {
    onAdd(s)
    setQ('')
    setOpen(false)
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {symbols.map((s, i) => (
        <span
          key={s}
          className="inline-flex items-center gap-1.5 rounded-full border border-line-default bg-surface-raised py-1 pl-2.5 pr-1 text-sm font-semibold text-fg-primary"
        >
          <span className="h-2 w-2 rounded-full" style={{ background: COMPARE_COLORS[i] }} aria-hidden />
          {s}
          <button
            type="button"
            onClick={() => onRemove(s)}
            aria-label={`Remove ${s}`}
            className="rounded-full p-0.5 text-fg-muted hover:bg-surface-hover hover:text-fg-primary"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
      {!full && (
        <div className={`relative ${mobile ? 'w-full' : 'w-64'}`}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const exact = results.find((r) => r.symbol.toUpperCase() === q.trim().toUpperCase())
              pick(exact?.symbol ?? results[0]?.symbol ?? q)
            }}
            className="flex items-center gap-1.5 rounded-lg border border-line-default bg-surface-base px-2.5 py-1.5"
          >
            <Search className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setOpen(true) }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              placeholder={symbols.length ? 'Add ticker…' : 'Ticker, e.g. AAPL'}
              aria-label="Add ticker to compare"
              className="min-w-0 flex-1 bg-transparent text-sm text-fg-primary placeholder:text-fg-muted focus:outline-none"
            />
            {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-muted" /> : (
              <button type="submit" aria-label="Add" className="text-fg-muted hover:text-fg-primary"><Plus className="h-4 w-4" /></button>
            )}
          </form>
          {open && q.trim() && results.length > 0 && (
            <ul className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-lg border border-line-default bg-surface-overlay shadow-xl" role="listbox" style={{ background: 'var(--surface-overlay, var(--surface-base))' }}>
              {results.map((r) => (
                <li key={r.symbol}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(r.symbol)}
                    disabled={symbols.includes(r.symbol.toUpperCase())}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover disabled:opacity-50"
                  >
                    <span className="font-semibold text-fg-primary">{r.symbol}</span>
                    <span className="truncate text-xs text-fg-muted">{r.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {full && <span className="text-xs text-fg-muted">Maximum {MAX_COMPARE} tickers</span>}
    </div>
  )
}
