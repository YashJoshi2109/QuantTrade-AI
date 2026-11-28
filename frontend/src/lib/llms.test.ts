import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { routeExists } from './__testutils__/routes'
import { buildLlmsFull, LLMS_FAQ } from './llmsFull'
import { GLOSSARY_TERMS, glossaryPath } from './glossary'
import { METHODOLOGY_SECTIONS } from './methodology'
import { PRO_MONTHLY, PRO_YEARLY_TOTAL, PRO_YEARLY_TRIAL_DAYS } from './pricing'
import { GET } from '@/app/llms-full.txt/route'

const LLMS = fs.readFileSync(path.resolve(__dirname, '../../public/llms.txt'), 'utf8')
const FULL = buildLlmsFull()

/** Internal paths of every markdown link and bare site URL in a document. */
function sitePaths(text: string): string[] {
  const urls = Array.from(text.matchAll(/https:\/\/www\.quanttrade\.us(\/[^\s)]*)?/g)).map((m) => m[1] ?? '/')
  const relative = Array.from(text.matchAll(/\]\((\/[^)\s]*)\)/g)).map((m) => m[1])
  return Array.from(new Set([...urls, ...relative].map((u) => u.replace(/[.,;:]+$/, ''))))
}

const BANNED = /400\+|bloomberg|institutional-grade|gpt-4|\bneon\b|vercel|render\.com|\bec2\b|nginx|docker|elasticache|\brds\b|railway|guarantee(d)? (returns|profit)/i

describe('llms.txt', () => {
  it('follows the llms.txt shape: H1, blockquote summary, dated, H2 link sections', () => {
    const lines = LLMS.split('\n')
    expect(lines[0]).toBe('# QuantTrade AI')
    expect(lines.find((l) => l.trim())).toBe('# QuantTrade AI')
    expect(lines[2].startsWith('> ')).toBe(true)
    expect(LLMS).toMatch(/^Last updated: \d{4}-\d{2}-\d{2}$/m)
    const date = LLMS.match(/^Last updated: (\d{4}-\d{2}-\d{2})$/m)![1]
    expect(date <= new Date().toISOString().slice(0, 10)).toBe(true)
    expect((LLMS.match(/^## /gm) ?? []).length).toBeGreaterThanOrEqual(4)
    // Every list item under a section is "[name](url): description" (or a bare link in Optional/Policies).
    for (const l of lines.filter((x) => /^- \[/.test(x))) expect(l).toMatch(/^- \[[^\]]+\]\(https:\/\/[^)]+\)(: .+)?$/)
  })

  it('links only to routes that exist', () => {
    const paths = sitePaths(LLMS)
    expect(paths.length).toBeGreaterThan(15)
    for (const p of paths) expect([p, routeExists(p)]).toEqual([p, true])
  })

  it('covers the core product and the new reference pages', () => {
    for (const p of ['/stocks', '/screener', '/earnings', '/dividends', '/outlook', '/markets/movers', '/backtest', '/copilot', '/community/bots', '/pricing', '/methodology', '/glossary']) {
      expect(sitePaths(LLMS)).toContain(p)
    }
  })

  it('states the real prices from lib/pricing', () => {
    expect(LLMS).toContain(`$${PRO_MONTHLY.toFixed(2)}/month`)
    expect(LLMS).toContain(`$${PRO_YEARLY_TOTAL}/year`)
    expect(LLMS).toContain(`${PRO_YEARLY_TRIAL_DAYS}-day free trial`)
  })

  it('carries the disclaimers and no infrastructure or inflated claims', () => {
    expect(LLMS).toMatch(/not investment advice/i)
    expect(LLMS).toMatch(/delayed/i)
    expect(LLMS).toMatch(/research-grade/i)
    expect(LLMS).not.toMatch(BANNED)
  })
})

describe('llms-full.txt', () => {
  it('is served as plain text from the route handler', async () => {
    const res = GET()
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/)
    expect(await res.text()).toBe(FULL)
  })

  it('is self-contained: methodology, FAQ and every glossary term', () => {
    expect(FULL.startsWith('# QuantTrade AI')).toBe(true)
    expect(FULL).toMatch(/^Last updated: \d{4}-\d{2}-\d{2}$/m)
    for (const s of METHODOLOGY_SECTIONS) {
      expect(FULL).toContain(s.question)
      expect(FULL).toContain(s.passage)
    }
    for (const f of LLMS_FAQ) expect(FULL).toContain(f.q)
    for (const t of GLOSSARY_TERMS) expect(FULL).toContain(`https://www.quanttrade.us${glossaryPath(t.slug)}`)
    expect(FULL.split(/\s+/).length).toBeGreaterThan(10000)
  })

  it('links only to routes that exist and makes no inflated claims', () => {
    for (const p of sitePaths(FULL)) expect([p, routeExists(p)]).toEqual([p, true])
    expect(FULL).not.toMatch(BANNED)
    expect(FULL).toContain(`$${PRO_MONTHLY.toFixed(2)}`)
  })
})
