import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { JsonLd } from '@/components/seo/JsonLd'
import { routeMetadata } from '@/lib/routeSeo'
import { breadcrumbSchema } from '@/lib/schema'

export const metadata: Metadata = routeMetadata('/markets/movers')

export default function MarketMoversLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <JsonLd data={breadcrumbSchema([{ name: 'Markets', path: '/markets' }, { name: 'Movers', path: '/markets/movers' }])} />
      {children}
    </>
  )
}
