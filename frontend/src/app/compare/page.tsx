'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import CompareView from '@/components/compare/CompareView'
import { parseSymbols } from '@/lib/compare'

function ComparePageInner() {
  const params = useSearchParams()
  const symbols = parseSymbols(params.get('symbols'))
  return (
    <>
      <div className="hidden md:block">
        <AppLayout>
          <CompareView symbols={symbols} variant="desktop" />
        </AppLayout>
      </div>
      <div className="md:hidden">
        <MobileLayout>
          <CompareView symbols={symbols} variant="mobile" />
        </MobileLayout>
      </div>
    </>
  )
}

export default function ComparePage() {
  return (
    <Suspense fallback={null}>
      <ComparePageInner />
    </Suspense>
  )
}
