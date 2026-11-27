import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/screener', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: false }) }))
vi.mock('@/components/Toast', () => ({ useToast: () => ({ info: vi.fn(), success: vi.fn(), error: vi.fn() }) }))

import { Sheet } from './ScreenerParts'

describe('screener Sheet', () => {
  afterEach(cleanup)
  it('focuses the autofocus target, traps Tab and closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <Sheet open onClose={onClose} side="right" label="AAPL overview">
        <button data-autofocus>Close</button>
        <a href="/research?symbol=AAPL">Open Research</a>
        <button>Set alert</button>
      </Sheet>
    )
    const dialog = screen.getByRole('dialog', { name: 'AAPL overview' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    // jsdom has no layout, so offsetParent is null; give the controls one.
    for (const el of Array.from(dialog.querySelectorAll('a,button'))) Object.defineProperty(el, 'offsetParent', { value: dialog })
    expect(document.activeElement).toBe(screen.getByText('Close'))

    screen.getByText('Set alert').focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByText('Close'))
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByText('Set alert'))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when closed', () => {
    render(<Sheet open={false} onClose={() => {}} side="bottom" label="Filters"><p>x</p></Sheet>)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
