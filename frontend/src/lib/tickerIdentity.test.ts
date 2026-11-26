import { describe, expect, it } from 'vitest'
import { displayCompanyName, identityWarning, type TickerIdentity } from './tickerIdentity'

const base: TickerIdentity = {
  ticker: 'PARA',
  status: 'ok',
  note: null,
  listed_name: 'Paramount Global',
  filer_name: null,
  former_name: null,
  successor_symbol: null,
}

describe('identityWarning', () => {
  it('is null for ok / missing identity', () => {
    expect(identityWarning(base)).toBeNull()
    expect(identityWarning(null)).toBeNull()
    expect(identityWarning(undefined)).toBeNull()
  })

  it('explains a known ticker change and links the successor', () => {
    const w = identityWarning({
      ...base,
      status: 'changed',
      former_name: 'Paramount Global',
      successor_symbol: 'SKYD',
      note: 'Paramount Global merged with Skydance in Aug 2025 (traded as PSKY); renamed Skydance Corp (SKYD).',
    })
    expect(w?.title).toBe('PARA no longer refers to Paramount Global')
    expect(w?.body).toContain('Skydance')
    expect(w?.body).toContain('may belong to another company')
    expect(w?.successorHref).toBe('/research?symbol=SKYD')
  })

  it('handles a mismatch without a note or successor', () => {
    const w = identityWarning({ ...base, status: 'mismatch', filer_name: 'Parabolic Technologies, Inc.' })
    expect(w?.title).toBe('PARA may refer to a different company')
    expect(w?.body).toContain('Parabolic Technologies')
    expect(w?.successorHref).toBeNull()
  })
})

describe('displayCompanyName', () => {
  const changed = { ...base, status: 'changed' as const, former_name: 'Paramount Global' }
  it('marks the stale listed name as former', () => {
    expect(displayCompanyName('Paramount Global', changed)).toBe('Paramount Global (former)')
  })
  it('leaves other names and ok identities alone', () => {
    expect(displayCompanyName('Parabolic Technologies', changed)).toBe('Parabolic Technologies')
    expect(displayCompanyName('Paramount Global', base)).toBe('Paramount Global')
    expect(displayCompanyName(null, changed)).toBeNull()
  })
})
