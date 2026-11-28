import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { privateMetadata } from '@/lib/seo'

// Per-user or utility route: keep out of search results.
export const metadata: Metadata = privateMetadata('Messages')

export default function CommunityMessagesLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
