'use client'

import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { onIdle } from '@/lib/idle'
import { hideBrandIntroPoster, shouldShowBrandIntro } from '@/lib/brandIntro'

// Both widgets are client-only and not part of first paint, so they ship as
// separate chunks instead of riding in the root layout bundle on every page.
// The intro chunk pulls in @remotion/player and is only requested for a
// first-time visitor who will actually see it.
const BrandIntroGate = dynamic(() => import('@/components/BrandIntroGate'), { ssr: false })
const ChatWidget = dynamic(() => import('@/components/chat/ChatWidget'), { ssr: false })

/**
 * Global client widgets mounted from the root layout.
 *
 * - Brand intro: decided once, on the first client render of the landing route.
 *   It is the full-screen first-visit overlay, so it only plays when the visit
 *   starts on the home page; deep links (a ticker page from search, /markets,
 *   etc.) go straight to their content.
 * - Copilot button: desktop-only floating link, mounted once the main thread
 *   is idle so it never competes with hydration.
 */
export default function DeferredGlobalWidgets() {
  const pathname = usePathname()
  const [intro, setIntro] = useState(false)
  const [chatReady, setChatReady] = useState(false)

  useEffect(() => {
    // Landing route only: read once on mount, not on every client navigation.
    const show = shouldShowBrandIntro(pathname)
    setIntro(show)
    // The poster's inline script and this check normally agree; if not, drop it.
    if (!show) hideBrandIntroPoster()
    return onIdle(() => setChatReady(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      {intro && <BrandIntroGate />}
      {chatReady && <ChatWidget />}
    </>
  )
}
