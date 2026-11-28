import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import PostClient from './PostClient'
import { JsonLd } from '@/components/seo/JsonLd'
import { breadcrumbSchema } from '@/lib/schema'
import { pageMetadata } from '@/lib/seo'
import { clampTitle, excerpt, serverGetJson } from '@/lib/serverApi'

type Params = { params: Promise<{ id: string }> }

interface PostSummary {
  id: number
  title?: string | null
  body?: string | null
  community_name?: string | null
  community_slug?: string | null
  community?: { name?: string; slug?: string } | null
}

// Cached for 5 minutes: GET /posts/{id} also bumps the view counter, so the
// server must not call it on every crawl.
const loadPost = cache(async (id: string) =>
  /^\d{1,12}$/.test(id) ? serverGetJson<PostSummary>(`/api/v1/posts/${id}`, 300) : ({ status: 'not_found' } as const)
)

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params
  const res = await loadPost(id)
  const path = `/community/post/${id}`
  if (res.status !== 'ok') {
    return pageMetadata({
      title: 'Community Post',
      description: 'A discussion post in the QuantTrade AI trader community. Posts are opinions, not investment advice.',
      path,
      ogType: 'article',
    })
  }
  const post = res.data
  const community = post.community?.name || post.community_name
  const title = clampTitle(post.title?.trim() || (community ? `Post in ${community}` : 'Community Post'))
  const description =
    excerpt(post.body) || `A discussion post${community ? ` in ${community}` : ''} on QuantTrade AI. Opinions, not investment advice.`
  return pageMetadata({ title, description, path, ogType: 'article' })
}

export default async function PostPage({ params }: Params) {
  const { id } = await params
  const res = await loadPost(id)
  if (res.status === 'not_found') notFound()
  const crumbs = [{ name: 'Community', path: '/community' }]
  if (res.status === 'ok') {
    crumbs.push({ name: clampTitle(res.data.title?.trim() || 'Post', 80), path: `/community/post/${id}` })
  }
  return (
    <>
      <JsonLd data={breadcrumbSchema(crumbs)} />
      <PostClient />
    </>
  )
}
