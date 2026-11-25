import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test'
})

import fixture from '@/lib/__fixtures__/newsFeed.json'
import { useNewsFeed, computeLagSeconds } from './useNewsFeed'
import { resetNewsFeedAvailability, normalizeFeedResponse } from '@/lib/newsFeed'
import { __resetNewsSocketForTests, reconnectDelay } from '@/lib/newsSocket'

class MockSocket {
  static instances: MockSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  constructor(public url: string) {
    MockSocket.instances.push(this)
  }
  open() {
    this.onopen?.()
  }
  emit(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
  close() {
    this.closed = true
  }
  drop() {
    this.onclose?.()
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function wrapper(client: QueryClient) {
  return function W({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

const fetchMock = vi.fn()
let client: QueryClient

beforeEach(() => {
  MockSocket.instances = []
  __resetNewsSocketForTests()
  resetNewsFeedAvailability()
  vi.stubGlobal('WebSocket', MockSocket)
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) => {
    const u = new URL(String(url))
    if (u.pathname === '/api/v1/news/feed') {
      const ticker = u.searchParams.get('ticker')
      const items = ticker
        ? fixture.feed.items.filter((i) => i.tickers.includes(ticker))
        : fixture.feed.items
      return jsonResponse({ ...fixture.feed, items })
    }
    return jsonResponse([], 404)
  })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

afterEach(() => {
  cleanup()
  __resetNewsSocketForTests()
  client.clear()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useNewsFeed', () => {
  it('loads the feed and exposes counts + live state', async () => {
    const { result } = renderHook(() => useNewsFeed({ limit: 50 }), { wrapper: wrapper(client) })
    await waitFor(() => expect(result.current.items).toHaveLength(12))
    expect(result.current.mode).toBe('live')
    expect(result.current.totalCount).toBe(12)
    expect(result.current.categoryCounts.earnings).toBe(2)
    expect(result.current.isLive).toBe(false)
    act(() => MockSocket.instances[0].open())
    expect(result.current.isLive).toBe(true)
    expect(result.current.lagSeconds).toBe(4)
  })

  it('merges pushed items: new cluster on top, same cluster updated in place', async () => {
    const { result } = renderHook(() => useNewsFeed({ limit: 50 }), { wrapper: wrapper(client) })
    await waitFor(() => expect(result.current.items).toHaveLength(12))
    const sock = MockSocket.instances[0]
    act(() => sock.open())

    act(() => sock.emit(fixture.push))
    expect(result.current.items).toHaveLength(13)
    expect(result.current.items[0].cluster_id).toBe('c-2001')
    expect(result.current.newIds.has('c-2001')).toBe(true)
    expect(result.current.categoryCounts.product_business).toBe(2)
    expect(result.current.totalCount).toBe(13)

    // same cluster again with more sources → update, no duplicate, no count bump
    act(() =>
      sock.emit({ type: 'news', item: { ...fixture.push.item, sources_count: 5, title: 'AMD deal (updated)' } })
    )
    expect(result.current.items).toHaveLength(13)
    expect(result.current.items.filter((i) => i.cluster_id === 'c-2001')).toHaveLength(1)
    expect(result.current.items[0].title).toBe('AMD deal (updated)')
    expect(result.current.categoryCounts.product_business).toBe(2)

    // malformed / foreign messages are ignored
    act(() => sock.emit({ type: 'heartbeat' }))
    expect(result.current.items).toHaveLength(13)
  })

  it('keeps the requested sort when merging (impact)', async () => {
    const { result } = renderHook(() => useNewsFeed({ sort: 'impact', limit: 50 }), {
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(result.current.items.length).toBeGreaterThan(0))
    act(() => MockSocket.instances[0].emit(fixture.push))
    const impacts = result.current.items.map((i) => i.impact)
    expect([...impacts].sort((a, b) => b - a)).toEqual(impacts)
  })

  it('ignores pushed items outside the ticker filter', async () => {
    const { result } = renderHook(() => useNewsFeed({ ticker: 'NVDA' }), { wrapper: wrapper(client) })
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    act(() => MockSocket.instances[0].emit({ type: 'news', item: { ...fixture.push.item, tickers: ['MSFT'], ai: null } }))
    expect(result.current.items).toHaveLength(1)
    act(() => MockSocket.instances[0].emit(fixture.push)) // AMD deal lists NVDA in ai.affected_tickers
    expect(result.current.items).toHaveLength(2)
  })

  it('shares one socket across hook instances and closes it after the last unmount', async () => {
    const a = renderHook(() => useNewsFeed({ limit: 50 }), { wrapper: wrapper(client) })
    const b = renderHook(() => useNewsFeed({ ticker: 'NVDA' }), { wrapper: wrapper(client) })
    await waitFor(() => expect(b.result.current.items).toHaveLength(1))
    expect(MockSocket.instances).toHaveLength(1)
    expect(MockSocket.instances[0].url).toBe('ws://api.test/api/v1/ws/news')
    a.unmount()
    expect(MockSocket.instances[0].closed).toBe(false)
    b.unmount()
    expect(MockSocket.instances[0].closed).toBe(true)
  })

  it('highlights a pushed item in every instance sharing the cache entry', async () => {
    const a = renderHook(() => useNewsFeed({ limit: 50 }), { wrapper: wrapper(client) })
    const b = renderHook(() => useNewsFeed({ limit: 50 }), { wrapper: wrapper(client) })
    await waitFor(() => expect(b.result.current.items).toHaveLength(12))
    act(() => MockSocket.instances[0].emit(fixture.push))
    expect(a.result.current.newIds.has('c-2001')).toBe(true)
    expect(b.result.current.newIds.has('c-2001')).toBe(true)
    expect(a.result.current.items).toHaveLength(13)
  })

  it('reconnects with backoff after the socket drops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result } = renderHook(() => useNewsFeed({ limit: 50 }), { wrapper: wrapper(client) })
    await waitFor(() => expect(result.current.items).toHaveLength(12))
    act(() => MockSocket.instances[0].open())
    act(() => MockSocket.instances[0].drop())
    expect(result.current.socketStatus).toBe('closed')
    expect(result.current.isLive).toBe(false)
    await act(async () => {
      vi.advanceTimersByTime(2_000)
    })
    expect(MockSocket.instances).toHaveLength(2)
  })

  it('announces new items politely when enabled', async () => {
    const { result } = renderHook(() => useNewsFeed({ limit: 50, announce: true }), {
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(result.current.items).toHaveLength(12))
    act(() => MockSocket.instances[0].emit(fixture.push))
    await waitFor(() => expect(result.current.announcement).toContain('AMD wins'))
  })

  it('falls back to legacy endpoints when the feed 404s', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/v1/news/feed')) return jsonResponse({ detail: 'Symbol not found' }, 404)
      if (String(url).includes('/enhanced/news/market/breaking')) return jsonResponse(fixture.legacy_breaking)
      return jsonResponse([], 404)
    })
    const { result } = renderHook(() => useNewsFeed({ limit: 50 }), { wrapper: wrapper(client) })
    await waitFor(() => expect(result.current.items).toHaveLength(3))
    expect(result.current.mode).toBe('legacy')
    expect(result.current.items.every((i) => i.legacy)).toBe(true)
    act(() => MockSocket.instances[0]?.open())
    expect(result.current.isLive).toBe(false)
  })
})

describe('helpers', () => {
  it('computeLagSeconds uses the most recently ingested item', () => {
    const items = normalizeFeedResponse(fixture.feed).items
    expect(computeLagSeconds(items)).toBe(4)
    expect(computeLagSeconds([])).toBeNull()
  })
  it('reconnectDelay grows exponentially and caps at 60s', () => {
    const mid = () => 0.5
    expect(reconnectDelay(0, mid)).toBe(1000)
    expect(reconnectDelay(3, mid)).toBe(8000)
    expect(reconnectDelay(20, mid)).toBe(60000)
  })
})
