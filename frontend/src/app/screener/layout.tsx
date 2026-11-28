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
      {/* The page body renders client-side; until it does, hold a viewport of
          height so the disclaimer below isn't painted at the top and then
          pushed down (measured CLS 0.21 on mobile). */}
      <div className="min-h-[100svh]">{children}</div>
      <RouteDisclaimer />
    </>
  )
}
