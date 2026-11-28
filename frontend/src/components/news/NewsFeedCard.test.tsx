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
import { imageAttribution, normalizeFeedResponse, publisherInitials, storyImageUrl, type NewsFeedItem } from '@/lib/newsFeed'

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

describe('publisher logo tile (Google News stories without an image)', () => {
  const logo = 'https://s.yimg.com/cv/apiv2/default/finance/favicon-180x180.png'

  it('shows the publisher logo in the tile instead of the monogram', () => {
    thumb({ source_logo: logo }, 'lg')
    const img = screen.getByTestId('news-publisher-logo') as HTMLImageElement
    expect(img.getAttribute('src')).toBe(logo)
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(screen.queryByText('YF')).toBeNull()
    expect(screen.getByText('Yahoo Finance')).toBeTruthy()
    expect(screen.getByText('Moves')).toBeTruthy()
  })

  it('small tiles show the logo too, and fall back to the monogram if it fails', () => {
    thumb({ source_logo: logo }, 'sm')
    fireEvent.error(screen.getByTestId('news-publisher-logo'))
    expect(screen.queryByTestId('news-publisher-logo')).toBeNull()
    expect(screen.getByText('YF')).toBeTruthy()
  })

  it('ignores non-https logos', () => {
    thumb({ source_logo: 'http://x.com/logo.png' })
    expect(screen.queryByTestId('news-publisher-logo')).toBeNull()
    expect(screen.getByText('YF')).toBeTruthy()
  })

  it('a story image still wins over the logo once loaded', () => {
    const { container } = thumb({ source_logo: logo, image_url: 'https://s.yimg.com/story.jpg' })
    const story = container.querySelector('img:not([data-testid])') as HTMLImageElement
    fireEvent.load(story)
    expect(screen.queryByTestId('news-publisher-logo')).toBeNull()
  })

  it('default cards reserve the thumbnail when a logo is available (desktop grid and mobile list)', () => {
    render(<NewsFeedCard item={{ ...base, source_logo: logo }} variant="default" />)
    expect(screen.getByTestId('news-fallback-tile')).toBeTruthy()
    expect(screen.getByTestId('news-publisher-logo')).toBeTruthy()
  })
})

describe('borrowed image credit', () => {
  it('credits a cluster sibling image once it loads', () => {
    const { container } = thumb({ source: 'WSJ', image_source: 'CNBC', image_url: 'https://image.cnbcfm.com/a.jpg' }, 'md')
    expect(screen.queryByTestId('news-image-credit')).toBeNull()
    fireEvent.load(container.querySelector('img') as HTMLImageElement)
    expect(screen.getByTestId('news-image-credit').textContent).toBe('Image: CNBC')
    expect((container.firstChild as HTMLElement).getAttribute('title')).toBe('Image: CNBC')
  })

  it("no credit for the publisher's own image or on small thumbs", () => {
    const own = thumb({ source: 'WSJ', image_source: 'WSJ', image_url: 'https://images.wsj.net/a' }, 'md')
    fireEvent.load(own.container.querySelector('img') as HTMLImageElement)
    expect(screen.queryByTestId('news-image-credit')).toBeNull()
    own.unmount()
    const sm = thumb({ source: 'WSJ', image_source: 'CNBC', image_url: 'https://image.cnbcfm.com/a.jpg' }, 'sm')
    fireEvent.load(sm.container.querySelector('img') as HTMLImageElement)
    expect(screen.queryByTestId('news-image-credit')).toBeNull()
  })

  it('imageAttribution / normalize pass-through', () => {
    expect(imageAttribution({ source: 'WSJ', image_source: 'cnbc' })).toBe('cnbc')
    expect(imageAttribution({ source: 'WSJ', image_source: 'wsj' })).toBeNull()
    expect(imageAttribution({ source: 'WSJ', image_source: null })).toBeNull()
    const r = normalizeFeedResponse({ items: [{ ...base, image_source: 'CNBC', source_logo: 'https://a.b/l.png' }] })
    expect(r.items[0].image_source).toBe('CNBC')
    expect(r.items[0].source_logo).toBe('https://a.b/l.png')
    expect(normalizeFeedResponse({ items: [{ id: '1' }] }).items[0].source_logo).toBeNull()
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
