import { describe, expect, it } from 'vitest'
import { safeRedirectPath, signInHref } from './authRedirect'

describe('safeRedirectPath', () => {
  it('keeps same-origin paths with their query', () => {
    expect(safeRedirectPath('/mlops')).toBe('/mlops')
    expect(safeRedirectPath('/research?symbol=AAPL')).toBe('/research?symbol=AAPL')
    expect(safeRedirectPath(encodeURIComponent('/alerts?tab=active'))).toBe('/alerts?tab=active')
  })

  it('falls back to the dashboard for anything that could leave the site', () => {
    for (const bad of [
      null,
      undefined,
      '',
      'mlops',
      'https://evil.com',
      '//evil.com',
      '/\\evil.com',
      encodeURIComponent('//evil.com'),
      'javascript:alert(1)',
      '/\n/evil.com',
      '%E0%A4%A',
    ]) {
      expect(safeRedirectPath(bad)).toBe('/')
    }
  })

  it('never redirects back into the auth page', () => {
    expect(safeRedirectPath('/auth')).toBe('/')
    expect(safeRedirectPath('/auth?redirect=/x')).toBe('/')
    expect(safeRedirectPath('/auth/forgot-password')).toBe('/')
  })
})

describe('signInHref', () => {
  it('encodes the return path', () => {
    expect(signInHref('/notifications')).toBe('/auth?redirect=%2Fnotifications')
    expect(signInHref('/research?symbol=MSFT')).toBe('/auth?redirect=%2Fresearch%3Fsymbol%3DMSFT')
  })

  it('drops the parameter when there is nowhere useful to return to', () => {
    expect(signInHref(undefined)).toBe('/auth')
    expect(signInHref('/')).toBe('/auth')
    expect(signInHref('//evil.com')).toBe('/auth')
  })
})
