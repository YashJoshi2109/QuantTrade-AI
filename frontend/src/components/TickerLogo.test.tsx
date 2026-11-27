import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import TickerLogo from './TickerLogo'
import { __resetLogoCache, isLogoMiss, markLogoMiss } from '@/lib/logoCache'

describe('TickerLogo', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetLogoCache()
  })

  it('only ever requests the same-origin proxy (no guessed third-party URLs)', () => {
    const { container } = render(<TickerLogo symbol="defy" companyName="Defiance Gold Enhanced Options ETF" />)
    const imgs = Array.from(container.querySelectorAll('img'))
    expect(imgs).toHaveLength(1)
    expect(imgs[0].getAttribute('src')).toBe('/api/logo?symbol=DEFY')
  })

  it('shows initials and records the miss when the proxy 404s, with no retry', () => {
    const { container } = render(<TickerLogo symbol="CRY" companyName="Some ETF" />)
    const img = container.querySelector('img')!
    act(() => {
      fireEvent.error(img)
    })
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('CR')).toBeInTheDocument()
    expect(isLogoMiss('/api/logo?symbol=CRY')).toBe(true)
  })

  it('does not request a symbol already known to miss', () => {
    markLogoMiss('/api/logo?symbol=HMYY')
    const { container } = render(<TickerLogo symbol="HMYY" />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('HM')).toBeInTheDocument()
  })

  it('tries an explicit logoSrc first, then the proxy', () => {
    const { container } = render(<TickerLogo symbol="AAPL" logoSrc="https://static2.finnhub.io/logo/a.png" />)
    expect(container.querySelector('img')!.getAttribute('src')).toBe('https://static2.finnhub.io/logo/a.png')
    act(() => {
      fireEvent.error(container.querySelector('img')!)
    })
    expect(container.querySelector('img')!.getAttribute('src')).toBe('/api/logo?symbol=AAPL')
  })
})
