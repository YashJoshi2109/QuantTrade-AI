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
      // Explicitly allow AI crawlers for AI Overviews, ChatGPT, Perplexity visibility
      {
        userAgent: ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'PerplexityBot', 'Anthropic-AI', 'Google-Extended'],
        allow: [
          '/',
          '/pricing',
          '/markets',
          '/research',
          '/backtest',
          '/ideas-lab',
          '/copilot',
          '/about',
          '/help',
          '/legal',
          '/monitor',
        ],
        disallow: ['/auth', '/settings', '/billing', '/api/'],
      },
      // Block training-only crawlers
      {
        userAgent: ['CCBot', 'Bytespider'],
        disallow: ['/'],
      },
    ],
    sitemap: 'https://www.quanttrade.us/sitemap.xml',
  }
}
