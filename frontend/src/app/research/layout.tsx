import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { JsonLd } from '@/components/seo/JsonLd'
import { routeMetadata } from '@/lib/routeSeo'
import { breadcrumbSchema } from '@/lib/schema'
import RouteDisclaimer from '@/components/seo/RouteDisclaimer'

export const metadata: Metadata = routeMetadata('/research')

export default function ResearchLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <JsonLd data={breadcrumbSchema([{ name: 'Research', path: '/research' }])} />
      {children}
      <RouteDisclaimer />
    </>
  )
}
