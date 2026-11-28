import type { MetadataRoute } from 'next'
import { SITE_URL, absoluteUrl } from '@/lib/seo'
import { GLOSSARY_REVIEWED, GLOSSARY_TERMS, glossaryPath } from '@/lib/glossary'
import { METHODOLOGY_REVIEWED } from '@/lib/methodology'

/**
 * Public, indexable routes with the date their visible content last changed
 * (from git history of each route's page files). Bump a date when you change
 * what a page shows; do not bump it for refactors. The Docker build has no
 * .git, so these dates are kept here rather than computed at build time.
 *
 * Not listed: private / per-user routes (noindex), /game (sign-in required),
 * /research?symbol=... (canonicalises to /research).
 */
const ROUTE_LASTMOD: Record<string, string> = {
  '/stocks': '2026-11-28', // hub; per-ticker pages live in /stocks/sitemap.xml
  '/': '2026-11-28',
  '/pricing': '2026-11-27',
  '/about': '2026-11-28',
  '/markets': '2026-11-27',
  '/markets/movers': '2026-11-27',
  '/earnings': '2026-11-26',
  '/dividends': '2026-11-26',
  '/outlook': '2026-11-27',
  '/monitor': '2026-11-27',
  '/research': '2026-11-27',
  '/screener': '2026-11-26',
  '/backtest': '2026-11-26',
  '/backtest/classic': '2026-11-27',
  '/ideas-lab': '2026-11-27',
  '/copilot': '2026-11-27',
  '/compare': '2026-11-26',
  '/community': '2026-11-27',
  '/community/discover': '2026-11-27',
  '/community/bots': '2026-11-27',
  '/help': '2026-11-28',
  '/legal': '2026-11-28',
  '/terms': '2026-05-17',
  '/privacy': '2026-11-28',
  '/status': '2026-11-27',
  '/methodology': METHODOLOGY_REVIEWED,
  '/glossary': GLOSSARY_REVIEWED,
}

const BOT_SLUGS = [
  'market_weather', 'sentiment_pulse', 'movers_breakouts',
  'earnings_watch', 'real_estate_rates', 'sector_rotation',
]
const BOTS_LASTMOD = '2026-11-27'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...Object.entries(ROUTE_LASTMOD).map(([path, date]) => ({
      url: path === '/' ? SITE_URL : absoluteUrl(path),
      lastModified: date,
    })),
    ...BOT_SLUGS.map((slug) => ({
      url: absoluteUrl(`/community/bots/${slug}`),
      lastModified: BOTS_LASTMOD,
    })),
    ...GLOSSARY_TERMS.map((t) => ({
      url: absoluteUrl(glossaryPath(t.slug)),
      lastModified: GLOSSARY_REVIEWED,
    })),
  ]
}
