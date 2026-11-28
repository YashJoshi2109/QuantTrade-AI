import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { routeMetadata } from '@/lib/routeSeo'

// /community/bots/[slug] overrides all of this via generateMetadata.
export const metadata: Metadata = routeMetadata('/community/bots')

export default function CommunityBotsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
