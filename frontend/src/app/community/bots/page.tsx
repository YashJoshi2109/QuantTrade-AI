import BotsClient from './BotsClient'
import { JsonLd } from '@/components/seo/JsonLd'
import { breadcrumbSchema } from '@/lib/schema'

// Breadcrumb lives on the page (not the layout) so /community/bots/[slug]
// only carries its own trail.
export default function CommunityBotsPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbSchema([
          { name: 'Community', path: '/community' },
          { name: 'Bots', path: '/community/bots' },
        ])}
      />
      <BotsClient />
    </>
  )
}
