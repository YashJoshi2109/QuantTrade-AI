import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import localFont from 'next/font/local'
import { JsonLd } from '@/components/seo/JsonLd'
import { routeMetadata } from '@/lib/routeSeo'
import { SITE_NAME, absoluteUrl } from '@/lib/seo'
import { ORG_ID, WEBSITE_ID, breadcrumbSchema } from '@/lib/schema'

const aboutPageSchema = {
  '@context': 'https://schema.org',
  '@type': 'AboutPage',
  url: absoluteUrl('/about'),
  name: `About ${SITE_NAME}`,
  isPartOf: { '@id': WEBSITE_ID },
  about: { '@id': ORG_ID },
}

export const metadata: Metadata = routeMetadata('/about')

const aboutDisplay = localFont({
  src: '../../fonts/fraunces-latin-var.woff2',
  weight: '100 900',
  variable: '--font-about-display',
  display: 'swap',
})

const aboutBody = localFont({
  src: '../../fonts/dmsans-latin-var.woff2',
  weight: '100 1000',
  variable: '--font-about-body',
  display: 'swap',
})

/**
 * Route-scoped typography (distinct from the rest of the app).
 * Aligns with frontend-design / UI craft guidance: editorial pairing, no generic stack-only body.
 */
export default function AboutLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${aboutDisplay.variable} ${aboutBody.variable} min-h-0 antialiased [font-family:var(--font-about-body),ui-sans-serif,system-ui,sans-serif]`}
    >
      <JsonLd data={aboutPageSchema} />
      <JsonLd data={breadcrumbSchema([{ name: 'About', path: '/about' }])} />
      {children}
    </div>
  )
}
