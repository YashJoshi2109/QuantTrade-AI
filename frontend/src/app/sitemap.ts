import type { MetadataRoute } from 'next'

const BASE = 'https://www.quanttrade.us'
const now = new Date()

const BOT_SLUGS = [
  'market_weather', 'sentiment_pulse', 'movers_breakouts',
  'earnings_watch', 'real_estate_rates', 'sector_rotation',
]

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: BASE,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${BASE}/pricing`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.95,
    },
    {
      url: `${BASE}/about`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${BASE}/markets`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.85,
    },
    {
      url: `${BASE}/earnings`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${BASE}/dividends`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.75,
    },
    {
      url: `${BASE}/outlook`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${BASE}/monitor`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.85,
    },
    {
      url: `${BASE}/research`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${BASE}/screener`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${BASE}/backtest`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.75,
    },
    {
      url: `${BASE}/ideas-lab`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.75,
    },
    {
      url: `${BASE}/copilot`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${BASE}/game`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.6,
    },
    {
      url: `${BASE}/help`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${BASE}/legal`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.4,
    },
    { url: `${BASE}/markets/movers`, lastModified: now, changeFrequency: 'daily', priority: 0.75 },
    { url: `${BASE}/compare`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE}/community`, lastModified: now, changeFrequency: 'hourly', priority: 0.7 },
    { url: `${BASE}/community/discover`, lastModified: now, changeFrequency: 'daily', priority: 0.55 },
    ...BOT_SLUGS.map((slug) => ({
      url: `${BASE}/community/bots/${slug}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.45,
    })),
    { url: `${BASE}/status`, lastModified: now, changeFrequency: 'always', priority: 0.4 },
    { url: `${BASE}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ]
}
