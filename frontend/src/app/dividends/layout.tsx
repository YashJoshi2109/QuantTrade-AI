import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { JsonLd } from '@/components/seo/JsonLd'
import { routeMetadata } from '@/lib/routeSeo'
import { breadcrumbSchema } from '@/lib/schema'

export const metadata: Metadata = routeMetadata('/dividends')

export default function DividendsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <JsonLd data={breadcrumbSchema([{ name: 'Dividends', path: '/dividends' }])} />
      {children}
    </>
  )
}
