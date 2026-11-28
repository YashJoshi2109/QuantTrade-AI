import type { Metadata } from 'next'
import CommunityClient from './CommunityClient'
import { JsonLd } from '@/components/seo/JsonLd'
import { routeMetadata } from '@/lib/routeSeo'
import { breadcrumbSchema } from '@/lib/schema'

// Page-level (not layout) metadata so /community/* sub-routes do not inherit
// the /community canonical.
export const metadata: Metadata = routeMetadata('/community')

export default function CommunityPage() {
  return (
    <>
      <JsonLd data={breadcrumbSchema([{ name: 'Community', path: '/community' }])} />
      <CommunityClient />
    </>
  )
}
