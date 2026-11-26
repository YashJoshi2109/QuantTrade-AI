import { describe, expect, it } from 'vitest'
import { errorText, estimateOrder, fmtMoney, fmtPct, pnlClass, sliceColor } from './portfolio'

describe('portfolio helpers', () => {
  it('formats money with sign and compact options', () => {
    expect(fmtMoney(1234.5)).toBe('$1,234.50')
    expect(fmtMoney(-12)).toBe('−$12.00')
    expect(fmtMoney(5, { signed: true })).toBe('+$5.00')
    expect(fmtMoney(null)).toBe('—')
    expect(fmtMoney(2_500_000, { compact: true })).toBe('$2.5M')
  })

  it('formats percentages', () => {
    expect(fmtPct(1.234)).toBe('+1.23%')
    expect(fmtPct(-0.5)).toBe('−0.50%')
    expect(fmtPct(undefined)).toBe('—')
  })

  it('colors gains, losses and flat values', () => {
    expect(pnlClass(3)).toContain('emerald')
    expect(pnlClass(-3)).toContain('red')
    expect(pnlClass(0)).toBe('text-fg-secondary')
  })

  it('preflights simulated orders against cash and holdings', () => {
    expect(estimateOrder('BUY', 2, 100, 150, 0).error).toMatch(/Not enough simulated cash/)
    expect(estimateOrder('BUY', 1, 100, 150, 0)).toEqual({ notional: 100, error: null })
    expect(estimateOrder('SELL', 5, 100, 0, 3).error).toMatch(/You hold 3/)
    expect(estimateOrder('BUY', 0, 100, 1000, 0).error).toMatch(/quantity/)
    // unknown price: no estimate, server decides
    expect(estimateOrder('BUY', 1, null, 10, 0)).toEqual({ notional: null, error: null })
  })

  it('reads FastAPI error shapes', () => {
    expect(errorText({ detail: 'nope' }, 400)).toBe('nope')
    expect(errorText({ detail: [{ msg: 'Value error, trade_date cannot be in the future' }] }, 422)).toBe(
      'trade_date cannot be in the future'
    )
    expect(errorText({}, 401)).toMatch(/sign in/)
  })

  it('keeps Cash neutral in allocation colors', () => {
    expect(sliceColor('Cash', 0)).toBe('#94a3b8')
    expect(sliceColor('Technology', 0)).not.toBe('#94a3b8')
  })
})
