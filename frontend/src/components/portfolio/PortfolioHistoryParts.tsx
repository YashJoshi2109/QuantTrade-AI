'use client'

/**
 * Performance history panel and CSV trade import form, shared by the desktop
 * and mobile Portfolio views (containers differ, contents do not).
 */
import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, FileUp, Info, Loader2, RefreshCw } from 'lucide-react'
import NormalizedLineChart, { fmtPctValue } from '@/components/charts/NormalizedLineChart'
import { useToast } from '@/components/Toast'
import { fmtMoney, pnlClass, portfolioKeys } from '@/lib/portfolio'
import {
  HISTORY_RANGES,
  IMPORT_TEMPLATE,
  ImportRejected,
  RANGE_LABEL,
  checkImportFile,
  describeImportRow,
  excessReturn,
  historyApi,
  historyKeys,
  historySeries,
  startsAfterFirstTrade,
  type HistoryRange,
  type ImportPreview,
} from '@/lib/portfolioHistory'
import { SimulatedBadge } from './PortfolioParts'

const RANGE_KEY = 'qt.portfolio.historyRange'

/** 'YYYY-MM-DD' as a calendar day (no timezone shift). */
function fmtIsoDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function savedRange(): HistoryRange {
  try {
    const v = window.localStorage.getItem(RANGE_KEY) as HistoryRange | null
    return v && (HISTORY_RANGES as readonly string[]).includes(v) ? v : '1Y'
  } catch {
    return '1Y'
  }
}

export function PerformancePanel({
  portfolioId,
  simulated,
  compact = false,
}: {
  portfolioId: number
  simulated: boolean
  compact?: boolean
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [range, setRangeState] = useState<HistoryRange>(() => (typeof window === 'undefined' ? '1Y' : savedRange()))
  const setRange = (r: HistoryRange) => {
    setRangeState(r)
    try {
      window.localStorage.setItem(RANGE_KEY, r)
    } catch {
      /* not remembered */
    }
  }
  const q = useQuery({
    queryKey: historyKeys.range(portfolioId, range),
    queryFn: () => historyApi.get(portfolioId, range),
    staleTime: 5 * 60_000,
  })
  const rebuild = useMutation({
    mutationFn: () => historyApi.backfill(portfolioId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: historyKeys.all(portfolioId) })
      toast.success('History rebuilt from your transactions')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Rebuild failed'),
  })
  const h = q.data
  const { dates, series } = historySeries(h)
  const st = h?.stats
  const excess = excessReturn(st)

  const tiles = [
    { label: 'Time-weighted return', value: fmtPctValue(st?.twr_percent), cls: pnlClass(st?.twr_percent) },
    { label: 'Max drawdown', value: fmtPctValue(st?.max_drawdown_percent), cls: st?.max_drawdown_percent ? 'text-red-600 dark:text-red-400' : 'text-fg-primary' },
    { label: h?.benchmark ?? 'SPY', value: fmtPctValue(st?.benchmark_return_percent), cls: pnlClass(st?.benchmark_return_percent) },
    { label: 'vs SPY', value: excess == null ? '—' : `${excess > 0 ? '+' : excess < 0 ? '−' : ''}${Math.abs(excess).toFixed(2)} pts`, cls: pnlClass(excess) },
  ]

  return (
    <section className={compact ? 'rounded-2xl border border-line-subtle bg-surface-raised p-3' : 'hud-card p-4'} aria-label="Performance history">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-fg-primary">Performance</h3>
          {simulated && <SimulatedBadge />}
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Range">
          {HISTORY_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={r === range}
              onClick={() => setRange(r)}
              className={`rounded-md px-2 py-1 text-[11px] font-semibold tabular-nums transition-colors ${
                r === range
                  ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400'
                  : 'text-fg-muted hover:bg-surface-raised hover:text-fg-primary'
              }`}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      <div className={`mb-3 grid gap-2 ${compact ? 'grid-cols-[repeat(2,minmax(0,1fr))]' : 'grid-cols-[repeat(2,minmax(0,1fr))] lg:grid-cols-4'}`}>
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border border-line-subtle px-2.5 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-fg-muted">{t.label}</p>
            <p className={`mt-0.5 text-base font-bold tabular-nums ${t.cls}`}>{q.isLoading ? '…' : t.value}</p>
          </div>
        ))}
      </div>

      {q.isLoading ? (
        <div className="flex items-center justify-center" style={{ height: compact ? 200 : 260 }}>
          <Loader2 className="h-5 w-5 animate-spin text-fg-muted" />
        </div>
      ) : q.error ? (
        <p className="py-10 text-center text-sm text-red-500">{(q.error as Error).message}</p>
      ) : dates.length < 2 ? (
        <p className="py-10 text-center text-sm text-fg-muted">
          {dates.length === 0
            ? simulated ? 'No history yet. Place a simulated order to start the curve.' : 'No history yet. Add a transaction or import a CSV to build the curve.'
            : 'Only one day of history so far. The curve appears after the next close.'}
        </p>
      ) : (
        <NormalizedLineChart
          dates={dates}
          series={series}
          height={compact ? 200 : 260}
          ariaLabel={`Portfolio return versus ${h?.benchmark ?? 'SPY'}, ${RANGE_LABEL[range]}`}
        />
      )}

      <div className="mt-2 flex flex-wrap items-start justify-between gap-2 text-[11px] text-fg-muted">
        <p className="flex max-w-xl items-start gap-1.5">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>
            Time-weighted from daily closes{simulated ? ' of a simulated account' : ''}: {simulated ? 'virtual cash is part of the account.' : 'buys and sells are treated as deposits and withdrawals, so adding money is not counted as a gain.'}
            {st?.start && st.end ? ` ${fmtMoney(st.start_value)} → ${fmtMoney(st.end_value)}.` : ''}
          </span>
        </p>
        <button
          type="button"
          onClick={() => rebuild.mutate()}
          disabled={rebuild.isPending}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-fg-secondary hover:bg-surface-raised hover:text-fg-primary disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${rebuild.isPending ? 'animate-spin' : ''}`} aria-hidden /> Rebuild
        </button>
      </div>
      {h && h.missing_symbols.length > 0 && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          No stored daily closes for {h.missing_symbols.join(', ')} on some days; those holdings are counted at cost there.
        </p>
      )}
      {startsAfterFirstTrade(h) && (
        <p className="mt-1.5 text-[11px] text-fg-muted">
          Daily closes for these holdings are stored from {fmtIsoDay(h!.coverage_start!)}; trades before that are included in the starting value.
        </p>
      )}
      {h && !h.benchmark_available && dates.length > 0 && (
        <p className="mt-1.5 text-[11px] text-fg-muted">SPY closes are not stored for this range, so the benchmark line is hidden.</p>
      )}
    </section>
  )
}

/** Upload or paste a CSV, review every row, then commit all or nothing. */
export function ImportTradesForm({ portfolioId, onDone }: { portfolioId: number; onDone: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [previewFor, setPreviewFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const check = useMutation({
    mutationFn: () => historyApi.importPreview(portfolioId, text),
    onSuccess: (p) => {
      setPreview(p)
      setPreviewFor(text)
      setError(null)
    },
    onError: (e) => {
      setPreview(null)
      setError(e instanceof Error ? e.message : 'Could not read the file')
    },
  })
  const commit = useMutation({
    mutationFn: () => historyApi.importCommit(portfolioId, text),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: portfolioKeys.list })
      qc.invalidateQueries({ queryKey: portfolioKeys.detail(portfolioId) })
      toast.success(`Imported ${r.imported} transaction${r.imported === 1 ? '' : 's'}`)
      onDone()
    },
    onError: (e) => {
      if (e instanceof ImportRejected && e.preview) setPreview(e.preview)
      setError(e instanceof Error ? e.message : 'Import failed')
    },
  })

  const onFile = async (f: File | undefined) => {
    if (!f) return
    const bad = checkImportFile(f)
    if (bad) {
      setError(bad)
      return
    }
    setFileName(f.name)
    setText(await f.text())
    setPreview(null)
    setError(null)
  }

  const stale = preview != null && previewFor !== text
  const canCommit = !!preview?.can_commit && !stale && !commit.isPending

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-fg-muted">
        Columns: <code className="text-fg-secondary">date, symbol, type, quantity, price</code> (optional <code className="text-fg-secondary">fees, amount, notes</code>).
        Type is BUY, SELL or DIVIDEND. Nothing is saved until you confirm, and a file with any error is rejected as a whole.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line-default px-3 py-1.5 text-xs font-medium text-fg-secondary hover:bg-surface-raised hover:text-fg-primary"
        >
          <FileUp className="h-3.5 w-3.5" /> Choose CSV
        </button>
        <button
          type="button"
          onClick={() => { setText(IMPORT_TEMPLATE); setFileName(null); setPreview(null) }}
          className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Use example
        </button>
        {fileName && <span className="truncate text-xs text-fg-muted">{fileName}</span>}
      </div>
      <label className="block">
        <span className="sr-only">CSV contents</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          spellCheck={false}
          placeholder={'date,symbol,type,quantity,price\n2026-01-05,AAPL,BUY,10,185.20'}
          className="w-full rounded-lg border border-line-default bg-surface-base px-3 py-2 font-mono text-xs text-fg-primary placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
        />
      </label>

      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      {preview && (
        <div className="space-y-2">
          <p className="text-xs text-fg-secondary">
            <strong className="text-fg-primary">{preview.summary.valid}</strong> of {preview.summary.total} rows valid
            {' · '}{preview.summary.buys} buys, {preview.summary.sells} sells, {preview.summary.dividends} dividends
            {preview.summary.errors > 0 && <span className="text-red-600 dark:text-red-400"> · {preview.summary.errors} with errors</span>}
            {preview.summary.warnings > 0 && <span className="text-amber-600 dark:text-amber-400"> · {preview.summary.warnings} warnings</span>}
          </p>
          {preview.ledger_error && <p className="text-xs text-red-600 dark:text-red-400">{preview.ledger_error}</p>}
          <div className="max-h-64 overflow-auto rounded-lg border border-line-subtle">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-base">
                <tr className="text-left text-[10px] uppercase tracking-wide text-fg-muted">
                  <th className="px-2 py-1.5 font-medium">Line</th>
                  <th className="px-2 py-1.5 font-medium">Date</th>
                  <th className="px-2 py-1.5 font-medium">Symbol</th>
                  <th className="px-2 py-1.5 font-medium">Trade</th>
                  <th className="px-2 py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.row} className={`border-t border-line-subtle align-top ${r.status === 'error' ? 'bg-red-500/[0.06]' : ''}`}>
                    <td className="px-2 py-1.5 tabular-nums text-fg-muted">{r.row}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-fg-secondary">{r.date ?? '—'}</td>
                    <td className="px-2 py-1.5 font-semibold text-fg-primary">{r.symbol ?? '—'}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-fg-secondary">{describeImportRow(r)}</td>
                    <td className="px-2 py-1.5">
                      {r.status === 'error' ? (
                        <span className="text-red-600 dark:text-red-400">{r.errors.join('; ')}</span>
                      ) : r.warnings.length ? (
                        <span className="text-amber-600 dark:text-amber-400">{r.warnings.join('; ')}</span>
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-label="OK" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={() => check.mutate()}
          disabled={!text.trim() || check.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line-default px-3.5 py-2 text-sm font-medium text-fg-secondary hover:bg-surface-raised hover:text-fg-primary disabled:opacity-50"
        >
          {check.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {preview && !stale ? 'Check again' : 'Preview'}
        </button>
        <button
          type="button"
          onClick={() => commit.mutate()}
          disabled={!canCommit}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-[#fff] hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {commit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Import {preview?.can_commit && !stale ? preview.summary.valid : ''} transactions
        </button>
      </div>
      {stale && <p className="text-right text-[11px] text-fg-muted">The text changed since the preview. Preview again before importing.</p>}
    </div>
  )
}
