import type { Metadata } from 'next'
import HomePageClient from './HomePageClient'
import { JsonLd } from '@/components/seo/JsonLd'
import { routeMetadata } from '@/lib/routeSeo'
import { webAppSchema } from '@/lib/schema'

export const metadata: Metadata = routeMetadata('/')

export default function Home() {
  return (
    <>
      <JsonLd data={webAppSchema} />
      <HomePageClient />
    </>
  )
}
