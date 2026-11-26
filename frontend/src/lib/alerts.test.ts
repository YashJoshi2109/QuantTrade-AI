import { describe, expect, it } from 'vitest'
import { CONDITION_ORDER, describeAlert, distanceToLevel, formatThreshold, validateThreshold } from './alerts'

describe('alert helpers', () => {
  it('describes each condition', () => {
    expect(describeAlert({ condition: 'price_above', threshold: 210 })).toBe('Price rises above $210.00')
    expect(describeAlert({ condition: 'change_down_pct', threshold: 3 })).toBe('Down on the day by 3%')
    expect(describeAlert({ condition: 'rsi_below', threshold: 30 })).toBe('RSI(14) below 30')
    expect(CONDITION_ORDER).toHaveLength(6)
  })

  it('formats thresholds by unit', () => {
    expect(formatThreshold('price_below', 1234.5)).toBe('$1,234.50')
    expect(formatThreshold('change_up_pct', 2.5)).toBe('2.5%')
  })

  it('validates threshold bounds like the backend', () => {
    expect(validateThreshold('rsi_above', '150')).toMatch(/between 1 and 99/)
    expect(validateThreshold('change_up_pct', '0')).toMatch(/between/)
    expect(validateThreshold('price_above', 'abc')).toBe('Enter a number')
    expect(validateThreshold('price_above', '10')).toBeNull()
  })

  it('measures distance to a price level only for price alerts', () => {
    expect(distanceToLevel({ condition: 'price_above', threshold: 110, current_price: 100 })).toBeCloseTo(10)
    expect(distanceToLevel({ condition: 'rsi_above', threshold: 70, current_price: 100 })).toBeNull()
    expect(distanceToLevel({ condition: 'price_below', threshold: 90, current_price: null })).toBeNull()
  })
})
