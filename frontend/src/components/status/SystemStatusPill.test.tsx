import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import SystemStatusPill from './SystemStatusPill'
import CopilotLlmBanner from './CopilotLlmBanner'
import { SystemStatusProvider } from './SystemStatusProvider'

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const body = {
  generated_at: '2026-11-27T16:00:05Z',
  overall: 'degraded',
  services: [
    { id: 'postgres', name: 'PostgreSQL', group: 'core', status: 'ok', latency_ms: 3, last_ok_at: '2026-11-27T16:00:04Z',
      last_checked_at: '2026-11-27T16:00:04Z', detail: 'SELECT 1 in 3 ms', quota: null },
    { id: 'fmp', name: 'Financial Modeling Prep', group: 'market_data', status: 'degraded', latency_ms: null,
      last_ok_at: null, last_checked_at: '2026-11-27T16:00:03Z', detail: 'quota above 90%',
      quota: { used: 230, limit: 250, remaining: 20, resets_at: null, window: 'day (UTC)' } },
    { id: 'copilot_llm', name: 'AI Copilot (LLM)', group: 'intelligence', status: 'down', latency_ms: null,
      last_ok_at: null, last_checked_at: '2026-11-27T16:00:03Z', detail: 'the last 3 answers failed', quota: null },
  ],
}

function wrap(ui: ReactNode) {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <SystemStatusProvider>{ui}</SystemStatusProvider>
    </QueryClientProvider>,
  )
}

describe('SystemStatusPill', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {},
    }))
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows the overall state, opens the grouped list and the Copilot banner shares one poll', async () => {
    wrap(
      <>
        <SystemStatusPill />
        <CopilotLlmBanner />
      </>,
    )
    const pill = await screen.findByTestId('system-status-pill')
    await waitFor(() => expect(pill.getAttribute('data-state')).toBe('degraded'))
    expect(pill.textContent).toContain('Degraded: 2')
    expect(screen.getByTestId('copilot-llm-banner').textContent).toContain('not answering')
    // pill + banner = one subscription → one request so far
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/system/status')

    await act(async () => {
      fireEvent.click(pill)
    })
    expect(screen.getByRole('dialog', { name: 'System status' })).toBeTruthy()
    expect(screen.getByText('Core')).toBeTruthy()
    expect(screen.getByText('Market data')).toBeTruthy()
    expect(screen.getByText('Financial Modeling Prep')).toBeTruthy()
    expect(screen.getByRole('meter', { name: /Financial Modeling Prep quota/ }).getAttribute('aria-valuenow')).toBe('230')
  })

  it('reports an outage when the status API is unreachable', async () => {
    fetchMock.mockImplementation(async () => new Response('bad gateway', { status: 502 }))
    wrap(<SystemStatusPill />)
    const pill = await screen.findByTestId('system-status-pill')
    await waitFor(() => expect(pill.getAttribute('data-state')).toBe('down'))
    expect(pill.textContent).toContain('Outage')
  })
})
