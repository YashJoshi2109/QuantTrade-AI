import { describe, expect, it } from 'vitest'
import { degradedCount, fmtDelta, fmtInt, fmtMs, fmtPct, fmtUsd, flatten, statusTone, toCsv, ADMIN_PAGES } from './admin'

describe('admin formatting', () => {
  it('renders missing values as a dash, never a fake number', () => {
    for (const f of [fmtInt, fmtPct, fmtUsd, fmtMs]) {
      expect(f(null)).toBe('—')
      expect(f(undefined)).toBe('—')
      expect(f(Number.NaN)).toBe('—')
    }
    expect(fmtDelta(null)).toEqual({ text: '—', tone: 'none' })
  })

  it('formats real values', () => {
    expect(fmtInt(12345)).toBe('12,345')
    expect(fmtPct(0.1234)).toBe('12.3%')
    expect(fmtUsd(1.5)).toBe('$1.50')
    expect(fmtMs(1530)).toBe('1.53 s')
    expect(fmtMs(80)).toBe('80 ms')
    expect(fmtDelta(12.34)).toEqual({ text: '+12.3%', tone: 'up' })
    expect(fmtDelta(-3)).toEqual({ text: '-3.0%', tone: 'down' })
  })

  it('maps statuses to tones and counts degraded services', () => {
    expect(statusTone('ok')).toBe('ok')
    expect(statusTone('degraded')).toBe('degraded')
    expect(statusTone('down')).toBe('down')
    expect(statusTone('suspended')).toBe('down')
    expect(statusTone('not_configured')).toBe('pending')
    expect(degradedCount([{ status: 'ok' }, { status: 'degraded' }, { status: 'down' }, { status: 'pending' }])).toBe(2)
    expect(degradedCount(null)).toBe(0)
  })
})

describe('admin export', () => {
  it('flattens nested objects', () => {
    expect(flatten({ a: { b: 1, c: [1, 2] }, d: null })).toEqual({ 'a.b': 1, 'a.c': '[1,2]', d: null })
  })

  it('builds CSV sections and escapes cells', () => {
    const csv = toCsv({ kpis: { users: { value: 3 } }, rows: [{ name: 'a,b', n: 1 }, { name: 'say "hi"', n: 2 }] })
    expect(csv).toContain('# summary')
    expect(csv).toContain('kpis.users.value,3')
    expect(csv).toContain('# rows')
    expect(csv).toContain('"a,b",1')
    expect(csv).toContain('"say ""hi""",2')
  })

  it('lists every console page once', () => {
    const hrefs = ADMIN_PAGES.map((p) => p.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
    expect(hrefs).toContain('/admin/traffic')
  })
})
