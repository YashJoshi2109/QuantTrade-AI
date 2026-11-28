import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import BotClient from './BotClient'
import { JsonLd } from '@/components/seo/JsonLd'
import type { CommunityBotInfo } from '@/lib/communityBots'
import { breadcrumbSchema } from '@/lib/schema'
import { pageMetadata } from '@/lib/seo'
import { clampTitle, excerpt, serverGetJson } from '@/lib/serverApi'

type Params = { params: Promise<{ slug: string }> }

const SLUG_RE = /^[a-z0-9_-]{1,64}$/

const loadBot = cache(async (slug: string) =>
  SLUG_RE.test(slug)
    ? serverGetJson<CommunityBotInfo>(`/api/v1/community-bots/${encodeURIComponent(slug)}`, 3600)
    : ({ status: 'not_found' } as const)
)

function humanize(slug: string): string {
  return slug.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const res = await loadBot(slug)
  const path = `/community/bots/${encodeURIComponent(slug)}`
  const name = res.status === 'ok' ? res.data.display_name : humanize(slug)
  const description =
    res.status === 'ok'
      ? excerpt(`${(res.data.tagline || '').replace(/[.\s]+$/, '')}. ${res.data.description || ''}`)
      : excerpt(`${name}: an automated QuantTrade AI community bot. See its method, data sources and posting schedule. Not investment advice.`)
  return pageMetadata({ title: clampTitle(`${name}: Community Market Bot`), description, path })
}

export default async function CommunityBotPage({ params }: Params) {
  const { slug } = await params
  const res = await loadBot(slug)
  if (res.status === 'not_found') notFound()
  const name = res.status === 'ok' ? res.data.display_name : humanize(slug)
  return (
    <>
      <JsonLd
        data={breadcrumbSchema([
          { name: 'Community', path: '/community' },
          { name: 'Bots', path: '/community/bots' },
          { name, path: `/community/bots/${encodeURIComponent(slug)}` },
        ])}
      />
      <BotClient />
    </>
  )
}
