import { describe, expect, it } from 'vitest'
import { buildFanGeometry, type ForecastResponse } from './ForecastPanel'

const pt = (h: number, point: number, w: number) => ({
  h, date: `2026-12-${String(h).padStart(2, '0')}`, point, exp_return_pct: 0, prob_up: 0.5,
  bands: { '50': [point - w / 3, point + w / 3], '80': [point - w / 1.5, point + w / 1.5], '95': [point - w, point + w] },
}) as ForecastResponse['path'][number]

const data = {
  ticker: 'TEST', as_of: '2026-11-24', last_close: 100,
  path: Array.from({ length: 20 }, (_, i) => pt(i + 1, 100 + i * 0.1, 2 + i)),
} as unknown as ForecastResponse

describe('buildFanGeometry', () => {
  const g = buildFanGeometry(data, 640, 220)
  it('keeps every band point inside the viewBox', () => {
    for (const lvl of ['50', '80', '95'] as const) {
      for (const pair of g.area(lvl).split(' ')) {
        const [x, y] = pair.split(',').map(Number)
        expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(640)
        expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(220)
      }
    }
  })
  it('starts at today\'s close and widens', () => {
    expect(g.line.split(' ')[0]).toBe(`${g.x(0)},${g.naiveY}`)
    expect(g.lo).toBeCloseTo(80.9, 1)
    expect(g.hi).toBeCloseTo(122.9, 1)
  })
})
