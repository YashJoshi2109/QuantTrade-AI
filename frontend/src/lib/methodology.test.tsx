import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Metadata } from 'next'
import { routeExists } from './__testutils__/routes'
import { METHODOLOGY_REVIEWED, METHODOLOGY_SECTIONS, wordCount } from './methodology'
import { SAME_AS, organizationSchema } from './schema'

vi.mock('@/components/AppLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }))

import MethodologyPage, { metadata } from '@/app/methodology/page'

function jsonLdBlocks(html: string): Record<string, unknown>[] {
  return Array.from(html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)).map((m) => JSON.parse(m[1]))
}

describe('methodology content', () => {
  it.each(METHODOLOGY_SECTIONS.map((s) => [s.id, s] as const))('%s is a 134-167 word answer to a question', (_id, s) => {
    expect(s.question).toMatch(/^(How|What)\b.*\?$/)
    expect(wordCount(s.passage)).toBeGreaterThanOrEqual(134)
    expect(wordCount(s.passage)).toBeLessThanOrEqual(167)
    for (const l of s.links ?? []) expect([l.href, routeExists(l.href)]).toEqual([l.href, true])
    for (const src of s.sources ?? []) expect(src.url).toMatch(/^https:\/\//)
  })

  it('covers every required topic once', () => {
    const ids = METHODOLOGY_SECTIONS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ['quotes', 'delays', 'fundamentals', 'dcf', 'wacc', 'backtests', 'overfitting', 'forecasts', 'news', 'bots', 'public-data', 'limits']) {
      expect(ids).toContain(id)
    }
  })

  it('is honest about forecasts and advice', () => {
    const all = METHODOLOGY_SECTIONS.map((s) => s.passage).join(' ')
    expect(all).toMatch(/no claim of predictive edge|do not claim they have an edge/)
    expect(all).toMatch(/not an investment adviser/)
    expect(all).not.toMatch(/bloomberg|guaranteed returns|institutional-grade/i)
  })
})

describe('/methodology page', () => {
  it('has self-canonical metadata', () => {
    const m = metadata as Metadata
    expect(m.alternates?.canonical).toBe('/methodology')
    expect(m.title).toEqual({ absolute: 'Methodology: How Our Numbers Are Made | QuantTrade AI' })
    expect(m.robots).toBeUndefined()
  })

  it('renders question H2s, a visible review date and the required links', () => {
    const html = renderToStaticMarkup(<MethodologyPage />)
    expect(html).toContain('<h1')
    for (const s of METHODOLOGY_SECTIONS) expect(html).toContain(`id="${s.id}"`)
    expect((html.match(/<h2/g) ?? []).length).toBe(METHODOLOGY_SECTIONS.length)
    expect(html).toContain(`Last reviewed <time dateTime="${METHODOLOGY_REVIEWED}"`)
    for (const href of ['/stocks', '/screener', '/backtest', '/about', '/glossary']) expect(html).toContain(`href="${href}"`)
  })

  it('emits TechArticle and BreadcrumbList JSON-LD with dateModified', () => {
    const blocks = jsonLdBlocks(renderToStaticMarkup(<MethodologyPage />))
    const article = blocks.find((b) => b['@type'] === 'TechArticle')!
    expect(article.dateModified).toBe(METHODOLOGY_REVIEWED)
    expect(article.url).toBe('https://www.quanttrade.us/methodology')
    expect(blocks.some((b) => b['@type'] === 'BreadcrumbList')).toBe(true)
  })
})

describe('Organization sameAs', () => {
  it('reads from the single SAME_AS constant and holds only https URLs', () => {
    expect(organizationSchema.sameAs).toEqual([...SAME_AS])
    expect(SAME_AS).toContain('https://github.com/YashJoshi2109')
    for (const u of SAME_AS) expect(u).toMatch(/^https:\/\//)
  })
})
