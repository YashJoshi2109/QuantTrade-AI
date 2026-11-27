'use client'

/**
 * State + job lifecycle for the Strategy Lab, shared by desktop and mobile.
 *
 * Persistence (lib/persistentState, keyed per user): the builder draft (spec,
 * robustness, preset), the active tab, the last result and the current job
 * are restored when the user comes back. Jobs run on the server, so leaving
 * the page does not stop them; on return the job is polled again
 * (lib/persistentJob) and shows progress or the finished result.
 */
import { useCallback, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import {
  DEFAULT_ROBUSTNESS, baseSpec, gridSize, labApi, labErrorStatus, specFromPreset, validateSpec,
  type Job, type LabResult, type RobustnessOptions, type StrategySpec,
} from '@/lib/backtestLab'
import { usePersistentJob } from '@/lib/persistentJob'
import { oneOf, usePersistentState } from '@/lib/persistentState'

export type LabTab = 'builder' | 'results' | 'trades' | 'robustness'

const LEGACY_STORAGE_KEY = 'qt.strategyLab.v1'
const DAY_MS = 24 * 3600 * 1000

export interface LabDraft {
  spec: StrategySpec
  robustness: RobustnessOptions
  presetId: string | null
}

export function parseDraft(v: unknown): LabDraft | null | undefined {
  if (v === null) return null
  const d = v as Partial<LabDraft> | undefined
  if (!d || typeof d !== 'object' || !d.spec || typeof d.spec !== 'object' || !(d.spec as StrategySpec).entry) return undefined
  return {
    spec: { ...baseSpec(), ...d.spec },
    robustness: { ...DEFAULT_ROBUSTNESS, ...(d.robustness || {}) },
    presetId: typeof d.presetId === 'string' ? d.presetId : null,
  }
}

export function parseLabResult(v: unknown): LabResult | null | undefined {
  if (v === null) return null
  const r = v as LabResult | undefined
  return r && typeof r === 'object' && r.metrics && r.spec && Array.isArray(r.trades) ? r : undefined
}

/** One-time read of the pre-versioning key, so existing drafts are kept. */
function legacyDraft(): LabDraft | null {
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return null
    return parseDraft(JSON.parse(raw)) ?? null
  } catch {
    return null
  }
}

async function getJob(id: string): Promise<Job | null> {
  try {
    return await labApi.get(id)
  } catch (e) {
    if (labErrorStatus(e) === 404) return null
    throw e
  }
}

export function useBacktestLab() {
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const meta = useQuery({ queryKey: ['backtest-lab-meta'], queryFn: labApi.meta, staleTime: 3_600_000 })

  const [draft, setDraft, draftCtl] = usePersistentState<LabDraft | null>('strategyLab.draft', null, { version: 1, validate: parseDraft })
  const [tab, setTabState, tabCtl] = usePersistentState<LabTab>('strategyLab.tab', 'builder', {
    version: 1, validate: oneOf<LabTab>(['builder', 'results', 'trades', 'robustness']),
  })
  const [result, setResult, resultCtl] = usePersistentState<LabResult | null>('strategyLab.result', null, {
    version: 1, validate: parseLabResult, maxAgeMs: 7 * DAY_MS,
  })
  const [error, setError] = usePersistentState<string | null>('strategyLab.error', null, { storage: 'session' })

  const jobs = usePersistentJob<LabResult>({
    key: 'strategyLab.job',
    queryKey: 'backtest-lab',
    enabled: isAuthenticated,
    get: getJob,
    latest: () => labApi.latest(false),
    hasResult: !!result,
    onDone: (r, wasActive) => {
      setResult(r)
      setError(null)
      if (wasActive) setTabState('results')
    },
    onFailed: (j, wasActive) => {
      if (wasActive) setError(j.status === 'cancelled' ? null : j.error || 'Backtest failed')
    },
  })

  useEffect(() => {
    if (jobs.pollError) setError(jobs.pollError.message)
  }, [jobs.pollError, setError])

  // Initialise the draft: stored, else the legacy key, else the first preset.
  useEffect(() => {
    if (draft || !draftCtl.restored || !meta.data) return
    const legacy = legacyDraft()
    if (legacy) {
      setDraft(legacy)
      return
    }
    const p = meta.data.presets[0]
    if (p) setDraft({ spec: specFromPreset(p), robustness: DEFAULT_ROBUSTNESS, presetId: p.id })
  }, [draft, draftCtl.restored, meta.data, setDraft])

  const spec = draft?.spec ?? null
  const robustness = draft?.robustness ?? DEFAULT_ROBUSTNESS
  const presetId = draft?.presetId ?? null

  const applyPreset = useCallback((id: string) => {
    const p = meta.data?.presets.find((x) => x.id === id)
    if (!p) return
    setDraft((d) => ({ spec: specFromPreset(p, d?.spec), robustness: d?.robustness ?? DEFAULT_ROBUSTNESS, presetId: id }))
  }, [meta.data, setDraft])

  const update = useCallback((patch: Partial<StrategySpec>) => {
    setDraft((d) => (d ? { ...d, spec: { ...d.spec, ...patch }, presetId: null } : d))
  }, [setDraft])

  const setRobustness = useCallback((next: RobustnessOptions) => {
    setDraft((d) => (d ? { ...d, robustness: next } : d))
  }, [setDraft])

  const errors = useMemo(() => (spec ? validateSpec(spec, meta.data?.limits) : []), [spec, meta.data])
  const combos = spec ? gridSize(spec.param_grid) : 1
  const running = jobs.running
  const hasResult = !!result
  const setTab = useCallback((t: LabTab) => setTabState(t !== 'builder' && !hasResult ? 'builder' : t), [hasResult, setTabState])

  const run = useCallback(async () => {
    if (!spec || errors.length || running) return
    setError(null)
    try {
      const rob = { ...robustness, sweep: robustness.sweep && combos > 1 }
      jobs.track(await labApi.start(spec, rob))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [spec, errors.length, running, robustness, combos, jobs, setError])

  const cancel = useCallback(async () => {
    if (!jobs.jobId) return
    try {
      jobs.update(await labApi.cancel(jobs.jobId))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [jobs, setError])

  /** Back to the first preset with no result. Cancels a running job and drops the server copy. */
  const reset = useCallback(() => {
    if (jobs.jobId && isAuthenticated) labApi.forget(jobs.jobId).catch(() => undefined)
    jobs.clear()
    resultCtl.reset()
    tabCtl.reset()
    setError(null)
    try {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch {
      /* storage blocked */
    }
    const p = meta.data?.presets[0]
    if (p) setDraft({ spec: specFromPreset(p), robustness: DEFAULT_ROBUSTNESS, presetId: p.id })
    else draftCtl.reset()
  }, [jobs, isAuthenticated, resultCtl, tabCtl, setError, meta.data, setDraft, draftCtl])

  // A stored tab other than the builder needs a result to show.
  const effectiveTab: LabTab = tab !== 'builder' && !result ? 'builder' : tab

  return {
    isAuthenticated, authLoading, meta: meta.data, metaError: meta.error as Error | null,
    // Only block on metadata when there is no restored draft to show.
    metaLoading: meta.isLoading && !spec,
    spec, setSpec: update, robustness, setRobustness, presetId, applyPreset,
    tab: effectiveTab, setTab, job: jobs.job as Job | null,
    running, result, error, errors, combos, run, cancel, reset,
  }
}

export type LabController = ReturnType<typeof useBacktestLab>
