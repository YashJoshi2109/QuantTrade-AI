/**
 * Schema.org JSON-LD builders. Organization + WebSite render site-wide from
 * the root layout; the WebApplication (with offers) renders only on / and
 * /pricing. Prices come from lib/pricing so markup always matches the page.
 * No ratings or reviews: none exist, so none are marked up.
 */
import { PRO_MONTHLY, PRO_YEARLY_TOTAL, PRO_YEARLY_TRIAL_DAYS } from './pricing'
import { SITE_NAME, SITE_URL, absoluteUrl } from './seo'

export const ORG_ID = `${SITE_URL}/#organization`
export const WEBSITE_ID = `${SITE_URL}/#website`
export const APP_ID = `${SITE_URL}/#app`

const CONTACT_EMAIL = 'quanttrade.us@icloud.com'

export const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': ORG_ID,
  name: SITE_NAME,
  url: SITE_URL,
  logo: { '@type': 'ImageObject', url: `${SITE_URL}/logo.png`, width: 668, height: 374 },
  email: CONTACT_EMAIL,
  contactPoint: {
    '@type': 'ContactPoint',
    email: CONTACT_EMAIL,
    contactType: 'customer support',
  },
  founder: {
    '@type': 'Person',
    name: 'Yash Joshi',
    url: 'https://github.com/YashJoshi2109',
  },
  sameAs: ['https://github.com/YashJoshi2109'],
}

export const websiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': WEBSITE_ID,
  name: SITE_NAME,
  url: SITE_URL,
  inLanguage: 'en-US',
  description: 'AI stock research, screening and strategy backtesting for US stocks',
  publisher: { '@id': ORG_ID },
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: `${SITE_URL}/research?symbol={search_term_string}`,
    },
    'query-input': 'required name=search_term_string',
  },
}

export const webAppSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  '@id': APP_ID,
  name: SITE_NAME,
  url: SITE_URL,
  applicationCategory: 'FinanceApplication',
  operatingSystem: 'Web',
  browserRequirements: 'Requires JavaScript',
  description:
    'AI stock research platform for US stocks: SEC filing analysis, earnings and dividend calendars, a stock screener, strategy backtesting and an AI research copilot that cites its sources.',
  publisher: { '@id': ORG_ID },
  screenshot: `${SITE_URL}/og-image.png`,
  featureList: [
    'AI research copilot with cited sources',
    'Strategy backtesting with Monte Carlo',
    'Stock screener',
    'Earnings and dividend calendars',
    'SEC filing analysis',
    'Global geopolitical monitor',
  ],
  offers: [
    {
      '@type': 'Offer',
      name: 'Free',
      price: '0',
      priceCurrency: 'USD',
      url: absoluteUrl('/pricing'),
      availability: 'https://schema.org/InStock',
      description: 'Markets dashboard, basic symbol research, 3 Copilot messages per day, watchlist of 5 symbols',
    },
    {
      '@type': 'Offer',
      name: 'Pro (monthly)',
      price: PRO_MONTHLY.toFixed(2),
      priceCurrency: 'USD',
      url: absoluteUrl('/pricing'),
      availability: 'https://schema.org/InStock',
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: PRO_MONTHLY.toFixed(2),
        priceCurrency: 'USD',
        billingDuration: 'P1M',
        unitCode: 'MON',
      },
    },
    {
      '@type': 'Offer',
      name: `Pro (yearly, ${PRO_YEARLY_TRIAL_DAYS}-day free trial)`,
      price: PRO_YEARLY_TOTAL.toFixed(2),
      priceCurrency: 'USD',
      url: absoluteUrl('/pricing'),
      availability: 'https://schema.org/InStock',
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: PRO_YEARLY_TOTAL.toFixed(2),
        priceCurrency: 'USD',
        billingDuration: 'P1Y',
        unitCode: 'ANN',
      },
    },
  ],
}

export interface Crumb {
  name: string
  path: string
}

/** BreadcrumbList starting at Home. Pass the trail after Home. */
export function breadcrumbSchema(trail: Crumb[]) {
  const items = [{ name: 'Home', path: '/' }, ...trail]
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: absoluteUrl(it.path),
    })),
  }
}
