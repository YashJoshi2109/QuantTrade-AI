import type { MetadataRoute } from 'next'
import { allUniverseSymbols } from '@/lib/stockPage/related'
import { SITE_URL, stockUrl } from '@/lib/stockPage/symbol'

/**
 * /stocks/sitemap.xml: the hub plus every curated ticker page. Kept separate
 * from app/sitemap.ts so the two can change independently.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  const pages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/stocks`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
  ]
  for (const symbol of allUniverseSymbols()) {
    const url = stockUrl(symbol)
    if (url) pages.push({ url, lastModified: now, changeFrequency: 'daily', priority: 0.7 })
  }
  return pages
}
