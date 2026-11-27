'use client'

/**
 * Shared by ScreenerDesktop and ScreenerMobile: URL-synced controller, filter
 * panel, preset bar, filter chips, row actions and pager.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { BellPlus, Check, ChevronLeft, ChevronRight, Loader2, Plus, RotateCcw, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/Toast'
import { addToWatchlist } from '@/lib/api'
import { usePersistedQuery } from '@/lib/persistedQuery'
import {
  EMPTY_STATE,
  PAGE_SIZE,
  RANGE_FILTERS,
  SMA_FILTERS,
  applyPreset,
  describePreset,
  filterChips,
  parseScreenerParams,
  removeChip,
  setRange,
  toSearchParams,
  useScreener,
  useScreenerMeta,
  validateRangeInput,
  type PresetId,
  type RangeKey,
  type RangeSpec,
  type ScreenerMeta,
  type ScreenerState,
  type SmaDir,
  type SmaKey,
  type SortField,
  type SortOrder,
} from '@/lib/screener'

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

export const inputCls =
  'w-full min-w-0 rounded-lg border border-line-default bg-surface-base px-2.5 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-indigo-500/40'
// The app's mobile CSS forces .grid-cols-* to one column; arbitrary templates are exempt.
export const GRID2 = 'grid-cols-[repeat(2,minmax(0,1fr))]'
export const GRID3 = 'grid-cols-[repeat(3,minmax(0,1fr))]'

// ── controller ───────────────────────────────────────────────────────────────

export function useScreenerController() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  // Filters + sort live in the URL; the last screen is remembered per user and restored on a bare /screener.
  const qs = usePersistedQuery('screener.query', params?.toString() ?? '')
  const state = useMemo(() => parseScreenerParams(qs), [qs])

  // Latest screen, also covering edits made before the URL round-trip lands.
  const latest = useRef(state)
  useEffect(() => { latest.current = state }, [state])

  const setState = useCallback(
    (next: ScreenerState) => {
      latest.current = next
      const s = toSearchParams(next).toString()
      if (s === window.location.search.replace(/^\?/, '')) return
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false })
    },
    [router, pathname]
  )
  const update = useCallback((fn: (s: ScreenerState) => ScreenerState) => setState(fn(latest.current)), [setState])

  const q = useScreener(state)
  const meta = useScreenerMeta()
  const data = q.data
  const activeSort: SortField = data?.sort ?? state.sort ?? 'market_cap'
  const activeOrder: SortOrder = data?.order ?? state.order ?? 'desc'
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return {
    state, setState, update, query: q, data, rows: data?.results ?? [], meta: meta.data, total, pages,
    activeSort, activeOrder,
    loading: q.isLoading, fetching: q.isFetching, error: q.error as Error | null,
    reset: () => setState(EMPTY_STATE),
    chips: filterChips(state),
    removeChip: (id: string) => setState(removeChip(state, id)),
    setPreset: (id: PresetId | undefined) => setState(applyPreset(id)),
    setPage: (page: number) => setState({ ...state, page: Math.min(Math.max(1, page), pages) }),
  }
}

export type ScreenerController = ReturnType<typeof useScreenerController>

// ── row actions ──────────────────────────────────────────────────────────────

export function useRowActions() {
  const { isAuthenticated } = useAuth()
  const toast = useToast()
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())

  const addWatch = async (symbol: string) => {
    if (!isAuthenticated) {
      toast.info('Sign in to use your watchlist')
      router.push('/auth')
      return
    }
    setBusy(symbol)
    try {
      try {
        await addToWatchlist({ symbol, source: 'screener' })
      } catch (e) {
        // Unknown to the watchlist backend: sync the ticker once, then retry (same as Alerts).
        if (!(e instanceof Error) || !/not found/i.test(e.message)) throw e
        const s = await fetch(`${API_URL}/api/v1/symbols/${encodeURIComponent(symbol)}/sync`, { method: 'POST' })
        if (!s.ok) throw e
        await addToWatchlist({ symbol, source: 'screener' })
      }
      setAdded((prev) => new Set(prev).add(symbol))
      toast.success(`${symbol} added to your watchlist`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not add to watchlist'
      if (/already in your watchlist/i.test(msg)) {
        setAdded((prev) => new Set(prev).add(symbol))
        toast.info(msg)
      } else toast.error(msg)
    } finally {
      setBusy(null)
    }
  }
  return { addWatch, busy, added }
}

export function RowActions({ symbol, actions, size = 'md' }: { symbol: string; actions: ReturnType<typeof useRowActions>; size?: 'md' | 'lg' }) {
  const btn = size === 'lg' ? 'h-9 w-9' : 'h-7 w-7'
  const isAdded = actions.added.has(symbol)
  return (
    <div className="flex items-center justify-end gap-1">
      <Link
        href={`/alerts?symbol=${encodeURIComponent(symbol)}`}
        aria-label={`Add alert for ${symbol}`}
        title="Add alert"
        onClick={(e) => e.stopPropagation()}
        className={`${btn} flex items-center justify-center rounded-lg text-fg-muted hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400`}
      >
        <BellPlus className="h-4 w-4" />
      </Link>
      <button
        type="button"
        aria-label={isAdded ? `${symbol} is in your watchlist` : `Add ${symbol} to watchlist`}
        title={isAdded ? 'In watchlist' : 'Add to watchlist'}
        disabled={actions.busy === symbol || isAdded}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); actions.addWatch(symbol) }}
        className={`${btn} flex items-center justify-center rounded-lg text-fg-muted hover:bg-indigo-500/10 hover:text-indigo-600 disabled:cursor-default dark:hover:text-indigo-400 ${isAdded ? 'text-emerald-600 dark:text-emerald-400' : ''}`}
      >
        {actions.busy === symbol ? <Loader2 className="h-4 w-4 animate-spin" /> : isAdded ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
      </button>
    </div>
  )
}

// ── presets & chips ──────────────────────────────────────────────────────────

export function PresetBar({ c, scroll = false }: { c: ScreenerController; scroll?: boolean }) {
  const presets = c.meta?.presets ?? []
  const pill = (active: boolean) =>
    `shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
      active
        ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
        : 'border-line-subtle bg-surface-raised text-fg-secondary hover:text-fg-primary'
    }`
  return (
    <div className={`flex gap-2 ${scroll ? '-mx-4 overflow-x-auto px-4 pb-1 scrollbar-hide' : 'flex-wrap'}`} role="group" aria-label="Preset screens">
      <button type="button" aria-pressed={!c.state.preset} onClick={() => c.setPreset(undefined)} className={pill(!c.state.preset)}>
        All stocks
      </button>
      {presets.map((p) => (
        <button
          key={p.id}
          type="button"
          aria-pressed={c.state.preset === p.id}
          title={`${p.description} (${describePreset(p)})`}
          onClick={() => c.setPreset(c.state.preset === p.id ? undefined : p.id)}
          className={pill(c.state.preset === p.id)}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

export function ActiveChips({ c }: { c: ScreenerController }) {
  const preset = c.meta?.presets.find((p) => p.id === c.state.preset)
  if (!c.chips.length && !preset) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {preset && (
        <span className="rounded-full bg-surface-raised px-2.5 py-1 text-[11px] text-fg-secondary">
          <span className="font-semibold text-fg-primary">{preset.label}:</span> {describePreset(preset)}
        </span>
      )}
      {c.chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={() => c.removeChip(chip.id)}
          aria-label={`Remove filter ${chip.label}`}
          className="inline-flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-500/20 dark:text-indigo-300"
        >
          {chip.label} <X className="h-3 w-3" />
        </button>
      ))}
      <button type="button" onClick={c.reset} className="inline-flex items-center gap-1 px-1.5 py-1 text-[11px] font-medium text-fg-muted hover:text-fg-primary">
        <RotateCcw className="h-3 w-3" /> Reset
      </button>
    </div>
  )
}

// ── filter panel ─────────────────────────────────────────────────────────────

function BoundInput({ spec, bound, value, onCommit }: { spec: RangeSpec; bound: 'min' | 'max'; value: number | undefined; onCommit: (v: number | undefined) => void }) {
  const [raw, setRaw] = useState(value == null ? '' : String(value))
  useEffect(() => { setRaw(value == null ? '' : String(value)) }, [value])
  const err = validateRangeInput(spec.key, raw)
  useEffect(() => {
    if (err) return
    const v = raw.trim() === '' ? undefined : Number(raw)
    if (v === value) return
    const t = setTimeout(() => onCommit(v), 450)
    return () => clearTimeout(t)
  }, [raw, err, value, onCommit])
  const id = `f-${spec.key}-${bound}`
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="sr-only">{`${spec.label} ${bound === 'min' ? 'minimum' : 'maximum'}`}</label>
      <input
        id={id}
        inputMode="decimal"
        placeholder={bound === 'min' ? 'Min' : 'Max'}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={() => {
          if (err) return
          const v = raw.trim() === '' ? undefined : Number(raw)
          if (v !== value) onCommit(v)
        }}
        aria-invalid={!!err}
        title={err ?? undefined}
        className={`${inputCls} ${err ? 'border-red-500 focus:ring-red-500/40' : ''}`}
      />
    </div>
  )
}

const UNIT_TEXT: Record<RangeSpec['unit'], string> = { '$B': '$B', $: '$', '%': '%', x: '×', '': '' }

export type Updater = (fn: (s: ScreenerState) => ScreenerState) => void

export function FilterPanel({ value, onChange, meta }: { value: ScreenerState; onChange: Updater; meta?: ScreenerMeta }) {
  const groups = ['Valuation', 'Fundamentals', 'Technicals'] as const
  const commit = (key: RangeKey, bound: 'min' | 'max') => (v: number | undefined) => onChange((s) => setRange(s, key, bound, v))
  const toggleSector = (name: string) =>
    onChange((s) => ({
      ...s,
      sectors: s.sectors.includes(name) ? s.sectors.filter((x) => x !== name) : [...s.sectors, name].sort(),
      page: 1,
    }))
  const setSma = (key: SmaKey, dir: SmaDir | undefined) =>
    onChange((s) => {
      const sma = { ...s.sma }
      if (dir) sma[key] = dir
      else delete sma[key]
      return { ...s, sma, page: 1 }
    })

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="screener-q" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-fg-muted">Search</label>
        <SearchInput value={value.q} onCommit={(q) => onChange((s) => ({ ...s, q, page: 1 }))} />
      </div>

      {groups.map((g) => (
        <fieldset key={g}>
          <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{g}</legend>
          <div className="space-y-2.5">
            {RANGE_FILTERS.filter((f) => f.group === g).map((f) => (
              <div key={f.key}>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-fg-secondary" title={f.hint}>{f.label}</span>
                  {UNIT_TEXT[f.unit] && <span className="text-[10px] text-fg-muted">{UNIT_TEXT[f.unit]}</span>}
                </div>
                <div className={`grid ${GRID2} gap-2`}>
                  <BoundInput spec={f} bound="min" value={value.ranges[f.key]?.min} onCommit={commit(f.key, 'min')} />
                  <BoundInput spec={f} bound="max" value={value.ranges[f.key]?.max} onCommit={commit(f.key, 'max')} />
                </div>
              </div>
            ))}
            {g === 'Technicals' && SMA_FILTERS.map(({ key, label }) => (
              <div key={key}>
                <span className="mb-1 block text-xs font-medium text-fg-secondary">{label}</span>
                <div className={`grid ${GRID3} gap-1 rounded-lg border border-line-subtle bg-surface-base p-0.5`} role="radiogroup" aria-label={label}>
                  {([undefined, 'above', 'below'] as const).map((dir) => (
                    <button
                      key={dir ?? 'any'}
                      type="button"
                      role="radio"
                      aria-checked={value.sma[key] === dir}
                      onClick={() => setSma(key, dir)}
                      className={`rounded-md px-2 py-1 text-xs font-medium ${value.sma[key] === dir ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300' : 'text-fg-muted hover:text-fg-primary'}`}
                    >
                      {dir === undefined ? 'Any' : dir === 'above' ? 'Above' : 'Below'}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </fieldset>
      ))}

      <fieldset>
        <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">Sector</legend>
        <div className="flex flex-wrap gap-1.5">
          {(meta?.sectors ?? []).map((s) => {
            const on = value.sectors.includes(s.name)
            return (
              <button
                key={s.name}
                type="button"
                aria-pressed={on}
                onClick={() => toggleSector(s.name)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${on ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300' : 'border-line-subtle text-fg-secondary hover:text-fg-primary'}`}
              >
                {s.name} <span className="opacity-60">{s.count}</span>
              </button>
            )
          })}
          {!meta && <span className="text-xs text-fg-muted">Loading sectors…</span>}
        </div>
      </fieldset>

      <label className="flex items-center gap-2 text-xs text-fg-secondary">
        <input
          type="checkbox"
          checked={value.includeEtfs}
          onChange={(e) => { const on = e.target.checked; onChange((s) => ({ ...s, includeEtfs: on, page: 1 })) }}
          className="h-4 w-4 rounded border-line-default accent-indigo-600"
        />
        Include ETFs
      </label>
    </div>
  )
}

function SearchInput({ value, onCommit }: { value?: string; onCommit: (v: string | undefined) => void }) {
  const [raw, setRaw] = useState(value ?? '')
  useEffect(() => { setRaw(value ?? '') }, [value])
  useEffect(() => {
    const v = raw.trim() || undefined
    if (v === value || (v && !/^[A-Za-z0-9 .&'-]{1,40}$/.test(v))) return
    const t = setTimeout(() => onCommit(v), 400)
    return () => clearTimeout(t)
  }, [raw, value, onCommit])
  return (
    <input id="screener-q" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="Ticker or company" maxLength={40} className={inputCls} />
  )
}

// ── pager & status ───────────────────────────────────────────────────────────

export function Pager({ c }: { c: ScreenerController }) {
  if (c.total === 0) return null
  const from = (c.state.page - 1) * PAGE_SIZE + 1
  const to = Math.min(c.total, c.state.page * PAGE_SIZE)
  const btn = 'inline-flex h-8 items-center gap-1 rounded-lg border border-line-subtle px-2.5 text-xs font-medium text-fg-secondary hover:text-fg-primary disabled:opacity-40'
  return (
    <nav className="flex items-center justify-between gap-3 text-xs text-fg-muted" aria-label="Pagination">
      <span className="tabular-nums">{from.toLocaleString()}–{to.toLocaleString()} of {c.total.toLocaleString()}</span>
      <div className="flex gap-2">
        <button type="button" className={btn} disabled={c.state.page <= 1} onClick={() => c.setPage(c.state.page - 1)}>
          <ChevronLeft className="h-3.5 w-3.5" /> Prev
        </button>
        <button type="button" className={btn} disabled={c.state.page >= c.pages} onClick={() => c.setPage(c.state.page + 1)}>
          Next <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </nav>
  )
}

export function asOfText(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function EmptyState({ c }: { c: ScreenerController }) {
  return (
    <div className="p-10 text-center">
      <p className="text-sm font-semibold text-fg-primary">No stocks match these filters</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-fg-muted">
        Stocks with a missing value never match a filter on that value. Try widening a range or removing a filter.
      </p>
      <button type="button" onClick={c.reset} className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-line-subtle px-3 py-1.5 text-xs font-medium text-fg-secondary hover:text-fg-primary">
        <RotateCcw className="h-3.5 w-3.5" /> Reset filters
      </button>
    </div>
  )
}
