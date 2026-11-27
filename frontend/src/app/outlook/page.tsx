'use client'

import MobileLayout from '@/components/layout/MobileLayout'
import OutlookDesktop from '@/components/outlook/OutlookDesktop'
import OutlookMobile from '@/components/outlook/OutlookMobile'
import { useEffect, useState } from 'react'

/** Desktop and mobile each run their own queries, so only the visible one is mounted. */
function useIsDesktop(): boolean | null {
  const [v, setV] = useState<boolean | null>(null)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const on = () => setV(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return v
}

export default function OutlookPage() {
  const desktop = useIsDesktop()
  return (
    <>
      <div className="hidden md:block">{desktop !== false && <OutlookDesktop />}</div>
      <div className="md:hidden">
        {desktop !== true && (
          <MobileLayout>
            <OutlookMobile />
          </MobileLayout>
        )}
      </div>
    </>
  )
}
