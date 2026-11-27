import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AnchorHTMLAttributes, ReactNode } from 'react'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test'
})

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import fixture from '@/lib/__fixtures__/newsFeed.json'
import LiveNews from './LiveNews'
import { coverageDays, emptyTickerMessage, resetNewsFeedAvailability } from '@/lib/newsFeed'
import { __resetNewsSocketForTests } from '@/lib/newsSocket'

class SilentSocket {
  onopen = null
  onmessage = null
  onclose = null
  onerror = null
  close() {}
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const THREE_DAYS_AGO = new Date(Date.now() - 3 * 86_400_000).toISOString()
const fetchMock = vi.fn()

function renderNews(symbol: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <LiveNews symbol={symbol} limit={8} showTitle={false} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  __resetNewsSocketForTests()
  resetNewsFeedAvailability()
  vi.stubGlobal('WebSocket', SilentSocket)
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) => {
    const u = new URL(String(url))
    if (u.pathname === '/api/v1/news/feed') {
      const ticker = u.searchParams.get('ticker')
      const items = ticker ? fixture.feed.items.filter((i) => i.tickers.includes(ticker)) : fixture.feed.items
      return jsonResponse({ ...fixture.feed, items, coverage_since: THREE_DAYS_AGO })
    }
    if (u.pathname === '/api/v1/research/QUIET/filings') {
      return jsonResponse({
        ticker: 'QUIET',
        filings: [
          { form_type: '8-K', filing_date: '2026-11-20', url: 'https://www.sec.gov/a.htm' },
          { form_type: '10-Q', filing_date: '2026-11-04', url: 'https://www.sec.gov/b.htm' },
        ],
      })
    }
    return jsonResponse({ detail: 'not found' }, 404)
  })
})

afterEach(() => {
  cleanup()
  __resetNewsSocketForTests()
  vi.unstubAllGlobals()
})

describe('empty ticker message', () => {
  it('names the window that was searched', () => {
    const now = Date.parse('2026-11-27T00:00:00Z')
    expect(coverageDays('2026-11-24T00:00:00Z', now)).toBe(3)
    expect(coverageDays('2026-11-26T20:00:00Z', now)).toBe(1)
    expect(coverageDays(null, now)).toBeNull()
    expect(emptyTickerMessage('AMD', '2026-11-24T00:00:00Z', now)).toBe('No AMD stories in the last 3 days.')
    expect(emptyTickerMessage('AMD', '2026-11-26T20:00:00Z', now)).toBe('No AMD stories in the last 1 day.')
    expect(emptyTickerMessage('AMD', null, now)).toBe('No AMD stories in recent coverage.')
  })
})

describe('LiveNews (Research news card, desktop + mobile)', () => {
  it('shows tagged stories for a covered ticker', async () => {
    renderNews('NVDA')
    expect(await screen.findByText(/NVIDIA beats/)).toBeInTheDocument()
    expect(screen.queryByTestId('news-quiet-fallback')).not.toBeInTheDocument()
  })

  it('explains an empty ticker feed and falls back to SEC filings and market news', async () => {
    renderNews('QUIET')
    expect(await screen.findByText('No QUIET stories in the last 3 days.')).toBeInTheDocument()
    expect(await screen.findByText('Recent QUIET SEC filings')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /8-K/ })).toHaveAttribute('href', 'https://www.sec.gov/a.htm')
    expect(await screen.findByText(/Market news/)).toBeInTheDocument()
    expect(await screen.findByText(/NVIDIA beats/)).toBeInTheDocument()
    expect(screen.queryByText(/stories right now/)).not.toBeInTheDocument()
  })

  it('still renders the explanation when the filings lookup fails', async () => {
    renderNews('NOFILE')
    expect(await screen.findByText('No NOFILE stories in the last 3 days.')).toBeInTheDocument()
    expect(await screen.findByText(/NVIDIA beats/)).toBeInTheDocument()
    expect(screen.queryByText(/SEC filings$/)).not.toBeInTheDocument()
  })
})
