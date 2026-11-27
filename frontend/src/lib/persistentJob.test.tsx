import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePersistentJob, type ServerJob } from './persistentJob'
import { __resetPersistentStateForTests } from './persistentState'

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

const job = (status: ServerJob<{ n: number }>['status'], result?: { n: number }): ServerJob<{ n: number }> => ({
  id: 'job1', status, stage: status, progress: status === 'done' ? 1 : 0.5, error: null, result,
})

beforeEach(() => {
  window.localStorage.clear()
  __resetPersistentStateForTests()
})

describe('usePersistentJob', () => {
  it('re-attaches to a stored running job and delivers the result when it finishes', async () => {
    // The user started a job, then left the page.
    window.localStorage.setItem('qt:anon:lab.job', JSON.stringify({ v: 1, t: Date.now(), d: { id: 'job1', status: 'running', startedAt: 1 } }))
    const get = vi.fn()
      .mockResolvedValueOnce(job('running'))
      .mockResolvedValue(job('done', { n: 7 }))
    const onDone = vi.fn()
    const { result } = renderHook(
      () => usePersistentJob({ key: 'lab.job', queryKey: 't1', enabled: true, get, hasResult: false, onDone, pollMs: 10 }),
      { wrapper: wrapper() },
    )
    // Shown as running immediately (no idle flash) while reconnecting.
    expect(result.current.running).toBe(true)
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ n: 7 }, true))
    expect(get).toHaveBeenCalledWith('job1')
    expect(result.current.running).toBe(false)
    expect(JSON.parse(window.localStorage.getItem('qt:anon:lab.job')!).d.status).toBe('done')
  })

  it('forgets an expired job id but keeps going', async () => {
    window.localStorage.setItem('qt:anon:lab.job', JSON.stringify({ v: 1, t: Date.now(), d: { id: 'gone', status: 'running', startedAt: 1 } }))
    const { result } = renderHook(
      () => usePersistentJob({ key: 'lab.job', queryKey: 't2', enabled: true, get: async () => null, hasResult: true, onDone: vi.fn() }),
      { wrapper: wrapper() },
    )
    await waitFor(() => expect(result.current.stored).toBeNull())
    expect(result.current.running).toBe(false)
  })

  it('adopts the server’s latest active job when this browser has none (another device)', async () => {
    const latest = vi.fn().mockResolvedValue({ ...job('running'), created: 100 })
    const get = vi.fn().mockResolvedValue(job('running'))
    const { result } = renderHook(
      () => usePersistentJob({ key: 'lab.job', queryKey: 't3', enabled: true, get, latest, hasResult: false, onDone: vi.fn(), pollMs: 1000 }),
      { wrapper: wrapper() },
    )
    await waitFor(() => expect(result.current.stored?.id).toBe('job1'))
    expect(result.current.running).toBe(true)
  })

  it('does not poll while signed out', async () => {
    window.localStorage.setItem('qt:anon:lab.job', JSON.stringify({ v: 1, t: Date.now(), d: { id: 'job1', status: 'running', startedAt: 1 } }))
    const get = vi.fn()
    renderHook(
      () => usePersistentJob({ key: 'lab.job', queryKey: 't4', enabled: false, get, hasResult: false, onDone: vi.fn() }),
      { wrapper: wrapper() },
    )
    await new Promise((r) => setTimeout(r, 30))
    expect(get).not.toHaveBeenCalled()
  })
})
