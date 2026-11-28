import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { JsonLd } from '@/components/seo/JsonLd'
import { routeMetadata } from '@/lib/routeSeo'
import { breadcrumbSchema } from '@/lib/schema'
import RouteDisclaimer from '@/components/seo/RouteDisclaimer'

export const metadata: Metadata = routeMetadata('/screener')

export default function ScreenerLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <JsonLd data={breadcrumbSchema([{ name: 'Screener', path: '/screener' }])} />
      {children}
      <RouteDisclaimer />
    </>
  )
}
