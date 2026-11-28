import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Metadata } from 'next'
import { routeExists } from './__testutils__/routes'
import { GLOSSARY_CATEGORIES, GLOSSARY_TERMS, getTerm, glossaryPath, termTitle, termWordCount } from './glossary'
import { fullTitle } from './seo'
import { definedTermSchema, definedTermSetSchema } from './schema'
import sitemap from '@/app/sitemap'

vi.mock('@/components/AppLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

import GlossaryIndex from '@/app/glossary/page'
import * as glossaryIndexModule from '@/app/glossary/page'
import GlossaryTermPage, { generateMetadata, generateStaticParams } from '@/app/glossary/[term]/page'

function jsonLdBlocks(html: string): Record<string, unknown>[] {
  return Array.from(html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)).map((m) => JSON.parse(m[1]))
}

describe('glossary terms', () => {
  it('has 40-60 terms with unique, well-formed slugs and names', () => {
    expect(GLOSSARY_TERMS.length).toBeGreaterThanOrEqual(40)
    expect(GLOSSARY_TERMS.length).toBeLessThanOrEqual(60)
    const slugs = GLOSSARY_TERMS.map((t) => t.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    expect(new Set(GLOSSARY_TERMS.map((t) => t.term)).size).toBe(slugs.length)
    expect(new Set(GLOSSARY_TERMS.map((t) => t.short)).size).toBe(slugs.length)
  })

  it.each(GLOSSARY_TERMS.map((t) => [t.slug, t] as const))('%s has a 200+ word definition, example and valid links', (_slug, t) => {
    expect(termWordCount(t)).toBeGreaterThanOrEqual(200)
    expect(t.summary.length).toBeGreaterThanOrEqual(70)
    expect(t.summary.length).toBeLessThanOrEqual(155)
    expect(t.example.split(/\s+/).length).toBeGreaterThanOrEqual(25)
    expect(t.seeOn.length).toBeGreaterThan(0)
    for (const l of t.seeOn) expect([l.href, routeExists(l.href)]).toEqual([l.href, true])
    expect(t.related.length).toBeGreaterThan(0)
    for (const r of t.related) {
      expect(r).not.toBe(t.slug)
      expect(getTerm(r), `${t.slug} -> ${r}`).toBeDefined()
    }
    expect(fullTitle(termTitle(t.short, Boolean(t.formula))).length).toBeLessThanOrEqual(60)
    expect(`${t.body.join(' ')} ${t.example}`).not.toMatch(/investopedia|as an ai language model/i)
  })

  it('uses every category', () => {
    for (const c of GLOSSARY_CATEGORIES) expect(GLOSSARY_TERMS.some((t) => t.category === c.id)).toBe(true)
  })

  it('covers the core terms', () => {
    for (const s of ['pe-ratio', 'eps', 'rsi', 'macd', 'sharpe-ratio', 'wacc', 'discounted-cash-flow', 'form-4', 'form-13f', 'xbrl', 'look-ahead-bias', 'walk-forward-analysis', 'yield-curve', 'fama-french-factors']) {
      expect(getTerm(s), s).toBeDefined()
    }
  })
})

describe('glossary pages', () => {
  it('statically generates one page per term', () => {
    expect(generateStaticParams()).toEqual(GLOSSARY_TERMS.map((t) => ({ term: t.slug })))
  })

  it('index metadata is self-canonical', () => {
    const m = glossaryIndexModule.metadata as Metadata
    expect(m.alternates?.canonical).toBe('/glossary')
  })

  it('index groups terms by category with anchors and valid DefinedTermSet JSON-LD', () => {
    const html = renderToStaticMarkup(<GlossaryIndex />)
    expect(html).toContain('<h1')
    for (const c of GLOSSARY_CATEGORIES) expect(html).toContain(`id="${c.id}"`)
    for (const t of GLOSSARY_TERMS) expect(html).toContain(`href="${glossaryPath(t.slug)}"`)
    const set = jsonLdBlocks(html).find((b) => b['@type'] === 'DefinedTermSet') as { hasDefinedTerm: { url: string }[] }
    expect(set.hasDefinedTerm).toHaveLength(GLOSSARY_TERMS.length)
    expect(set.hasDefinedTerm[0].url).toMatch(/^https:\/\/www\.quanttrade\.us\/glossary\//)
    expect(jsonLdBlocks(html).some((b) => b['@type'] === 'BreadcrumbList')).toBe(true)
  })

  it('term page renders definition, example, links and DefinedTerm JSON-LD', async () => {
    const t = getTerm('sharpe-ratio')!
    const html = renderToStaticMarkup(await GlossaryTermPage({ params: Promise.resolve({ term: t.slug }) }))
    expect(html).toContain(t.term)
    expect(html).toContain('Worked example')
    expect(html).toContain('Where you&#x27;ll see it on QuantTrade')
    for (const l of t.seeOn) expect(html).toContain(`href="${l.href}"`)
    const blocks = jsonLdBlocks(html)
    const term = blocks.find((b) => b['@type'] === 'DefinedTerm') as Record<string, unknown>
    expect(term.url).toBe('https://www.quanttrade.us/glossary/sharpe-ratio')
    expect((term.inDefinedTermSet as { '@id': string })['@id']).toBe('https://www.quanttrade.us/glossary#termset')
    const crumbs = blocks.find((b) => b['@type'] === 'BreadcrumbList') as { itemListElement: { item: string }[] }
    expect(crumbs.itemListElement.map((i) => i.item)).toEqual([
      'https://www.quanttrade.us',
      'https://www.quanttrade.us/glossary',
      'https://www.quanttrade.us/glossary/sharpe-ratio',
    ])
  })

  it('term metadata is self-canonical with the term summary', async () => {
    const t = getTerm('rsi')!
    const m = await generateMetadata({ params: Promise.resolve({ term: 'rsi' }) })
    expect(m.alternates?.canonical).toBe('/glossary/rsi')
    expect(m.description).toBe(t.summary)
    expect((m.openGraph as { type: string }).type).toBe('article')
  })

  it('unknown terms 404', async () => {
    await expect(GlossaryTermPage({ params: Promise.resolve({ term: 'nope' }) })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('JSON-LD builders produce serialisable schema.org nodes', () => {
    const set = JSON.parse(JSON.stringify(definedTermSetSchema(GLOSSARY_TERMS, '2026-11-28')))
    expect(set['@context']).toBe('https://schema.org')
    const one = JSON.parse(JSON.stringify(definedTermSchema(GLOSSARY_TERMS[0], '2026-11-28')))
    expect(one['@type']).toBe('DefinedTerm')
    expect(one.name).toBe(GLOSSARY_TERMS[0].term)
  })
})

describe('sitemap', () => {
  it('lists /glossary, /methodology and every term page', () => {
    const urls = sitemap().map((e) => e.url)
    expect(urls).toContain('https://www.quanttrade.us/glossary')
    expect(urls).toContain('https://www.quanttrade.us/methodology')
    for (const t of GLOSSARY_TERMS) expect(urls).toContain(`https://www.quanttrade.us/glossary/${t.slug}`)
  })
})
