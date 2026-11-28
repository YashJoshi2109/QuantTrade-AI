import type { Metadata } from 'next'
import NotFoundView from '@/components/notfound/NotFoundView'

export const metadata: Metadata = {
  title: { absolute: 'Page not found · QuantTrade AI' },
  robots: { index: false, follow: true },
  // A 404 has no canonical URL (and must not inherit one from a route layout).
  alternates: { canonical: null },
  openGraph: null,
}

export default function NotFound() {
  return <NotFoundView />
}
