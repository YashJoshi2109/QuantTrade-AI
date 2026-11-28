import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Metadata } from 'next'
import { NOINDEX, OG_IMAGE, SITE_URL, absoluteUrl, fullTitle, pageMetadata } from './seo'
import { ROUTE_SEO, routeMetadata, type SeoRoute } from './routeSeo'
import { PRO_MONTHLY, PRO_YEARLY_TOTAL } from './pricing'
import sitemap from '@/app/sitemap'

import * as authLayout from '@/app/auth/layout'
import * as settingsLayout from '@/app/settings/layout'
import * as watchlistLayout from '@/app/watchlist/layout'
import * as billingLayout from '@/app/billing/layout'
import * as connectLayout from '@/app/connect/layout'
import * as mlopsLayout from '@/app/mlops/layout'
import * as notificationsLayout from '@/app/notifications/layout'
import * as portfolioLayout from '@/app/portfolio/layout'
import * as alertsLayout from '@/app/alerts/layout'
import * as messagesLayout from '@/app/community/messages/layout'
import * as bookmarksLayout from '@/app/community/bookmarks/layout'
import * as createLayout from '@/app/community/create/layout'
import * as moderationLayout from '@/app/community/moderation/layout'
import * as marketsLayout from '@/app/markets/layout'
import * as moversLayout from '@/app/markets/movers/layout'
import * as helpLayout from '@/app/help/layout'
import * as notFoundPage from '@/app/not-found'

const SRC = path.resolve(__dirname, '..')

function canonicalOf(m: Metadata): string | undefined {
  const c = m.alternates?.canonical
  if (!c) return undefined
  const s = typeof c === 'string' ? c : c instanceof URL ? c.href : String(c.url)
  return new URL(s, SITE_URL).href
}

describe('canonical host', () => {
  it('uses www as the single canonical origin', () => {
    expect(SITE_URL).toBe('https://www.quanttrade.us')
    expect(absoluteUrl('/pricing')).toBe('https://www.quanttrade.us/pricing')
    expect(absoluteUrl('/')).toBe('https://www.quanttrade.us')
  })

  it('has no hard-coded apex URLs left in frontend/src', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.test.ts')) {
          if (/https?:\/\/quanttrade\.us/.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(SRC, p))
        }
      }
    }
    walk(SRC)
    expect(offenders).toEqual([])
  })
})

describe('route metadata', () => {
  const routes = Object.keys(ROUTE_SEO) as SeoRoute[]

  it.each(routes)('%s has a self-canonical, og:url and og:image', (route) => {
    const m = routeMetadata(route)
    expect(canonicalOf(m)).toBe(new URL(route, SITE_URL).href)
    const og = m.openGraph as { url?: string; images?: { url: string }[] }
    expect(og.url).toBe(route)
    expect(og.images?.[0]?.url).toBe(OG_IMAGE.url)
    expect(m.robots).toBeUndefined()
  })

  it.each(routes)('%s title <= 60 chars and description <= 155 chars', (route) => {
    const { title, description } = ROUTE_SEO[route]
    expect(fullTitle(title).length).toBeLessThanOrEqual(60)
    expect(description.length).toBeLessThanOrEqual(155)
    expect(description.length).toBeGreaterThanOrEqual(70)
  })

  it('titles and descriptions are unique across routes', () => {
    const titles = routes.map((r) => ROUTE_SEO[r].title)
    const descs = routes.map((r) => ROUTE_SEO[r].description)
    expect(new Set(titles).size).toBe(titles.length)
    expect(new Set(descs).size).toBe(descs.length)
  })

  it('makes no unsubstantiated claims', () => {
    for (const r of routes) {
      const text = `${ROUTE_SEO[r].title} ${ROUTE_SEO[r].description}`
      expect(text).not.toMatch(/bloomberg|institutional|guarantee|best\b/i)
    }
  })

  it('/markets/movers is its own page, not a duplicate of /markets', () => {
    const markets = marketsLayout.metadata as Metadata
    const movers = moversLayout.metadata as Metadata
    expect(canonicalOf(movers)).toBe('https://www.quanttrade.us/markets/movers')
    expect(movers.title).not.toEqual(markets.title)
    expect(movers.title).toEqual({ absolute: 'Top Stock Gainers, Losers & Most Active | QuantTrade AI' })
    expect(canonicalOf(helpLayout.metadata as Metadata)).toBe('https://www.quanttrade.us/help')
  })

  it('pricing description states the real prices', () => {
    const d = ROUTE_SEO['/pricing'].description
    expect(d).toContain(`$${PRO_MONTHLY.toFixed(2)}/month`)
    expect(d).toContain(`$${PRO_YEARLY_TOTAL}/year`)
    expect(d).not.toMatch(/\$8\b/)
  })

  it('pageMetadata re-declares the OG image when overriding openGraph', () => {
    const m = pageMetadata({ title: 'X', description: 'Y', path: '/x' })
    expect((m.openGraph as { images: unknown[] }).images).toHaveLength(1)
    expect((m.twitter as { images: string[] }).images).toEqual([OG_IMAGE.url])
  })
})

describe('private routes', () => {
  const layouts: [string, { metadata?: Metadata }][] = [
    ['/auth', authLayout],
    ['/settings', settingsLayout],
    ['/watchlist', watchlistLayout],
    ['/billing', billingLayout],
    ['/connect', connectLayout],
    ['/mlops', mlopsLayout],
    ['/notifications', notificationsLayout],
    ['/portfolio', portfolioLayout],
    ['/alerts', alertsLayout],
    ['/community/messages', messagesLayout],
    ['/community/bookmarks', bookmarksLayout],
    ['/community/create', createLayout],
    ['/community/moderation', moderationLayout],
  ]

  it.each(layouts)('%s is noindex, nofollow with no canonical', (_route, mod) => {
    expect(mod.metadata?.robots).toEqual(NOINDEX)
    expect(mod.metadata?.alternates).toBeUndefined()
  })

  it('404 page is noindex and has no canonical', () => {
    const m = notFoundPage.metadata as Metadata
    expect(m.robots).toMatchObject({ index: false })
    expect(m.alternates?.canonical).toBeNull()
  })
})

describe('sitemap', () => {
  const entries = sitemap()

  it('lists only www URLs with real dates and no priority/changefreq', () => {
    const today = new Date().toISOString().slice(0, 10)
    for (const e of entries) {
      expect(e.url.startsWith('https://www.quanttrade.us')).toBe(true)
      expect(String(e.lastModified)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(String(e.lastModified) <= today).toBe(true)
      expect(e.priority).toBeUndefined()
      expect(e.changeFrequency).toBeUndefined()
    }
  })

  it('omits the sign-in-gated game and includes /privacy', () => {
    const urls = entries.map((e) => e.url)
    expect(urls.some((u) => u.includes('/game'))).toBe(false)
    expect(urls).toContain('https://www.quanttrade.us/privacy')
  })

  it('every listed static route has route metadata', () => {
    for (const e of entries) {
      const p = new URL(e.url).pathname
      if (p.startsWith('/community/bots/')) continue
      expect(Object.keys(ROUTE_SEO)).toContain(p)
    }
  })
})
