import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

import UnknownTicker from './UnknownTicker'
import { normalizeTickerInput } from '@/components/notfound/TickerJumpForm'

afterEach(() => {
  cleanup()
  push.mockReset()
})

describe('UnknownTicker', () => {
  it('names the symbol and links suggestions to Research', () => {
    render(<UnknownTicker symbol="zzzzz" />)
    expect(screen.getByRole('heading').textContent).toContain('ZZZZZ')
    const suggested = screen.getByRole('list', { name: 'Suggested tickers' })
    const links = suggested.querySelectorAll('a')
    expect(links.length).toBeGreaterThan(0)
    for (const a of Array.from(links)) expect(a.getAttribute('href')).toMatch(/^\/research\?symbol=[A-Z]+$/)
    expect(screen.getByRole('link', { name: /Dashboard/ }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: /Screener/ }).getAttribute('href')).toBe('/screener')
  })

  it('does not suggest the unknown symbol itself; ranks close matches first', () => {
    render(<UnknownTicker symbol="APPL" />)
    const first = screen.getByRole('list', { name: 'Suggested tickers' }).querySelector('a')
    expect(first?.getAttribute('href')).toBe('/research?symbol=AAPL')
  })

  it('shows Try again only with onRetry and calls it', () => {
    const onRetry = vi.fn()
    const { rerender } = render(<UnknownTicker symbol="ZZZZZ" />)
    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull()
    rerender(<UnknownTicker symbol="ZZZZZ" onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('search box opens the typed ticker in Research', () => {
    render(<UnknownTicker symbol="ZZZZZ" compact />)
    fireEvent.change(screen.getByLabelText('Ticker symbol'), { target: { value: ' msft ' } })
    fireEvent.submit(screen.getByRole('search'))
    expect(push).toHaveBeenCalledWith('/research?symbol=MSFT')
  })
})

describe('normalizeTickerInput', () => {
  it('uppercases and strips junk but keeps class/crypto separators', () => {
    expect(normalizeTickerInput(' brk.b ')).toBe('BRK.B')
    expect(normalizeTickerInput('btc-usd')).toBe('BTC-USD')
    expect(normalizeTickerInput('^gspc')).toBe('^GSPC')
    expect(normalizeTickerInput('<script>')).toBe('SCRIPT')
  })
})
