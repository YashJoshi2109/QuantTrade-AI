'use client'

/**
 * The classic (named-strategy) backtester at /backtest/classic: form, result
 * and the server job, persisted per user so leaving the page, reloading or
 * closing the tab and coming back restores everything. Shared by the desktop
 * and mobile views.
 */
import { useCallback, useMemo } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import type { BacktestRequest, BacktestResult } from './api'
import { usePersistentJob, type ServerJob } from './persistentJob'
import { isBool, isStr, objectOf, usePersistentState } from './persistentState'

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

// ── Form ─────────────────────────────────────────────────────────────────

export interface ClassicForm {
  symbol: string
  strategy: string
  startDate: string
  endDate: string
  initialCapital: number
  positionSizing: string
  commissionRate: number
  slippageRate: number
  stopLoss: number | null
  takeProfit: number | null
  trailingStop: number | null
  maxPyramiding: number
  walkForward: boolean
  monteCarlo: boolean
  benchmark: string
  /** Strategy parameters, keyed by strategy id so switching back keeps them. */
  params: Record<string, Record<string, number>>
}

function isoDay(d: Date): string {
  return d.toISOString().split('T')[0]
}

export function defaultClassicForm(now = new Date()): ClassicForm {
  const start = new Date(now)
  start.setFullYear(start.getFullYear() - 2)
  return {
    symbol: 'AAPL', strategy: 'rsi_ma_crossover', startDate: isoDay(start), endDate: isoDay(now),
    initialCapital: 100000, positionSizing: 'fixed', commissionRate: 0.001, slippageRate: 0.0005,
    stopLoss: null, takeProfit: null, trailingStop: null, maxPyramiding: 1,
    walkForward: false, monteCarlo: true, benchmark: 'SPY', params: {},
  }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const numOrNull = (v: unknown) => (v === null ? null : num(v))
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)
const ticker = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9.\-^=]{0,15}$/.test(v) ? v : undefined)
function paramMap(v: unknown): Record<string, Record<string, number>> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const out: Record<string, Record<string, number>> = {}
  for (const [k, inner] of Object.entries(v as Record<string, unknown>)) {
    if (!inner || typeof inner !== 'object') continue
    const p: Record<string, number> = {}
    for (const [pk, pv] of Object.entries(inner as Record<string, unknown>)) if (num(pv) !== undefined) p[pk] = pv as number
    out[k] = p
  }
  return out
}

export const parseClassicForm = (v: unknown) =>
  objectOf<ClassicForm>(defaultClassicForm(), {
    symbol: ticker, strategy: isStr, startDate: day, endDate: day, initialCapital: num, positionSizing: isStr,
    commissionRate: num, slippageRate: num, stopLoss: numOrNull, takeProfit: numOrNull, trailingStop: numOrNull,
    maxPyramiding: num, walkForward: isBool, monteCarlo: isBool, benchmark: ticker, params: paramMap,
  })(v)

export function parseClassicResult(v: unknown): BacktestResult | null | undefined {
  if (v === null) return null
  const r = v as BacktestResult | undefined
  return r && typeof r === 'object' && typeof r.symbol === 'string' && typeof r.total_return === 'number' ? r : undefined
}

/** Why a finished result is not worth showing (no trades), or null. */
export function classicResultProblem(res: BacktestResult, form: Pick<ClassicForm, 'initialCapital'>, strategyName: string): string | null {
  const hasNoTrades = !res.total_trades || res.total_trades === 0
  const hasNoReturn = res.total_return === 0 && res.sharpe_ratio === 0 && res.win_rate === 0
  const hasNoEquity = !res.equity_curve || res.equity_curve.length <= 1
  if (!(hasNoTrades && hasNoReturn)) return null
  const sym = (res.symbol || '').toUpperCase()
  return hasNoEquity
    ? `No trades generated for ${sym} with ${strategyName}. Try a different date range, strategy, or check that market data is available.`
    : `Strategy produced 0 trades — parameters may be too restrictive or insufficient data for ${sym} in the selected period. If your initial capital ($${form.initialCapital.toLocaleString()}) is less than the stock price, increase it so at least 1 share can be purchased.`
}

// ── Job API ──────────────────────────────────────────────────────────────

type ClassicJob = ServerJob<BacktestResult>

async function jobCall<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = body && typeof body.detail === 'string' ? body.detail : `Backtest failed (${res.status})`
    throw Object.assign(new Error(detail), { status: res.status })
  }
  return body as T
}

export const classicJobApi = {
  start: (req: BacktestRequest) => jobCall<ClassicJob>('/backtest/jobs', { method: 'POST', body: JSON.stringify(req) }),
  get: async (id: string) => {
    try {
      return await jobCall<ClassicJob>(`/backtest/v2/jobs/${encodeURIComponent(id)}`)
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null
      throw e
    }
  },
  latest: () => jobCall<ClassicJob | null>('/backtest/v2/jobs/latest?kind=classic&include_result=false'),
  cancel: (id: string) => jobCall<ClassicJob>(`/backtest/v2/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  forget: (id: string) => jobCall<ClassicJob>(`/backtest/v2/jobs/${encodeURIComponent(id)}?forget=true`, { method: 'DELETE' }),
}

export function formToRequest(f: ClassicForm, params: Record<string, number>): BacktestRequest {
  return {
    symbol: f.symbol.toUpperCase(),
    start_date: f.startDate + 'T00:00:00',
    end_date: f.endDate + 'T23:59:59',
    strategy: f.strategy,
    initial_capital: f.initialCapital,
    strategy_params: params,
    position_sizing: f.positionSizing,
    commission_rate: f.commissionRate,
    slippage_rate: f.slippageRate,
    stop_loss_pct: f.stopLoss,
    take_profit_pct: f.takeProfit,
    trailing_stop_pct: f.trailingStop,
    max_pyramiding: f.maxPyramiding,
    walk_forward: f.walkForward,
    monte_carlo: f.monteCarlo,
    benchmark: f.benchmark,
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────

type Setter<V> = (v: V | ((prev: V) => V)) => void

/**
 * Form + result + job for the classic backtester. `onResult` runs in the
 * calling view when a job this browser saw running finishes (switch tabs).
 */
export function useClassicBacktest(opts: { strategyName: (id: string) => string; onResult?: () => void }) {
  const { isAuthenticated } = useAuth()
  const [form, setForm, formCtl] = usePersistentState<ClassicForm>('classicBacktest.form', defaultClassicForm(), {
    version: 1, validate: parseClassicForm,
  })
  const [result, setResult, resultCtl] = usePersistentState<BacktestResult | null>('classicBacktest.result', null, {
    version: 1, validate: parseClassicResult, maxAgeMs: 7 * 24 * 3600 * 1000,
  })
  const [error, setError] = usePersistentState<string | null>('classicBacktest.error', null, { storage: 'session' })

  const jobs = usePersistentJob<BacktestResult>({
    key: 'classicBacktest.job',
    queryKey: 'backtest-classic',
    enabled: isAuthenticated,
    get: classicJobApi.get,
    latest: classicJobApi.latest,
    hasResult: !!result,
    onDone: (r, wasActive) => {
      const problem = classicResultProblem(r, form, opts.strategyName(r.strategy || form.strategy))
      if (problem) {
        if (wasActive) setError(problem)
        return
      }
      setResult(r)
      setError(null)
      if (wasActive) opts.onResult?.()
    },
    onFailed: (j, wasActive) => {
      if (wasActive && j.status !== 'cancelled') setError(j.error || 'Failed to run backtest')
    },
  })

  /** A setter for one form field, `useState`-style. */
  const field = useCallback(
    <K extends keyof ClassicForm>(k: K): Setter<ClassicForm[K]> =>
      (v) => setForm((f) => ({ ...f, [k]: typeof v === 'function' ? (v as (p: ClassicForm[K]) => ClassicForm[K])(f[k]) : v })),
    [setForm],
  )
  const setters = useMemo(
    () => ({
      setSymbol: field('symbol'), setStrategy: field('strategy'), setStartDate: field('startDate'), setEndDate: field('endDate'),
      setInitialCapital: field('initialCapital'), setPositionSizing: field('positionSizing'), setCommissionRate: field('commissionRate'),
      setSlippageRate: field('slippageRate'), setStopLoss: field('stopLoss'), setTakeProfit: field('takeProfit'),
      setTrailingStop: field('trailingStop'), setMaxPyramiding: field('maxPyramiding'), setWalkForward: field('walkForward'),
      setMonteCarlo: field('monteCarlo'), setBenchmark: field('benchmark'),
    }),
    [field],
  )

  const run = useCallback(async (req: BacktestRequest) => {
    if (jobs.running) return
    setError(null)
    try {
      jobs.track(await classicJobApi.start(req))
    } catch (e) {
      setError((e as Error).message || 'Failed to run backtest')
    }
  }, [jobs, setError])

  const cancel = useCallback(async () => {
    if (!jobs.jobId) return
    try {
      jobs.update(await classicJobApi.cancel(jobs.jobId))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [jobs, setError])

  /** Default form, no result; drops the server copy too. */
  const reset = useCallback(() => {
    if (jobs.jobId && isAuthenticated) classicJobApi.forget(jobs.jobId).catch(() => undefined)
    jobs.clear()
    resultCtl.reset()
    formCtl.reset()
    setError(null)
  }, [jobs, isAuthenticated, resultCtl, formCtl, setError])

  return {
    form, setForm, ...setters, result, setResult, error, setError,
    job: jobs.job, running: jobs.running, startedAt: jobs.stored?.startedAt ?? null,
    run, cancel, reset, restored: formCtl.restored,
  }
}
