import type { Metadata } from 'next'

/**
 * Canonical origin. The apex (quanttrade.us) 301-redirects here, so every
 * canonical, og:url, sitemap entry and JSON-LD URL must use this host.
 */
export const SITE_URL = 'https://www.quanttrade.us'
export const SITE_NAME = 'QuantTrade AI'

/** Homepage <h1>: describes the product (desktop + mobile trees share it). */
export const HOME_HEADING = 'AI stock research, screening and backtesting'

/** 1200x630 social preview (frontend/public/og-image.png). */
export const OG_IMAGE = {
  url: '/og-image.png',
  width: 1200,
  height: 630,
  alt: 'QuantTrade AI: AI stock research, screening and strategy backtesting',
} as const

/** Private, per-user or utility routes: keep out of search results. */
export const NOINDEX: NonNullable<Metadata['robots']> = { index: false, follow: false }

export interface PageSeo {
  /** Page part of the title; the root template appends " | QuantTrade AI". */
  title: string
  description: string
  /** Route path, e.g. "/pricing". Resolved against metadataBase. */
  path: string
  ogType?: 'website' | 'article'
}

/** Full title as rendered in <title> (page part + root template suffix). */
export function fullTitle(title: string): string {
  return `${title} | ${SITE_NAME}`
}

/** Absolute URL on the canonical host. */
export function absoluteUrl(path: string): string {
  if (path === '/' || path === '') return SITE_URL
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

/**
 * Metadata for a public, indexable route: own title, description,
 * self-canonical, and Open Graph / Twitter tags that re-declare the image
 * (Next replaces the parent openGraph object wholesale, so images must be
 * repeated on every override).
 */
export function pageMetadata({ title, description, path, ogType = 'website' }: PageSeo): Metadata {
  const ogTitle = fullTitle(title)
  return {
    // Absolute: the root "%s | QuantTrade AI" template is skipped for the
    // homepage (same segment as the root layout) and for routes nested under a
    // layout that sets its own title, so spell the full title out everywhere.
    title: { absolute: ogTitle },
    description,
    alternates: { canonical: path },
    openGraph: {
      type: ogType,
      locale: 'en_US',
      siteName: SITE_NAME,
      url: path,
      title: ogTitle,
      description,
      images: [{ ...OG_IMAGE }],
    },
    twitter: {
      card: 'summary_large_image',
      site: '@quanttradeai',
      title: ogTitle,
      description,
      images: [OG_IMAGE.url],
    },
  }
}

/** Metadata for a private / utility route: a title for the tab, noindex, no canonical. */
export function privateMetadata(title: string): Metadata {
  return { title: { absolute: fullTitle(title) }, robots: NOINDEX }
}
