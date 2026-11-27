/**
 * MLOps status — shared by the desktop MLOps Command Center and MobileMLOps.
 *
 * GET /api/v1/mlops/status returns what prod actually has: the ML gate verdict,
 * forecast benchmarks vs ARIMA(0,1,0), the Postgres model registry and data
 * freshness. Every section carries an `empty_reason` when it has nothing to show.
 */

const API = process.env.NEXT_PUBLIC_API_URL || ''

export interface GateHorizon {
  horizon: number
  checkpoint?: string | null
  tickers: string[]
  oos_period?: [string, string] | null
  origins_per_ticker?: number | null
  rel_mae_range?: [number, number] | null
  min_dm_p_one_sided?: number | null
  significantly_worse_tickers: string[]
  edge: boolean
}

/** One of the 10 walk-forward gate conditions, with the measured value. */
export interface GateCheck {
  key: string
  label: string
  value: number | null
  threshold: string
  unit: 'ic' | 'pct' | 'num'
  passed: boolean
}

export interface ResearchCandidate {
  phase?: string
  evaluated_at?: string
  model_family?: string
  variant?: string
  description?: string
  gates_passed?: number
  gates_total?: number
  gates_required?: number
  robust?: boolean
  verdict?: 'READY' | 'NOT_READY'
  deployed?: boolean
  mean_ic?: number
  ic_tstat_nonoverlap?: number
  robustness?: { n_runs: number; min_gates: number; max_gates: number; median_gates: number; runs_passing: number; all_pass: boolean } | null
  scorecard?: GateCheck[]
  before?: { variant: string; gates_passed: number; mean_ic: number; scorecard?: GateCheck[] } | null
  oos_period?: [string, string] | null
  data?: { source?: string; n_symbols?: number; date_min?: string; date_max?: string } | null
}

export interface ServingDecision {
  signal_model: string | null
  baseline: string | null
  reason: string
}

/** Format a gate value in its own unit: IC to 4 dp, percentages to 1 dp. */
export function formatGateValue(c: Pick<GateCheck, 'value' | 'unit'>): string {
  if (c.value === null || c.value === undefined || !Number.isFinite(c.value)) return '--'
  if (c.unit === 'ic') return (c.value >= 0 ? '+' : '') + c.value.toFixed(4)
  if (c.unit === 'pct') return `${(c.value * 100).toFixed(1)}%`
  return c.value.toFixed(2)
}

/** "9/10 primary · 6–9/10 across 9 re-runs (8 required on every run)" */
export function robustnessLine(rc?: ResearchCandidate | null): string | null {
  if (!rc || rc.gates_passed === undefined) return null
  const total = rc.gates_total ?? 10
  const r = rc.robustness
  if (!r) return `${rc.gates_passed}/${total} on one run; not robustness-tested`
  return `${rc.gates_passed}/${total} primary · ${r.min_gates}–${r.max_gates}/${total} across ${r.n_runs} re-runs (${rc.gates_required ?? 8} required on every run)`
}

export interface GateStatus {
  status: string
  verdict?: 'READY' | 'NOT_READY'
  promoted?: boolean
  gates_passed?: number | null
  gates_total?: number
  gates_required?: number
  evaluated_at?: string | null
  note?: string
  served_model?: string
  reason?: string
  research_candidate?: ResearchCandidate | null
  serving?: ServingDecision | null
  benchmark_test?: {
    benchmark: string
    test?: string | null
    evaluated_at?: string | null
    edge_any?: boolean | null
    finding?: string | null
    horizons: GateHorizon[]
  } | null
  empty_reason?: string
  error?: string
}

export interface RegistryVersion {
  model_version: string
  promotion_status: string
  symbol_count?: number | null
  horizons?: number[] | null
  avg_da?: number | null
  avg_ic?: number | null
  promoted_at?: string | null
  created_at?: string | null
}

export interface RegistryStatus {
  status: string
  versions?: RegistryVersion[]
  production?: RegistryVersion | null
  runs_total?: number
  runs_completed?: number
  latest_run?: { run_id: string; status: string; created_at?: string | null; ended_at?: string | null } | null
  empty_reason?: string | null
  error?: string
}

export interface FreshnessTable {
  status: 'fresh' | 'stale' | 'empty'
  rows: number
  symbols_covered?: number
  newest?: string | null
  oldest?: string | null
  newest_age_days?: number | null
  stale_after_days: number
  empty_reason?: string | null
}

export interface DataFreshness {
  status: string
  symbols?: number
  price_bars?: FreshnessTable
  fundamentals?: FreshnessTable
  coverage_note?: string | null
  empty_reason?: string
  error?: string
}

export interface BenchmarkHorizon {
  horizon: number
  primary?: string | null
  primary_label?: string | null
  rel_mae?: number | null
  dm_pvalue_holm?: number | null
  edge: boolean
  holdout_origins?: number | null
  effective_tests?: number | null
}

export interface ForecastBenchmarks {
  status: string
  benchmark?: string
  checked?: number
  cached?: number
  edges?: number
  tests?: number
  tickers: { ticker: string; as_of?: string | null; origins?: number | null; order_label?: string | null; budget_hit?: boolean; horizons: BenchmarkHorizon[] }[]
  empty_reason?: string | null
  error?: string
}

export interface MlopsStatus {
  generated_at: string
  gate: GateStatus
  registry: RegistryStatus
  data_freshness: DataFreshness
  forecast_benchmarks: ForecastBenchmarks
  file_stores?: { status: string; stores: string[]; empty_reason: string }
}

export type FetchOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'unauthorized' | 'http' | 'network'; status?: number }

/** Fetch with the session cookie; tells a 401 apart from other failures. */
export async function mlopsFetch<T>(path: string): Promise<FetchOutcome<T>> {
  try {
    const res = await fetch(`${API}${path}`, { credentials: 'include', cache: 'no-store' })
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'unauthorized', status: res.status }
    if (!res.ok) return { ok: false, reason: 'http', status: res.status }
    return { ok: true, data: (await res.json()) as T }
  } catch {
    return { ok: false, reason: 'network' }
  }
}

export function fetchMlopsStatus(): Promise<FetchOutcome<MlopsStatus>> {
  return mlopsFetch<MlopsStatus>('/api/v1/mlops/status')
}

/** Human message for a failed fetch, used for empty states instead of blank panels. */
export function fetchFailureMessage(outcome: FetchOutcome<unknown>): string | null {
  if (outcome.ok) return null
  if (outcome.reason === 'unauthorized') return 'Your session has expired. Sign in again to load MLOps data.'
  if (outcome.reason === 'network') return 'Could not reach the backend. Check your connection and retry.'
  return `The backend answered HTTP ${outcome.status ?? '?'} for MLOps status.`
}

export function formatAge(days?: number | null): string {
  if (days === null || days === undefined) return '--'
  if (days < 1 / 24) return 'just now'
  if (days < 1) return `${Math.round(days * 24)}h ago`
  return `${days.toFixed(days < 10 ? 1 : 0)}d ago`
}

export function freshnessTone(status?: string): 'ok' | 'warn' | 'bad' {
  if (status === 'fresh') return 'ok'
  if (status === 'stale') return 'warn'
  return 'bad'
}

export function gateHeadline(g?: GateStatus | null): string {
  if (!g || g.status === 'error') return 'Gate status unavailable'
  const passed = g.gates_passed
  const tally = passed === null || passed === undefined
    ? `never gate-tested (${g.gates_required ?? 8}/${g.gates_total ?? 10} required)`
    : `${passed}/${g.gates_total ?? 10} gates passed (${g.gates_required ?? 8} required)`
  return `${g.verdict === 'READY' ? 'READY' : 'NOT READY'} · ${tally}`
}
