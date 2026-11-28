import { afterEach, describe, expect, it, vi } from 'vitest'
import { BRAND_INTRO_STORAGE_KEY, shouldShowBrandIntro } from './brandIntro'

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce'), media: q }))
}

describe('shouldShowBrandIntro', () => {
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('shows on a first visit that lands on home', () => {
    mockReducedMotion(false)
    expect(shouldShowBrandIntro('/')).toBe(true)
  })

  it('never shows on deep links', () => {
    mockReducedMotion(false)
    for (const p of ['/markets', '/research', '/earnings', '/dividends', '/screener', null]) {
      expect(shouldShowBrandIntro(p)).toBe(false)
    }
  })

  it('does not show again once seen', () => {
    mockReducedMotion(false)
    localStorage.setItem(BRAND_INTRO_STORAGE_KEY, '1')
    expect(shouldShowBrandIntro('/')).toBe(false)
  })

  it('respects prefers-reduced-motion', () => {
    mockReducedMotion(true)
    expect(shouldShowBrandIntro('/')).toBe(false)
  })
})
