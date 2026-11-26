import { describe, expect, it } from 'vitest'
import {
  lastValue,
  linePath,
  nearestIndex,
  niceTicks,
  normalisePct,
  scaleLinear,
  valueDomain,
  xTickIndexes,
} from './lineChart'

describe('lineChart geometry', () => {
  it('domain always contains zero and pads', () => {
    const [lo, hi] = valueDomain([{ values: [2, 5, null, 8] }])
    expect(lo).toBeLessThan(0)
    expect(hi).toBeGreaterThan(8)
    expect(valueDomain([{ values: [null] }])).toEqual([-1, 1])
    const [a, b] = valueDomain([{ values: [0, 0] }])
    expect(a).toBeLessThan(0)
    expect(b).toBeGreaterThan(0)
  })

  it('nice ticks are round and inside the domain', () => {
    expect(niceTicks(-3, 12, 4)).toEqual([0, 5, 10])
    expect(niceTicks(-0.4, 0.9, 4)).toEqual([0, 0.5])
    expect(niceTicks(1, 1)).toEqual([])
  })

  it('line path breaks on gaps instead of inventing points', () => {
    const x = (i: number) => i * 10
    const y = scaleLinear(0, 10, 100, 0)
    expect(linePath([0, 10, null, 5], x, y)).toBe('M0.0,100.0L10.0,0.0M30.0,50.0')
    expect(linePath([null, null], x, y)).toBe('')
  })

  it('nearest index clamps to the data', () => {
    expect(nearestIndex(0, 10, 100, 11)).toBe(0)
    expect(nearestIndex(60, 10, 100, 11)).toBe(5)
    expect(nearestIndex(999, 10, 100, 11)).toBe(10)
    expect(nearestIndex(50, 10, 100, 1)).toBe(0)
  })

  it('normalises raw closes to % from the first valid close', () => {
    const out = normalisePct([null, 100, 110, null, 90])
    expect(out[0]).toBeNull()
    expect(out[1]).toBe(0)
    expect(out[2]).toBeCloseTo(10)
    expect(out[3]).toBeNull()
    expect(out[4]).toBeCloseTo(-10)
  })

  it('x ticks include both ends', () => {
    expect(xTickIndexes(3)).toEqual([0, 1, 2])
    expect(xTickIndexes(100, 5)).toEqual([0, 25, 50, 74, 99])
    expect(lastValue([1, 2, null])).toBe(2)
    expect(lastValue([])).toBeNull()
  })
})
