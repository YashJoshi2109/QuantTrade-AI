import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
import MarketNewsGrid, { emptyStateMessage } from './MarketNewsGrid'
import { buildCategoryTabs } from './news/NewsCategoryTabs'
import { DEFAULT_NEWS_CATEGORIES, resetNewsFeedAvailability } from '@/lib/newsFeed'
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

const fetchMock = vi.fn()
let requested: URL[] = []

function renderGrid() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MarketNewsGrid />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  requested = []
  __resetNewsSocketForTests()
  resetNewsFeedAvailability()
  vi.stubGlobal('WebSocket', SilentSocket)
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) => {
    const u = new URL(String(url))
    requested.push(u)
    if (u.pathname === '/api/v1/news/categories') return jsonResponse(fixture.categories)
    if (u.pathname === '/api/v1/news/feed') {
      const cat = u.searchParams.get('category')
      const sent = u.searchParams.get('sentiment')
      const items = fixture.feed.items.filter(
        (i) => (!cat || i.categories.includes(cat)) && (!sent || i.sentiment.label === sent)
      )
      return jsonResponse({ ...fixture.feed, items })
    }
    return jsonResponse([], 404)
  })
})

afterEach(() => {
  cleanup()
  __resetNewsSocketForTests()
  vi.unstubAllGlobals()
})

describe('buildCategoryTabs', () => {
  it('always shows All, hides zero-count tabs, overflows the rest', () => {
    const { visible, overflow } = buildCategoryTabs(
      DEFAULT_NEWS_CATEGORIES,
      { earnings: 3, macro_fed: 2, mna: 0, crypto: 4, geopolitics: 0 },
      9,
      'all'
    )
    expect(visible.map((t) => t.key)).toEqual(['all', 'earnings', 'macro_fed'])
    expect(visible[0].count).toBe(9)
    expect(overflow.map((t) => t.key)).toEqual(['crypto'])
  })

  it('keeps the selected tab visible even at zero and promotes overflow selections', () => {
    const { visible, overflow } = buildCategoryTabs(DEFAULT_NEWS_CATEGORIES, { crypto: 4, mna: 0 }, 4, 'crypto')
    expect(visible.map((t) => t.key)).toEqual(['all', 'crypto'])
    expect(overflow).toEqual([])
    expect(buildCategoryTabs(DEFAULT_NEWS_CATEGORIES, {}, 0, 'mna').visible.map((t) => t.key)).toEqual(['all', 'mna'])
  })
})

describe('emptyStateMessage', () => {
  it('names the empty filter', () => {
    expect(emptyStateMessage('earnings', 'bearish', DEFAULT_NEWS_CATEGORIES)).toBe('No bearish Earnings stories right now.')
    expect(emptyStateMessage('macro_fed', 'all', DEFAULT_NEWS_CATEGORIES)).toBe('No Macro / Fed stories right now.')
    expect(emptyStateMessage('all', 'neutral', DEFAULT_NEWS_CATEGORIES)).toBe('No neutral stories right now.')
  })
})

describe('MarketNewsGrid', () => {
  it('renders category tabs from backend counts (zero-count hidden) with an accessible tablist', async () => {
    renderGrid()
    const tablist = await screen.findByRole('tablist', { name: 'News categories' })
    await waitFor(() => expect(within(tablist).getByRole('tab', { name: /Earnings/ })).toBeInTheDocument())
    const tabs = within(tablist).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['All12', 'Earnings2', 'Macro / Fed2', 'M&A1', 'Analyst1'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: /Other/ })).toBeNull()
    // remaining non-zero categories live under More
    fireEvent.click(screen.getByRole('button', { name: /More/ }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitemradio', { name: /Crypto 2/ })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitemradio', { name: /Other/ })).toBeNull()
  })

  it('passes category / sentiment / sort to the API instead of filtering client-side', async () => {
    renderGrid()
    const tablist = await screen.findByRole('tablist')
    await screen.findByText(/NVIDIA beats/)
    fireEvent.click(within(tablist).getByRole('tab', { name: /Earnings/ }))
    await waitFor(() => expect(requested.some((u) => u.searchParams.get('category') === 'earnings')).toBe(true))
    expect(within(tablist).getByRole('tab', { name: /Earnings/ })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(screen.queryByText(/Fed minutes/)).toBeNull())
    expect(screen.getByText(/Walmart lifts/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Sort stories'), { target: { value: 'impact' } })
    await waitFor(() => expect(requested.some((u) => u.searchParams.get('sort') === 'impact')).toBe(true))
  })

  it('supports arrow-key navigation between tabs', async () => {
    renderGrid()
    const tablist = await screen.findByRole('tablist')
    await waitFor(() => expect(within(tablist).getAllByRole('tab').length).toBeGreaterThan(1))
    const [all, earnings] = within(tablist).getAllByRole('tab')
    all.focus()
    fireEvent.keyDown(all, { key: 'ArrowRight' })
    expect(earnings).toHaveFocus()
    expect(earnings).toHaveAttribute('aria-selected', 'true')
  })

  it('shows a filter-specific empty state with a Show all action', async () => {
    renderGrid()
    const tablist = await screen.findByRole('tablist')
    await screen.findByText(/NVIDIA beats/)
    fireEvent.click(within(tablist).getByRole('tab', { name: /Earnings/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Bearish' }))
    expect(await screen.findByText('No bearish Earnings stories right now.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Show all stories/ }))
    expect(await screen.findByText(/Fed minutes/)).toBeInTheDocument()
    expect(within(tablist).getByRole('tab', { name: /All/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('renders card details: sources, ticker links, sentiment score, impact, why it matters', async () => {
    renderGrid()
    await screen.findByText(/NVIDIA beats/)
    const card = screen.getByText(/NVIDIA beats/).closest('article') as HTMLElement
    expect(within(card).getByText('4 sources')).toBeInTheDocument()
    expect(within(card).getAllByRole('link', { name: 'Research NVDA' })[0]).toHaveAttribute('href', '/research?symbol=NVDA')
    expect(within(card).getByText('+0.78')).toBeInTheDocument()
    expect(within(card).getByRole('meter')).toHaveAttribute('aria-valuenow', '88')
    // hero opens "Why it matters" by default
    expect(within(card).getByRole('button', { name: /Why it matters/ })).toHaveAttribute('aria-expanded', 'true')
    expect(within(card).getByText(/Horizon: Days/)).toBeInTheDocument()
  })

  it('renders story images, falling back to the publisher favicon when there is none', async () => {
    renderGrid()
    await screen.findByText(/NVIDIA beats/)
    const hero = screen.getByText(/NVIDIA beats/).closest('article') as HTMLElement
    const heroImgs = Array.from(hero.querySelectorAll('img')).map((i) => i.getAttribute('src'))
    expect(heroImgs).toContain('https://picsum.photos/seed/qtnews1000/800/450')
    // Sorted latest: jobless-claims story (no image) is not the hero; it still gets a favicon in its source line
    const claims = screen.getByText(/jobless claims/).closest('article') as HTMLElement
    const srcs = Array.from(claims.querySelectorAll('img')).map((i) => i.getAttribute('src') ?? '')
    expect(srcs.some((s) => s.includes('favicons?domain=marketwatch.com'))).toBe(true)
  })
})
