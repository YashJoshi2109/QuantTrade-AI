import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LOGO_MAX_CONCURRENT,
  __logoSlotStats,
  __resetLogoCache,
  acquireLogoSlot,
  isLogoMiss,
  isLogoOk,
  logoProxyUrl,
  markLogoMiss,
  markLogoOk,
} from './logoCache'

describe('logoCache', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetLogoCache()
  })

  it('builds the same-origin proxy URL', () => {
    expect(logoProxyUrl('AAPL')).toBe('/api/logo?symbol=AAPL')
  })

  it('remembers hits and misses', () => {
    const u = logoProxyUrl('CRY')
    expect(isLogoMiss(u)).toBe(false)
    markLogoMiss(u)
    expect(isLogoMiss(u)).toBe(true)
    markLogoOk(logoProxyUrl('AAPL'))
    expect(isLogoOk(logoProxyUrl('AAPL'))).toBe(true)
  })

  it('persists misses across a reload and expires them after the TTL', () => {
    const u = logoProxyUrl('HMYY')
    markLogoMiss(u)
    __resetLogoCache() // simulate a new page load: memory gone, storage kept
    expect(isLogoMiss(u)).toBe(true)

    __resetLogoCache()
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 25 * 60 * 60 * 1000)
    expect(isLogoMiss(u)).toBe(false)
    vi.restoreAllMocks()
  })

  it('survives corrupt storage', () => {
    window.localStorage.setItem('qt:logo-miss:v1', '{not json')
    expect(isLogoMiss(logoProxyUrl('X'))).toBe(false)
  })

  it('caps concurrent loads and hands slots to the next waiter', () => {
    const granted: number[] = []
    const releases = Array.from({ length: LOGO_MAX_CONCURRENT + 3 }, (_, i) => acquireLogoSlot(() => granted.push(i)))
    expect(granted).toHaveLength(LOGO_MAX_CONCURRENT)
    expect(__logoSlotStats()).toEqual({ active: LOGO_MAX_CONCURRENT, waiting: 3 })

    // a waiter that unmounts before its turn leaves the queue without taking a slot
    releases[LOGO_MAX_CONCURRENT]()
    expect(__logoSlotStats().waiting).toBe(2)

    releases[0]()
    expect(granted).toContain(LOGO_MAX_CONCURRENT + 1)
    expect(__logoSlotStats()).toEqual({ active: LOGO_MAX_CONCURRENT, waiting: 1 })

    // double release is a no-op
    releases[0]()
    expect(__logoSlotStats()).toEqual({ active: LOGO_MAX_CONCURRENT, waiting: 1 })
  })
})
