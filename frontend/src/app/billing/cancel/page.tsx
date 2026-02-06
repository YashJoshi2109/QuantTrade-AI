'use client'

import AppLayout from '@/components/AppLayout'
import { ArrowLeftCircle } from 'lucide-react'
import Link from 'next/link'

export default function BillingCancelPage() {
  return (
    <AppLayout>
      <div className="min-h-[70vh] flex items-center justify-center p-6">
        <div className="hud-panel max-w-md w-full p-8 text-center">
          <ArrowLeftCircle className="w-10 h-10 text-slate-300 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-white mb-2">
            Checkout canceled
          </h1>
          <p className="text-sm text-slate-400 mb-4">
            No worries—your card was not charged. You can restart checkout at any time
            from the pricing page.
          </p>
          <div className="flex items-center justify-center gap-3 text-sm">
            <Link
              href="/"
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 transition-colors"
            >
              Back to dashboard
            </Link>
            <Link
              href="/pricing"
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors"
            >
              View plans
            </Link>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}

