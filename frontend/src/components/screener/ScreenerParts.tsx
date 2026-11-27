'use client'

/**
 * Shared by ScreenerDesktop and ScreenerMobile: URL-synced controller, stat
 * cards, quick screens, filter panel (draft + apply), view tabs, the security
 * overview, dialogs and the pager. Every number comes from the screener API.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, BellPlus, Check, ChevronLeft, ChevronRight, Loader2, Minus, Plus, RotateCcw, Search, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/Toast'
import TickerLogo from '@/components/TickerLogo'
import { Skeleton } from '@/components/Skeleton'
import { addToWatchlist } from '@/lib/api'
import { usePersistedQuery } from '@/lib/persistedQuery'
import { arrayOf, isBool, oneOf, usePersistentState } from '@/lib/persistentState'
import {
  DASH,
  EMPTY_STATE,
  FLAG_TEXT,
  PAGE_SIZE,
  PRESETS,
  RANGE_FILTERS,
  SMA_FILTERS,
  VIEWS,
  VIEW_IDS,
  activeCriteriaCount,
  applyPreset,
  describeScreen,
  fmtPct,
  fmtPrice,
  metricColumn,
  missingReason,
  parseScreenerParams,
  presetFilters,
  presetRule,
  setRange,
  toSearchParams,
  toneClass,
  useScreener,
  useScreenerMeta,
  validateRangeInput,
  type MetricColumn,
  type PresetId,
  type RangeKey,
  type RangeSpec,
  type RowKey,
  type ScreenerMeta,
  type ScreenerRow,
  type ScreenerState,
  type SmaDir,
  type SmaKey,
  type SortField,
  type SortOrder,
  type ViewId,
} from '@/lib/screener'

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

// Opaque surfaces: --surface-base is transparent in dark mode, so cards use
// .rs-card (globals.css) and sticky cells/sheets use these solid colours.
export const SOLID = 'bg-white dark:bg-[#0f1520]'
export const SOLID_INSET = 'bg-slate-50 dark:bg-[#141b28]'

export const inputCls =
  'w-full min-w-0 rounded-lg border border-line-default bg-white px-2.5 py-1.5 text-sm tabular-nums text-fg-primary placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:bg-[#141b28]'
// The app's mobile CSS forces .grid-cols-* to one column; arbitrary templates are exempt.
export const GRID2 = 'grid-cols-[repeat(2,minmax(0,1fr))]'
export const GRID3 = 'grid-cols-[repeat(3,minmax(0,1fr))]'

// ── controller ───────────────────────────────────────────────────────────────

export function useScreenerController() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  // Preset, filters and sort live in the URL; the last screen is remembered per user
  // (persistentState) and restored on a bare /screener.
  const qs = usePersistedQuery('screener.query', params?.toString() ?? '')
  const state = useMemo(() => parseScreenerParams(qs), [qs])
  const [view, setView] = usePersistentState<ViewId>('screener.view', 'overview', { validate: oneOf(VIEW_IDS) })

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
    activeSort, activeOrder, view, setView,
    loading: q.isLoading, fetching: q.isFetching, error: q.error as Error | null,
    criteria: activeCriteriaCount(state),
    /** Clears every filter and the preset; keeps the user's explicit sort. */
    reset: () => setState({ ...EMPTY_STATE, sort: latest.current.sort, order: latest.current.order }),
    setPreset: (id: PresetId | undefined) => setState(applyPreset(id)),
    setPage: (page: number) => setState({ ...state, page: Math.min(Math.max(1, page), pages) }),
  }
}

export type ScreenerController = ReturnType<typeof useScreenerController>

/** Local copy of the screen that the filter panel edits; `apply` commits it to the URL. */
export function useFilterDraft(c: ScreenerController) {
  const key = toSearchParams(c.state).toString()
  const [draft, setDraft] = useState<ScreenerState>(c.state)
  const ref = useRef(draft)
  const latestState = useRef(c.state)
  latestState.current = c.state
  useEffect(() => {
    ref.current = c.state
    setDraft(c.state)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const update = useCallback((fn: (s: ScreenerState) => ScreenerState) => {
    ref.current = fn(ref.current)
    setDraft(ref.current)
  }, [])
  const dirty = toSearchParams({ ...draft, page: 1 }).toString() !== toSearchParams({ ...c.state, page: 1 }).toString()
  const apply = () => c.setState({ ...ref.current, page: 1 })
  const resetAll = () => {
    const next = { ...EMPTY_STATE, sort: c.state.sort, order: c.state.order }
    ref.current = next
    setDraft(next)
    c.setState(next)
  }
  /** Drop unapplied edits (e.g. when the mobile sheet reopens). */
  const discard = useCallback(() => {
    ref.current = latestState.current
    setDraft(latestState.current)
  }, [])
  return { draft, update, dirty, apply, resetAll, discard }
}

export type FilterDraft = ReturnType<typeof useFilterDraft>

// ── watchlist action ─────────────────────────────────────────────────────────

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

export type RowActionsApi = ReturnType<typeof useRowActions>

// ── header, stats, quick screens ─────────────────────────────────────────────

export function Breadcrumb() {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
      Research workspace <span className="mx-1 opacity-60">/</span> <span className="text-fg-secondary">Screener</span>
    </p>
  )
}

export const SUBTITLE = 'Discover equities by valuation, growth, quality and technical signals.'

export function asOfText(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function StatCard({ label, children, aside, compact }: { label: string; children: ReactNode; aside?: ReactNode; compact?: boolean }) {
  return (
    <div className={`rs-card min-w-0 ${compact ? 'px-3 py-2.5' : 'px-4 py-3.5'}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className={`truncate font-medium text-fg-muted ${compact ? 'text-[10px]' : 'text-xs'}`}>{label}</p>
        {aside}
      </div>
      <div className={`mt-1 truncate font-semibold tabular-nums text-fg-primary ${compact ? 'text-base' : 'text-2xl'}`}>{children}</div>
    </div>
  )
}

/** Universe coverage, matches and active criteria, all from the live response. */
export function StatCards({ c, compact = false }: { c: ScreenerController; compact?: boolean }) {
  const universe = c.data?.universe ?? c.meta?.universe
  const asOf = c.data?.as_of ?? c.meta?.as_of
  const num = (v: number | undefined, w = 'w-14') => (v == null ? <Skeleton className={`inline-block h-5 ${w} align-middle`} /> : v.toLocaleString('en-US'))
  const unit = (t: string) => <span className={`font-medium text-fg-muted ${compact ? 'text-[10px]' : 'text-sm'}`}>{t}</span>
  return (
    <div className={`grid ${GRID3} ${compact ? 'gap-2' : 'gap-4'}`}>
      <StatCard
        compact={compact}
        label={compact ? 'Universe' : 'Universe coverage'}
        aside={!compact && asOf ? (
          <span className="shrink-0 text-[11px] text-fg-muted" title={c.data?.refreshing ? 'A newer snapshot is being built' : undefined}>
            As of {asOfText(asOf)}{c.data?.refreshing ? ' · refreshing' : ''}
          </span>
        ) : undefined}
      >
        {num(universe)} {universe != null && unit('stocks')}
      </StatCard>
      <StatCard compact={compact} label="Matches">
        {c.data ? c.total.toLocaleString('en-US') : num(undefined, 'w-10')}
        {universe != null && c.data && <> {unit(`/ ${universe.toLocaleString('en-US')}`)}</>}
      </StatCard>
      <StatCard compact={compact} label={compact ? 'Criteria' : 'Active criteria'}>{c.criteria}</StatCard>
    </div>
  )
}

export function PresetBar({ c, scroll = false }: { c: ScreenerController; scroll?: boolean }) {
  const pill = (active: boolean) =>
    `shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
      active
        ? 'border-indigo-600 bg-indigo-600 text-[#fff] dark:border-indigo-500 dark:bg-indigo-500'
        : 'border-line-default bg-white text-fg-secondary hover:border-indigo-500/40 hover:text-fg-primary dark:bg-[#0f1520]'
    }`
  return (
    <div className={scroll ? '' : 'flex flex-wrap items-center gap-3'}>
      <p className={`text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-muted ${scroll ? 'mb-1.5' : ''}`}>Quick screens</p>
      <div className={`flex gap-2 ${scroll ? '-mx-4 overflow-x-auto px-4 pb-1 scrollbar-hide' : 'flex-wrap'}`} role="group" aria-label="Quick screens">
        <button type="button" aria-pressed={!c.state.preset} onClick={() => c.setPreset(undefined)} className={pill(!c.state.preset)} title="Every stock in the universe, no filters">
          All stocks
        </button>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={c.state.preset === p.id}
            title={`${p.description}\nRule: ${presetRule(p.id)}`}
            onClick={() => c.setPreset(c.state.preset === p.id ? undefined : p.id)}
            className={pill(c.state.preset === p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function ScreenSummary({ c, className = '' }: { c: ScreenerController; className?: string }) {
  return <p className={`text-xs text-fg-muted ${className}`}>{describeScreen(c.state)}</p>
}

export function ViewTabs({ c, scroll = false }: { c: ScreenerController; scroll?: boolean }) {
  return (
    <div role="tablist" aria-label="Column set" className={`flex gap-1 ${scroll ? '-mx-4 overflow-x-auto px-4 scrollbar-hide' : ''}`}>
      {VIEWS.map((v) => {
        const on = c.view === v.id
        return (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => c.setView(v.id)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              on ? 'bg-indigo-500/10 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300' : 'text-fg-muted hover:bg-surface-hover hover:text-fg-primary'
            }`}
          >
            {v.label}
          </button>
        )
      })}
    </div>
  )
}

/** A metric cell's text plus a tooltip that explains a dash. */
export function MetricValue({ r, col }: { r: ScreenerRow; col: MetricColumn }) {
  const reason = missingReason(r, col.key)
  if (reason) return <span title={reason} className="cursor-help text-fg-muted">{DASH}</span>
  return <span className={col.tone ? col.tone(r) : 'text-fg-primary'}>{col.format(r)}</span>
}

export function FlagIcon({ r }: { r: ScreenerRow }) {
  if (!r.flags.length) return null
  const text = r.flags.map((f) => FLAG_TEXT[f] ?? f).join('\n')
  return (
    <span title={text} aria-label={text} className="inline-flex">
      <AlertTriangle className="h-3 w-3 text-amber-500" />
    </span>
  )
}

// ── filter panel ─────────────────────────────────────────────────────────────

const GROUPS = ['Valuation', 'Fundamentals', 'Technicals', 'Sector'] as const
type Group = (typeof GROUPS)[number]

function BoundInput({ spec, bound, value, preset, onCommit }: { spec: RangeSpec; bound: 'min' | 'max'; value: number | undefined; preset?: number; onCommit: (v: number | undefined) => void }) {
  const [raw, setRaw] = useState(value == null ? '' : String(value))
  useEffect(() => {
    setRaw((cur) => (cur.trim() !== '' && Number(cur) === value ? cur : value == null ? '' : String(value)))
  }, [value])
  const err = validateRangeInput(spec.key, raw)
  const id = `f-${spec.key}-${bound}`
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="sr-only">{`${spec.label} ${bound === 'min' ? 'minimum' : 'maximum'}`}</label>
      <input
        id={id}
        inputMode="decimal"
        placeholder={preset != null ? `${bound === 'min' ? '≥' : '≤'} ${preset} (preset)` : bound === 'min' ? 'Min' : 'Max'}
        value={raw}
        onChange={(e) => {
          const next = e.target.value
          setRaw(next)
          if (validateRangeInput(spec.key, next)) return
          onCommit(next.trim() === '' ? undefined : Number(next))
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

function GroupHeader({ g, open, count, onToggle }: { g: Group; open: boolean; count: number; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center justify-between py-2.5 text-left text-xs font-semibold text-fg-primary"
    >
      <span className="flex items-center gap-1.5">
        {g}
        {count > 0 && <span className="rounded-full bg-indigo-500/15 px-1.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-300">{count}</span>}
      </span>
      {open ? <Minus className="h-3.5 w-3.5 text-fg-muted" /> : <Plus className="h-3.5 w-3.5 text-fg-muted" />}
    </button>
  )
}

/** Search box + collapsible groups. Edits go to `onChange` (a draft); the caller applies. */
export function FilterPanel({ value, onChange, meta }: { value: ScreenerState; onChange: Updater; meta?: ScreenerMeta }) {
  const [openGroups, setOpenGroups] = usePersistentState<Group[]>('screener.filterGroups', ['Valuation'], { validate: arrayOf(GROUPS) })
  const toggle = (g: Group) => setOpenGroups((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]))
  const commit = (key: RangeKey, bound: 'min' | 'max') => (v: number | undefined) => onChange((s) => setRange(s, key, bound, v))
  const clearRange = (key: RangeKey) => onChange((s) => setRange(setRange(s, key, 'min', undefined), key, 'max', undefined))
  const toggleSector = (name: string) =>
    onChange((s) => ({ ...s, sectors: s.sectors.includes(name) ? s.sectors.filter((x) => x !== name) : [...s.sectors, name].sort(), page: 1 }))
  const setSma = (key: SmaKey, dir: SmaDir | undefined) =>
    onChange((s) => {
      const sma = { ...s.sma }
      if (dir) sma[key] = dir
      else delete sma[key]
      return { ...s, sma, page: 1 }
    })
  const presetRanges = value.preset ? presetFilters(value.preset).ranges : {}
  const groupCount = (g: Group) =>
    g === 'Sector'
      ? value.sectors.length + (value.includeEtfs ? 1 : 0)
      : RANGE_FILTERS.filter((f) => f.group === g && value.ranges[f.key]).length + (g === 'Technicals' ? Object.keys(value.sma).length : 0)

  return (
    <div>
      <label htmlFor="screener-q" className="sr-only">Ticker or company</label>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
        <SearchInput value={value.q} onCommit={(q) => onChange((s) => ({ ...s, q, page: 1 }))} />
      </div>

      {GROUPS.map((g) => {
        const open = openGroups.includes(g)
        return (
          <section key={g} className="border-b border-line-subtle last:border-b-0">
            <GroupHeader g={g} open={open} count={groupCount(g)} onToggle={() => toggle(g)} />
            {open && g !== 'Sector' && (
              <div className="space-y-3 pb-3">
                {RANGE_FILTERS.filter((f) => f.group === g).map((f) => {
                  const set = value.ranges[f.key]
                  return (
                    <div key={f.key}>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-fg-secondary" title={f.hint}>
                          {f.label}{UNIT_TEXT[f.unit] && <span className="ml-1 text-[10px] text-fg-muted">{UNIT_TEXT[f.unit]}</span>}
                        </span>
                        <button
                          type="button"
                          onClick={() => clearRange(f.key)}
                          disabled={!set}
                          aria-label={`Clear ${f.label}`}
                          title={`Clear ${f.label}`}
                          className="rounded p-0.5 text-fg-muted hover:bg-surface-hover hover:text-fg-primary disabled:invisible"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      <div className={`grid ${GRID2} items-center gap-2`}>
                        <BoundInput spec={f} bound="min" value={set?.min} preset={presetRanges[f.key]?.min} onCommit={commit(f.key, 'min')} />
                        <BoundInput spec={f} bound="max" value={set?.max} preset={presetRanges[f.key]?.max} onCommit={commit(f.key, 'max')} />
                      </div>
                    </div>
                  )
                })}
                {g === 'Technicals' && SMA_FILTERS.map(({ key, label }) => (
                  <div key={key}>
                    <span className="mb-1 block text-xs font-medium text-fg-secondary">{label}</span>
                    <div className={`grid ${GRID3} gap-1 rounded-lg border border-line-subtle p-0.5 ${SOLID_INSET}`} role="radiogroup" aria-label={label}>
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
            )}
            {open && g === 'Sector' && (
              <div className="pb-3">
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
                        {s.name} <span className="tabular-nums opacity-60">{s.count}</span>
                      </button>
                    )
                  })}
                  {!meta && <span className="text-xs text-fg-muted">Loading sectors…</span>}
                </div>
                <label className="mt-3 flex items-center gap-2 text-xs text-fg-secondary">
                  <input
                    type="checkbox"
                    checked={value.includeEtfs}
                    onChange={(e) => { const on = e.target.checked; onChange((s) => ({ ...s, includeEtfs: on, page: 1 })) }}
                    className="h-4 w-4 rounded border-line-default accent-indigo-600"
                  />
                  Include ETFs
                </label>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function SearchInput({ value, onCommit }: { value?: string; onCommit: (v: string | undefined) => void }) {
  const [raw, setRaw] = useState(value ?? '')
  useEffect(() => { setRaw((cur) => (cur.trim() === (value ?? '') ? cur : value ?? '')) }, [value])
  const bad = raw.trim() !== '' && !/^[A-Za-z0-9 .&'-]{1,40}$/.test(raw.trim())
  return (
    <input
      id="screener-q"
      value={raw}
      onChange={(e) => {
        setRaw(e.target.value)
        const v = e.target.value.trim()
        if (!v || /^[A-Za-z0-9 .&'-]{1,40}$/.test(v)) onCommit(v || undefined)
      }}
      placeholder="Ticker or company"
      maxLength={40}
      aria-invalid={bad}
      title={bad ? "Letters, digits, spaces and . & ' - only" : undefined}
      className={`${inputCls} pl-8 ${bad ? 'border-red-500' : ''}`}
    />
  )
}

// ── dialogs (side drawer on desktop, bottom sheet on mobile): components/ui/DialogSheet ──

export { Sheet, useDialogA11y } from '@/components/ui/DialogSheet'

// ── security overview ────────────────────────────────────────────────────────

const OVERVIEW_KEYS: RowKey[] = [
  'market_cap', 'pe_ratio', 'ps_ratio', 'dividend_yield_pct', 'revenue_growth_yoy_pct', 'profit_margin_pct',
  'roe_pct', 'debt_to_equity', 'rsi_14', 'price_vs_sma50_pct', 'price_vs_sma200_pct',
]

export function SecurityOverview({ r, actions, onClose, sheet = false }: { r: ScreenerRow; actions: RowActionsApi; onClose: () => void; sheet?: boolean }) {
  const isAdded = actions.added.has(r.symbol)
  const href = `/research?symbol=${encodeURIComponent(r.symbol)}`
  const btn = 'inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold'
  return (
    <>
      <div className={`flex items-start justify-between gap-3 px-5 ${sheet ? 'pt-3' : 'pt-5'}`}>
        <div className="min-w-0">
          {sheet && <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-surface-active" />}
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-muted">Security overview</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close security overview" data-autofocus className="-mr-1.5 rounded-full p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg-primary">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <div className="mt-2 flex items-center gap-3">
          <TickerLogo symbol={r.symbol} companyName={r.name} size={40} />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-2xl font-bold leading-tight text-fg-primary">{r.symbol} <FlagIcon r={r} /></p>
            <p className="truncate text-sm text-fg-muted">{r.name ?? DASH}</p>
          </div>
        </div>
        <div className="mt-4 flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums text-fg-primary">{fmtPrice(r.price)}</span>
          <span className={`text-sm font-semibold tabular-nums ${toneClass(r.change_1d_pct)}`} title="Change on the day">{fmtPct(r.change_1d_pct, true, 2)}</span>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
          {r.price_as_of ? `Price as of ${asOfText(r.price_as_of)}` : 'Price time unavailable'}
          {r.exchange ? ` · ${r.exchange}` : ''} · Fundamentals from filings and data providers (may lag) · Technicals from daily closes
        </p>
        <dl className={`mt-4 divide-y divide-line-subtle rounded-xl border border-line-subtle ${SOLID_INSET}`}>
          <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <dt className="text-fg-muted">Sector</dt>
            <dd className="truncate text-right font-medium text-fg-primary" title={r.industry ?? undefined}>{r.sector ?? <span title="Sector unavailable">{DASH}</span>}</dd>
          </div>
          {OVERVIEW_KEYS.map((k) => {
            const col = metricColumn(k)
            return (
              <div key={k} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <dt className="text-fg-muted" title={col.title}>{col.label === 'Margin' ? 'Profit margin' : col.label}</dt>
                <dd className="font-medium tabular-nums"><MetricValue r={r} col={col} /></dd>
              </div>
            )
          })}
        </dl>
      </div>
      <div className={`grid ${GRID2} gap-2 border-t border-line-subtle px-5 pt-3 ${sheet ? 'pb-[max(1.25rem,env(safe-area-inset-bottom))]' : 'pb-5'}`}>
        <Link href={href} className={`${btn} col-span-2 bg-indigo-600 text-[#fff] hover:bg-indigo-500`}>Open Research</Link>
        <button
          type="button"
          disabled={actions.busy === r.symbol || isAdded}
          onClick={() => actions.addWatch(r.symbol)}
          className={`${btn} border border-line-default text-fg-primary hover:bg-surface-hover disabled:cursor-default ${isAdded ? 'text-emerald-600 dark:text-emerald-400' : ''}`}
        >
          {actions.busy === r.symbol ? <Loader2 className="h-4 w-4 animate-spin" /> : isAdded ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {isAdded ? 'In watchlist' : 'Add to watchlist'}
        </button>
        <Link prefetch={false} href={`/alerts?symbol=${encodeURIComponent(r.symbol)}`} className={`${btn} border border-line-default text-fg-primary hover:bg-surface-hover`}>
          <BellPlus className="h-4 w-4" /> Set alert
        </Link>
      </div>
    </>
  )
}

// ── pager & states ───────────────────────────────────────────────────────────

export function Pager({ c, className = '' }: { c: ScreenerController; className?: string }) {
  if (!c.data || c.total === 0) return null
  const from = (c.state.page - 1) * PAGE_SIZE + 1
  const to = Math.min(c.total, from + c.rows.length - 1)
  const btn = 'inline-flex h-8 items-center gap-1 rounded-lg border border-line-subtle px-2.5 text-xs font-medium text-fg-secondary hover:text-fg-primary disabled:opacity-40'
  return (
    <nav className={`flex items-center justify-between gap-3 text-xs text-fg-muted ${className}`} aria-label="Pagination">
      <span className="tabular-nums">Showing {from.toLocaleString()}–{to.toLocaleString()} of {c.total.toLocaleString()}</span>
      {c.pages > 1 && (
        <div className="flex items-center gap-2">
          <span className="hidden tabular-nums sm:inline">Page {c.state.page} of {c.pages}</span>
          <button type="button" className={btn} disabled={c.state.page <= 1} onClick={() => c.setPage(c.state.page - 1)} aria-label="Previous page">
            <ChevronLeft className="h-3.5 w-3.5" /> Prev
          </button>
          <button type="button" className={btn} disabled={c.state.page >= c.pages} onClick={() => c.setPage(c.state.page + 1)} aria-label="Next page">
            Next <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </nav>
  )
}

export function ErrorState({ c }: { c: ScreenerController }) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-6 text-sm text-red-600 dark:text-red-400" role="alert">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">{c.error?.message ?? 'The screener could not load.'}</span>
      <button type="button" onClick={() => c.query.refetch()} className="rounded-lg border border-line-default px-3 py-1.5 text-xs font-semibold text-fg-primary">
        Retry
      </button>
    </div>
  )
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

export const LEGEND = '— = unavailable. Fundamentals may lag; technicals use daily closes.'

export function usePanelCollapsed() {
  return usePersistentState('screener.panelCollapsed', false, { validate: isBool })
}
