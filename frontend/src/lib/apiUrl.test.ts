import { describe, expect, it } from 'vitest'
import { apiUrl } from '@/lib/api'

describe('apiUrl', () => {
  it('resolves same-origin paths when NEXT_PUBLIC_API_URL is empty', () => {
    // `new URL('/api/v1/...')` without a base throws "Invalid URL"; that broke
    // movers, breaking news and alerts whenever the API was same-origin.
    const u = apiUrl('/api/v1/market/movers')
    u.searchParams.set('limit', '5')
    expect(u.pathname).toBe('/api/v1/market/movers')
    expect(u.origin).toBe(window.location.origin)
    expect(u.toString()).toContain('limit=5')
  })
})
