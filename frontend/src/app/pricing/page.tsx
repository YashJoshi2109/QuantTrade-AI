import type { Metadata } from 'next'
import PricingClient from './PricingClient'
import { JsonLd } from '@/components/seo/JsonLd'
import { routeMetadata } from '@/lib/routeSeo'
import { breadcrumbSchema, webAppSchema } from '@/lib/schema'

export const metadata: Metadata = routeMetadata('/pricing')

export default function PricingPage() {
  return (
    <>
      <JsonLd data={webAppSchema} />
      <JsonLd data={breadcrumbSchema([{ name: 'Pricing', path: '/pricing' }])} />
      <PricingClient />
    </>
  )
}
