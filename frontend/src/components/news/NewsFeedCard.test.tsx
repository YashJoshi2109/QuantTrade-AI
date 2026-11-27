import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import NewsFeedCard, { NewsThumb } from './NewsFeedCard'
import { publisherInitials, storyImageUrl, type NewsFeedItem } from '@/lib/newsFeed'

const base: NewsFeedItem = {
  id: '1',
  cluster_id: 'c-1',
  title: 'Dow posts biggest weekly gain since 2022',
  summary: '',
  url: 'https://finance.yahoo.com/markets/stocks/articles/dow-1.html',
  source: 'Yahoo Finance',
  sources_count: 1,
  sources: ['Yahoo Finance'],
  published_at: '2026-11-27T19:00:00Z',
  ingested_at: '2026-11-27T19:00:05Z',
  tickers: [],
  categories: ['market_moves'],
  primary_category: 'market_moves',
  sentiment: { label: 'bullish', score: 0.4, confidence: 0.8 },
  impact: 40,
  ai: null,
  image_url: null,
}

afterEach(cleanup)

function thumb(item: Partial<NewsFeedItem>, size: 'sm' | 'md' | 'lg' = 'lg') {
  return render(<NewsThumb item={{ ...base, ...item }} className="h-24 w-36" iconSize={size} />)
}

describe('NewsThumb', () => {
  it('shows the designed publisher tile (not a favicon) when there is no image', () => {
    const { container } = thumb({ image_url: null })
    expect(screen.getByTestId('news-fallback-tile')).toBeTruthy()
    expect(screen.getByText('Yahoo Finance')).toBeTruthy()
    expect(screen.getByText('YF')).toBeTruthy()
    expect(screen.getByText('Moves')).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
  })

  it('renders a lazy, no-referrer image over the tile and keeps the box size', () => {
    const { container } = thumb({ image_url: 'https://s.yimg.com/story.jpg' })
    const img = container.querySelector('img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('https://s.yimg.com/story.jpg')
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(img.className).toContain('absolute inset-0')
    expect((container.firstChild as HTMLElement).className).toContain('h-24 w-36')
    // tile stays visible until the image has loaded
    expect(screen.getByTestId('news-fallback-tile')).toBeTruthy()
    fireEvent.load(img)
    expect(screen.queryByTestId('news-fallback-tile')).toBeNull()
  })

  it('falls back to the tile when the image fails', () => {
    const { container } = thumb({ image_url: 'https://cdn.example.org/broken.jpg' })
    fireEvent.error(container.querySelector('img') as HTMLImageElement)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByTestId('news-fallback-tile')).toBeTruthy()
  })

  it('never renders non-https image URLs', () => {
    for (const url of ['http://cdn.example.org/a.jpg', 'javascript:alert(1)', 'data:image/gif;base64,AAAA', '/x.jpg']) {
      const { container, unmount } = thumb({ image_url: url })
      expect(container.querySelector('img')).toBeNull()
      unmount()
    }
  })

  it('small tiles show only the monogram', () => {
    thumb({ source: 'SEC EDGAR', primary_category: 'regulatory_legal' }, 'sm')
    expect(screen.getByText('SEC')).toBeTruthy()
    expect(screen.queryByText('SEC EDGAR')).toBeNull()
  })
})

describe('NewsFeedCard image slots', () => {
  it('hero/row/compact always reserve the thumbnail; default only with an image', () => {
    for (const variant of ['hero', 'row', 'compact'] as const) {
      const { unmount } = render(<NewsFeedCard item={base} variant={variant} />)
      expect(screen.getByTestId('news-fallback-tile')).toBeTruthy()
      unmount()
    }
    const { container } = render(<NewsFeedCard item={base} variant="default" />)
    expect(screen.queryByTestId('news-fallback-tile')).toBeNull()
    expect(container.querySelector('img[src*="favicons"]')).toBeTruthy() // small source-line favicon only
  })
})

describe('image helpers', () => {
  it('storyImageUrl accepts https only', () => {
    expect(storyImageUrl('https://a.b/c.jpg')).toBe('https://a.b/c.jpg')
    expect(storyImageUrl('http://a.b/c.jpg')).toBeNull()
    expect(storyImageUrl('')).toBeNull()
    expect(storyImageUrl(null)).toBeNull()
    expect(storyImageUrl('not a url')).toBeNull()
  })

  it('publisherInitials', () => {
    expect(publisherInitials('Yahoo Finance')).toBe('YF')
    expect(publisherInitials('SEC EDGAR')).toBe('SEC')
    expect(publisherInitials('PR Newswire')).toBe('PR')
    expect(publisherInitials('CNBC')).toBe('CNBC')
    expect(publisherInitials('Fiscal.Ai')).toBe('FA')
    expect(publisherInitials('Bloomberg.com')).toBe('B')
    expect(publisherInitials("Investor's Business Daily")).toBe('IBD')
    expect(publisherInitials('')).toBe('N')
  })
})
