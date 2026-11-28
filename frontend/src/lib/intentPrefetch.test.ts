import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetPrefetchedForTests, prefetchKey, prefetchOnce } from './intentPrefetch'

describe('prefetchKey', () => {
  it('keeps path + search and drops the hash', () => {
    expect(prefetchKey('/research?symbol=NVDA')).toBe('/research?symbol=NVDA')
    expect(prefetchKey('/terms#privacy')).toBe('/terms')
    expect(prefetchKey('/')).toBe('/')
  })

  it('rejects non-route hrefs', () => {
    expect(prefetchKey(undefined)).toBeNull()
    expect(prefetchKey('')).toBeNull()
    expect(prefetchKey('#more')).toBeNull()
    expect(prefetchKey('https://www.github.com/x')).toBeNull()
    expect(prefetchKey('//evil.example/x')).toBeNull()
    expect(prefetchKey('mailto:a@b.c')).toBeNull()
  })
})

describe('prefetchOnce', () => {
  beforeEach(() => __resetPrefetchedForTests())

  it('prefetches each route at most once per session', () => {
    const router = { prefetch: vi.fn() }
    expect(prefetchOnce(router, '/dividends')).toBe(true)
    expect(prefetchOnce(router, '/dividends')).toBe(false)
    expect(prefetchOnce(router, '/dividends')).toBe(false)
    expect(prefetchOnce(router, '/earnings')).toBe(true)
    expect(router.prefetch).toHaveBeenCalledTimes(2)
    expect(router.prefetch).toHaveBeenNthCalledWith(1, '/dividends')
    expect(router.prefetch).toHaveBeenNthCalledWith(2, '/earnings')
  })

  it('dedupes across router instances and hash variants', () => {
    const a = { prefetch: vi.fn() }
    const b = { prefetch: vi.fn() }
    prefetchOnce(a, '/terms')
    prefetchOnce(b, '/terms#risk')
    expect(a.prefetch).toHaveBeenCalledTimes(1)
    expect(b.prefetch).not.toHaveBeenCalled()
  })

  it('treats different query strings as different routes', () => {
    const router = { prefetch: vi.fn() }
    prefetchOnce(router, '/research?symbol=NVDA')
    prefetchOnce(router, '/research?symbol=AAPL')
    expect(router.prefetch).toHaveBeenCalledTimes(2)
  })

  it('ignores external and hash-only hrefs', () => {
    const router = { prefetch: vi.fn() }
    expect(prefetchOnce(router, 'https://example.com')).toBe(false)
    expect(prefetchOnce(router, '#more')).toBe(false)
    expect(prefetchOnce(router, null)).toBe(false)
    expect(router.prefetch).not.toHaveBeenCalled()
  })

  it('allows a retry when the router throws', () => {
    const router = {
      prefetch: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('offline')
        })
        .mockImplementation(() => {}),
    }
    expect(prefetchOnce(router, '/screener')).toBe(false)
    expect(prefetchOnce(router, '/screener')).toBe(true)
    expect(prefetchOnce(router, '/screener')).toBe(false)
    expect(router.prefetch).toHaveBeenCalledTimes(2)
  })
})
