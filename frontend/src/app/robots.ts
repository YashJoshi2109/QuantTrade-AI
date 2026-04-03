import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: [
          '/',
          '/pricing',
          '/markets',
          '/research',
          '/backtest',
          '/ideas-lab',
          '/about',
          '/help',
          '/legal',
          '/monitor',
        ],
        disallow: [
          '/auth',
          '/settings',
          '/billing',
          '/watchlist',
          '/api/',
        ],
      },
      // Explicitly allow AI crawlers to index all public pages
      {
        userAgent: ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Anthropic-AI', 'Google-Extended'],
        allow: [
          '/',
          '/pricing',
          '/markets',
          '/research',
          '/backtest',
          '/ideas-lab',
          '/about',
          '/help',
          '/legal',
          '/monitor',
        ],
        disallow: ['/auth', '/settings', '/billing', '/api/'],
      },
    ],
    sitemap: 'https://quanttrade.us/sitemap.xml',
  }
}
