'use client'

/**
 * ONE app-wide subscription to /api/v1/system/status. The pill, the popover,
 * the mobile sheet, /status and the Copilot banner all read this context, so
 * an open tab makes exactly one request per second (none while hidden: React
 * Query skips interval refetches when the document is not visible; 10 s
 * after a failed request).
 */
import { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  appendHistory,
  fetchSystemStatus,
  pollInterval,
  type History,
  type SystemStatus,
} from '@/lib/systemStatus'

interface Ctx {
  data: SystemStatus | undefined
  /** Date.now() when `data` arrived (for skew-free "checked Xs ago"). */
  receivedAt: number
  isLoading: boolean
  /** Last request failed (data may still hold the previous snapshot). */
  failed: boolean
  history: History
}

const SystemStatusContext = createContext<Ctx | null>(null)

export const SYSTEM_STATUS_QUERY_KEY = ['system-status'] as const

export function SystemStatusProvider({ children }: { children: ReactNode }) {
  const q = useQuery({
    queryKey: SYSTEM_STATUS_QUERY_KEY,
    queryFn: ({ signal }) => fetchSystemStatus(signal),
    refetchInterval: (query) => pollInterval(query.state.status === 'error' || query.state.fetchFailureCount > 0),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    staleTime: 0,
    retry: false,
    // background poll: GlobalDataLoadingBar ignores it
    meta: { background: true },
  })
  const [history, setHistory] = useState<History>({})
  const receivedAt = useRef(0)
  const updatedAt = q.dataUpdatedAt

  useEffect(() => {
    if (!q.data || !updatedAt) return
    receivedAt.current = updatedAt
    setHistory((prev) => appendHistory(prev, q.data as SystemStatus, Date.now()))
  }, [q.data, updatedAt])

  const value = useMemo<Ctx>(
    () => ({
      data: q.data,
      receivedAt: updatedAt || receivedAt.current,
      isLoading: q.isLoading,
      failed: q.isError || q.failureCount > 0,
      history,
    }),
    [q.data, updatedAt, q.isLoading, q.isError, q.failureCount, history],
  )
  return <SystemStatusContext.Provider value={value}>{children}</SystemStatusContext.Provider>
}

const EMPTY: Ctx = { data: undefined, receivedAt: 0, isLoading: true, failed: false, history: {} }

export function useSystemStatus(): Ctx {
  return useContext(SystemStatusContext) ?? EMPTY
}

/** Re-render every `ms` so ages tick even when no new snapshot arrives. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [ms])
  return now
}
