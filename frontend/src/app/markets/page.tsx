import MarketsClient from './MarketsClient'
import { JsonLd } from '@/components/seo/JsonLd'
import { breadcrumbSchema } from '@/lib/schema'

// Breadcrumb lives on the page (not the layout) so /markets/movers only
// carries its own trail.
export default function MarketsPage() {
  return (
    <>
      <JsonLd data={breadcrumbSchema([{ name: 'Markets', path: '/markets' }])} />
      <MarketsClient />
    </>
  )
}
