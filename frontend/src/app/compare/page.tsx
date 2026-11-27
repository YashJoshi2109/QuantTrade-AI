'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import CompareView from '@/components/compare/CompareView'
import { parseSymbols } from '@/lib/compare'
import { usePersistedQuery } from '@/lib/persistedQuery'

function ComparePageInner() {
  const params = useSearchParams()
  // Tickers live in the URL; the last set is remembered per user and restored on a bare /compare.
  const qs = usePersistedQuery('compare.query', params?.toString() ?? '', { allowed: ['symbols'] })
  const symbols = parseSymbols(new URLSearchParams(qs).get('symbols'))
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
