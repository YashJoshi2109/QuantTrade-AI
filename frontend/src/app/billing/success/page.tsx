'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import AppLayout from '@/components/AppLayout'
import { CheckCircle2 } from 'lucide-react'
import { getBillingSessionStatus } from '@/lib/api'
import { Skeleton, SkeletonText } from '@/components/Skeleton'

function BillingSuccessContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const sessionId = searchParams?.get('session_id') ?? null

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) {
      setLoading(false)
      setError('Missing checkout session. If you completed payment, your access will still be provisioned shortly.')
      return
    }

    let cancelled = false

    async function fetchStatus() {
      try {
        const status = await getBillingSessionStatus(sessionId!)
        if (cancelled) return
        // We don&apos;t need to show all details here; just let user continue.
        setLoading(false)
        // After a short delay, send user back to dashboard.
        setTimeout(() => {
          if (!cancelled) {
            router.push('/')
          }
        }, 2500)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Unable to verify checkout session'
        setError(message)
        setLoading(false)
      }
    }

    fetchStatus()

    return () => {
      cancelled = true
    }
  }, [sessionId, router])

  return (
    <AppLayout>
      <div className="min-h-[70vh] flex items-center justify-center p-6">
        <div className="hud-panel max-w-md w-full p-8 text-center">
          {loading ? (
            <>
              <Skeleton className="w-10 h-10 rounded-full mx-auto mb-4" />
              <SkeletonText className="h-6 w-48 mx-auto mb-2" />
              <SkeletonText className="h-4 w-64 mx-auto" />
            </>
          ) : error ? (
            <>
              <h1 className="text-xl font-semibold text-white mb-2">
                Thanks for your purchase
              </h1>
              <p className="text-sm text-slate-400 mb-2">
                Your payment should still be processed. If you don&apos;t see Plus features unlocked,
                please contact support with your email and we&apos;ll sort it out.
              </p>
              <p className="text-xs text-amber-300">{error}</p>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-4" />
              <h1 className="text-xl font-semibold text-white mb-2">
                Subscription activated
              </h1>
              <p className="text-sm text-slate-400 mb-2">
                You now have access to QuantTrade Plus. Redirecting you back to your dashboard...
              </p>
            </>
          )}
        </div>
      </div>
    </AppLayout>
  )
}

export default function BillingSuccessPage() {
  return (
    <Suspense fallback={
      <AppLayout>
        <div className="min-h-[70vh] flex items-center justify-center p-6">
          <div className="hud-panel max-w-md w-full p-8 text-center">
            <Skeleton className="w-10 h-10 rounded-full mx-auto mb-4" />
            <SkeletonText className="h-6 w-48 mx-auto mb-2" />
            <SkeletonText className="h-4 w-64 mx-auto" />
          </div>
        </div>
      </AppLayout>
    }>
      <BillingSuccessContent />
    </Suspense>
  )
}

