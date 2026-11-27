import { describe, expect, it } from 'vitest'
import {
  CONDITION_ORDER,
  DISMISS_TTL_MS,
  describeAlert,
  distanceToLevel,
  formatThreshold,
  pruneDismissed,
  suggestionToInput,
  validateThreshold,
  visibleSuggestions,
  type AlertSuggestion,
} from './alerts'

describe('alert helpers', () => {
  it('describes each condition', () => {
    expect(describeAlert({ condition: 'price_above', threshold: 210 })).toBe('Price rises above $210.00')
    expect(describeAlert({ condition: 'change_down_pct', threshold: 3 })).toBe('Down on the day by 3%')
    expect(describeAlert({ condition: 'rsi_below', threshold: 30 })).toBe('RSI(14) below 30')
    expect(CONDITION_ORDER).toHaveLength(7)
    expect(describeAlert({ condition: "earnings_within_days", threshold: 3 })).toBe("Earnings report within 3 days")
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

describe('suggested alerts helpers', () => {
  const s = (over: Partial<AlertSuggestion> = {}): AlertSuggestion => ({
    id: 'AAPL:price_above:203', symbol: 'AAPL', name: 'Apple', condition: 'price_above', condition_label: '',
    threshold: 203, reason: 'AAPL is 1.2% below its 52-week high', source: 'near_52w_high', label: '52-week high',
    current_price: 200, change_percent: 0.4, repeat: false, note: '52-week high breakout', score: 66, ...over,
  })

  it('maps a suggestion to a create payload', () => {
    expect(suggestionToInput(s())).toEqual({
      symbol: 'AAPL', condition: 'price_above', threshold: 203, repeat: false, notify_email: false, note: '52-week high breakout',
    })
    expect(suggestionToInput(s({ note: null })).note).toBeUndefined()
  })

  it('hides dismissed, just-added and already-existing alerts', () => {
    const list = [
      s(),
      s({ id: 'MSFT:price_below:400', symbol: 'MSFT', condition: 'price_below' }),
      s({ id: 'KO:earnings_within_days:3', symbol: 'KO', condition: 'earnings_within_days' }),
    ]
    expect(visibleSuggestions(list, {}).map((x) => x.symbol)).toEqual(['AAPL', 'MSFT', 'KO'])
    expect(visibleSuggestions(list, { 'AAPL:price_above:203': 1 }).map((x) => x.symbol)).toEqual(['MSFT', 'KO'])
    const alerts = [
      { symbol: 'MSFT', condition: 'price_below' as const, status: 'active' as const },
      { symbol: 'KO', condition: 'earnings_within_days' as const, status: 'triggered' as const },
    ]
    expect(visibleSuggestions(list, {}, alerts).map((x) => x.symbol)).toEqual(['AAPL', 'KO'])
  })

  it('expires dismissals after a week', () => {
    const now = 1_000_000_000_000
    expect(pruneDismissed({ a: now - 1000, b: now - DISMISS_TTL_MS - 1 }, now)).toEqual({ a: now - 1000 })
  })
})
