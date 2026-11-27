import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SEARCH_DEBOUNCE_MS, useSymbolSearch } from './useSymbolSearch'

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useSymbolSearch', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) =>
      new Response(JSON.stringify({ query: '', results: [{ symbol: 'AAPL', name: 'Apple', exchange: 'NASDAQ', kind: 'stock', country: 'US', market_cap: null, source: 'db' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('debounces keystrokes into ONE /api/search request for the settled query', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result, rerender } = renderHook(({ q }) => useSymbolSearch(q), { wrapper: wrapper(), initialProps: { q: '' } })
    for (const q of ['a', 'ap', 'app']) {
      rerender({ q })
      act(() => {
        vi.advanceTimersByTime(50)
      })
    }
    expect(fetchMock).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 10)
    })
    await waitFor(() => expect(result.current.results).toHaveLength(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/search?q=app&limit=12')
    // Same query again (e.g. retyped) is served from cache: still one call.
    rerender({ q: 'ap' })
    rerender({ q: 'app' })
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 10)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not fetch for an empty query', () => {
    renderHook(() => useSymbolSearch('   '), { wrapper: wrapper() })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
