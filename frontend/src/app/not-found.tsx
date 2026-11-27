import type { Metadata } from 'next'
import NotFoundView from '@/components/notfound/NotFoundView'

export const metadata: Metadata = {
  title: { absolute: 'Page not found · QuantTrade AI' },
  robots: { index: false, follow: true },
}

export default function NotFound() {
  return <NotFoundView />
}
