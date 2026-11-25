import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test'
})

import fixture from './__fixtures__/newsFeed.json'
import {
  bumpCategoryCounts,
  feedItemToNewsArticle,
  fetchNewsFeedWithFallback,
  formatRelativeTime,
  formatSentimentScore,
  legacyArticleToFeedItem,
  matchesFeedParams,
  mergeFeedItems,
  newsFeedQueryKey,
  newsSocketUrl,
  normalizeFeedResponse,
  resetNewsFeedAvailability,
  sortFeedItems,
  type NewsFeedItem,
} from './newsFeed'
import type { NewsArticle } from './api'

const feed = normalizeFeedResponse(fixture.feed)
const push = fixture.push.item as unknown as NewsFeedItem

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('mergeFeedItems', () => {
  it('adds a new cluster at the top for latest sort', () => {
    const { items, added } = mergeFeedItems(feed.items, [push], { sort: 'latest', limit: 50 })
    expect(added).toEqual(['c-2001'])
    expect(items[0].cluster_id).toBe('c-2001')
    expect(items).toHaveLength(feed.items.length + 1)
  })

  it('updates an existing cluster in place without duplicating', () => {
    const updated = { ...feed.items[3], title: 'UPDATED', sources_count: 5 }
    const { items, added, updated: upd } = mergeFeedItems(feed.items, [updated], { sort: 'latest' })
    expect(added).toEqual([])
    expect(upd).toEqual([updated.cluster_id])
    expect(items.filter((i) => i.cluster_id === updated.cluster_id)).toHaveLength(1)
    expect(items.find((i) => i.cluster_id === updated.cluster_id)?.title).toBe('UPDATED')
    expect(items).toHaveLength(feed.items.length)
  })

  it('keeps impact ordering and caps the list', () => {
    const sorted = sortFeedItems(feed.items, 'impact')
    const { items } = mergeFeedItems(sorted, [push], { sort: 'impact', limit: 5 })
    expect(items).toHaveLength(5)
    const impacts = items.map((i) => i.impact)
    expect([...impacts].sort((a, b) => b - a)).toEqual(impacts)
    // push.impact=69 lands between 72 and 64
    expect(items.map((i) => i.cluster_id)).toContain('c-2001')
  })

  it('orders most bearish first', () => {
    const items = sortFeedItems(feed.items, 'bearish')
    expect(items[0].sentiment.score).toBe(-0.56)
  })

  it('drops pushed items that do not match the active filter and removes updates that stop matching', () => {
    const params = { category: 'earnings', sort: 'latest' as const }
    const earnings = feed.items.filter((i) => matchesFeedParams(i, params))
    expect(mergeFeedItems(earnings, [push], { params }).items).toHaveLength(earnings.length)
    const reclassified = { ...earnings[0], categories: ['other'], primary_category: 'other' }
    expect(mergeFeedItems(earnings, [reclassified], { params }).items).toHaveLength(earnings.length - 1)
  })

  it('dedupes duplicates inside the existing list', () => {
    const { items } = mergeFeedItems([feed.items[0], feed.items[0]], [], {})
    expect(items).toHaveLength(1)
  })
})

describe('matchesFeedParams', () => {
  it('matches ticker via tickers or ai.affected_tickers, case-insensitive', () => {
    expect(matchesFeedParams(feed.items[0], { ticker: 'nvda' })).toBe(true)
    expect(matchesFeedParams(feed.items[0], { ticker: 'AMD' })).toBe(true) // ai.affected_tickers
    expect(matchesFeedParams(feed.items[0], { ticker: 'AAPL' })).toBe(false)
  })
  it('matches secondary categories and sentiment', () => {
    expect(matchesFeedParams(feed.items[0], { category: 'guidance' })).toBe(true)
    expect(matchesFeedParams(feed.items[0], { sentiment: 'bearish' })).toBe(false)
    expect(matchesFeedParams(feed.items[0], { category: 'all' })).toBe(true)
  })
})

describe('bumpCategoryCounts', () => {
  it('increments each category and all once per new cluster', () => {
    const next = bumpCategoryCounts({ all: 12, product_business: 1 }, [push])
    expect(next).toEqual({ all: 13, product_business: 2 })
  })
})

describe('query key + helpers', () => {
  it('normalizes params so equivalent calls share a cache entry', () => {
    expect(newsFeedQueryKey({ limit: 50 })).toEqual(newsFeedQueryKey({ category: 'all', sort: 'latest', ticker: '' }))
    expect(newsFeedQueryKey({ ticker: 'aapl' })[1]).toMatchObject({ ticker: 'AAPL' })
  })
  it('formats score and relative time', () => {
    expect(formatSentimentScore(0.624)).toBe('+0.62')
    expect(formatSentimentScore(-0.4)).toBe('−0.40')
    expect(formatSentimentScore(0)).toBe('0.00')
    const now = Date.parse('2026-11-25T15:00:00Z')
    expect(formatRelativeTime('2026-11-25T14:54:00Z', now)).toBe('6m ago')
    expect(formatRelativeTime('2026-11-25T13:00:00Z', now)).toBe('2h ago')
    expect(formatRelativeTime('2026-11-25T14:59:50Z', now)).toBe('just now')
  })
  it('derives ws/wss socket URL from the API base', () => {
    expect(newsSocketUrl('https://api.example.com')).toBe('wss://api.example.com/api/v1/ws/news')
    expect(newsSocketUrl('http://localhost:8030')).toBe('ws://localhost:8030/api/v1/ws/news')
  })
})

describe('legacy fallback mapping', () => {
  const legacy = fixture.legacy_breaking as unknown as NewsArticle[]

  it('maps old articles into the unified shape with sentiment from the old field', () => {
    const it0 = legacyArticleToFeedItem(legacy[0])
    expect(it0).toMatchObject({
      title: 'Stocks edge higher as Treasury yields ease',
      summary: 'The S&P 500 rose 0.4% in early trading.',
      source: 'Yahoo Finance',
      sources_count: 1,
      tickers: ['SPY'],
      primary_category: 'other',
      sentiment: { label: 'bullish' },
      ai: null,
      legacy: true,
    })
    expect(legacyArticleToFeedItem(legacy[1]).sentiment.label).toBe('bearish')
    expect(legacyArticleToFeedItem(legacy[3]).sentiment.label).toBe('neutral')
    expect(legacyArticleToFeedItem(legacy[0], 'aapl').tickers).toEqual(['SPY', 'AAPL'])
  })

  it('round-trips to NewsArticle with the model label capitalized', () => {
    expect(feedItemToNewsArticle(feed.items[1]).sentiment).toBe('Bearish')
  })

  describe('fetchNewsFeedWithFallback', () => {
    const fetchMock = vi.fn()
    beforeEach(() => {
      resetNewsFeedAvailability()
      fetchMock.mockReset()
      vi.stubGlobal('fetch', fetchMock)
      vi.spyOn(console, 'error').mockImplementation(() => {})
    })
    afterEach(() => {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    })

    it('uses the unified feed when available', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(fixture.feed))
      const res = await fetchNewsFeedWithFallback({ limit: 50 })
      expect(res.mode).toBe('live')
      expect(res.items).toHaveLength(12)
      expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/news/feed?sort=latest&limit=50')
    })

    it('falls back to the legacy breaking endpoint on 404 and dedupes', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (String(url).includes('/news/feed')) return jsonResponse({ detail: 'Symbol not found' }, 404)
        if (String(url).includes('/enhanced/news/market/breaking')) return jsonResponse(legacy)
        return jsonResponse([], 404)
      })
      const res = await fetchNewsFeedWithFallback({ limit: 50 })
      expect(res.mode).toBe('legacy')
      expect(res.items).toHaveLength(3)
      expect(res.items[0].title).toBe('Retail sales miss forecasts in October')
      expect(res.category_counts).toEqual({ all: 3 })
      // 404 remembered: next call skips the unified endpoint
      fetchMock.mockClear()
      await fetchNewsFeedWithFallback({ limit: 50, sentiment: 'bearish' })
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/news/feed'))).toBe(false)
    })

    it('emulates sentiment filter and uses the realtime endpoint for a ticker', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (String(url).includes('/news/feed')) return jsonResponse({ detail: 'Not Found' }, 404)
        if (String(url).includes('/enhanced/news/AAPL/realtime')) return jsonResponse(legacy)
        return jsonResponse([], 404)
      })
      const res = await fetchNewsFeedWithFallback({ ticker: 'aapl', sentiment: 'bullish' })
      expect(res.items.map((i) => i.title)).toEqual(['Stocks edge higher as Treasury yields ease'])
      expect(res.items[0].tickers).toContain('AAPL')
    })

    it('treats a 200 with a non-feed body (legacy /news/{symbol} route) as unavailable', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (String(url).includes('/news/feed')) return jsonResponse([])
        return jsonResponse(legacy)
      })
      const res = await fetchNewsFeedWithFallback({})
      expect(res.mode).toBe('legacy')
    })

    it('rethrows real server errors instead of silently falling back', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}, 500))
      await expect(fetchNewsFeedWithFallback({})).rejects.toThrow(/500/)
    })
  })
})
