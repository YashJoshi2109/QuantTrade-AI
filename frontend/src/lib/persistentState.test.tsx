import { act, render, renderHook, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetPersistentStateForTests, arrayOf, clearPersisted, decodePersisted, getPersistScope, isBool, objectOf, oneOf,
  persistKey, readPersisted, setPersistUser, usePersistentState, writePersisted,
} from './persistentState'
import { parseStoredJob } from './persistentJob'
import { DEFAULT_CHART_PREFS, normalizeSymbol, parseChartPrefs } from './researchPrefs'
import { defaultClassicForm, parseClassicForm } from './classicBacktest'
import { pickParams } from './persistedQuery'

function env(d: unknown, v = 1, t = Date.now()) {
  return JSON.stringify({ v, t, d })
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  __resetPersistentStateForTests()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('decodePersisted', () => {
  it('returns undefined for missing, corrupt or wrong-shape values', () => {
    expect(decodePersisted(null)).toBeUndefined()
    expect(decodePersisted('{not json')).toBeUndefined()
    expect(decodePersisted('"just a string"')).toBeUndefined()
    expect(decodePersisted(JSON.stringify({ d: 1 }))).toBeUndefined()
  })

  it('drops other versions unless migrated', () => {
    expect(decodePersisted(env('old', 1), { version: 2 })).toBeUndefined()
    expect(decodePersisted(env('old', 1), { version: 2, migrate: (v, from) => `${v}@${from}` })).toBe('old@1')
    expect(decodePersisted(env('x', 2), { version: 2 })).toBe('x')
  })

  it('validates and expires', () => {
    const validate = oneOf(['a', 'b'] as const)
    expect(decodePersisted(env('a'), { validate })).toBe('a')
    expect(decodePersisted(env('zzz'), { validate })).toBeUndefined()
    expect(decodePersisted(env('a', 1, 1000), { maxAgeMs: 10 }, 2000)).toBeUndefined()
    expect(decodePersisted(env('a', 1, 1995), { maxAgeMs: 10 }, 2000)).toBe('a')
  })

  it('never throws from a validator', () => {
    expect(decodePersisted(env(1), { validate: () => { throw new Error('bad') } })).toBeUndefined()
  })
})

describe('scope and storage helpers', () => {
  it('keys per user, from the auth hint until the session is known', () => {
    expect(getPersistScope()).toBe('anon')
    window.localStorage.setItem('auth_user', JSON.stringify({ id: 42 }))
    expect(getPersistScope()).toBe('u42')
    setPersistUser(7)
    expect(getPersistScope()).toBe('u7')
    setPersistUser(null)
    expect(getPersistScope()).toBe('anon')
    expect(persistKey('k', { scope: 'global' })).toBe('qt:g:k')
  })

  it('ignores a corrupt auth hint', () => {
    window.localStorage.setItem('auth_user', '{oops')
    expect(getPersistScope()).toBe('anon')
  })

  it('round-trips and isolates users', () => {
    setPersistUser(1)
    expect(writePersisted('lab', { a: 1 })).toBe(true)
    expect(readPersisted('lab')).toEqual({ a: 1 })
    setPersistUser(2)
    expect(readPersisted('lab')).toBeUndefined()
    setPersistUser(1)
    clearPersisted('lab')
    expect(readPersisted('lab')).toBeUndefined()
  })

  it('survives storage that throws (private mode, quota)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(writePersisted('k', 1)).toBe(false)
    expect(readPersisted('k')).toBeUndefined()
    expect(() => clearPersisted('k')).not.toThrow()
  })
})

describe('usePersistentState', () => {
  it('restores the stored value on mount and falls back to the default', () => {
    window.localStorage.setItem('qt:anon:tab', env('results'))
    const { result } = renderHook(() => usePersistentState('tab', 'builder'))
    expect(result.current[0]).toBe('results')
    expect(result.current[2].restored).toBe(true)

    const other = renderHook(() => usePersistentState('missing', 'builder'))
    expect(other.result.current[0]).toBe('builder')
  })

  it('renders the default on the server (no hydration mismatch)', () => {
    window.localStorage.setItem('qt:anon:tab', env('results'))
    function View() {
      const [v] = usePersistentState('tab', 'builder')
      return <span>{v}</span>
    }
    expect(renderToString(<View />)).toContain('builder')
  })

  it('reads synchronously after hydration (client navigation: no default frame)', () => {
    renderHook(() => usePersistentState('warm', 0)) // marks hydrated
    window.localStorage.setItem('qt:anon:tab', env('trades'))
    const seen: string[] = []
    function View() {
      const [v] = usePersistentState('tab', 'builder')
      seen.push(v)
      return null
    }
    render(<View />)
    expect(seen[0]).toBe('trades')
  })

  it('debounces writes and flushes on unmount', () => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() => usePersistentState('n', 0, { debounceMs: 200 }))
    act(() => result.current[1](1))
    act(() => result.current[1]((p) => p + 1))
    expect(window.localStorage.getItem('qt:anon:n')).toBeNull()
    act(() => { vi.advanceTimersByTime(250) })
    expect(JSON.parse(window.localStorage.getItem('qt:anon:n')!).d).toBe(2)
    act(() => result.current[1](3))
    unmount()
    expect(JSON.parse(window.localStorage.getItem('qt:anon:n')!).d).toBe(3)
  })

  it('reset restores the default and forgets the stored value', () => {
    window.localStorage.setItem('qt:anon:sym', env('AAPL'))
    const { result } = renderHook(() => usePersistentState('sym', 'NVDA'))
    expect(result.current[0]).toBe('AAPL')
    act(() => result.current[2].reset())
    expect(result.current[0]).toBe('NVDA')
    expect(window.localStorage.getItem('qt:anon:sym')).toBeNull()
  })

  it('keeps two mounted instances (desktop + mobile) in sync', () => {
    function Pair() {
      const [a, setA] = usePersistentState('shared', 'x')
      const [b] = usePersistentState('shared', 'x')
      return <button onClick={() => setA('y')}>{a}-{b}</button>
    }
    render(<Pair />)
    expect(screen.getByRole('button').textContent).toBe('x-x')
    act(() => screen.getByRole('button').click())
    expect(screen.getByRole('button').textContent).toBe('y-y')
  })

  it('switches to the new user’s state when the login changes', () => {
    window.localStorage.setItem('qt:u1:filter', env('tech'))
    window.localStorage.setItem('qt:u2:filter', env('energy'))
    setPersistUser(1)
    const { result } = renderHook(() => usePersistentState('filter', ''))
    expect(result.current[0]).toBe('tech')
    act(() => setPersistUser(2))
    expect(result.current[0]).toBe('energy')
    act(() => setPersistUser(null))
    expect(result.current[0]).toBe('')
  })

  it('does not write another user’s key after a switch', () => {
    vi.useFakeTimers()
    setPersistUser(1)
    const { result } = renderHook(() => usePersistentState('draft', '', { debounceMs: 50 }))
    act(() => result.current[1]('mine'))
    act(() => setPersistUser(2))
    act(() => { vi.advanceTimersByTime(100) })
    expect(JSON.parse(window.localStorage.getItem('qt:u1:draft')!).d).toBe('mine')
    expect(window.localStorage.getItem('qt:u2:draft')).toBeNull()
    expect(result.current[0]).toBe('')
  })

  it('works when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const { result, unmount } = renderHook(() => usePersistentState('k', 'd', { debounceMs: 0 }))
    expect(result.current[0]).toBe('d')
    act(() => result.current[1]('e'))
    expect(result.current[0]).toBe('e')
    expect(() => unmount()).not.toThrow()
  })

  it('uses sessionStorage when asked', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => usePersistentState('err', '', { storage: 'session', debounceMs: 0 }))
    act(() => result.current[1]('oops'))
    act(() => { vi.advanceTimersByTime(1) })
    expect(window.sessionStorage.getItem('qt:anon:err')).not.toBeNull()
    expect(window.localStorage.getItem('qt:anon:err')).toBeNull()
  })
})

describe('validators and page schemas', () => {
  it('object/array validators keep defaults for bad fields', () => {
    const parse = objectOf({ a: 1, b: false, c: ['x'] as string[] }, { a: (v) => (typeof v === 'number' ? v : undefined), b: isBool, c: arrayOf(['x', 'y']) })
    expect(parse({ a: 'no', b: true, c: ['y', 'evil'] })).toEqual({ a: 1, b: true, c: ['y'] })
    expect(parse(null)).toBeUndefined()
    expect(parse([1])).toBeUndefined()
  })

  it('chart prefs reject unknown indicators and periods', () => {
    expect(parseChartPrefs({ period: '10Y', overlays: ['sma20', 'nope'], panes: 'rsi', seriesType: 'line' })).toEqual({
      ...DEFAULT_CHART_PREFS, overlays: ['sma20'], seriesType: 'line',
    })
    expect(normalizeSymbol(' aapl ')).toBe('AAPL')
    expect(normalizeSymbol('<script>')).toBeUndefined()
  })

  it('stored job ids are validated', () => {
    expect(parseStoredJob({ id: 'abc123', status: 'running', startedAt: 5 })).toEqual({ id: 'abc123', status: 'running', startedAt: 5 })
    expect(parseStoredJob({ id: '../etc', status: 'running' })).toBeUndefined()
    expect(parseStoredJob({ id: 'ok', status: 'weird' })?.status).toBe('queued')
    expect(parseStoredJob(null)).toBeNull()
  })

  it('classic form keeps valid fields only', () => {
    const f = parseClassicForm({ symbol: 'msft', startDate: '2020-01-01', endDate: 'tomorrow', stopLoss: null, monteCarlo: 'yes', params: { rsi_ma_crossover: { rsi_period: 10, bad: 'x' } } })!
    const d = defaultClassicForm()
    expect(f.symbol).toBe('msft')
    expect(f.startDate).toBe('2020-01-01')
    expect(f.endDate).toBe(d.endDate)
    expect(f.monteCarlo).toBe(true)
    expect(f.params).toEqual({ rsi_ma_crossover: { rsi_period: 10 } })
  })

  it('pickParams keeps only owned params', () => {
    expect(pickParams('?symbols=AAPL,MSFT&utm=x', ['symbols'])).toBe('symbols=AAPL%2CMSFT')
    expect(pickParams('a=1&b=2')).toBe('a=1&b=2')
  })
})
