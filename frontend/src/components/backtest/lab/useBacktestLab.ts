'use client'

/** State + job lifecycle for the Strategy Lab, shared by desktop and mobile. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import {
  DEFAULT_ROBUSTNESS, baseSpec, gridSize, labApi, specFromPreset, validateSpec,
  type Job, type LabResult, type RobustnessOptions, type StrategySpec,
} from '@/lib/backtestLab'

export type LabTab = 'builder' | 'results' | 'trades' | 'robustness'

const STORAGE_KEY = 'qt.strategyLab.v1'
const POLL_MS = 700

function load(): { spec: StrategySpec; robustness: RobustnessOptions; presetId: string | null } | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw)
    if (!v?.spec?.entry) return null
    return { spec: { ...baseSpec(), ...v.spec }, robustness: { ...DEFAULT_ROBUSTNESS, ...v.robustness }, presetId: v.presetId ?? null }
  } catch {
    return null
  }
}

export function useBacktestLab() {
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const meta = useQuery({ queryKey: ['backtest-lab-meta'], queryFn: labApi.meta, staleTime: 3_600_000 })
  const [spec, setSpec] = useState<StrategySpec | null>(null)
  const [robustness, setRobustness] = useState<RobustnessOptions>(DEFAULT_ROBUSTNESS)
  const [presetId, setPresetId] = useState<string | null>(null)
  const [tab, setTab] = useState<LabTab>('builder')
  const [job, setJob] = useState<Job | null>(null)
  const [result, setResult] = useState<LabResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Initialise from local storage, else the first preset.
  useEffect(() => {
    if (spec || !meta.data) return
    const saved = typeof window !== 'undefined' ? load() : null
    if (saved) {
      setSpec(saved.spec)
      setRobustness(saved.robustness)
      setPresetId(saved.presetId)
    } else {
      const p = meta.data.presets[0]
      setSpec(specFromPreset(p))
      setPresetId(p.id)
    }
  }, [meta.data, spec])

  useEffect(() => {
    if (!spec) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ spec, robustness, presetId }))
    } catch {
      /* storage unavailable: fine */
    }
  }, [spec, robustness, presetId])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const applyPreset = useCallback((id: string) => {
    const p = meta.data?.presets.find((x) => x.id === id)
    if (!p) return
    setSpec((prev) => specFromPreset(p, prev ?? undefined))
    setPresetId(id)
  }, [meta.data])

  const update = useCallback((patch: Partial<StrategySpec>) => {
    setSpec((s) => (s ? { ...s, ...patch } : s))
    setPresetId(null)
  }, [])

  const errors = useMemo(() => (spec ? validateSpec(spec, meta.data?.limits) : []), [spec, meta.data])
  const combos = spec ? gridSize(spec.param_grid) : 1
  const running = job?.status === 'queued' || job?.status === 'running'

  const poll = useCallback((id: string) => {
    labApi.get(id).then((j) => {
      setJob(j)
      if (j.status === 'done' && j.result) {
        setResult(j.result)
        setTab('results')
      } else if (j.status === 'queued' || j.status === 'running') {
        timer.current = setTimeout(() => poll(id), POLL_MS)
      } else {
        setError(j.error || 'Backtest failed')
      }
    }).catch((e: Error) => setError(e.message))
  }, [])

  const run = useCallback(async () => {
    if (!spec || errors.length || running) return
    setError(null)
    try {
      const rob = { ...robustness, sweep: robustness.sweep && combos > 1 }
      const j = await labApi.start(spec, rob)
      setJob(j)
      poll(j.id)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [spec, errors.length, running, robustness, combos, poll])

  const cancel = useCallback(async () => {
    if (!job) return
    if (timer.current) clearTimeout(timer.current)
    try {
      setJob(await labApi.cancel(job.id))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [job])

  return {
    isAuthenticated, authLoading, meta: meta.data, metaError: meta.error as Error | null, metaLoading: meta.isLoading,
    spec, setSpec: update, robustness, setRobustness, presetId, applyPreset,
    tab, setTab, job, running, result, error, errors, combos, run, cancel,
  }
}

export type LabController = ReturnType<typeof useBacktestLab>
