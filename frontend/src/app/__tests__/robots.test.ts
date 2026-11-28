import { describe, expect, it } from 'vitest'
import robots from '../robots'
import sitemap from '../sitemap'

const groups = () => {
  const r = robots().rules
  return (Array.isArray(r) ? r : [r]).map((g) => ({
    agents: ([] as string[]).concat(g.userAgent ?? []),
    allow: ([] as string[]).concat(g.allow ?? []),
    disallow: ([] as string[]).concat(g.disallow ?? []),
  }))
}

describe('robots policy', () => {
  it('blocks training crawlers entirely and never allows them', () => {
    for (const bot of ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot', 'Bytespider', 'meta-externalagent']) {
      const gs = groups().filter((g) => g.agents.includes(bot))
      expect(gs.length).toBe(1)
      expect(gs[0].disallow).toEqual(['/'])
      expect(gs[0].allow).toEqual([])
    }
  })

  it('allows answer bots but keeps private areas closed', () => {
    for (const bot of ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot']) {
      const g = groups().find((x) => x.agents.includes(bot))!
      expect(g.allow).toContain('/')
      for (const p of ['/api/', '/auth', '/settings', '/portfolio', '/community/messages']) expect(g.disallow).toContain(p)
    }
  })

  it('sitemap has unique absolute URLs and no private pages', () => {
    const urls = sitemap().map((e) => e.url)
    expect(new Set(urls).size).toBe(urls.length)
    for (const u of urls) {
      expect(u.startsWith('https://www.quanttrade.us')).toBe(true)
      expect(u).not.toMatch(/\/(auth|settings|portfolio|admin|watchlist|alerts)(\/|$|\?)/)
    }
    expect(urls).toContain('https://www.quanttrade.us/research?symbol=AAPL')
  })
})
