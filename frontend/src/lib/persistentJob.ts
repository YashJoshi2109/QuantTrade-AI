'use client'

/**
 * A server-side job (backtests) that the page re-attaches to when the user
 * comes back.
 *
 * - The job id is stored per user (lib/persistentState). On return it is
 *   polled again, so the page shows live progress or the finished result.
 * - With no stored id (another device, cleared storage) the user's latest job
 *   of this kind is fetched once from the server and adopted if it is still
 *   running, or finished and the page has no result yet.
 * - Polling goes through React Query, so several mounted trees (desktop and
 *   mobile) share one request loop.
 */
import { useCallback, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { oneOf, usePersistScope, usePersistentState } from './persistentState'

export type ServerJobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled' | 'timeout'

export interface ServerJob<R> {
  id: string
  status: ServerJobStatus
  stage: string
  progress: number
  error: string | null
  created?: number
  result?: R
}

/** What the browser remembers about the job it started or adopted. */
export interface StoredJob {
  id: string
  status: ServerJobStatus
  /** Client clock when the run started (for "elapsed" displays). */
  startedAt: number
}

export const ACTIVE_STATUSES: readonly ServerJobStatus[] = ['queued', 'running']
export const isActive = (s: ServerJobStatus | undefined | null) => !!s && ACTIVE_STATUSES.includes(s)

const statusOf = oneOf<ServerJobStatus>(['queued', 'running', 'done', 'error', 'cancelled', 'timeout'])

export function parseStoredJob(v: unknown): StoredJob | null | undefined {
  if (v === null) return null
  const j = v as Partial<StoredJob> | undefined
  if (!j || typeof j !== 'object' || typeof j.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(j.id)) return undefined
  return {
    id: j.id,
    status: statusOf(j.status) ?? 'queued',
    startedAt: typeof j.startedAt === 'number' && Number.isFinite(j.startedAt) ? j.startedAt : Date.now(),
  }
}

export interface PersistentJobOptions<R> {
  /** Storage key, e.g. "strategyLab.job". */
  key: string
  /** Query namespace, e.g. "backtest-lab". */
  queryKey: string
  /** Signed in: the job API needs auth. */
  enabled: boolean
  get: (id: string) => Promise<ServerJob<R> | null>
  latest?: () => Promise<ServerJob<R> | null>
  /** True when the page already shows a result (skip adopting a finished job). */
  hasResult: boolean
  /** The job finished with a result. `wasActive` is true when this browser saw it running. */
  onDone: (result: R, wasActive: boolean) => void
  /** The job ended without a result. */
  onFailed?: (job: ServerJob<R>, wasActive: boolean) => void
  pollMs?: number
}

const DAY_MS = 24 * 3600 * 1000

export function usePersistentJob<R>(o: PersistentJobOptions<R>) {
  const queryClient = useQueryClient()
  const scope = usePersistScope()
  const [stored, setStored, storedCtl] = usePersistentState<StoredJob | null>(o.key, null, {
    version: 1, validate: parseStoredJob, maxAgeMs: DAY_MS, debounceMs: 0,
  })
  const cb = useRef(o)
  cb.current = o

  const jobId = stored?.id ?? null
  const jobKey = [o.queryKey, 'job', scope, jobId] as const
  const jobQuery = useQuery<ServerJob<R> | null>({
    queryKey: jobKey,
    enabled: !!jobId && o.enabled,
    queryFn: () => cb.current.get(jobId!),
    refetchInterval: (q) => (isActive(q.state.data?.status) ? o.pollMs ?? 700 : false),
    refetchIntervalInBackground: true,
    staleTime: 0,
    retry: 2,
  })

  const latestQuery = useQuery<ServerJob<R> | null>({
    queryKey: [o.queryKey, 'latest', scope],
    enabled: !!o.latest && o.enabled && storedCtl.restored && !jobId,
    queryFn: () => cb.current.latest!().catch(() => null),
    staleTime: Infinity,
    retry: false,
  })

  // Adopt the server's latest job when this browser has none.
  useEffect(() => {
    const j = latestQuery.data
    if (!j || jobId) return
    if (isActive(j.status)) setStored({ id: j.id, status: j.status, startedAt: (j.created ?? Date.now() / 1000) * 1000 })
    else if (j.status === 'done' && !o.hasResult) setStored({ id: j.id, status: 'running', startedAt: Date.now() })
  }, [latestQuery.data, jobId, o.hasResult, setStored])

  // React to status changes. Every mounted tree runs this; the writes are idempotent.
  const handled = useRef<string | null>(null)
  useEffect(() => {
    if (!stored) return
    if (jobQuery.data === null && jobQuery.isFetched && !jobQuery.isFetching) {
      setStored(null) // expired or unknown: keep any cached result, forget the id
      return
    }
    const j = jobQuery.data
    if (!j || j.id !== stored.id) return
    const sig = `${j.id}:${j.status}`
    if (handled.current === sig) return
    handled.current = sig
    const wasActive = isActive(stored.status)
    if (j.status === 'done' && j.result !== undefined) cb.current.onDone(j.result, wasActive)
    else if (!isActive(j.status)) cb.current.onFailed?.(j, wasActive)
    if (j.status !== stored.status) setStored({ ...stored, status: j.status })
  }, [jobQuery.data, jobQuery.isFetched, jobQuery.isFetching, stored, setStored])

  /** Track a job the page just started. */
  const track = useCallback((j: ServerJob<R>) => {
    handled.current = null
    queryClient.setQueryData([o.queryKey, 'job', scope, j.id], j)
    setStored({ id: j.id, status: j.status, startedAt: Date.now() })
  }, [queryClient, o.queryKey, scope, setStored])

  /** Record a status the page learned itself (e.g. after cancel). */
  const update = useCallback((j: ServerJob<R>) => {
    queryClient.setQueryData([o.queryKey, 'job', scope, j.id], j)
    setStored((s) => (s && s.id === j.id ? { ...s, status: j.status } : s))
  }, [queryClient, o.queryKey, scope, setStored])

  /** Forget the job locally (and stop re-adopting the server's latest). */
  const clear = useCallback(() => {
    queryClient.setQueryData([o.queryKey, 'latest', scope], null)
    storedCtl.reset()
  }, [queryClient, o.queryKey, scope, storedCtl])

  const job = jobQuery.data ?? null
  const running = !!stored && isActive(stored.status) && (!job || isActive(job.status))
  const shown: ServerJob<R> | null = running
    ? job ?? { id: stored!.id, status: stored!.status, stage: 'Reconnecting', progress: 0, error: null }
    : job

  return {
    stored, jobId, job: shown, running, track, update, clear,
    pollError: jobQuery.error as Error | null,
    restored: storedCtl.restored,
  }
}
